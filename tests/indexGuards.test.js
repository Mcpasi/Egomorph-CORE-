const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

describe('index.html runtime guards', () => {
  test('long-term memory buttons only bind handlers when exported functions exist', () => {
    expect(app).toMatch(/byId\('ltmExportBtn'\)\s*&&\s*typeof window\.exportLongTermMemory === 'function'/);
    expect(app).toMatch(/byId\('ltmClearBtn'\)\s*&&\s*typeof window\.clearLongTermMemory === 'function'/);
  });

  test('classification and avatar modules are absent from startup', () => {
    expect(index).not.toMatch(/emotionModel|vectorizeEmotion|thinkingMode|morphyAgent|spriteController/);
    expect(index).not.toContain('id="entity"');
    expect(index).toContain('id="egoCoreLogoMotion"');
  });

  test('API/Codex reply wrapper checks mode helpers before invoking them', () => {
    expect(app).toContain("profile === 'api' || profile === 'codex'");
    expect(app).toContain("profile === 'full'");
  });

  test('main prompt input is a multiline textarea with Enter submit guard', () => {
    expect(index).toMatch(/<textarea\s+id="inputText"[\s\S]*<\/textarea>/);
    expect(app).toContain("event.key !== 'Enter' || event.shiftKey || event.isComposing");
    expect(app).toContain('inputForm.requestSubmit');
  });

  test('composer exposes stop, live Codex models and reasoning controls', () => {
    expect(index).toContain('id="stopBtn" type="button" hidden');
    expect(index).toContain('id="codexModelSelect"');
    expect(index).toContain('id="codexReasoningSelect"');
    expect(app).toContain('window.egoProfile.listCodexModels()');
    expect(app).toContain('activeController.abort()');
    expect(app).toContain("if (input && !input.value.trim()) input.value = text");
    expect(style).toContain('.codex-composer-controls');
    expect(style).toContain('#stopBtn[hidden]');
  });

  test('markdown upload is wired to the model-home gateway helper', () => {
    expect(index).toContain('id="markdownUploadInput" type="file" accept=".md,text/markdown"');
    expect(app).toContain('window.egoProfile.uploadMarkdownFileToModelHome');
    expect(app).toContain('uploadMarkdownFiles(uploadInput.files)');
    expect(app).toContain('window.getPendingMarkdownUploadPaths');
    expect(app).toContain('modelHomeFiles: pendingMarkdownPaths.slice()');
  });

  test('conversation history renders grouped user and EgoMorph reply turns', () => {
    expect(app).toContain('conversation-turn');
    expect(app).toContain('conversation-user');
    expect(app).toContain('conversation-bot');
    expect(index).toContain('<script src="agentResponse.js"></script>');
    expect(app).toContain('agentThoughtLabel');
    expect(app).toContain('agentSkillLabel');
    expect(app).toContain('agentFinalLabel');
    expect(app).toContain("onSkillStart: function (skillId)");
    expect(app).toContain("onSkillBlocked: function (skillId)");
    expect(app).toContain('window.EgoAgentResponse.parseLive');
    expect(app).toContain("updateSkill(skillId, 'running')");
    expect(style).toContain('.agent-final-separator');
    expect(style).toContain('.agent-skill-run[data-status="running"]');
  });

  test('multiple conversations use a desktop sidebar and mobile drawer', () => {
    expect(index).toContain('id="conversationSidebar"');
    expect(index).toContain('id="conversationDrawerToggle"');
    expect(index).toContain('id="newConversationBtn"');
    expect(app).toContain('window.EgoConversationStore.create(localStorage)');
    expect(app).toContain('sessionId: activeThreadId');
    expect(app).toContain('resetCodexConversationSession(id)');
    expect(style).toContain('@media (min-width: 1100px)');
    expect(style).toContain('body.conversation-drawer-open .conversation-sidebar');
    expect(style).toContain('.conversation-drawer-backdrop');
  });

  test('startup stays usable when the optional thread module fails', () => {
    expect(index.indexOf('<script src="loader.js"></script>')).toBeLessThan(index.indexOf('id="welcomeModal"'));
    expect(index).toContain('function bindWelcomeModal()');
    expect(app).toContain('createConversationThreadsStore()');
    expect(app).toContain('conversationStore.js fehlt; starte mit flüchtigem Notfall-Speicher');
    expect(index).toContain("params.get('egomorph-clean') !== '1'");
  });

  test('info panel contains the current project and license copy', () => {
    expect(index).toContain('Egomorph Core ist eine lokale, PWA-fähige und agentische Browser-App');
    expect(index).toContain('Copyright CreateWithCode 2025 - 2026');
    expect(index).toContain('Unter der MIT-Lizenz.');
  });

  test('skills are managed through manifests in settings', () => {
    expect(index).toContain('<script src="skillSystem.js"></script>');
    expect(index).not.toContain('<script src="skills/internetSkill.js"></script>');
    expect(index).toContain('id="skillCatalog"');
    expect(index).not.toContain('id="internetSkillEnabledToggle"');
    expect(app).toContain("window.EgoSkillSystem.getSkills()");
    expect(app).toContain("system.setPermission");
    expect(style).toContain('.skill-card');
  });
});
