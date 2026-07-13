#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_TURN_TIMEOUT_MS = 180000;
const DEFAULT_CLIENT_INFO = {
  name: 'egomorph_gateway',
  title: 'Egomorph Core Gateway',
  version: '1.0.0'
};

function asErrorMessage(err) {
  if (!err) return 'Unbekannter App-Server-Fehler';
  if (err.message) return String(err.message);
  return String(err);
}

function createJsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { id, error };
}

function createAbortError(message) {
  const error = new Error(message || 'Codex-Turn wurde abgebrochen');
  error.name = 'AbortError';
  return error;
}

function extractAgentTextFromTurn(turn) {
  if (!turn || !Array.isArray(turn.items)) return '';
  return turn.items
    .filter(item => item && item.type === 'agentMessage' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n')
    .trim();
}

class CodexAppServerClient {
  constructor(options = {}) {
    this.codexBin = options.codexBin || process.env.CODEX_BIN || 'codex';
    this.spawnImpl = options.spawnImpl || spawn;
    this.cwd = options.cwd || process.cwd();
    this.env = options.env || process.env;
    this.clientInfo = options.clientInfo || DEFAULT_CLIENT_INFO;
    this.requestTimeoutMs = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    this.turnTimeoutMs = options.turnTimeoutMs || DEFAULT_TURN_TIMEOUT_MS;
    this.persistSessions = options.persistSessions != null
      ? !!options.persistSessions
      : process.env.CODEX_BRIDGE_PERSIST_SESSIONS === '1';

    this.child = null;
    this.stdoutBuffer = '';
    this.stderrTail = '';
    this.nextId = 1;
    this.pending = new Map();
    this.notificationHandlers = new Set();
    this.turnCloseHandlers = new Set();
    this.sessions = new Map();
    this.sessionQueues = new Map();
    this.initializing = null;
    this.initialized = false;
    this.closed = false;
    this.lastInitialize = null;
  }

  start() {
    if (this.child) return this.child;
    this.closed = false;
    const child = this.spawnImpl(this.codexBin, ['app-server', '--stdio'], {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;

    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', chunk => this._handleStdout(chunk));
    }
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', chunk => this._handleStderr(chunk));
    }
    if (typeof child.on === 'function') {
      child.on('error', err => this._handleClose(err));
      child.on('close', code => {
        const detail = this.stderrTail ? ` ${this.stderrTail.trim().slice(-800)}` : '';
        this._handleClose(new Error(`Codex App Server beendet${code == null ? '' : ` mit Code ${code}`}.${detail}`.trim()));
      });
      child.on('exit', code => {
        if (!this.child) return;
        const detail = this.stderrTail ? ` ${this.stderrTail.trim().slice(-800)}` : '';
        this._handleClose(new Error(`Codex App Server beendet${code == null ? '' : ` mit Code ${code}`}.${detail}`.trim()));
      });
    }
    return child;
  }

  async initialize() {
    if (this.initialized) return this.lastInitialize;
    if (this.initializing) return this.initializing;

    this.start();
    this.initializing = this._requestRaw('initialize', {
      clientInfo: this.clientInfo,
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        mcpServerOpenaiFormElicitation: false,
        optOutNotificationMethods: []
      }
    }, this.requestTimeoutMs)
      .then(response => {
        this.initialized = true;
        this.lastInitialize = response;
        this._write({ method: 'initialized' });
        return response;
      })
      .catch(err => {
        this.initializing = null;
        throw err;
      });

    return this.initializing;
  }

  async request(method, params, timeoutMs) {
    await this.initialize();
    return this._requestRaw(method, params, timeoutMs || this.requestTimeoutMs);
  }

  async runTurn(options = {}) {
    const sessionId = String(options.sessionId || 'default');
    return this._enqueueSession(sessionId, () => this._runTurnNow({
      ...options,
      sessionId
    }));
  }

  resetSession(sessionId = 'default') {
    const key = String(sessionId || 'default');
    return this.sessions.delete(key);
  }

  getStatus() {
    return {
      running: !!this.child && !this.closed,
      initialized: !!this.initialized,
      pid: this.child && this.child.pid ? this.child.pid : null,
      codexBin: this.codexBin,
      persistSessions: this.persistSessions,
      queuedSessions: this.sessionQueues.size,
      activeTurns: this.turnCloseHandlers.size,
      sessions: Array.from(this.sessions.entries()).map(([sessionId, session]) => ({
        sessionId,
        threadId: session.threadId,
        turnCount: session.turnCount || 0,
        model: session.model || '',
        lastStatus: session.lastStatus || '',
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      })),
      stderrTail: this.stderrTail.trim().slice(-800)
    };
  }

  _enqueueSession(sessionId, fn) {
    const previous = this.sessionQueues.get(sessionId) || Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    const queued = next.catch(() => {});
    this.sessionQueues.set(sessionId, queued);
    queued.finally(() => {
      if (this.sessionQueues.get(sessionId) === queued) {
        this.sessionQueues.delete(sessionId);
      }
    });
    return next;
  }

  async _runTurnNow(options) {
    const signal = options.signal;
    if (signal && signal.aborted) throw createAbortError();
    const workdir = options.workdir || this.cwd;
    const session = await this._ensureThread(options);
    if (signal && signal.aborted) throw createAbortError();
    const hadPreviousTurns = session.turnCount > 0;
    const text = hadPreviousTurns && options.followupPrompt
      ? options.followupPrompt
      : options.prompt;
    if (!String(text || '').trim()) {
      throw new Error('Codex App Server Prompt fehlt');
    }

    let turnId = '';
    let content = '';
    let finalTurn = null;
    const timeoutMs = options.timeoutMs || this.turnTimeoutMs;
    let cleanupDone = () => {};
    let rejectDone = () => {};
    let closeHandler = null;
    let aborted = false;

    const interruptTurn = () => {
      if (!turnId) return Promise.resolve(false);
      return this.request('turn/interrupt', {
        threadId: session.threadId,
        turnId
      }).then(() => true, () => false);
    };

    const done = new Promise((resolve, reject) => {
      rejectDone = reject;
      const timer = setTimeout(() => {
        cleanup();
        interruptTurn().catch(() => {});
        reject(new Error(`Codex App Server Timeout nach ${timeoutMs} ms`));
      }, timeoutMs);

      const abortHandler = () => {
        if (aborted) return;
        aborted = true;
        cleanup();
        interruptTurn().catch(() => {});
        reject(createAbortError());
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.notificationHandlers.delete(handler);
        if (closeHandler) this.turnCloseHandlers.delete(closeHandler);
        if (signal && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', abortHandler);
        }
      };
      cleanupDone = cleanup;

      closeHandler = err => {
        cleanup();
        reject(err);
      };

      const handler = message => {
        if (!message || !message.method) return;
        const params = message.params || {};
        if (turnId && params.turnId && params.turnId !== turnId) return;
        if (params.threadId && params.threadId !== session.threadId) return;

        if (message.method === 'item/agentMessage/delta') {
          const delta = typeof params.delta === 'string' ? params.delta : '';
          if (delta) {
            content += delta;
            if (typeof options.onToken === 'function') options.onToken(delta);
          }
          return;
        }

        if ((message.method === 'item/started' || message.method === 'item/completed') &&
            params.item && params.item.type === 'webSearch') {
          const callback = message.method === 'item/started'
            ? options.onWebSearchStart
            : options.onWebSearchComplete;
          if (typeof callback === 'function') callback(params.item);
          return;
        }

        if (message.method === 'item/completed' &&
            params.item && params.item.type === 'agentMessage' &&
            typeof params.item.text === 'string') {
          if (!content.trim()) content = params.item.text;
          return;
        }

        if (message.method === 'turn/completed') {
          const turn = params.turn || {};
          if (turnId && turn.id && turn.id !== turnId) return;
          finalTurn = turn;
          cleanup();
          if (turn.status === 'failed') {
            const reason = turn.error && turn.error.message
              ? turn.error.message
              : 'Codex App Server Turn fehlgeschlagen';
            reject(new Error(reason));
            return;
          }
          if (!content.trim()) content = extractAgentTextFromTurn(turn);
          resolve({
            content: content.trim(),
            threadId: session.threadId,
            turnId: turn.id || turnId,
            turn
          });
        }
      };

      this.notificationHandlers.add(handler);
      this.turnCloseHandlers.add(closeHandler);
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    });
    done.catch(() => {});

    let turnResponse;
    try {
      turnResponse = await this.request('turn/start', {
        threadId: session.threadId,
        input: [{
          type: 'text',
          text: String(text),
          text_elements: []
        }],
        cwd: workdir,
        approvalPolicy: 'never',
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [workdir],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false
        },
        model: options.model || null,
        effort: options.reasoningEffort || null
      }, this.requestTimeoutMs);
    } catch (err) {
      cleanupDone();
      rejectDone(err);
      await done.catch(() => {});
      throw err;
    }
    turnId = turnResponse && turnResponse.turn && turnResponse.turn.id
      ? turnResponse.turn.id
      : '';
    if (aborted) await interruptTurn();

    const result = await done;
    session.turnCount = (session.turnCount || 0) + 1;
    session.updatedAt = new Date().toISOString();
    if (finalTurn && finalTurn.status) session.lastStatus = finalTurn.status;
    return result;
  }

  async _ensureThread(options) {
    await this.initialize();
    const sessionId = String(options.sessionId || 'default');
    if (options.resetSession) this.sessions.delete(sessionId);
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const workdir = options.workdir || this.cwd;
    const response = await this.request('thread/start', {
      cwd: workdir,
      model: options.model || null,
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
      serviceName: 'egomorph-gateway',
      ephemeral: !this.persistSessions
    }, this.requestTimeoutMs);
    const threadId = response && response.thread && response.thread.id
      ? response.thread.id
      : '';
    if (!threadId) throw new Error('Codex App Server lieferte keine Thread-ID');

    const now = new Date().toISOString();
    const session = {
      sessionId,
      threadId,
      turnCount: 0,
      model: options.model || '',
      createdAt: now,
      updatedAt: now
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  _requestRaw(method, params, timeoutMs) {
    if (this.closed) {
      return Promise.reject(new Error('Codex App Server ist geschlossen'));
    }
    this.start();
    const id = `egomorph-${this.nextId++}`;
    const message = { method, id };
    if (params !== undefined) message.params = params;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server Request Timeout (${method}) nach ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: err => {
          clearTimeout(timer);
          reject(err);
        }
      });

      try {
        this._write(message);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  _write(message) {
    if (!this.child || !this.child.stdin || this.closed) {
      throw new Error('Codex App Server stdin ist nicht verfuegbar');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  _handleStdout(chunk) {
    this.stdoutBuffer += chunk.toString('utf8');
    let index;
    while ((index = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (!line) continue;
      this._handleLine(line);
    }
  }

  _handleStderr(chunk) {
    this.stderrTail += chunk.toString('utf8');
    if (this.stderrTail.length > 4000) {
      this.stderrTail = this.stderrTail.slice(-4000);
    }
  }

  _handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (_) {
      this._handleStderr(`${line}\n`);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'id') &&
        (Object.prototype.hasOwnProperty.call(message, 'result') ||
          Object.prototype.hasOwnProperty.call(message, 'error'))) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'id') && message.method) {
      this._handleServerRequest(message);
      return;
    }

    if (message.method) {
      for (const handler of Array.from(this.notificationHandlers)) {
        try {
          handler(message);
        } catch (_) {
          // Notification handlers are per-turn observers; one failing observer
          // must not break the shared app-server connection.
        }
      }
    }
  }

  _handleServerRequest(message) {
    const method = message.method;
    const id = message.id;
    if (method === 'currentTime/read') {
      this._write({ id, result: { currentTimeAt: Math.floor(Date.now() / 1000) } });
      return;
    }
    if (method === 'item/commandExecution/requestApproval') {
      this._write({ id, result: { decision: 'cancel' } });
      return;
    }
    if (method === 'item/fileChange/requestApproval') {
      this._write({ id, result: { decision: 'cancel' } });
      return;
    }
    if (method === 'applyPatchApproval' || method === 'execCommandApproval') {
      this._write({ id, result: { decision: 'abort' } });
      return;
    }
    if (method === 'item/tool/requestUserInput') {
      this._write({ id, result: { answers: {} } });
      return;
    }
    if (method === 'mcpServer/elicitation/request') {
      this._write({ id, result: { action: 'cancel', content: null, _meta: null } });
      return;
    }
    this._write(createJsonRpcError(id, -32601, `Egomorph Core Gateway unterstuetzt Server-Request ${method} nicht`));
  }

  _handleClose(err) {
    if (this.closed && !this.child) return;
    this.closed = true;
    this.child = null;
    this.initialized = false;
    this.initializing = null;
    this.sessions.clear();
    const error = err instanceof Error ? err : new Error(asErrorMessage(err));
    for (const handler of Array.from(this.turnCloseHandlers)) {
      try {
        handler(error);
      } catch (_) {
        // Reject every active turn even if one observer unexpectedly fails.
      }
    }
    this.turnCloseHandlers.clear();
    this.notificationHandlers.clear();
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

module.exports = {
  CodexAppServerClient,
  extractAgentTextFromTurn
};
