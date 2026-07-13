const EventEmitter = require('events');
const { CodexAppServerClient } = require('../scripts/codex-app-server-client');

function createClosingAppServer() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write(line) {
      const message = JSON.parse(String(line).trim());
      if (!message.id) return true;

      let result = {};
      if (message.method === 'thread/start') {
        result = { thread: { id: 'thread-test' } };
      } else if (message.method === 'turn/start') {
        result = { turn: { id: 'turn-test', status: 'inProgress' } };
      }

      process.nextTick(() => {
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: message.id, result })}\n`));
        if (message.method === 'turn/start') {
          setImmediate(() => child.emit('close', 9));
        }
      });
      return true;
    }
  };
  return child;
}

function createInterruptibleAppServer(messages, turnStarted) {
  const child = new EventEmitter();
  child.pid = 4343;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write(line) {
      const message = JSON.parse(String(line).trim());
      messages.push(message);
      if (!message.id) return true;
      let result = {};
      if (message.method === 'thread/start') result = { thread: { id: 'thread-interrupt' } };
      if (message.method === 'turn/start') result = { turn: { id: 'turn-interrupt', status: 'inProgress' } };
      process.nextTick(() => {
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: message.id, result })}\n`));
        if (message.method === 'turn/start') turnStarted();
      });
      return true;
    }
  };
  return child;
}

function createWebSearchAppServer() {
  const child = new EventEmitter();
  child.pid = 4444;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write(line) {
      const message = JSON.parse(String(line).trim());
      if (!message.id) return true;
      let result = {};
      if (message.method === 'thread/start') result = { thread: { id: 'thread-web' } };
      if (message.method === 'turn/start') result = { turn: { id: 'turn-web', status: 'inProgress' } };
      process.nextTick(() => {
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: message.id, result })}\n`));
        if (message.method === 'turn/start') {
          setImmediate(() => {
            const notifications = [
              { method: 'item/started', params: { threadId: 'thread-web', turnId: 'turn-web', item: { id: 'web-1', type: 'webSearch', query: 'news' } } },
              { method: 'item/completed', params: { threadId: 'thread-web', turnId: 'turn-web', item: { id: 'web-1', type: 'webSearch', query: 'news' } } },
              { method: 'item/agentMessage/delta', params: { threadId: 'thread-web', turnId: 'turn-web', delta: 'Aktuell' } },
              { method: 'turn/completed', params: { threadId: 'thread-web', turn: { id: 'turn-web', status: 'completed' } } }
            ];
            notifications.forEach(notification => child.stdout.emit('data', Buffer.from(`${JSON.stringify(notification)}\n`)));
          });
        }
      });
      return true;
    }
  };
  return child;
}

describe('codex app-server client', () => {
  test('forwards authoritative Codex web-search item lifecycle events', async () => {
    const client = new CodexAppServerClient({
      spawnImpl: createWebSearchAppServer,
      requestTimeoutMs: 1000,
      turnTimeoutMs: 10000
    });
    const events = [];

    const result = await client.runTurn({
      prompt: 'Was ist aktuell?',
      sessionId: 'chat-web',
      onWebSearchStart: item => events.push(['started', item.id]),
      onWebSearchComplete: item => events.push(['completed', item.id])
    });

    expect(result.content).toBe('Aktuell');
    expect(events).toEqual([['started', 'web-1'], ['completed', 'web-1']]);
  });

  test('rejects an active turn immediately when the app server exits', async () => {
    const client = new CodexAppServerClient({
      spawnImpl: createClosingAppServer,
      requestTimeoutMs: 1000,
      turnTimeoutMs: 10000
    });

    await expect(client.runTurn({
      prompt: 'Hallo',
      sessionId: 'chat-close'
    })).rejects.toThrow('Codex App Server beendet mit Code 9');

    await new Promise(resolve => setImmediate(resolve));
    expect(client.getStatus()).toEqual(expect.objectContaining({
      running: false,
      activeTurns: 0,
      queuedSessions: 0
    }));
  });

  test('releases completed per-session queues', async () => {
    const client = new CodexAppServerClient();
    const first = client._enqueueSession('chat-ok', async () => 'eins');
    const second = client._enqueueSession('chat-ok', async () => 'zwei');

    await expect(Promise.all([first, second])).resolves.toEqual(['eins', 'zwei']);
    await new Promise(resolve => setImmediate(resolve));
    expect(client.sessionQueues.size).toBe(0);
  });

  test('maps browser conversation ids to separate reusable Codex threads', async () => {
    const client = new CodexAppServerClient();
    client.initialize = jest.fn(async () => ({}));
    let threadCount = 0;
    client.request = jest.fn(async method => {
      expect(method).toBe('thread/start');
      threadCount += 1;
      return { thread: { id: `thread-${threadCount}` } };
    });

    const first = await client._ensureThread({ sessionId: 'chat-a' });
    const second = await client._ensureThread({ sessionId: 'chat-b' });
    const firstAgain = await client._ensureThread({ sessionId: 'chat-a' });

    expect(first.threadId).toBe('thread-1');
    expect(second.threadId).toBe('thread-2');
    expect(firstAgain).toBe(first);
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  test('interrupts the active app-server turn when the browser aborts', async () => {
    const messages = [];
    let markTurnStarted;
    const turnStarted = new Promise(resolve => { markTurnStarted = resolve; });
    const client = new CodexAppServerClient({
      spawnImpl: () => createInterruptibleAppServer(messages, markTurnStarted),
      requestTimeoutMs: 1000,
      turnTimeoutMs: 10000
    });
    const controller = new AbortController();
    const turn = client.runTurn({
      prompt: 'Bitte lange nachdenken',
      sessionId: 'chat-interrupt',
      reasoningEffort: 'high',
      signal: controller.signal
    });

    await turnStarted;
    controller.abort();
    await expect(turn).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise(resolve => setImmediate(resolve));

    const start = messages.find(message => message.method === 'turn/start');
    expect(start.params.effort).toBe('high');
    expect(messages).toContainEqual(expect.objectContaining({
      method: 'turn/interrupt',
      params: { threadId: 'thread-interrupt', turnId: 'turn-interrupt' }
    }));
  });

  test('does not start a turn when cancellation happens during thread setup', async () => {
    const client = new CodexAppServerClient();
    let resolveThread;
    let markSetupStarted;
    const setupStarted = new Promise(resolve => { markSetupStarted = resolve; });
    client._ensureThread = jest.fn(() => {
      markSetupStarted();
      return new Promise(resolve => { resolveThread = resolve; });
    });
    client.request = jest.fn();
    const controller = new AbortController();
    const turn = client.runTurn({ prompt: 'Hallo', signal: controller.signal });

    await setupStarted;
    controller.abort();
    resolveThread({ threadId: 'thread-late', turnCount: 0 });

    await expect(turn).rejects.toMatchObject({ name: 'AbortError' });
    expect(client.request).not.toHaveBeenCalled();
  });
});
