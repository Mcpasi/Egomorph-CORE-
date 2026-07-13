(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EgoConversationStore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var STORAGE_KEY = 'egoConversationThreads';
  var LEGACY_KEY = 'egoConversation';
  var VERSION = 2;
  var MAX_THREADS = 50;
  var MAX_TURNS = 30;

  function cleanTurns(value) {
    if (!Array.isArray(value)) return [];
    return value
      .filter(function (item) { return item && typeof item === 'object'; })
      .map(function (item) {
        var turn = { user: String(item.user || ''), reply: String(item.reply || '') };
        if (item.thought) turn.thought = String(item.thought).slice(0, 2000);
        if (Array.isArray(item.skills)) {
          turn.skills = item.skills.map(function (skill) { return String(skill || '').slice(0, 160); }).filter(Boolean).slice(0, 10);
        }
        if (Array.isArray(item.skillRuns)) {
          turn.skillRuns = item.skillRuns.map(function (run) {
            var status = run && /^(running|completed|failed|blocked)$/.test(run.status) ? run.status : 'completed';
            var cleanRun = { id: String(run && run.id || '').slice(0, 160), status: status === 'running' ? 'failed' : status };
            if (run && /^(read|write)$/.test(run.operation)) cleanRun.operation = run.operation;
            if (run && Number.isFinite(Number(run.resultCount))) cleanRun.resultCount = Math.max(0, Math.round(Number(run.resultCount)));
            return cleanRun;
          }).filter(function (run) { return !!run.id; }).slice(0, 10);
        }
        return turn;
      })
      .slice(-MAX_TURNS);
  }

  function titleFromConversation(conversation) {
    for (var i = 0; i < conversation.length; i++) {
      var text = String(conversation[i].user || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      return text.length > 42 ? text.slice(0, 39).trimEnd() + '...' : text;
    }
    return '';
  }

  function create(storage, options) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new Error('Ein localStorage-kompatibler Speicher ist erforderlich');
    }
    var opts = options || {};
    var now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
    var idFactory = typeof opts.idFactory === 'function'
      ? opts.idFactory
      : function () {
          var random = Math.random().toString(36).slice(2, 10);
          return 'chat-' + now().toString(36) + '-' + random;
        };

    function newThread(conversation) {
      var timestamp = now();
      var turns = cleanTurns(conversation);
      return {
        id: String(idFactory()).slice(0, 160),
        title: titleFromConversation(turns),
        createdAt: timestamp,
        updatedAt: timestamp,
        conversation: turns
      };
    }

    function normalizeThread(thread) {
      if (!thread || typeof thread !== 'object' || !String(thread.id || '').trim()) return null;
      var conversation = cleanTurns(thread.conversation);
      var createdAt = Number(thread.createdAt) || now();
      return {
        id: String(thread.id).slice(0, 160),
        title: String(thread.title || titleFromConversation(conversation)).slice(0, 80),
        createdAt: createdAt,
        updatedAt: Number(thread.updatedAt) || createdAt,
        conversation: conversation
      };
    }

    function readJson(key, fallback) {
      try {
        var raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_) {
        return fallback;
      }
    }

    function load() {
      var saved = readJson(STORAGE_KEY, null);
      var threads = saved && Array.isArray(saved.threads)
        ? saved.threads.map(normalizeThread).filter(Boolean).slice(0, MAX_THREADS)
        : [];
      if (!threads.length) {
        threads.push(newThread(readJson(LEGACY_KEY, [])));
      }
      var activeThreadId = saved && threads.some(function (thread) { return thread.id === saved.activeThreadId; })
        ? saved.activeThreadId
        : threads[0].id;
      return { version: VERSION, activeThreadId: activeThreadId, threads: threads };
    }

    var state = load();

    function getThread(id) {
      var key = String(id || '');
      return state.threads.find(function (thread) { return thread.id === key; }) || null;
    }

    function getActiveThread() {
      return getThread(state.activeThreadId) || state.threads[0];
    }

    function persist() {
      var active = getActiveThread();
      if (active) state.activeThreadId = active.id;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(state));
        storage.setItem(LEGACY_KEY, JSON.stringify(active ? active.conversation : []));
      } catch (_) {
        // Private browsing or exhausted storage must not break the chat UI.
      }
      return state;
    }

    function createThread() {
      var thread = newThread([]);
      state.threads.unshift(thread);
      state.threads = state.threads.slice(0, MAX_THREADS);
      state.activeThreadId = thread.id;
      persist();
      return thread;
    }

    function switchThread(id) {
      var thread = getThread(id);
      if (!thread) return null;
      state.activeThreadId = thread.id;
      persist();
      return thread;
    }

    function setConversation(id, value) {
      var thread = getThread(id);
      if (!thread) return null;
      thread.conversation = cleanTurns(value);
      thread.title = thread.conversation.length
        ? (thread.title || titleFromConversation(thread.conversation))
        : '';
      thread.updatedAt = now();
      persist();
      return thread;
    }

    function clearThread(id) {
      return setConversation(id, []);
    }

    function deleteThread(id) {
      var key = String(id || '');
      var index = state.threads.findIndex(function (thread) { return thread.id === key; });
      if (index === -1) return null;
      state.threads.splice(index, 1);
      if (!state.threads.length) state.threads.push(newThread([]));
      if (!getThread(state.activeThreadId)) {
        state.activeThreadId = state.threads[Math.min(index, state.threads.length - 1)].id;
      }
      persist();
      return getActiveThread();
    }

    persist();
    return {
      getState: function () { return state; },
      getThread: getThread,
      getActiveThread: getActiveThread,
      getActiveConversation: function () { return getActiveThread().conversation; },
      createThread: createThread,
      switchThread: switchThread,
      setConversation: setConversation,
      clearThread: clearThread,
      deleteThread: deleteThread
    };
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    LEGACY_KEY: LEGACY_KEY,
    VERSION: VERSION,
    create: create,
    cleanTurns: cleanTurns,
    titleFromConversation: titleFromConversation
  };
});
