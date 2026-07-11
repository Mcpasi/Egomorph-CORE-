const EventEmitter = require('events');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  createGatewayServer,
  getGatewayUrl,
  isLoopbackBind,
  normalizePort
} = require('../scripts/egomorph-gateway');
const {
  parseArgs,
  runClean,
  runCodexLogin
} = require('../scripts/egomorph');

const root = path.resolve(__dirname, '..');

describe('egomorph gateway', () => {
  async function withGateway(testFn) {
    const server = createGatewayServer({
      runLoginStatus: async () => ({
        loggedIn: true,
        method: 'ChatGPT',
        persistent: true,
        message: 'ok',
        raw: 'Logged in using ChatGPT'
      })
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      await testFn(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  test('serves the dashboard from the reserved gateway server', async () => {
    await withGateway(async baseUrl => {
      const response = await fetch(`${baseUrl}/`);
      const html = await response.text();

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(html).toContain('EgoMorph');
      expect(html).toContain('resourceProfile.js');
      expect(html).toContain('conversationStore.js');
    });
  });

  test('serves every local startup dependency referenced by the dashboard', async () => {
    await withGateway(async baseUrl => {
      const html = await fetch(`${baseUrl}/`).then(response => response.text());
      const assetPaths = Array.from(html.matchAll(/(?:src|href)=["']([^"']+)["']/g))
        .map(match => match[1])
        .filter(asset => !/^(?:https?:|data:|#)/.test(asset));

      for (const asset of new Set(assetPaths)) {
        const response = await fetch(new URL(asset, `${baseUrl}/`));
        expect({ asset, status: response.status }).toEqual({ asset, status: 200 });
      }
    });
  });

  test('keeps gateway API routes available next to the dashboard', async () => {
    await withGateway(async baseUrl => {
      const gatewayStatus = await fetch(`${baseUrl}/gateway/status`).then(resp => resp.json());
      const codexStatus = await fetch(`${baseUrl}/codex/status`).then(resp => resp.json());

      expect(gatewayStatus).toEqual(expect.objectContaining({
        ok: true,
        service: 'egomorph-gateway',
        dashboard: '/'
      }));
      expect(gatewayStatus.endpoints.chatCompletions).toBe('/v1/chat/completions');
      expect(gatewayStatus.endpoints.codexSessions).toBe('/codex/sessions');
      expect(codexStatus.login).toEqual(expect.objectContaining({
        loggedIn: true,
        method: 'ChatGPT'
      }));
    });
  });

  test('marks clean dashboard responses for browser cache eviction', async () => {
    await withGateway(async baseUrl => {
      const response = await fetch(`${baseUrl}/?egomorph-clean=1`);
      expect(response.ok).toBe(true);
      expect(response.headers.get('clear-site-data')).toBe('"cache"');
      await response.text();
    });
  });

  test('exposes app-server session diagnostics without static file caching', async () => {
    await withGateway(async baseUrl => {
      const response = await fetch(`${baseUrl}/codex/sessions`);
      const payload = await response.json();

      expect(response.ok).toBe(true);
      expect(payload).toEqual(expect.objectContaining({
        ok: true,
        engine: 'app-server',
        sessions: []
      }));
    });
  });

  test('does not expose project internals as static dashboard files', async () => {
    await withGateway(async baseUrl => {
      const bridgeSource = await fetch(`${baseUrl}/scripts/codex-bridge.js`);
      const modelHome = await fetch(`${baseUrl}/EgomorphCore/model-home/memory.md`);

      expect(bridgeSource.status).toBe(404);
      expect(modelHome.status).toBe(404);
    });
  });

  test('parses gateway flags and formats dashboard URLs', () => {
    expect(parseArgs(['dashboard', '--port', '8788', '--no-open'])).toEqual({
      positionals: ['dashboard'],
      flags: { port: '8788', noOpen: true }
    });
    expect(parseArgs(['dashboard', '--port', '--no-open'])).toEqual({
      positionals: ['dashboard'],
      flags: { noOpen: true }
    });
    expect(parseArgs(['gateway', '--host', '--open'])).toEqual({
      positionals: ['gateway'],
      flags: { open: true }
    });
    expect(normalizePort('bad')).toBe(8787);
    expect(getGatewayUrl('127.0.0.1', 8787)).toBe('http://localhost:8787/');
  });

  test('recognizes only real loopback bind hosts as local', () => {
    expect(isLoopbackBind('localhost')).toBe(true);
    expect(isLoopbackBind('127.0.0.1')).toBe(true);
    expect(isLoopbackBind('127.1.2.3')).toBe(true);
    expect(isLoopbackBind('::1')).toBe(true);
    expect(isLoopbackBind('127.example.test')).toBe(false);
    expect(isLoopbackBind('0.0.0.0')).toBe(false);
  });

  test('root launcher works from the project folder and its parent folder', () => {
    const projectRun = spawnSync('./egomorph', ['--help'], {
      cwd: root,
      encoding: 'utf8'
    });
    const parentRun = spawnSync(path.join('.', path.basename(root), 'egomorph'), ['--help'], {
      cwd: path.dirname(root),
      encoding: 'utf8'
    });
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    expect(pkg.bin.egomorph).toBe('egomorph');
    expect(projectRun.status).toBe(0);
    expect(projectRun.stdout).toContain('Egomorph Core Gateway CLI');
    expect(projectRun.stdout).toContain('egomorph clean');
    expect(parentRun.status).toBe(0);
    expect(parentRun.stdout).toContain('./<projektordner>/egomorph dashboard');
  });

  test('codex login command uses the persistent automatic credential store', async () => {
    const calls = [];
    const spawnImpl = (bin, args, options) => {
      calls.push({ bin, args, options });
      const child = new EventEmitter();
      process.nextTick(() => child.emit('exit', 0));
      return child;
    };

    const code = await runCodexLogin({
      codexBin: 'codex-test',
      deviceAuth: true,
      spawnImpl,
      stdio: 'ignore'
    });

    expect(code).toBe(0);
    expect(calls[0].bin).toBe('codex-test');
    expect(calls[0].args).toEqual([
      'login',
      '-c',
      'cli_auth_credentials_store="auto"',
      '--device-auth'
    ]);
    expect(calls[0].options.stdio).toBe('ignore');
  });

  test('clean command opens the cache-cleaning URL without deleting user data', async () => {
    const opened = [];
    const logs = [];
    const code = await runClean({}, {
      probeGateway: async () => true,
      openUrl: url => { opened.push(url); return true; },
      logger: { log: message => logs.push(message) }
    });

    expect(code).toBe(0);
    expect(opened).toEqual(['http://localhost:8787/?egomorph-clean=1']);
    expect(logs.join('\n')).toContain('Unterhaltungen und Einstellungen bleiben erhalten');
  });
});
