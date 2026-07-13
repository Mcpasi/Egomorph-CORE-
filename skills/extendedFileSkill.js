(function () {
  'use strict';

  var SKILL_ID = 'workspace.extended-files';
  var EXTENSION_PATTERN = /\.(?:js|css|html|py)$/i;
  var MAX_CONTENT_CHARS = 120000;

  function bridgeBaseUrl() {
    var url = window.egoProfile && typeof window.egoProfile.getCodexConfig === 'function'
      ? window.egoProfile.getCodexConfig().url
      : 'http://localhost:8787';
    return String(url || 'http://localhost:8787')
      .replace(/\/+$/, '')
      .replace(/\/v1\/chat\/completions$/i, '')
      .replace(/\/chat\/completions$/i, '')
      .replace(/\/v1$/i, '');
  }

  function normalizePath(value) {
    var path = String(value || '').trim().replace(/\\/g, '/').replace(/^["'`]+|["'`]+$/g, '');
    if (!path) throw new Error('Dateipfad fehlt');
    if (!EXTENSION_PATTERN.test(path)) throw new Error('Der Datei-Skill erlaubt nur .js, .css, .html und .py');
    return path.slice(0, 500);
  }

  async function parseResponse(response, action) {
    var data = null;
    try { data = await response.json(); } catch (_) { /* handled below */ }
    if (!response.ok || !data || !data.ok) {
      var message = data && data.error && (data.error.message || data.error.code);
      throw new Error(action + ' fehlgeschlagen' + (message ? ': ' + message : ''));
    }
    return data;
  }

  async function read(path, options) {
    var opts = options || {};
    var normalized = normalizePath(path);
    var response = await fetch(bridgeBaseUrl() + '/egomorph/extended-files?path=' + encodeURIComponent(normalized), {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'X-Egomorph-Skill': SKILL_ID },
      signal: opts.signal
    });
    return parseResponse(response, 'Dateizugriff');
  }

  async function write(path, content, options) {
    var opts = options || {};
    var normalized = normalizePath(path);
    var text = String(content == null ? '' : content).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!text.length) throw new Error('Dateiinhalt fehlt');
    if (text.length > MAX_CONTENT_CHARS) throw new Error('Dateiinhalt ist zu gross');
    var response = await fetch(bridgeBaseUrl() + '/egomorph/extended-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Egomorph-Skill': SKILL_ID },
      body: JSON.stringify({ path: normalized, content: text, overwrite: opts.overwrite !== false }),
      signal: opts.signal
    });
    return parseResponse(response, 'Dateischreiben');
  }

  window.EgoExtendedFileSkill = {
    id: SKILL_ID,
    extensions: ['.js', '.css', '.html', '.py'],
    read: read,
    write: write
  };
})();
