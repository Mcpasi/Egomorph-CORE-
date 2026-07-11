const { create, STORAGE_KEY } = require('../conversationStore');

function createStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    getItem: key => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null,
    setItem: (key, value) => { values[key] = String(value); }
  };
}

function createTestStore(storage) {
  const ids = ['chat-a', 'chat-b', 'chat-c', 'chat-d'];
  let timestamp = 100;
  return create(storage, {
    idFactory: () => ids.shift(),
    now: () => timestamp++
  });
}

describe('conversation store', () => {
  test('migrates the former single conversation into the first thread', () => {
    const legacy = [{ user: 'Alter Chat', reply: 'Bleibt erhalten' }];
    const storage = createStorage({ egoConversation: JSON.stringify(legacy) });
    const store = createTestStore(storage);

    expect(store.getActiveThread()).toEqual(expect.objectContaining({
      id: 'chat-a',
      title: 'Alter Chat',
      conversation: legacy
    }));
    expect(JSON.parse(storage.values[STORAGE_KEY])).toEqual(expect.objectContaining({
      version: 2,
      activeThreadId: 'chat-a'
    }));
  });

  test('keeps multiple conversations isolated and restores the selected thread', () => {
    const storage = createStorage();
    const store = createTestStore(storage);
    store.setConversation('chat-a', [{ user: 'Erstes Thema', reply: 'A' }]);
    const second = store.createThread();
    store.setConversation(second.id, [{ user: 'Zweites Thema', reply: 'B' }]);

    expect(store.getActiveConversation()).toEqual([{ user: 'Zweites Thema', reply: 'B' }]);
    store.switchThread('chat-a');
    expect(store.getActiveConversation()).toEqual([{ user: 'Erstes Thema', reply: 'A' }]);
    expect(JSON.parse(storage.values.egoConversation)).toEqual([{ user: 'Erstes Thema', reply: 'A' }]);

    const restored = create(storage, { idFactory: () => 'unused', now: () => 999 });
    expect(restored.getActiveThread().id).toBe('chat-a');
    expect(restored.getState().threads).toHaveLength(2);
  });

  test('deleting the final thread creates a new empty conversation', () => {
    const store = createTestStore(createStorage());
    const active = store.deleteThread('chat-a');

    expect(active.id).toBe('chat-b');
    expect(active.conversation).toEqual([]);
    expect(store.getState().threads).toHaveLength(1);
  });

  test('derives compact titles and limits each thread to thirty turns', () => {
    const store = createTestStore(createStorage());
    const turns = Array.from({ length: 35 }, (_, index) => ({
      user: index === 5 ? 'Eine sehr lange Unterhaltung mit einem automatisch gekürzten Titel für die Seitenleiste' : `Frage ${index}`,
      reply: `Antwort ${index}`
    }));
    const thread = store.setConversation('chat-a', turns);

    expect(thread.conversation).toHaveLength(30);
    expect(thread.conversation[0].user).toContain('Eine sehr lange Unterhaltung');
    expect(thread.title).toBe('Eine sehr lange Unterhaltung mit einem...');
  });

  test('persists skill access states and never restores a stale running state', () => {
    const store = createTestStore(createStorage());
    const thread = store.setConversation('chat-a', [{
      user: 'Recherchiere',
      thought: 'Suche läuft',
      skillRuns: [{ id: 'internet.research', status: 'running' }],
      reply: 'Ergebnis'
    }]);

    expect(thread.conversation[0].skillRuns).toEqual([
      { id: 'internet.research', status: 'failed' }
    ]);
  });

  test('persists the number of sources used by a completed skill access', () => {
    const store = createTestStore(createStorage());
    const thread = store.setConversation('chat-a', [{
      user: 'Recherchiere',
      skillRuns: [{ id: 'internet.research', status: 'completed', resultCount: 3 }],
      reply: 'Ergebnis'
    }]);

    expect(thread.conversation[0].skillRuns).toEqual([
      { id: 'internet.research', status: 'completed', resultCount: 3 }
    ]);
  });

  test('persists a blocked skill start distinctly from a failed access', () => {
    const store = createTestStore(createStorage());
    const thread = store.setConversation('chat-a', [{
      user: 'Aktuelle Nachrichten',
      skillRuns: [{ id: 'internet.research', status: 'blocked' }],
      reply: 'Ohne Recherche'
    }]);

    expect(thread.conversation[0].skillRuns[0].status).toBe('blocked');
  });
});
