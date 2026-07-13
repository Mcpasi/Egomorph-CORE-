const {
  buildCodexPrompt,
  chatCompletionFromRequest,
  extractMemoryDirective,
  extractRequestedFilePaths,
  getCodexStatusPayload,
  getCodexEngine,
  getCodexModels,
  getModelHomeDir,
  isOriginAllowed,
  normalizeMessages,
  parseCodexLoginStatus,
  readAllowedModelFile,
  readExtendedModelFile,
  runCodexCompletion,
  writeExtendedModelFile,
  writeModelMarkdownFile
} = require('../scripts/codex-bridge');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('codex bridge', () => {
  test('defaults model home to the Egomorph Core project directory', () => {
    expect(getModelHomeDir()).toBe(path.resolve(__dirname, '..', 'EgomorphCore', 'model-home'));
  });

  test('normalizes OpenAI-style messages and keeps supported roles', () => {
    expect(normalizeMessages([
      { role: 'system', content: 'Regel' },
      { role: 'assistant', content: [{ text: 'Vorherige Antwort' }] },
      { role: 'tool', content: 'Nutzertext' },
      { role: 'user', content: '   ' }
    ])).toEqual([
      { role: 'system', content: 'Regel' },
      { role: 'assistant', content: 'Vorherige Antwort' },
      { role: 'user', content: 'Nutzertext' }
    ]);
  });

  test('builds a pure chat prompt for Codex', () => {
    const prompt = buildCodexPrompt([
      { role: 'system', content: 'Antworte knapp.' },
      { role: 'user', content: 'Hallo' }
    ], { maxTokens: 42 });

    expect(prompt).toContain('Du bist die lokale Codex-Bridge fuer Egomorph Core.');
    expect(prompt).toContain('Das Egomorph-Core-Modell-Home ist dein erlaubter lokaler Arbeitsbereich.');
    expect(prompt).toContain('mit relativen Pfaden frei orientieren');
    expect(prompt).toContain('Markdown-Dateien (.md) direkt im Modell-Home');
    expect(prompt).toContain('memory.md ist die reservierte Memory-Datei');
    expect(prompt).toContain('Wenn sie fehlt oder geloescht wurde');
    expect(prompt).toContain('Ziel-Laenge: maximal etwa 42 Antwort-Tokens');
    expect(prompt).toContain('<egomorph_skill_request>');
    expect(prompt).toContain('System: Antworte knapp.');
    expect(prompt).toContain('Nutzer: Hallo');
    expect(prompt.trim().endsWith('Egomorph Core:')).toBe(true);
  });

  test('shows the default model home as a repo-relative Egomorph Core path in prompts', () => {
    const modelHome = getModelHomeDir();
    const prompt = buildCodexPrompt([
      { role: 'user', content: 'Hallo' }
    ], {
      modelHomeContext: {
        homeDir: modelHome,
        memoryFile: path.join(modelHome, 'memory.md'),
        memory: 'Profilnotiz'
      }
    });

    expect(prompt).toContain('Modell-Home: EgomorphCore/model-home');
    expect(prompt).toContain('Memory-Datei: EgomorphCore/model-home/memory.md');
    expect(prompt).toContain('relative Dateinamen beziehen sich auf dieses Verzeichnis');
    expect(prompt).toContain('du darfst dich darin frei mit relativen Pfaden bewegen');
    expect(prompt).toContain('Wenn memory.md fehlt oder geloescht wurde');
    expect(prompt).not.toContain(path.resolve(__dirname, '..'));
  });

  test('extracts memory and requested model-home files from user text', () => {
    expect(extractMemoryDirective('merk dir - ich moechte Pasi genannt werden'))
      .toBe('ich moechte Pasi genannt werden');
    expect(extractRequestedFilePaths('Lies bitte profile.txt und "notes.md"')).toEqual([
      'profile.txt',
      'notes.md'
    ]);
  });

  test('stores memory.md and injects it into the codex prompt', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'egomorph-home-'));
    expect(fs.existsSync(path.join(home, 'memory.md'))).toBe(false);
    const runner = jest.fn(async ({ prompt, workdir }) => {
      expect(workdir).toBe(home);
      expect(prompt).toContain('Inhalt von memory.md');
      expect(prompt).toContain('ich moechte Pasi genannt werden');
      expect(prompt).toContain('Die Bridge hat Memory-Aenderungen bereits vor diesem Modellaufruf in memory.md geschrieben.');
      expect(prompt).toContain('Wenn memory.md fehlt oder geloescht wurde, darf sie fuer ausdrueckliche Memory-Eintraege neu angelegt werden.');
      expect(prompt).toContain('Behaupte dann niemals, du koenntest nichts speichern.');
      return 'Gemerkte Antwort';
    });

    const response = await chatCompletionFromRequest({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'merk dir - ich moechte Pasi genannt werden' }]
    }, {
      runCodex: runner,
      modelHome: home,
      now: new Date('2026-07-05T00:00:00Z')
    });

    expect(response.choices[0].message.content).toBe('Gemerkte Antwort');
    expect(fs.existsSync(path.join(home, 'memory.md'))).toBe(true);
    expect(fs.readFileSync(path.join(home, 'memory.md'), 'utf8')).toContain(
      '- 2026-07-05: ich moechte Pasi genannt werden'
    );
  });

  test('provides allowed file context and blocks scripts or traversal', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'egomorph-home-'));
    fs.writeFileSync(path.join(home, 'profile.txt'), 'Name: Pasi', 'utf8');
    fs.writeFileSync(path.join(home, 'app.js'), 'console.log("secret")', 'utf8');

    const allowed = readAllowedModelFile(home, 'profile.txt');
    expect(allowed).toEqual(expect.objectContaining({
      path: 'profile.txt',
      content: 'Name: Pasi'
    }));
    expect(() => readAllowedModelFile(home, 'app.js')).toThrow('Script-Dateien');
    expect(() => readAllowedModelFile(home, '../profile.txt')).toThrow('ausserhalb');

    const runner = jest.fn(async ({ prompt }) => {
      expect(prompt).toContain('--- profile.txt ---');
      expect(prompt).toContain('Name: Pasi');
      expect(prompt).toContain('app.js: Script-Dateien duerfen nicht gelesen werden');
      return 'Dateikontext Antwort';
    });

    await chatCompletionFromRequest({
      messages: [{ role: 'user', content: 'Lies profile.txt und app.js' }]
    }, { runCodex: runner, modelHome: home });
  });

  test('injects explicitly uploaded model-home files even when the prompt does not name them', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'egomorph-home-'));
    fs.writeFileSync(path.join(home, 'upload.md'), '# Upload\n\nFreigegebener Inhalt', 'utf8');

    const runner = jest.fn(async ({ prompt }) => {
      expect(prompt).toContain('Wenn Bereitgestellte Nutzerdateien vorhanden sind');
      expect(prompt).toContain('gelten diese Dateien als vom Nutzer hochgeladen');
      expect(prompt).toContain('--- upload.md ---');
      expect(prompt).toContain('Freigegebener Inhalt');
      return 'Upload-Kontext Antwort';
    });

    const response = await chatCompletionFromRequest({
      messages: [{ role: 'user', content: 'Fasse die Datei zusammen' }],
      egomorph: { files: ['upload.md'] }
    }, { runCodex: runner, modelHome: home });

    expect(response.choices[0].message.content).toBe('Upload-Kontext Antwort');
  });

  test('writes markdown files only inside the model home', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'egomorph-home-'));

    const written = writeModelMarkdownFile(home, '', '# Projektidee\n\nEin Entwurf.');
    expect(written).toEqual(expect.objectContaining({
      path: 'projektidee.md',
      overwritten: false
    }));
    expect(fs.readFileSync(path.join(home, 'projektidee.md'), 'utf8'))
      .toBe('# Projektidee\n\nEin Entwurf.\n');

    const duplicate = writeModelMarkdownFile(home, 'projektidee', 'Zweite Version');
    expect(duplicate.path).toBe('projektidee-2.md');

    expect(() => writeModelMarkdownFile(home, '../notiz.md', 'Text'))
      .toThrow('ausserhalb');
    expect(() => writeModelMarkdownFile(home, 'app.js', 'Text'))
      .toThrow('Script-Dateien');
    expect(() => writeModelMarkdownFile(home, 'notes.txt', 'Text'))
      .toThrow('Nur .md-Dateien');
    expect(() => writeModelMarkdownFile(home, 'memory.md', 'Text'))
      .toThrow('reserviert');
  });

  test('reads and writes only approved extended file types inside the model home', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'egomorph-extended-home-'));

    const written = writeExtendedModelFile(home, 'src/app.js', 'console.log("ok");\n');
    expect(written).toEqual(expect.objectContaining({ path: 'src/app.js', overwritten: false }));
    expect(readExtendedModelFile(home, 'src/app.js')).toEqual(expect.objectContaining({
      path: 'src/app.js',
      content: 'console.log("ok");\n'
    }));

    writeExtendedModelFile(home, 'styles/site.css', 'body {}');
    writeExtendedModelFile(home, 'page.html', '<main></main>');
    writeExtendedModelFile(home, 'tool.py', 'print("ok")');
    expect(() => writeExtendedModelFile(home, 'notes.md', '# Nein')).toThrow('nur .js, .css, .html und .py');
    expect(() => readExtendedModelFile(home, '../app.js')).toThrow('ausserhalb');
    expect(() => writeExtendedModelFile(home, 'node_modules/pkg/app.js', 'bad')).toThrow('Geschuetzter Pfad');
  });

  test('blocks symlinks that escape the model home', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'egomorph-symlink-home-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'egomorph-outside-'));
    fs.symlinkSync(outside, path.join(home, 'escape'));

    expect(() => writeExtendedModelFile(home, 'escape/app.js', 'bad'))
      .toThrow('Symlink fuehrt ausserhalb');
  });

  test('creates OpenAI-compatible chat completion response without running real codex', async () => {
    const runner = jest.fn(async ({ prompt, model, timeoutMs }) => {
      expect(prompt).toContain('Nutzer: Hallo');
      expect(model).toBe('gpt-5');
      expect(timeoutMs).toBe(1234);
      return 'Hallo von Codex';
    });

    const response = await chatCompletionFromRequest({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'Hallo' }],
      max_tokens: 25
    }, { runCodex: runner, timeoutMs: 1234 });

    expect(response.object).toBe('chat.completion');
    expect(response.model).toBe('gpt-5');
    expect(response.choices[0].message).toEqual({
      role: 'assistant',
      content: 'Hallo von Codex'
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  test('accepts streaming requests and still returns a final response for non-SSE callers', async () => {
    const runner = jest.fn(async () => 'Hallo Stream');
    const response = await chatCompletionFromRequest({
      stream: true,
      messages: [{ role: 'user', content: 'Hallo' }]
    }, { runCodex: runner });

    expect(response.choices[0].message.content).toBe('Hallo Stream');
    expect(runner).toHaveBeenCalledTimes(1);
  });

  test('passes session metadata and token callbacks through the app-server completion path', async () => {
    const tokens = [];
    const runner = jest.fn(async ({ onToken, onWebSearchStart, onWebSearchComplete, sessionId, followupPrompt }) => {
      expect(sessionId).toBe('chat-1');
      expect(followupPrompt).toContain('Aktuelle Nutzeranfrage');
      onWebSearchStart({ type: 'webSearch', query: 'aktuelle Daten' });
      onToken('Hal');
      onToken('lo');
      onWebSearchComplete({ type: 'webSearch', query: 'aktuelle Daten' });
      return {
        content: 'Hallo',
        engine: 'app-server',
        sessionId,
        threadId: 'thread-1',
        turnId: 'turn-1'
      };
    });

    const webSearchEvents = [];
    const completion = await runCodexCompletion({
      stream: true,
      messages: [{ role: 'user', content: 'Hallo' }],
      egomorph: { sessionId: 'chat-1' }
    }, { runCodex: runner }, {
      onToken: token => tokens.push(token),
      onWebSearchStart: item => webSearchEvents.push(['started', item.query]),
      onWebSearchComplete: item => webSearchEvents.push(['completed', item.query])
    });

    expect(completion.content).toBe('Hallo');
    expect(tokens).toEqual(['Hal', 'lo']);
    expect(webSearchEvents).toEqual([['started', 'aktuelle Daten'], ['completed', 'aktuelle Daten']]);
    expect(completion.metadata).toEqual(expect.objectContaining({
      engine: 'app-server',
      sessionId: 'chat-1',
      threadId: 'thread-1',
      turnId: 'turn-1'
    }));
  });

  test('streams Codex web-search lifecycle events to the browser protocol', async () => {
    const server = require('../scripts/codex-bridge').createServer({
      runCodex: async ({ onToken, onWebSearchStart, onWebSearchComplete }) => {
        onWebSearchStart({ type: 'webSearch', query: 'recent event' });
        onToken('<egomorph_final>Aktuell</egomorph_final>');
        onWebSearchComplete({ type: 'webSearch', query: 'recent event' });
        return '<egomorph_final>Aktuell</egomorph_final>';
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'Was ist aktuell?' }] })
      });
      const body = await response.text();

      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(body).toContain('"skill_event":{"id":"codex.web_search","status":"running"');
      expect(body).toContain('"skill_event":{"id":"codex.web_search","status":"completed"');
      expect(body).toContain('<egomorph_final>Aktuell</egomorph_final>');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('maps the live app-server model catalog to the gateway model format', async () => {
    const appServerClient = {
      request: jest.fn(async (method, params) => ({
        data: [{
          id: 'gpt-current',
          model: 'gpt-current',
          displayName: 'GPT Current',
          description: 'Current Codex model',
          hidden: false,
          isDefault: true,
          defaultReasoningEffort: 'medium',
          supportedReasoningEfforts: [
            { reasoningEffort: 'low' },
            { reasoningEffort: 'medium' },
            { reasoningEffort: 'high' },
            { reasoningEffort: 'xhigh' }
          ]
        }]
      }))
    };

    const models = await getCodexModels({ appServerClient });

    expect(appServerClient.request).toHaveBeenCalledWith('model/list', { limit: 100 });
    expect(models).toEqual([expect.objectContaining({
      id: 'gpt-current',
      display_name: 'GPT Current',
      is_default: true,
      default_reasoning_effort: 'medium',
      supported_reasoning_efforts: ['low', 'medium', 'high']
    })]);
  });

  test('passes reasoning level and cancellation signal to the selected runner', async () => {
    const controller = new AbortController();
    const runner = jest.fn(async ({ reasoningEffort, signal }) => {
      expect(reasoningEffort).toBe('high');
      expect(signal).toBe(controller.signal);
      return 'Antwort';
    });

    await runCodexCompletion({
      reasoning_effort: 'high',
      messages: [{ role: 'user', content: 'Hallo' }]
    }, { runCodex: runner }, { signal: controller.signal });

    expect(runner).toHaveBeenCalledTimes(1);
  });

  test('defaults to the persistent app-server engine unless legacy exec is requested', () => {
    expect(getCodexEngine({})).toBe('app-server');
    expect(getCodexEngine({ engine: 'exec' })).toBe('exec');
  });

  test('allows localhost origins by default and requires explicit remote origins', () => {
    expect(isOriginAllowed('http://localhost:4173', [])).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:4173', [])).toBe(true);
    expect(isOriginAllowed('null', [])).toBe(false);
    expect(isOriginAllowed('null', ['null'])).toBe(true);
    expect(isOriginAllowed('https://example.test', [])).toBe(false);
    expect(isOriginAllowed('https://example.test', ['https://example.test'])).toBe(true);
  });

  test('rejects browser Origin null at the HTTP boundary by default', async () => {
    const server = require('../scripts/codex-bridge').createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Origin: 'null' }
      });
      const payload = await response.json();
      expect(response.status).toBe(403);
      expect(payload.error.message).toContain('Origin');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('parses persistent ChatGPT login status from codex login status output', () => {
    expect(parseCodexLoginStatus('Logged in using ChatGPT', '', 0)).toEqual(
      expect.objectContaining({
        loggedIn: true,
        method: 'ChatGPT',
        persistent: true
      })
    );

    expect(parseCodexLoginStatus('Not logged in', '', 1)).toEqual(
      expect.objectContaining({
        loggedIn: false,
        persistent: false
      })
    );
  });

  test('status payload exposes login persistence without browser-side tokens', async () => {
    const payload = await getCodexStatusPayload({
      codexBin: 'codex-test',
      runLoginStatus: async () => ({
        loggedIn: true,
        method: 'ChatGPT',
        persistent: true,
        message: 'ok',
        raw: 'Logged in using ChatGPT'
      })
    });

    expect(payload.ok).toBe(true);
    expect(payload.codexBin).toBe('codex-test');
    expect(payload.login).toEqual(expect.objectContaining({ loggedIn: true, persistent: true }));
    expect(payload.modelHome).toEqual(expect.objectContaining({
      memoryFile: 'memory.md',
      allowedReadExtensions: expect.arrayContaining(['.json', '.md', '.txt']),
      allowedWriteExtensions: ['.md']
    }));
    expect(payload.persistence.browserStoresTokens).toBe(false);
  });

  test('POST /egomorph/files stores markdown through the bridge policy', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'egomorph-home-'));
    const server = require('../scripts/codex-bridge').createServer({ modelHome: home });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/egomorph/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Kurze Notiz', content: 'Gespeicherter Markdown-Text' })
      });
      const payload = await response.json();
      expect(response.ok).toBe(true);
      expect(payload.file.path).toBe('kurze-notiz.md');
      expect(fs.readFileSync(path.join(home, 'kurze-notiz.md'), 'utf8'))
        .toBe('Gespeicherter Markdown-Text\n');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('POST /egomorph/files accepts markdown uploads and rejects non-markdown filenames', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'egomorph-home-'));
    const server = require('../scripts/codex-bridge').createServer({ modelHome: home });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      const okResponse = await fetch(`http://127.0.0.1:${port}/egomorph/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'upload.md', content: '# Upload\n\nText' })
      });
      const okPayload = await okResponse.json();
      expect(okResponse.ok).toBe(true);
      expect(okPayload.file.path).toBe('upload.md');
      expect(fs.readFileSync(path.join(home, 'upload.md'), 'utf8')).toBe('# Upload\n\nText\n');

      const blockedResponse = await fetch(`http://127.0.0.1:${port}/egomorph/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'upload.txt', content: 'Text' })
      });
      const blockedPayload = await blockedResponse.json();
      expect(blockedResponse.status).toBe(400);
      expect(blockedPayload.error.message).toContain('Nur .md-Dateien');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
