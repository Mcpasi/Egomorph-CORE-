(function () {
  'use strict';

  var STATE_KEY = 'egoSkillStatesV1';
  var MANIFEST_URLS = [
    'skills/internet/manifest.json',
    'skills/extended-files/manifest.json',
    'skills/learn-with-egomorph/manifest.json'
  ];
  var VALID_PROFILES = ['full', 'api', 'codex'];
  var manifests = [];
  var states = readJson(STATE_KEY, {});
  var entrypointLoads = {};

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }

  function writeStates() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(states)); } catch (_) { /* ignore */ }
    if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
      document.dispatchEvent(new CustomEvent('ego-skills-change'));
    }
  }

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  function validateManifest(manifest, source) {
    if (!manifest || manifest.schemaVersion !== 1) throw new Error('Unsupported skill manifest: ' + source);
    ['id', 'name', 'version', 'entrypoint'].forEach(function (key) {
      if (typeof manifest[key] !== 'string' || !manifest[key].trim()) throw new Error('Invalid skill manifest field "' + key + '": ' + source);
    });
    if (!Array.isArray(manifest.permissions) || !Array.isArray(manifest.profiles)) {
      throw new Error('Skill manifest requires permissions and profiles: ' + source);
    }
    manifest.permissions.forEach(function (permission) {
      if (!permission || typeof permission.id !== 'string') throw new Error('Invalid skill permission: ' + source);
    });
    manifest.profiles = manifest.profiles.filter(function (profile) { return VALID_PROFILES.indexOf(profile) !== -1; });
    return manifest;
  }

  function defaultState(manifest) {
    var permissions = {};
    manifest.permissions.forEach(function (permission) { permissions[permission.id] = permission.defaultGranted === true; });
    return {
      installed: manifest.builtIn === true,
      enabled: manifest.defaultEnabled !== false,
      permissions: permissions,
      profiles: manifest.profiles.slice(),
      config: {},
      lastRunAt: null
    };
  }

  function migrateInternetState(state) {
    if (state.__legacyMigrated) return state;
    try {
      var enabled = localStorage.getItem('egoSkillInternetEnabled');
      if (enabled != null) state.enabled = enabled !== 'false';
      var provider = localStorage.getItem('egoInternetSearchProvider');
      var googleApiKey = localStorage.getItem('egoInternetGoogleApiKey');
      var googleCx = localStorage.getItem('egoInternetGoogleCx');
      if (provider) state.config.provider = provider;
      if (googleApiKey) state.config.googleApiKey = googleApiKey;
      if (googleCx) state.config.googleCx = googleCx;
      if (googleApiKey || googleCx) state.permissions.credentials = true;
    } catch (_) { /* ignore */ }
    state.__legacyMigrated = true;
    return state;
  }

  function ensureState(manifest) {
    var state = states[manifest.id];
    if (!state || typeof state !== 'object') state = defaultState(manifest);
    var defaults = defaultState(manifest);
    state.installed = typeof state.installed === 'boolean' ? state.installed : defaults.installed;
    state.enabled = typeof state.enabled === 'boolean' ? state.enabled : defaults.enabled;
    state.permissions = Object.assign({}, defaults.permissions, state.permissions || {});
    state.profiles = Array.isArray(state.profiles) ? state.profiles.filter(function (profile) {
      return manifest.profiles.indexOf(profile) !== -1;
    }) : defaults.profiles;
    state.config = state.config && typeof state.config === 'object' ? state.config : {};
    state.lastRunAt = typeof state.lastRunAt === 'string' ? state.lastRunAt : null;
    if (manifest.id === 'internet.research') state = migrateInternetState(state);
    states[manifest.id] = state;
    return state;
  }

  function findManifest(id) { return manifests.find(function (manifest) { return manifest.id === id; }) || null; }
  function getSkill(id) {
    var manifest = findManifest(id);
    return manifest ? { manifest: clone(manifest), state: clone(ensureState(manifest)) } : null;
  }
  function getSkills() { return manifests.map(function (manifest) { return getSkill(manifest.id); }); }

  function update(id, callback) {
    var manifest = findManifest(id);
    if (!manifest) return false;
    callback(ensureState(manifest), manifest);
    writeStates();
    return true;
  }

  function loadEntrypoint(manifest) {
    if (!manifest || typeof document === 'undefined' || typeof document.createElement !== 'function') return Promise.resolve();
    if (entrypointLoads[manifest.entrypoint]) return entrypointLoads[manifest.entrypoint];
    var existing = typeof document.querySelector === 'function'
      ? document.querySelector('script[data-skill-entrypoint="' + manifest.entrypoint + '"]')
      : null;
    if (existing) return Promise.resolve();
    entrypointLoads[manifest.entrypoint] = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = manifest.entrypoint;
      script.async = true;
      script.dataset.skillEntrypoint = manifest.entrypoint;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('Skill entrypoint could not be loaded: ' + manifest.entrypoint)); };
      (document.head || document.documentElement).appendChild(script);
    });
    return entrypointLoads[manifest.entrypoint];
  }

  function setInstalled(id, installed) {
    var changed = update(id, function (state) { state.installed = !!installed; if (!installed) state.enabled = false; });
    if (changed && installed) loadEntrypoint(findManifest(id)).catch(function (error) { console.error('[skillSystem]', error); });
    return changed;
  }
  function setEnabled(id, enabled) { return update(id, function (state) { state.enabled = !!enabled; }); }
  function setPermission(id, permissionId, granted) {
    return update(id, function (state, manifest) {
      if (manifest.permissions.some(function (permission) { return permission.id === permissionId; })) state.permissions[permissionId] = !!granted;
    });
  }
  function setProfiles(id, profiles) {
    return update(id, function (state, manifest) {
      state.profiles = (profiles || []).filter(function (profile) { return manifest.profiles.indexOf(profile) !== -1; });
    });
  }
  function setConfig(id, config) {
    return update(id, function (state, manifest) {
      (manifest.setup || []).forEach(function (field) {
        if (!Object.prototype.hasOwnProperty.call(config || {}, field.id)) return;
        var value = config[field.id];
        state.config[field.id] = typeof value === 'string' ? value.trim() : value;
      });
    });
  }
  function getConfig(id) { var skill = getSkill(id); return skill ? clone(skill.state.config) : {}; }

  function canRun(id, profile) {
    var skill = getSkill(id);
    if (!skill || !skill.state.installed || !skill.state.enabled || skill.state.profiles.indexOf(profile) === -1) return false;
    return skill.manifest.permissions.every(function (permission) {
      return permission.required !== true || skill.state.permissions[permission.id] === true;
    });
  }

  function canRunWithPermissions(id, profile, permissionIds) {
    var skill = getSkill(id);
    if (!skill || !skill.state.installed || !skill.state.enabled || skill.state.profiles.indexOf(profile) === -1) return false;
    var requested = Array.isArray(permissionIds) ? permissionIds : [permissionIds];
    if (!canRun(id, profile)) return false;
    return requested.filter(Boolean).every(function (permissionId) {
      return skill.manifest.permissions.some(function (permission) { return permission.id === permissionId; }) &&
        skill.state.permissions[permissionId] === true;
    });
  }

  function getConfigForRun(id) {
    var skill = getSkill(id);
    if (!skill) return {};
    var config = clone(skill.state.config);
    (skill.manifest.setup || []).forEach(function (field) {
      if (field.permission && skill.state.permissions[field.permission] !== true) delete config[field.id];
    });
    return config;
  }

  function recordRun(id, date) {
    return update(id, function (state) { state.lastRunAt = (date instanceof Date ? date : new Date(date || Date.now())).toISOString(); });
  }

  var ready = Promise.all(MANIFEST_URLS.map(function (url) {
    return fetch(url, { cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error('Skill manifest could not be loaded: ' + url);
      return response.json();
    }).then(function (manifest) { return validateManifest(manifest, url); });
  })).then(function (loaded) {
    manifests = loaded;
    manifests.forEach(ensureState);
    writeStates();
    return Promise.all(manifests.filter(function (manifest) { return ensureState(manifest).installed; }).map(loadEntrypoint))
      .then(getSkills);
  }).catch(function (error) {
    console.error('[skillSystem]', error);
    return [];
  });

  window.EgoSkillSystem = {
    ready: ready,
    getSkills: getSkills,
    getSkill: getSkill,
    setInstalled: setInstalled,
    setEnabled: setEnabled,
    setPermission: setPermission,
    setProfiles: setProfiles,
    setConfig: setConfig,
    getConfig: getConfig,
    getConfigForRun: getConfigForRun,
    canRun: canRun,
    canRunWithPermissions: canRunWithPermissions,
    recordRun: recordRun,
    loadEntrypoint: loadEntrypoint
  };
})();
