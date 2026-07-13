const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'resourceProfile.js'), 'utf8');

function createHarness(fetchImpl, initialStore) {
  const store = Object.assign({ egoResourceProfile: 'api' }, initialStore || {});
  const document = {
    readyState: 'complete',
    addEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
    querySelectorAll: jest.fn(() => []),
    getElementById: jest.fn(() => null)
  };
  const window = {};
  const localStorage = {
    getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; }
  };
  const context = {
    window,
    document,
    localStorage,
    fetch: fetchImpl || jest.fn(),
    location: { protocol: 'https:', origin: 'https://example.test' },
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    JSON,
    RegExp,
    String,
    Math,
    Number,
    parseInt,
    isNaN,
    TextDecoder,
    ReadableStream
  };

  vm.runInNewContext(source, context);
  return { context, window, document, store };
}

describe('resourceProfile', () => {
  test('migrates removed profiles to the agentic Codex profile', () => {
    const { window, store } = createHarness(undefined, { egoResourceProfile: 'standard' });
    expect(window.egoProfile.get()).toBe('codex');
    expect(store.egoResourceProfile).toBe('codex');
    expect(window.egoProfile.keywordEmotionDetect).toBeUndefined();
  });

  test('normalizes OpenAI-compatible base URLs and clamps token counts', async () => {
    const fetchMock = jest.fn(async (url, options) => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      text: async () => ''
    }));
    const { window } = createHarness(fetchMock);

    window.egoProfile.setApiConfig('https://api.openai.com', 'secret', 'test-model');
    const reply = await window.egoProfile.apiChatCompletion([{ role: 'user', content: 'Hallo' }], 5000);

    expect(reply).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' })
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(1000);
    expect(body.messages).toEqual([{ role: 'user', content: 'Hallo' }]);
  });

  test('uses a current OpenAI example model when no API model is configured', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      text: async () => ''
    }));
    const { window } = createHarness(fetchMock);

    window.egoProfile.setApiConfig('https://api.openai.com', '', '');
    await window.egoProfile.apiChatCompletion([{ role: 'user', content: 'Hallo' }], 20);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-5.4-mini');
  });

  test('rejects empty API message payloads before sending a request', async () => {
    const fetchMock = jest.fn();
    const { window } = createHarness(fetchMock);

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');

    await expect(window.egoProfile.apiChatCompletion([{ role: 'user', content: '   ' }], 20))
      .rejects.toThrow('Keine API-Nachrichten vorhanden');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('API replies use a longer default token budget and no short-answer prompt', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ausführliche antwort' } }] }),
      text: async () => ''
    }));
    const { window } = createHarness(fetchMock);

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    const reply = await window.egoProfile.apiGenerateReply('Bitte erkläre das ausführlich.');

    expect(reply).toBe('ausführliche antwort');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(700);
    expect(body.messages[0].content).toContain('nicht künstlich gekürzt');
    expect(body.messages[0].content).not.toContain('1-3 Sätze');
  });

  test('streams OpenAI-compatible API tokens into the live callback', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('data: {"choices":[{"delta":{}}],"egomorph":{"skill_event":{"id":"codex.web_search","status":"running"}}}\n\n'));
        controller.enqueue(Buffer.from('data: {"choices":[{"delta":{"content":"<egomorph_thought>Live</egomorph_thought>"}}]}\n\n'));
        controller.enqueue(Buffer.from('data: {"choices":[{"delta":{}}],"egomorph":{"skill_event":{"id":"codex.web_search","status":"completed"}}}\n\n'));
        controller.enqueue(Buffer.from('data: {"choices":[{"delta":{"content":"<egomorph_final>Antwort</egomorph_final>"}}]}\n\n'));
        controller.enqueue(Buffer.from('data: [DONE]\n\n'));
        controller.close();
      }
    });
    const fetchMock = jest.fn(async () => ({
      ok: true,
      headers: { get: name => String(name).toLowerCase() === 'content-type' ? 'text/event-stream' : '' },
      body: stream,
      text: async () => ''
    }));
    const { window } = createHarness(fetchMock);
    const onToken = jest.fn();
    const onSkillStart = jest.fn();
    const onSkillUse = jest.fn();

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    const reply = await window.egoProfile.apiGenerateReply('Hallo', { onToken, onSkillStart, onSkillUse });

    expect(reply).toContain('<egomorph_final>Antwort</egomorph_final>');
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(onToken.mock.calls[1][1]).toContain('Antwort');
    expect(onSkillStart).toHaveBeenCalledWith('codex.web_search');
    expect(onSkillUse).toHaveBeenCalledWith('codex.web_search', {});
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
  });

  test('API reply token setting is stored separately and clamps to API limit', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      text: async () => ''
    }));
    const { window, store } = createHarness(fetchMock);

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    window.egoProfile.setApiMaxTokens(5000);
    await window.egoProfile.apiGenerateReply('Hallo');

    expect(store.egoApiMaxTokens).toBe('1000');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(1000);
  });

  test('follows the model semantic skill decision without requiring search keywords', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '<egomorph_skill_request>{"skill":"internet.research","query":"Thema X"}</egomorph_skill_request>' } }] }),
        text: async () => ''
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'zusammenfassung' } }] }),
        text: async () => ''
      });
    const { window } = createHarness(fetchMock);
    window.EgoInternetSkill = {
      search: jest.fn(async () => ({
        query: 'Thema X',
        results: [
          {
            title: 'Quelle X',
            snippet: 'Aktuelle Information aus dem Netz.',
            url: 'https://example.test/x',
            source: 'Example'
          }
        ]
      })),
      formatForPrompt: jest.fn(() => 'Internet-Recherche zu: Thema X\n[1] Quelle X - Aktuelle Information aus dem Netz. Quelle: https://example.test/x')
    };

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    const onSkillStart = jest.fn();
    const onSkillUse = jest.fn();
    const reply = await window.egoProfile.apiGenerateReply('Erzähl mir etwas Verlässliches über Thema X.', { onSkillStart, onSkillUse });

    expect(reply).toBe('zusammenfassung');
    expect(window.EgoInternetSkill.search).toHaveBeenCalledWith(
      'Thema X',
      expect.objectContaining({ limit: 5, language: 'de', rawQuery: true })
    );
    expect(onSkillStart).toHaveBeenCalledWith('internet.research');
    expect(onSkillStart.mock.invocationCallOrder[0]).toBeLessThan(onSkillUse.mock.invocationCallOrder[0]);
    expect(onSkillUse).toHaveBeenCalledWith('internet.research', { resultCount: 1 });
    const plannerBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(plannerBody.messages[0].content).toContain('entscheidest semantisch selbst');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.messages[0].content).toContain('exakt 1 aufbereitete Webquellen');
    expect(body.messages[0].content).toContain('keine Quellen aus frueheren Nachrichten');
    expect(body.messages[1]).toEqual({
      role: 'system',
      content: expect.stringContaining('https://example.test/x')
    });
  });

  test('starts an adaptive Learn with EgoMorph turn through a real skill access', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '<egomorph_skill_request>{"skill":"learning.egomorph"}</egomorph_skill_request>' } }] }),
        text: async () => ''
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '<egomorph_thought>Lernstart vorbereitet.</egomorph_thought><egomorph_final>Auf welchem JavaScript-Level bist du?</egomorph_final>' } }] }),
        text: async () => ''
      });
    const { window } = createHarness(fetchMock);
    window.EgoSkillSystem = {
      ready: Promise.resolve(),
      canRun: jest.fn((id, profile) => id === 'learning.egomorph' && profile === 'api'),
      recordRun: jest.fn()
    };
    window.EgoLearnWithEgomorphSkill = {
      createContext: jest.fn(() => 'Adaptiver Tutor-Kontext ohne vorgefertigte Antworten; frage zuerst nach dem Niveau.')
    };
    const onSkillStart = jest.fn();
    const onSkillUse = jest.fn();

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    const reply = await window.egoProfile.apiGenerateReply('Ich möchte JavaScript mit EgoMorph lernen.', { onSkillStart, onSkillUse });

    expect(reply).toContain('Auf welchem JavaScript-Level');
    expect(window.EgoLearnWithEgomorphSkill.createContext).toHaveBeenCalledWith({ language: 'de' });
    expect(window.EgoSkillSystem.recordRun).toHaveBeenCalledWith('learning.egomorph');
    expect(onSkillStart).toHaveBeenCalledWith('learning.egomorph');
    expect(onSkillUse).toHaveBeenCalledWith('learning.egomorph', {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const planner = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(planner.messages[0].content).toContain('{"skill":"learning.egomorph"}');
    const teaching = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(teaching.messages[1].content).toContain('ohne vorgefertigte Antworten');
  });

  test('reports a requested learning skill as blocked when it is unavailable', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '<egomorph_skill_request>{"skill":"learning.egomorph"}</egomorph_skill_request>' } }] }),
        text: async () => ''
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '<egomorph_thought>Skill blockiert.</egomorph_thought><egomorph_final>Der Lern-Skill ist deaktiviert.</egomorph_final>' } }] }),
        text: async () => ''
      });
    const { window } = createHarness(fetchMock);
    const onSkillBlocked = jest.fn();
    const onSkillStart = jest.fn();

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    await window.egoProfile.apiGenerateReply('Starte den Tutor.', { onSkillBlocked, onSkillStart });

    expect(onSkillBlocked).toHaveBeenCalledWith('learning.egomorph');
    expect(onSkillStart).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toContain('learning.egomorph ist fuer diesen Turn nicht verfuegbar');
  });

  test('rejects extra learning-skill parameters instead of executing them', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '<egomorph_skill_request>{"skill":"learning.egomorph","answer":"fixed"}</egomorph_skill_request>' } }] }),
        text: async () => ''
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '<egomorph_thought>Ohne Skill.</egomorph_thought><egomorph_final>Sichere Antwort.</egomorph_final>' } }] }),
        text: async () => ''
      });
    const { window } = createHarness(fetchMock);
    window.EgoSkillSystem = {
      ready: Promise.resolve(),
      canRun: jest.fn(() => true),
      recordRun: jest.fn()
    };
    window.EgoLearnWithEgomorphSkill = { createContext: jest.fn(() => 'Tutor-Kontext') };

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    const reply = await window.egoProfile.apiGenerateReply('Lernen');

    expect(reply).toContain('Sichere Antwort');
    expect(window.EgoLearnWithEgomorphSkill.createContext).not.toHaveBeenCalled();
    expect(window.EgoSkillSystem.recordRun).not.toHaveBeenCalled();
  });

  test('does not run internet research merely because the user text contains old trigger words', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '<egomorph_thought>Direkte Antwort reicht.</egomorph_thought><egomorph_final>Ohne Suche beantwortet.</egomorph_final>' } }] }),
      text: async () => ''
    }));
    const { window } = createHarness(fetchMock);
    window.EgoInternetSkill = {
      search: jest.fn(),
      formatForPrompt: jest.fn()
    };

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    await window.egoProfile.apiGenerateReply('Suche bitte nach einer kreativen Metapher.');

    expect(window.EgoInternetSkill.search).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('runs multiple explicitly approved file accesses sequentially', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '<egomorph_skill_request>{"skill":"workspace.extended-files","operation":"read","path":"app.js"}</egomorph_skill_request>' } }] }),
        text: async () => ''
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '<egomorph_skill_request>{"skill":"workspace.extended-files","operation":"write","path":"style.css","content":"body { color: teal; }","overwrite":true}</egomorph_skill_request>' } }] }),
        text: async () => ''
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '<egomorph_thought>Dateien verarbeitet.</egomorph_thought><egomorph_final>Fertig.</egomorph_final>' } }] }),
        text: async () => ''
      });
    const { window } = createHarness(fetchMock);
    window.EgoSkillSystem = {
      ready: Promise.resolve(),
      canRunWithPermissions: jest.fn(() => true),
      recordRun: jest.fn()
    };
    window.EgoExtendedFileSkill = {
      read: jest.fn(async () => ({ ok: true, file: { content: 'console.log("alt");' } })),
      write: jest.fn(async () => ({ ok: true, file: { bytes: 21, overwritten: true } }))
    };
    const onSkillStart = jest.fn();
    const onSkillUse = jest.fn();

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    const reply = await window.egoProfile.apiGenerateReply('Bearbeite die beiden vereinbarten Projektdateien.', { onSkillStart, onSkillUse });

    expect(reply).toContain('<egomorph_final>Fertig.</egomorph_final>');
    expect(window.EgoExtendedFileSkill.read).toHaveBeenCalledWith('app.js', expect.any(Object));
    expect(window.EgoExtendedFileSkill.write).toHaveBeenCalledWith('style.css', 'body { color: teal; }', expect.objectContaining({ overwrite: true }));
    expect(onSkillStart).toHaveBeenNthCalledWith(1, 'workspace.extended-files', { operation: 'read' });
    expect(onSkillStart).toHaveBeenNthCalledWith(2, 'workspace.extended-files', { operation: 'write' });
    expect(onSkillUse).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.messages[1].content).toContain('console.log');
    const finalBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(finalBody.messages[1].content).toContain('console.log');
    expect(finalBody.messages[2].content).toContain('erfolgreich geschrieben');
  });

  test('recovers from an invalid model skill request without executing a skill', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '<egomorph_skill_request>{ungueltig}</egomorph_skill_request>' } }] }), text: async () => '' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '<egomorph_thought>Ohne Tool.</egomorph_thought><egomorph_final>Sichere Antwort.</egomorph_final>' } }] }), text: async () => '' });
    const { window } = createHarness(fetchMock);
    window.EgoInternetSkill = {
      search: jest.fn(),
      formatForPrompt: jest.fn()
    };

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    const reply = await window.egoProfile.apiGenerateReply('Komplexe Anfrage');

    expect(window.EgoInternetSkill.search).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reply).toContain('Sichere Antwort');
  });

  test('reports a completed skill access without sources instead of a technical failure', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '<egomorph_skill_request>{"skill":"internet.research","query":"Thema"}</egomorph_skill_request>' } }] }), text: async () => '' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'keine quellen' } }] }), text: async () => '' });
    const { window } = createHarness(fetchMock);
    window.EgoInternetSkill = {
      search: jest.fn(async () => ({ query: 'Thema', results: [] })),
      formatForPrompt: jest.fn()
    };
    const onSkillUse = jest.fn();
    const onSkillError = jest.fn();

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    await window.egoProfile.apiGenerateReply('Suche Thema', { onSkillUse, onSkillError });

    expect(onSkillUse).toHaveBeenCalledWith('internet.research', { resultCount: 0 });
    expect(onSkillError).not.toHaveBeenCalled();
    expect(window.EgoInternetSkill.formatForPrompt).toHaveBeenCalledWith({ query: 'Thema', results: [] });
    const finalBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(finalBody.messages[0].content).toContain('keine Webquelle an dich uebergeben');
    expect(finalBody.messages[0].content).toContain('keine Quellenangaben, Quellenliste oder als Beleg gemeinten URLs');
  });

  test('reports a technical skill failure when source formatting throws', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '<egomorph_skill_request>{"skill":"internet.research","query":"Thema"}</egomorph_skill_request>' } }] }), text: async () => '' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'fallback' } }] }), text: async () => '' });
    const { window } = createHarness(fetchMock);
    window.EgoInternetSkill = {
      search: jest.fn(async () => ({ query: 'Thema', results: [{ title: 'Quelle' }] })),
      formatForPrompt: jest.fn(() => { throw new Error('Formatfehler'); })
    };
    const onSkillUse = jest.fn();
    const onSkillError = jest.fn();

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    await window.egoProfile.apiGenerateReply('Suche Thema', { onSkillUse, onSkillError });

    expect(onSkillUse).not.toHaveBeenCalled();
    expect(onSkillError).toHaveBeenCalledWith('internet.research');
  });

  test('internet skill settings persist and can disable research context', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'antwort ohne suche' } }] }),
      text: async () => ''
    }));
    const { window, store } = createHarness(fetchMock);
    window.EgoInternetSkill = {
      search: jest.fn(async () => ({
        query: 'Thema X',
        results: [{ title: 'Quelle', snippet: 'Snippet', url: 'https://example.test' }]
      })),
      formatForPrompt: jest.fn(() => 'Internet-Recherche zu: Thema X')
    };

    window.egoProfile.setInternetSkillConfig({
      enabled: false,
      provider: 'google',
      googleApiKey: 'google-key',
      googleCx: 'engine-id'
    });
    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    const reply = await window.egoProfile.apiGenerateReply('Suche Thema X im Netz');

    expect(reply).toBe('antwort ohne suche');
    expect(window.egoProfile.getInternetSkillConfig()).toEqual({
      enabled: false,
      provider: 'google',
      googleApiKey: 'google-key',
      googleCx: 'engine-id'
    });
    expect(store.egoSkillInternetEnabled).toBe('false');
    expect(store.egoInternetSearchProvider).toBe('google');
    expect(store.egoInternetGoogleApiKey).toBe('google-key');
    expect(store.egoInternetGoogleCx).toBe('engine-id');
    expect(window.EgoInternetSkill.search).not.toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).not.toContain('Internet-Recherche bereitgestellt');
    expect(body.messages).not.toContainEqual(expect.objectContaining({
      role: 'system',
      content: expect.stringContaining('Internet-Recherche zu:')
    }));
  });

  test('makes a blocked research skill visible instead of silently skipping it', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '<egomorph_skill_request>{"skill":"internet.research","query":"heutiges Thema"}</egomorph_skill_request>' } }] }), text: async () => '' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'antwort ohne suche' } }] }), text: async () => '' });
    const { window } = createHarness(fetchMock);
    window.EgoInternetSkill = {
      search: jest.fn(),
      formatForPrompt: jest.fn()
    };
    const onSkillBlocked = jest.fn();

    window.egoProfile.setInternetSkillEnabled(false);
    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    await window.egoProfile.apiGenerateReply('Was ist heute aktuell?', { onSkillBlocked });

    expect(onSkillBlocked).toHaveBeenCalledWith('internet.research');
    expect(window.EgoInternetSkill.search).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toContain('nicht verfuegbar');
  });

  test('makes a missing research entrypoint visible for an implicit current request', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '<egomorph_skill_request>{"skill":"internet.research","query":"Nachrichten"}</egomorph_skill_request>' } }] }), text: async () => '' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'antwort' } }] }), text: async () => '' });
    const { window } = createHarness(fetchMock);
    const onSkillBlocked = jest.fn();

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    await window.egoProfile.apiGenerateReply('Was sind die neuesten Nachrichten?', { onSkillBlocked });

    expect(onSkillBlocked).toHaveBeenCalledWith('internet.research');
  });

  test('API replies persist requested user memory and include memory.md context', async () => {
    const fetchMock = jest.fn(async (url) => {
      if (String(url).endsWith('/egomorph/context')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            memory: '# EgoMorph Memory\n\n- 2026-07-05: ich moechte Pasi genannt werden\n',
            memoryUpdated: true,
            rememberedText: 'ich moechte Pasi genannt werden',
            fileContexts: [],
            fileErrors: []
          }),
          text: async () => ''
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'gemerkt' } }] }),
        text: async () => ''
      };
    });
    const { window, store } = createHarness(fetchMock);

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    const reply = await window.egoProfile.apiGenerateReply('merk dir - ich moechte Pasi genannt werden');

    expect(reply).toBe('gemerkt');
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8787/egomorph/context');
    expect(store.egoModelMemoryMarkdown).toContain('Pasi');
    const apiCall = fetchMock.mock.calls.find(call => String(call[0]).includes('/v1/chat/completions'));
    const body = JSON.parse(apiCall[1].body);
    expect(body.messages).toContainEqual(expect.objectContaining({
      role: 'system',
      content: expect.stringContaining('Inhalt von memory.md')
    }));
    expect(body.messages).toContainEqual(expect.objectContaining({
      role: 'system',
      content: expect.stringContaining('Das Egomorph-Core-Modell-Home ist der erlaubte lokale Arbeitsbereich')
    }));
    expect(body.messages).toContainEqual(expect.objectContaining({
      role: 'system',
      content: expect.stringContaining('memory.md ist die reservierte Memory-Datei')
    }));
    expect(body.messages).toContainEqual(expect.objectContaining({
      role: 'system',
      content: expect.stringContaining('Pasi')
    }));
  });

  test('memory requests do not surface model refusals to save', async () => {
    const fetchMock = jest.fn(async (url) => {
      if (String(url).endsWith('/egomorph/context')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            memory: '# EgoMorph Memory\n\n- 2026-07-05: ich moechte Pasi genannt werden\n',
            memoryUpdated: true,
            rememberedText: 'ich moechte Pasi genannt werden',
            fileContexts: [],
            fileErrors: []
          }),
          text: async () => ''
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Ich kann nichts dauerhaft speichern.' } }] }),
        text: async () => ''
      };
    });
    const { window } = createHarness(fetchMock);

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    const reply = await window.egoProfile.apiGenerateReply('merk dir - ich moechte Pasi genannt werden');

    expect(reply).toBe('Ich habe mir gemerkt: ich moechte Pasi genannt werden');
  });

  test('API replies include allowed file context and script-file errors from the local bridge', async () => {
    const fetchMock = jest.fn(async (url) => {
      if (String(url).endsWith('/egomorph/context')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            memory: '',
            memoryUpdated: false,
            fileContexts: [
              { path: 'profile.txt', content: 'Lieblingsname: Pasi', truncated: false }
            ],
            fileErrors: [
              { path: 'app.js', message: 'Script-Dateien duerfen nicht gelesen werden' }
            ]
          }),
          text: async () => ''
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'datei antwort' } }] }),
        text: async () => ''
      };
    });
    const { window } = createHarness(fetchMock);

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    const reply = await window.egoProfile.apiGenerateReply('Lies profile.txt und app.js');

    expect(reply).toBe('datei antwort');
    const apiCall = fetchMock.mock.calls.find(call => String(call[0]).includes('/v1/chat/completions'));
    const body = JSON.parse(apiCall[1].body);
    const contextMessage = body.messages.find(message =>
      message.role === 'system' && message.content.indexOf('Bereitgestellte Nutzerdateien') !== -1
    );
    expect(contextMessage.content).toContain('Lieblingsname: Pasi');
    expect(contextMessage.content).toContain('app.js: Script-Dateien duerfen nicht gelesen werden');
  });

  test('API replies include explicitly uploaded markdown even when the user prompt does not name it', async () => {
    const fetchMock = jest.fn(async (url, options) => {
      if (String(url).endsWith('/egomorph/context')) {
        const body = JSON.parse(options.body);
        expect(body.files).toEqual(['upload.md']);
        return {
          ok: true,
          json: async () => ({
            ok: true,
            memory: '',
            memoryUpdated: false,
            fileContexts: [
              { path: 'upload.md', content: '# Upload\n\nFreigegebener Inhalt', truncated: false }
            ],
            fileErrors: []
          }),
          text: async () => ''
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'upload antwort' } }] }),
        text: async () => ''
      };
    });
    const { window } = createHarness(fetchMock);

    window.egoProfile.setApiConfig('https://api.openai.com', '', 'test-model');
    const reply = await window.egoProfile.apiGenerateReply('Fasse die Datei zusammen', {
      modelHomeFiles: ['upload.md']
    });

    expect(reply).toBe('upload antwort');
    const apiCall = fetchMock.mock.calls.find(call => String(call[0]).includes('/v1/chat/completions'));
    const body = JSON.parse(apiCall[1].body);
    const contextMessage = body.messages.find(message =>
      message.role === 'system' && message.content.indexOf('Bereitgestellte Nutzerdateien') !== -1
    );
    expect(contextMessage.content).toContain('gilt diese Datei als vom Nutzer hochgeladen');
    expect(contextMessage.content).toContain('# Upload');
    expect(contextMessage.content).toContain('Freigegebener Inhalt');
  });

  test('supports codex as fifth profile and sends chat completions to the local bridge', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'codex antwort' } }] }),
      text: async () => ''
    }));
    const { window, store } = createHarness(fetchMock);

    window.egoProfile.set('codex');
    window.egoProfile.setCodexConfig('http://localhost:8787', 'gpt-5');
    window.egoProfile.setCodexMaxTokens(5000);

    const reply = await window.egoProfile.apiGenerateReply('Hallo Codex');

    expect(reply).toBe('codex antwort');
    expect(window.egoProfile.usesCodex()).toBe(true);
    expect(store.egoResourceProfile).toBe('codex');
    expect(store.egoCodexMaxTokens).toBe('1000');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-5');
    expect(body.max_tokens).toBe(1000);
    expect(body.stream).toBe(true);
    expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', content: 'Hallo Codex' });
  });

  test('stores the composer reasoning level and forwards it with the abort signal', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'codex antwort' } }] }),
      text: async () => ''
    }));
    const { window, store } = createHarness(fetchMock);
    const controller = new AbortController();
    window.egoProfile.set('codex');
    window.egoProfile.setCodexReasoningEffort('high');

    await window.egoProfile.codexChatCompletion(
      [{ role: 'user', content: 'Schwierige Frage' }],
      100,
      { stream: false, signal: controller.signal }
    );

    expect(store.egoCodexReasoningEffort).toBe('high');
    expect(window.egoProfile.getCodexConfig().reasoningEffort).toBe('high');
    const request = fetchMock.mock.calls[0][1];
    expect(request.signal).toBe(controller.signal);
    expect(JSON.parse(request.body).reasoning_effort).toBe('high');
  });

  test('loads the current Codex model catalog from the gateway', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-current', display_name: 'GPT Current' }] }),
      text: async () => ''
    }));
    const { window } = createHarness(fetchMock);

    const models = await window.egoProfile.listCodexModels();

    expect(models).toEqual([{ id: 'gpt-current', display_name: 'GPT Current' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/v1/models',
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('continues each browser conversation in its own Codex app-server session', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'fortgesetzt' } }] }),
      text: async () => ''
    }));
    const { window } = createHarness(fetchMock);
    window.egoProfile.set('codex');

    await window.egoProfile.apiGenerateReply('Neue Frage', {
      sessionId: 'chat-browser-2',
      conversationHistory: [{ user: 'Vorherige Frage', reply: 'Vorherige Antwort' }]
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.egomorph).toEqual({ sessionId: 'chat-browser-2' });
    expect(body.messages).toContainEqual({ role: 'user', content: 'Vorherige Frage' });
    expect(body.messages).toContainEqual({ role: 'assistant', content: 'Vorherige Antwort' });
  });

  test('reads Codex SSE streaming responses into the final reply', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n'));
        controller.enqueue(Buffer.from('data: {"choices":[{"delta":{"content":"Hallo "},"finish_reason":null}]}\n\n'));
        controller.enqueue(Buffer.from('data: {"choices":[{"delta":{"content":"Stream"},"finish_reason":null}]}\n\n'));
        controller.enqueue(Buffer.from('data: [DONE]\n\n'));
        controller.close();
      }
    });
    const fetchMock = jest.fn(async () => ({
      ok: true,
      headers: { get: name => String(name).toLowerCase() === 'content-type' ? 'text/event-stream' : '' },
      body: stream,
      text: async () => ''
    }));
    const { window } = createHarness(fetchMock);

    window.egoProfile.set('codex');
    const reply = await window.egoProfile.codexChatCompletion([{ role: 'user', content: 'Hallo' }], 20);

    expect(reply).toBe('Hallo Stream');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
  });

  test('codex requests forward explicitly uploaded model-home files to the bridge', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'codex upload antwort' } }] }),
      text: async () => ''
    }));
    const { window } = createHarness(fetchMock);

    window.egoProfile.set('codex');
    window.egoProfile.setCodexConfig('http://localhost:8787', 'gpt-5');

    const reply = await window.egoProfile.apiGenerateReply('Fasse die hochgeladene Datei zusammen', {
      modelHomeFiles: ['upload.md']
    });

    expect(reply).toBe('codex upload antwort');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.egomorph).toEqual({ files: ['upload.md'] });
  });

  test('checks Codex bridge status through the saved bridge URL', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        login: { loggedIn: true, method: 'ChatGPT', persistent: true }
      }),
      text: async () => ''
    }));
    const { window } = createHarness(fetchMock);

    window.egoProfile.set('codex');
    window.egoProfile.setCodexConfig('http://localhost:8787/v1/chat/completions', '');
    const status = await window.egoProfile.codexBridgeStatus();

    expect(status.login.loggedIn).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/codex/status',
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('resets only the selected Codex conversation session', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, sessionId: 'chat-browser-2', reset: true }),
      text: async () => ''
    }));
    const { window } = createHarness(fetchMock);

    const result = await window.egoProfile.resetCodexSession('chat-browser-2');

    expect(result.reset).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/codex/session/reset',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sessionId: 'chat-browser-2' })
      })
    );
  });

  test('uploads markdown files to the local gateway model home', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        modelHome: '/tmp/model-home',
        file: { path: 'Notizen.md', bytes: 8, overwritten: false }
      }),
      text: async () => ''
    }));
    const { window } = createHarness(fetchMock);

    window.egoProfile.setCodexConfig('http://localhost:8787/v1/chat/completions', '');
    const result = await window.egoProfile.uploadMarkdownFileToModelHome({
      name: 'Notizen.md',
      text: async () => '# Hallo'
    });

    expect(result.file.path).toBe('Notizen.md');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/egomorph/files',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      filename: 'Notizen.md',
      content: '# Hallo',
      overwrite: false
    });
  });

  test('rejects non-markdown uploads before contacting the gateway', async () => {
    const fetchMock = jest.fn();
    const { window } = createHarness(fetchMock);

    await expect(window.egoProfile.uploadMarkdownFileToModelHome({
      name: 'notes.txt',
      content: 'Text'
    })).rejects.toThrow('Nur .md-Dateien');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
