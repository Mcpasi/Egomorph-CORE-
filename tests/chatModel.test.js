const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'chatModel.js'), 'utf8');

function createHarness(pipeline) {
  const store = {};
  const elements = {
    chatModelStatusText: { textContent: '', style: {} },
    customChatModelId: { value: '' },
    llmEnabledToggle: { checked: false },
    llmMaxTokensInput: { value: '' }
  };
  const document = {
    readyState: 'complete',
    addEventListener: jest.fn(),
    getElementById(id) {
      return elements[id] || null;
    }
  };
  const window = {
    egoProfile: { get: () => 'full' },
    TransformersPipeline: pipeline
  };
  const localStorage = {
    getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; }
  };
  const context = {
    window,
    document,
    localStorage,
    console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    Promise,
    String,
    Math,
    parseInt,
    isNaN
  };

  vm.runInNewContext(source, context);
  return { context, window, document, elements, store };
}

describe('chatModel', () => {
  test('cuts generated output when a stop token appears at the beginning', async () => {
    const pipeline = jest.fn(async () => async prompt => [
      { generated_text: prompt + '</s> leaked text' }
    ]);
    const { window } = createHarness(pipeline);

    await window.initChatModel('Xenova/gpt2');
    const reply = await window.generateWithLLM('Hallo');

    expect(reply).toBeNull();
  });

  test('keeps the newest model when model loads finish out of order', async () => {
    const pending = {};
    const pipeline = jest.fn((task, id) => new Promise(resolve => {
      pending[id] = resolve;
    }));
    const { window } = createHarness(pipeline);

    const slowLoad = window.initChatModel('slow-model');
    const fastLoad = window.initChatModel('fast-model');

    pending['fast-model'](async prompt => [{ generated_text: prompt + 'Fast reply.' }]);
    await fastLoad;
    pending['slow-model'](async prompt => [{ generated_text: prompt + 'Slow reply.' }]);
    await slowLoad;

    const reply = await window.generateWithLLM('Test');
    expect(reply).toBe('Fast reply.');
  });

  test('clamps saved token limits to the supported UI range', () => {
    const { window, elements, store } = createHarness(jest.fn());

    window.saveLLMMaxTokens('1');
    expect(store.egoLLMMaxTokens).toBe('20');
    expect(elements.llmMaxTokensInput.value).toBe('20');

    window.saveLLMMaxTokens('999');
    expect(store.egoLLMMaxTokens).toBe('300');
    expect(elements.llmMaxTokensInput.value).toBe('300');
  });

  test('discards a local model result after the user stops generation', async () => {
    let finishGeneration;
    const pipeline = jest.fn(async () => async prompt => new Promise(resolve => {
      finishGeneration = () => resolve([{ generated_text: prompt + 'Zu spät.' }]);
    }));
    const { window } = createHarness(pipeline);
    const controller = new AbortController();

    await window.initChatModel('Xenova/gpt2');
    const reply = window.generateWithLLM('Hallo', { signal: controller.signal });
    controller.abort();
    finishGeneration();

    await expect(reply).rejects.toMatchObject({ name: 'AbortError' });
  });
});
