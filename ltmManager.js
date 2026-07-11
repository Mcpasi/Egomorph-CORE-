(function() {
  // Lightweight long-term memory manager
  const LTM_KEY = 'egoLongTermMemory';
  const MAX = 200;

  function hasStorage() {
    return typeof localStorage !== 'undefined' &&
      localStorage &&
      typeof localStorage.getItem === 'function' &&
      typeof localStorage.setItem === 'function';
  }

  function sanitiseEntry(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') {
      return { text: String(entry).slice(0, 280), topics: [], ts: 0, hits: 0 };
    }
    if (typeof entry !== 'object') return null;
    const text = entry.text == null ? '' : String(entry.text).slice(0, 280);
    const hits = typeof entry.hits === 'number' && Number.isFinite(entry.hits) ? entry.hits : 0;
    return {
      ...entry,
      text,
      topics: normaliseTopics(entry.topics),
      ts: normaliseTimestamp(entry.ts),
      hits
    };
  }
  function loadLTM() {
    if (!hasStorage()) return [];
    try {
      const raw = localStorage.getItem(LTM_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const normalised = [];
      for (const entry of parsed) {
        const sanitised = sanitiseEntry(entry);
        if (sanitised) normalised.push(sanitised);
      }
      return normalised;
    } catch (e) {
      return [];
    }
  }

  function saveLTM(arr) {
    if (!Array.isArray(arr)) return;
    if (!hasStorage()) return;
    try { localStorage.setItem(LTM_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  function normaliseTimestamp(ts) {
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
    return 0;
  }
  function addLongTermMemory(entry) {
    if (!entry || !entry.text) return;
    const now = Date.now();
    const ltm = loadLTM();
    const text = String(entry.text).trim().slice(0, 280);
    if (!text) return;
    const topics = normaliseTopics(entry.topics);
    const existing = ltm.find(item => String(item.text || '').trim().toLowerCase() === text.toLowerCase());
    if (existing) {
      existing.ts = Math.max(normaliseTimestamp(existing.ts), now);
      existing.topics = mergeTopics(existing.topics, topics);
    } else {
      ltm.push({ text, topics, ts: now, hits: 0 });
    }
    ltm.sort((a, b) => {
      const hitDelta = (b.hits || 0) - (a.hits || 0);
      if (hitDelta !== 0) return hitDelta;
      const tsA = normaliseTimestamp(a.ts);
      const tsB = normaliseTimestamp(b.ts);
      return tsB - tsA;
    });
    const trimmed = ltm.slice(0, MAX);
    saveLTM(trimmed);
  }

  function exportLongTermMemory() {
    const data = loadLTM();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'egomorph_ltm.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearLongTermMemory() {
    saveLTM([]);
  }

  function normaliseTopics(topics) {
    if (Array.isArray(topics)) return topics;
    if (topics == null) return [];
    return [topics];
  }

  function mergeTopics(a, b) {
    const seen = new Set();
    const merged = [];
    normaliseTopics(a).concat(normaliseTopics(b)).forEach(topic => {
      const text = String(topic == null ? '' : topic).trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) return;
      seen.add(key);
      merged.push(text);
    });
    return merged.slice(-20);
  }

  function queryLongTermMemory(query, k = 3) {
    const ltm = loadLTM();
    const q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return [];
    for (const e of ltm) {
      const txt = String(e.text == null ? '' : e.text).toLowerCase();
      const topicMatch = normaliseTopics(e.topics).some(t => String(t).toLowerCase().includes(q));
      const has = txt.includes(q) ? 1 : 0;
      const matchScore = has + (topicMatch ? 1 : 0);
      if (matchScore === 0) {
        e._score = 0;
        continue;
      }
      const ageDays = Math.max(0, (Date.now() - (e.ts || 0)) / (1000 * 60 * 60 * 24));
      const recencyBoost = 1 / (1 + ageDays);
      const hitScore = Math.log10((Math.max(0, e.hits || 0)) + 1);
      e._score = matchScore + hitScore + recencyBoost;
    }
    ltm.sort((a, b) => (b._score || 0) - (a._score || 0));
    const top = ltm.filter(e => (e._score || 0) > 0).slice(0, k);
    for (const e of top) {
      e.hits = (e.hits || 0) + 1;
      delete e._score;
    }
    for (const e of ltm) {
      if (e._score != null) delete e._score;
    }
    saveLTM(ltm);
    return top.map(e => e.text);
  }

  // Hook into memory persistence spot to also capture LTM
  if (hasStorage() && !localStorage.__egoLtmHooked) {
    const _setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(key, value) {
      try {
        if (key === 'egoConversation') {
          const conv = JSON.parse(value);
          const topics = JSON.parse(localStorage.getItem('egoMemoryTopics') || '[]');
          if (Array.isArray(conv) && conv.length > 0) {
            for (let i = conv.length - 1; i >= 0; i--) {
              if (conv[i] && conv[i].user && String(conv[i].user).trim()) {
                addLongTermMemory({ text: conv[i].user, topics });
                break;
              }
            }
          }
        } else if (key === 'egoMemory') {
          const mem = JSON.parse(value);
          const topics = JSON.parse(localStorage.getItem('egoMemoryTopics') || '[]');
          if (Array.isArray(mem) && mem.length > 0) {
            addLongTermMemory({ text: mem[mem.length - 1], topics });
          }
        }
      } catch (_) {}
      return _setItem(key, value);
    };
    try {
      Object.defineProperty(localStorage, '__egoLtmHooked', { value: true, configurable: true });
    } catch (_) {
      localStorage.__egoLtmHooked = true;
    }
  }

  if (typeof window !== 'undefined') {
    window.exportLongTermMemory = exportLongTermMemory;
    window.clearLongTermMemory = clearLongTermMemory;
    window.queryLongTermMemory = queryLongTermMemory;
  }
})();
