(function () {
  'use strict';

  var locales = window.EgoMorphLocales || {};
  var language = safeGet('egoLanguage', 'de');
  if (!locales[language]) language = 'de';
  var translations = {};
  Object.keys(locales).forEach(function (key) { translations[key] = locales[key].ui || {}; });
  window.__egoTranslations = translations;
  window.__egoCurrentLanguage = language;
  window.egoT = function (key) {
    return translations[language] && translations[language][key] != null
      ? translations[language][key]
      : translations.de && translations.de[key] != null ? translations.de[key] : key;
  };

  var input = byId('inputText');
  var inputForm = byId('inputForm');
  var responseBox = byId('response');
  var sendButton = byId('sendBtn');
  var stopButton = byId('stopBtn');
  var speechButton = byId('speechButton');
  var activeController = null;
  var pendingMarkdownPaths = [];
  var voiceEnabled = safeGet('voiceEnabled', 'true') !== 'false';
  var threads = createConversationThreadsStore();
  var activeThreadId = threads.getActiveThread().id;
  var conversation = threads.getActiveConversation();

  function byId(id) { return document.getElementById(id); }
  function safeGet(key, fallback) {
    try { var value = localStorage.getItem(key); return value == null ? fallback : value; }
    catch (_) { return fallback; }
  }
  function safeSet(key, value) { try { localStorage.setItem(key, String(value)); } catch (_) {} }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function format(key, fallback, values) {
    var value = window.egoT(key);
    if (!value || value === key) value = fallback;
    Object.keys(values || {}).forEach(function (name) {
      value = String(value).replace(new RegExp('\\{' + name + '\\}', 'g'), values[name]);
    });
    return value;
  }
  function createConversationThreadsStore() {
    if (window.EgoConversationStore && typeof window.EgoConversationStore.create === 'function') {
      return window.EgoConversationStore.create(localStorage);
    }
    console.error('[conversation] conversationStore.js fehlt; starte mit flüchtigem Notfall-Speicher.');
    var thread = { id: 'temporary', title: '', conversation: [] };
    return {
      getState: function () { return { activeThreadId: thread.id, threads: [thread] }; },
      getActiveThread: function () { return thread; },
      getActiveConversation: function () { return thread.conversation; },
      createThread: function () { thread = { id: 'temporary-' + Date.now(), title: '', conversation: [] }; return thread; },
      switchThread: function () { return thread; },
      setConversation: function (_, value) { thread.conversation = value.slice(); return thread; },
      clearThread: function () { thread.conversation = []; return thread; },
      deleteThread: function () { thread = { id: 'temporary-' + Date.now(), title: '', conversation: [] }; return thread; }
    };
  }

  function persistConversation() { threads.setConversation(activeThreadId, conversation); }
  function translatedSkillName(skillId) {
    var skill = window.EgoSkillSystem && window.EgoSkillSystem.getSkill
      ? window.EgoSkillSystem.getSkill(skillId)
      : null;
    var manifest = skill && skill.manifest;
    return manifest
      ? translatedManifestText(manifest.displayNameKey, manifest.name || skillId)
      : String(skillId || '');
  }
  function skillRunStatus(run) {
    if (run && run.status === 'blocked') return window.egoT('agentSkillBlocked');
    if (!run || run.status === 'running') return window.egoT('agentSkillRunning');
    if (run.status === 'failed') return window.egoT('agentSkillFailed');
    if (run.resultCount === 0) return window.egoT('agentSkillCompletedNoSources');
    if (Number(run.resultCount) > 0) {
      return format('agentSkillCompletedSources', '{count} Quellen verwendet', { count: run.resultCount });
    }
    return window.egoT('agentSkillCompleted');
  }
  function renderAgentReply(turn) {
    var thought = String(turn.thought || window.egoT('agentThoughtFallback'));
    var skillRuns = Array.isArray(turn.skillRuns) ? turn.skillRuns : [];
    if (!skillRuns.length && Array.isArray(turn.skills)) {
      skillRuns = turn.skills.filter(Boolean).map(function (id) { return { id: id, status: 'completed' }; });
    }
    var html = '<section class="agent-step agent-thought"><strong>' + escapeHtml(window.egoT('agentThoughtLabel')) + '</strong><span>' + escapeHtml(thought) + '</span></section>';
    if (skillRuns.length) {
      html += '<section class="agent-step agent-skill"><strong>' + escapeHtml(window.egoT('agentSkillLabel')) + '</strong>' +
        skillRuns.map(function (run) {
          return '<span class="agent-skill-run" data-status="' + escapeHtml(run.status || 'completed') + '">' +
            escapeHtml(translatedSkillName(run.id)) + ' · ' + escapeHtml(skillRunStatus(run)) + '</span>';
        }).join('') + '</section>';
    }
    html += '<div class="agent-final-separator">' + escapeHtml(window.egoT('agentFinalLabel')) + '</div>' +
      '<div class="agent-final-answer">' + escapeHtml(turn.reply || (turn.pending ? window.egoT('agentFinalWaiting') : '')) + '</div>';
    return html;
  }
  function renderConversation() {
    if (!responseBox) return;
    responseBox.innerHTML = conversation.map(function (turn) {
      return '<article class="conversation-turn">' +
        '<div class="conversation-line conversation-user"><strong>' + escapeHtml(window.egoT('youPrefix')) + '</strong> ' + escapeHtml(turn.user) + '</div>' +
        '<div class="conversation-line conversation-bot"><strong>Egomorph Core:</strong>' + renderAgentReply(turn) + '</div>' +
        '</article>';
    }).join('');
    responseBox.scrollTop = responseBox.scrollHeight;
  }
  function renderThreads() {
    var list = byId('conversationThreadList');
    if (!list) return;
    list.innerHTML = '';
    var state = threads.getState();
    state.threads.forEach(function (thread) {
      var item = document.createElement('div');
      item.className = 'conversation-thread-item' + (thread.id === activeThreadId ? ' is-active' : '');
      item.setAttribute('role', 'listitem');
      var select = document.createElement('button');
      select.type = 'button';
      select.className = 'conversation-thread-select';
      select.innerHTML = '<strong>' + escapeHtml(thread.title || window.egoT('conversationUntitled')) + '</strong><small>' +
        escapeHtml(format('conversationMessageCount', '{count} Nachrichten', { count: thread.conversation.length })) + '</small>';
      select.addEventListener('click', function () { switchThread(thread.id); });
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'conversation-thread-delete';
      remove.setAttribute('aria-label', window.egoT('conversationDelete'));
      remove.textContent = '×';
      remove.addEventListener('click', function () { deleteThread(thread.id); });
      item.appendChild(select); item.appendChild(remove); list.appendChild(item);
    });
    var active = threads.getActiveThread();
    if (byId('activeConversationTitle')) byId('activeConversationTitle').textContent = active.title || window.egoT('conversationUntitled');
  }
  function switchThread(id) {
    var thread = threads.switchThread(id); if (!thread) return;
    activeThreadId = thread.id; conversation = thread.conversation.slice(); renderConversation(); renderThreads(); closeDrawer();
  }
  function newThread() {
    var thread = threads.createThread(); activeThreadId = thread.id; conversation = []; renderConversation(); renderThreads(); closeDrawer();
  }
  function deleteThread(id) {
    resetCodexConversationSession(id);
    var thread = threads.deleteThread(id); activeThreadId = thread.id; conversation = thread.conversation.slice(); renderConversation(); renderThreads();
  }
  function resetCodexConversationSession(id) {
    if (window.egoProfile && typeof window.egoProfile.resetCodexSession === 'function') {
      window.egoProfile.resetCodexSession(id).catch(function () {});
    }
  }
  window.getActiveConversationThreadId = function () { return activeThreadId; };
  window.getActiveConversationHistory = function () { return conversation.slice(); };

  function setBusy(busy) {
    if (sendButton) { sendButton.disabled = busy; sendButton.hidden = busy; }
    if (stopButton) stopButton.hidden = !busy;
    if (inputForm) inputForm.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
  function abortError(error) { return error && (error.name === 'AbortError' || /abgebrochen|aborted/i.test(String(error.message || error))); }
  async function generateReply(text, signal, callbacks) {
    var events = callbacks || {};
    var profile = window.egoProfile && window.egoProfile.get ? window.egoProfile.get() : 'codex';
    var usedSkills = [];
    if (profile === 'api' || profile === 'codex') {
      var content = await window.egoProfile.apiGenerateReply(text, {
        modelHomeFiles: pendingMarkdownPaths.slice(),
        sessionId: activeThreadId,
        conversationHistory: conversation.slice(0, -1),
        onPhase: events.onPhase,
        onToken: events.onToken,
        onSkillStart: events.onSkillStart,
        onSkillBlocked: events.onSkillBlocked,
        onSkillUse: function (skillId, detail) {
          if (skillId && usedSkills.indexOf(skillId) === -1) usedSkills.push(skillId);
          if (typeof events.onSkillUse === 'function') events.onSkillUse(skillId, detail);
        },
        onSkillError: events.onSkillError,
        signal: signal
      });
      return { content: content, skills: usedSkills };
    }
    if (profile === 'full' && typeof window.generateWithLLM === 'function' &&
        typeof window.isLLMEnabled === 'function' && window.isLLMEnabled() &&
        typeof window.getChatModelStatus === 'function' && window.getChatModelStatus() === 'ready') {
      if (typeof events.onPhase === 'function') events.onPhase('model');
      return { content: await window.generateWithLLM(text, { signal: signal, conversationHistory: conversation.slice(0, -1) }), skills: [] };
    }
    throw new Error(window.egoT('modelRequiredError'));
  }
  async function interact(event) {
    if (event) event.preventDefault();
    var text = input ? input.value.trim() : '';
    if (!text || activeController) return;
    var controller = new AbortController(); activeController = controller; setBusy(true); input.value = '';
    var turn = { user: text, thought: window.egoT('agentAnalyzingStatus'), skillRuns: [], reply: '', pending: true };
    conversation.push(turn); renderConversation(); renderThreads();
    function updateSkill(skillId, status, detail) {
      if (!skillId) return;
      var run = turn.skillRuns.find(function (item) { return item.id === skillId; });
      if (!run) { run = { id: skillId, status: status }; turn.skillRuns.push(run); }
      else run.status = status;
      if (detail && Number.isFinite(Number(detail.resultCount))) run.resultCount = Math.max(0, Math.round(Number(detail.resultCount)));
      renderConversation();
    }
    try {
      var generated = await generateReply(text, controller.signal, {
        onPhase: function (phase) {
          if (phase === 'model' && !turn.reply) turn.thought = window.egoT('agentModelWorkingStatus');
          renderConversation();
        },
        onSkillStart: function (skillId) { updateSkill(skillId, 'running'); },
        onSkillBlocked: function (skillId) { updateSkill(skillId, 'blocked'); },
        onSkillUse: function (skillId, detail) { updateSkill(skillId, 'completed', detail); },
        onSkillError: function (skillId) { updateSkill(skillId, 'failed'); },
        onToken: function (_, streamedText) {
          var live = window.EgoAgentResponse.parseLive(streamedText, {
            fallbackThought: turn.thought,
            protectedPaths: pendingMarkdownPaths.slice()
          });
          if (live.thought) turn.thought = live.thought;
          turn.reply = live.reply;
          renderConversation();
        }
      });
      if (!generated || !generated.content) throw new Error(window.egoT('emptyModelReply'));
      var parsed = window.EgoAgentResponse.parse(generated.content, {
        fallbackThought: window.egoT('agentThoughtFallback'),
        protectedPaths: pendingMarkdownPaths.slice(),
        skills: generated.skills
      });
      if (!parsed.reply) throw new Error(window.egoT('emptyModelReply'));
      pendingMarkdownPaths = [];
      updateUploadStatus('');
      turn.thought = parsed.thought;
      turn.reply = parsed.reply;
      turn.pending = false;
      generated.skills.forEach(function (skillId) {
        var existing = turn.skillRuns.find(function (run) { return run.id === skillId; });
        if (!existing || existing.status === 'running') updateSkill(skillId, 'completed');
      });
      persistConversation(); renderConversation(); renderThreads(); speak(parsed.reply);
    } catch (error) {
      if (abortError(error)) {
        conversation.pop();
        if (input && !input.value.trim()) input.value = text;
      } else {
        turn.thought = window.egoT('agentProcessingFailed');
        turn.reply = format('replyErrorPrefix', 'Fehler: {message}', { message: error.message || error });
        turn.pending = false;
        persistConversation(); renderConversation(); renderThreads();
      }
    } finally { if (activeController === controller) activeController = null; setBusy(false); }
  }
  if (inputForm) inputForm.addEventListener('submit', interact);
  if (input && inputForm) input.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault(); inputForm.requestSubmit();
  });
  if (stopButton) stopButton.addEventListener('click', function () { if (activeController) activeController.abort(); });

  function updateUploadStatus(message, kind) {
    var status = byId('markdownUploadStatus'); if (!status) return;
    status.textContent = message || ''; status.dataset.kind = kind || '';
  }
  async function uploadMarkdownFiles(files) {
    if (!window.egoProfile || typeof window.egoProfile.uploadMarkdownFileToModelHome !== 'function') {
      updateUploadStatus(window.egoT('markdownUploadUnavailable'), 'error'); return;
    }
    updateUploadStatus(window.egoT('markdownUploadUploading'), 'working');
    try {
      var results = [];
      for (var i = 0; i < files.length; i++) results.push(await window.egoProfile.uploadMarkdownFileToModelHome(files[i]));
      pendingMarkdownPaths = pendingMarkdownPaths.concat(results.map(function (result) { return result.file.path; }))
        .filter(function (path, index, all) { return all.indexOf(path) === index; });
      updateUploadStatus(results.length === 1
        ? format('markdownUploadSuccess', 'Hochgeladen: {path}.', { path: results[0].file.path })
        : format('markdownUploadSuccessMultiple', '{count} Dateien hochgeladen.', { count: results.length }), 'success');
    } catch (error) { updateUploadStatus(window.egoT('markdownUploadErrorPrefix') + error.message, 'error'); }
  }
  window.getPendingMarkdownUploadPaths = function () { return pendingMarkdownPaths.slice(); };
  window.consumePendingMarkdownUploadPaths = function () { var paths = pendingMarkdownPaths.slice(); pendingMarkdownPaths = []; return paths; };
  var uploadButton = byId('markdownUploadBtn'); var uploadInput = byId('markdownUploadInput');
  if (uploadButton && uploadInput) uploadButton.addEventListener('click', function () { uploadInput.click(); });
  if (uploadInput) uploadInput.addEventListener('change', function () { uploadMarkdownFiles(uploadInput.files); uploadInput.value = ''; });

  function speak(text) {
    if (!voiceEnabled || !window.speechSynthesis || typeof SpeechSynthesisUtterance !== 'function') return;
    var utterance = new SpeechSynthesisUtterance(String(text)); utterance.lang = language === 'de' ? 'de-DE' : language === 'fr' ? 'fr-FR' : 'en-US';
    window.speechSynthesis.speak(utterance);
  }
  function bindSpeechInput() {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!speechButton || !Recognition) { if (speechButton) speechButton.hidden = true; return; }
    speechButton.addEventListener('click', function () {
      var recognition = new Recognition(); recognition.lang = language === 'de' ? 'de-DE' : language === 'fr' ? 'fr-FR' : 'en-US';
      recognition.onresult = function (event) { input.value = event.results[0][0].transcript; input.focus(); }; recognition.start();
    });
  }

  function updateTranslations() {
    document.documentElement.lang = language; window.__egoCurrentLanguage = language;
    var textMap = {
      welcomeText: 'welcomeText', closeModalBtn: 'closeModalBtn', sendBtn: 'sendButton', stopBtn: 'stopButton',
      settingsToggle: 'settingsBtn', writerToggle: 'writerBtn', infoToggle: 'infoBtn', settingsTitle: 'settingsTitle', settingsIntro: 'settingsIntro',
      settingsQuickSummary: 'quickActionsTitle', quickActionsHint: 'quickActionsHint', clearConvBtn: 'clearChatBtn', toggleVoiceBtn: voiceEnabled ? 'voiceDeactivate' : 'voiceActivate',
      ltmExportBtn: 'ltmExportBtn', ltmClearBtn: 'ltmClearBtn', settingsPersonalSummary: 'personalSectionTitle', userNameLabel: 'userNameLabel',
      saveUserNameBtn: 'saveUserNameBtn', clearUserNameBtn: 'clearUserNameBtn', personalHint: 'personalSectionHint', resourceProfileSummary: 'resourceProfileTitle',
      resourceProfileIntro: 'resourceProfileIntro', resourceProfileFullName: 'resourceProfileFullName', resourceProfileFullText: 'resourceProfileFullText',
      resourceProfileFullMeta: 'resourceProfileFullMeta', resourceProfileApiText: 'resourceProfileApiText', resourceProfileApiMeta: 'resourceProfileApiMeta',
      resourceProfileCodexText: 'resourceProfileCodexText', resourceProfileCodexMeta: 'resourceProfileCodexMeta', resourceProfileReloadHint: 'resourceProfileReloadHint',
      skillSettingsSummary: 'skillSettingsTitle', skillSettingsIntro: 'skillSettingsIntro',
      apiSettingsSummary: 'apiSettingsTitle', apiSettingsIntro: 'apiSettingsIntro', apiSettingsWarning: 'apiSettingsWarning', apiUrlLabel: 'apiUrlLabel', apiKeyLabel: 'apiKeyLabel', apiModelLabel: 'apiModelLabel',
      apiMaxTokensLabel: 'apiMaxTokensLabel', apiMaxTokensHint: 'apiMaxTokensHint', apiSaveBtn: 'apiSaveBtn', apiTestBtn: 'apiTestBtn', apiExamplesTitle: 'apiExamplesTitle',
      codexSettingsSummary: 'codexSettingsTitle', codexSettingsIntro: 'codexSettingsIntro', codexSettingsWarning: 'codexSettingsWarning', codexSetupTitle: 'codexSetupTitle',
      codexStepLogin: 'codexStepLogin', codexStepBridge: 'codexStepBridge', codexStepCheck: 'codexStepCheck', codexPersistentHint: 'codexPersistentHint', codexBridgeUrlLabel: 'codexBridgeUrlLabel',
      codexModelLabel: 'codexModelLabel', codexMaxTokensLabel: 'codexMaxTokensLabel', codexMaxTokensHint: 'codexMaxTokensHint', codexSaveBtn: 'codexSaveBtn', codexTestBtn: 'codexTestBtn', codexStatusBtn: 'codexStatusBtn',
      chatModelSettingsSummary: 'chatModelSettingsTitle', chatModelIdLabel: 'chatModelIdLabel', reloadChatModelBtn: 'reloadChatModelBtn', llmMaxTokensLabel: 'llmMaxTokensLabel', llmEnabledLabel: 'llmEnabledLabel',
      chatModelSettingsHint: 'chatModelSettingsHint', lightChatModelsTitle: 'lightChatModelsTitle', languageSummary: 'languageSectionTitle', languageLabel: 'languageLabel',
      conversationDrawerToggleLabel: 'conversationsTitle', conversationSidebarTitle: 'conversationsTitle', newConversationBtn: 'newConversationBtn', conversationSidebarHint: 'conversationSidebarHint', activeConversationEyebrow: 'activeConversationLabel'
    };
    Object.keys(textMap).forEach(function (id) { var el = byId(id); if (el) el.innerHTML = window.egoT(textMap[id]); });
    if (input) input.placeholder = window.egoT('placeholder');
    var info = byId('infoContent'); if (info) info.innerHTML = window.egoT('infoText');
    renderConversation(); renderThreads(); renderSkillCatalog();
    document.dispatchEvent(new CustomEvent('ego-language-change', { detail: { language: language } }));
  }
  function bindPanels() {
    var settings = byId('settingsPanel'); var info = byId('infoPanel');
    if (byId('settingsToggle')) byId('settingsToggle').addEventListener('click', function () {
      var open = settings.style.display !== 'flex'; settings.style.display = open ? 'flex' : 'none'; settings.setAttribute('aria-hidden', open ? 'false' : 'true'); this.setAttribute('aria-expanded', String(open));
    });
    if (byId('infoToggle')) byId('infoToggle').addEventListener('click', function () {
      var open = info.style.display !== 'block'; info.style.display = open ? 'block' : 'none'; info.setAttribute('aria-hidden', open ? 'false' : 'true'); this.setAttribute('aria-expanded', String(open));
    });
    if (byId('clearConvBtn')) byId('clearConvBtn').addEventListener('click', function () { threads.clearThread(activeThreadId); conversation = []; resetCodexConversationSession(activeThreadId); renderConversation(); renderThreads(); });
    if (byId('toggleVoiceBtn')) byId('toggleVoiceBtn').addEventListener('click', function () { voiceEnabled = !voiceEnabled; safeSet('voiceEnabled', voiceEnabled); updateTranslations(); });
    if (byId('newConversationBtn')) byId('newConversationBtn').addEventListener('click', newThread);
    if (byId('ltmExportBtn') && typeof window.exportLongTermMemory === 'function') byId('ltmExportBtn').addEventListener('click', window.exportLongTermMemory);
    if (byId('ltmClearBtn') && typeof window.clearLongTermMemory === 'function') byId('ltmClearBtn').addEventListener('click', window.clearLongTermMemory);
    if (byId('saveUserNameBtn')) byId('saveUserNameBtn').addEventListener('click', function () { var value = byId('userNameInput').value.trim(); if (value) safeSet('egoUserName', value); renderSavedName(); });
    if (byId('clearUserNameBtn')) byId('clearUserNameBtn').addEventListener('click', function () { try { localStorage.removeItem('egoUserName'); } catch (_) {} renderSavedName(); });
    var languageSelect = byId('languageSelect'); if (languageSelect) { languageSelect.value = language; languageSelect.addEventListener('change', function () { language = this.value; safeSet('egoLanguage', language); updateTranslations(); }); }
  }
  function renderSavedName() { var name = safeGet('egoUserName', ''); if (byId('userNameInput')) byId('userNameInput').value = name; if (byId('currentUserName')) byId('currentUserName').textContent = name ? format('savedNameTemplate', '({name})', { name: name }) : ''; }
  function openDrawer() { document.body.classList.add('conversation-drawer-open'); if (byId('conversationDrawerToggle')) byId('conversationDrawerToggle').setAttribute('aria-expanded', 'true'); }
  function closeDrawer() { document.body.classList.remove('conversation-drawer-open'); if (byId('conversationDrawerToggle')) byId('conversationDrawerToggle').setAttribute('aria-expanded', 'false'); }
  if (byId('conversationDrawerToggle')) byId('conversationDrawerToggle').addEventListener('click', openDrawer);
  if (byId('conversationDrawerClose')) byId('conversationDrawerClose').addEventListener('click', closeDrawer);
  if (byId('conversationDrawerBackdrop')) byId('conversationDrawerBackdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeDrawer(); });

  function skillElement(tag, className, textValue) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue != null) node.textContent = textValue;
    return node;
  }

  function translatedManifestText(key, fallback) {
    var value = key ? window.egoT(key) : '';
    return value && value !== key ? value : fallback || '';
  }

  function skillStatus(skill) {
    if (!skill.state.installed) return window.egoT('skillNotInstalled');
    return skill.state.enabled ? window.egoT('skillEnabled') : window.egoT('skillDisabled');
  }

  var skillStatusMessages = {};
  function setSkillStatus(id, message) {
    skillStatusMessages[id] = message;
    var card = byId('skill-card-' + id.replace(/[^a-z0-9_-]/gi, '-'));
    var status = card && card.querySelector('.skill-action-status');
    if (status) status.textContent = message;
  }

  function saveSkillCard(skill, card) {
    var system = window.EgoSkillSystem;
    var profiles = Array.prototype.slice.call(card.querySelectorAll('[data-skill-profile]:checked')).map(function (input) { return input.value; });
    var config = {};
    Array.prototype.slice.call(card.querySelectorAll('[data-skill-config]')).forEach(function (input) { config[input.dataset.skillConfig] = input.value; });
    var enabled = card.querySelector('[data-skill-enabled]');
    if (enabled) system.setEnabled(skill.manifest.id, enabled.checked);
    Array.prototype.slice.call(card.querySelectorAll('[data-skill-permission]')).forEach(function (input) {
      system.setPermission(skill.manifest.id, input.value, input.checked);
    });
    system.setProfiles(skill.manifest.id, profiles);
    system.setConfig(skill.manifest.id, config);
    setSkillStatus(skill.manifest.id, window.egoT('skillSavedStatus'));
  }

  async function testSkill(skill, card) {
    saveSkillCard(skill, card);
    setSkillStatus(skill.manifest.id, window.egoT('internetSkillTestingStatus'));
    try {
      if (!window.EgoSkillSystem.canRun(skill.manifest.id, window.egoProfile.get())) throw new Error(window.egoT('skillUnavailableForProfile'));
      var config = window.EgoSkillSystem.getConfigForRun(skill.manifest.id);
      var result = await window.EgoInternetSkill.search(window.egoT('internetSkillTestQuery'), { limit: 3, language: language, config: Object.assign({ enabled: true }, config) });
      window.EgoSkillSystem.recordRun(skill.manifest.id);
      setSkillStatus(skill.manifest.id, format('internetSkillTestOkStatus', 'OK ({count})', { count: result.results.length }));
    } catch (error) {
      setSkillStatus(skill.manifest.id, window.egoT('internetSkillErrorStatusPrefix') + error.message);
    }
  }

  function renderSkillCatalog() {
    var catalog = byId('skillCatalog');
    if (!catalog) return;
    if (!window.EgoSkillSystem) { catalog.textContent = window.egoT('skillSystemUnavailable'); return; }
    var skills = window.EgoSkillSystem.getSkills();
    if (!skills.length) { catalog.textContent = window.egoT('skillLoading'); return; }
    catalog.innerHTML = '';
    skills.forEach(function (skill) {
      var manifest = skill.manifest; var state = skill.state;
      var card = skillElement('article', 'skill-card');
      card.id = 'skill-card-' + manifest.id.replace(/[^a-z0-9_-]/gi, '-');
      card.dataset.skillId = manifest.id;
      var header = skillElement('div', 'skill-card-header');
      var heading = skillElement('div');
      heading.appendChild(skillElement('h3', '', translatedManifestText(manifest.displayNameKey, manifest.name)));
      heading.appendChild(skillElement('p', 'settings-hint', translatedManifestText(manifest.descriptionKey, manifest.name)));
      header.appendChild(heading);
      var install = skillElement('button', 'skill-install-button', state.installed ? window.egoT('skillUninstall') : window.egoT('skillInstall'));
      install.type = 'button';
      install.addEventListener('click', function () {
        window.EgoSkillSystem.setInstalled(manifest.id, !state.installed);
        if (!state.installed) window.EgoSkillSystem.setEnabled(manifest.id, true);
      });
      header.appendChild(install); card.appendChild(header);
      var lastRun = state.lastRunAt ? new Date(state.lastRunAt).toLocaleString(language) : window.egoT('skillNeverRun');
      card.appendChild(skillElement('p', 'skill-meta', window.egoT('skillVersion') + ' ' + manifest.version + ' · ' + skillStatus(skill) + ' · ' + window.egoT('skillLastRun') + ': ' + lastRun));
      if (state.installed) {
        var enabledRow = skillElement('label', 'skill-toggle-row');
        var enabled = skillElement('input'); enabled.type = 'checkbox'; enabled.checked = state.enabled; enabled.dataset.skillEnabled = 'true';
        enabledRow.appendChild(enabled); enabledRow.appendChild(document.createTextNode(window.egoT('skillEnable'))); card.appendChild(enabledRow);

        card.appendChild(skillElement('h4', 'skill-subheading', window.egoT('skillPermissions')));
        manifest.permissions.forEach(function (permission) {
          var row = skillElement('label', 'skill-choice-row');
          var input = skillElement('input'); input.type = 'checkbox'; input.value = permission.id; input.checked = state.permissions[permission.id] === true; input.dataset.skillPermission = permission.id;
          var copy = skillElement('span'); copy.appendChild(skillElement('strong', '', translatedManifestText(permission.labelKey, permission.id)));
          copy.appendChild(skillElement('small', '', translatedManifestText(permission.descriptionKey, '')));
          row.appendChild(input); row.appendChild(copy); card.appendChild(row);
        });

        card.appendChild(skillElement('h4', 'skill-subheading', window.egoT('skillProfiles')));
        var profileRow = skillElement('div', 'skill-profile-list');
        manifest.profiles.forEach(function (profile) {
          var label = skillElement('label', 'skill-profile-choice'); var input = skillElement('input');
          input.type = 'checkbox'; input.value = profile; input.checked = state.profiles.indexOf(profile) !== -1; input.dataset.skillProfile = profile;
          label.appendChild(input); label.appendChild(document.createTextNode(window.egoT('skillProfile' + profile.charAt(0).toUpperCase() + profile.slice(1)))); profileRow.appendChild(label);
        });
        card.appendChild(profileRow);

        if ((manifest.setup || []).length) card.appendChild(skillElement('h4', 'skill-subheading', window.egoT('skillSetup')));
        (manifest.setup || []).forEach(function (field) {
          var row = skillElement('div', 'settings-field skill-config-field');
          var id = card.id + '-' + field.id; var label = skillElement('label', '', translatedManifestText(field.labelKey, field.id)); label.htmlFor = id;
          var input = field.type === 'select' ? skillElement('select') : skillElement('input'); input.id = id; input.dataset.skillConfig = field.id;
          if (field.type !== 'select') input.type = field.type || 'text';
          if (field.autocomplete) input.autocomplete = field.autocomplete;
          (field.options || []).forEach(function (option) { var node = skillElement('option', '', translatedManifestText(option.labelKey, option.value)); node.value = option.value; input.appendChild(node); });
          input.value = state.config[field.id] == null ? (field.default || '') : state.config[field.id];
          if (field.permission && state.permissions[field.permission] !== true) input.disabled = true;
          row.appendChild(label); row.appendChild(input); card.appendChild(row);
        });
        var actions = skillElement('div', 'settings-inline-actions skill-actions');
        var save = skillElement('button', '', window.egoT('skillSave')); save.type = 'button'; save.addEventListener('click', function () { saveSkillCard(skill, card); }); actions.appendChild(save);
        if (manifest.testAction === 'internet-search') { var test = skillElement('button', '', window.egoT('internetSkillTestBtn')); test.type = 'button'; test.addEventListener('click', function () { testSkill(skill, card); }); actions.appendChild(test); }
        actions.appendChild(skillElement('span', 'settings-note skill-action-status', skillStatusMessages[manifest.id] || '')); card.appendChild(actions);
      }
      catalog.appendChild(card);
    });
  }

  if (window.EgoSkillSystem) window.EgoSkillSystem.ready.then(renderSkillCatalog);
  document.addEventListener('ego-skills-change', function () { Promise.resolve().then(renderSkillCatalog); });

  async function loadCodexModels() {
    var controls = byId('codexComposerControls'); if (!controls || !window.egoProfile) return;
    var codex = window.egoProfile.usesCodex(); controls.hidden = !codex; if (!codex) return;
    var select = byId('codexModelSelect'); var status = byId('codexModelSelectStatus'); status.textContent = window.egoT('codexModelsLoading');
    try { var models = await window.egoProfile.listCodexModels(); models.forEach(function (model) { var option = document.createElement('option'); option.value = model.id; option.textContent = model.display_name || model.id; select.appendChild(option); }); select.value = window.egoProfile.getCodexConfig().model || ''; status.textContent = window.egoT('codexModelsLoaded'); }
    catch (_) { status.textContent = window.egoT('codexModelsUnavailable'); }
  }
  if (byId('codexModelSelect')) byId('codexModelSelect').addEventListener('change', function () { var cfg = window.egoProfile.getCodexConfig(); window.egoProfile.setCodexConfig(cfg.url, this.value); });
  if (byId('codexReasoningSelect')) byId('codexReasoningSelect').addEventListener('change', function () { window.egoProfile.setCodexReasoningEffort(this.value); });
  document.addEventListener('ego-profile-change', loadCodexModels);

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').then(function (registration) {
      function offerUpdate() { if (window.confirm('Neues Update verfügbar, wollen sie es runterladen?')) registration.waiting.postMessage({ type: 'DOWNLOAD_UPDATE' }); }
      if (registration.waiting && navigator.serviceWorker.controller) offerUpdate();
      registration.addEventListener('updatefound', function () { var newWorker = registration.installing; if (newWorker) newWorker.addEventListener('statechange', function () { if (newWorker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(); }); });
    }).catch(function () {});
  }

  bindPanels(); bindSpeechInput(); renderSavedName(); renderConversation(); renderThreads(); updateTranslations(); loadCodexModels(); registerServiceWorker();
})();
