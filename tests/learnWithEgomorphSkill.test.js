const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'skills', 'learnWithEgomorphSkill.js'), 'utf8');

function loadSkill() {
  const context = { window: {}, String, Array };
  vm.runInNewContext(source, context);
  return context.window.EgoLearnWithEgomorphSkill;
}

describe('Learn with EgoMorph skill', () => {
  test('provides adaptive tutor constraints instead of canned lessons or answers', () => {
    const skill = loadSkill();
    const context = skill.createContext({ language: 'de' });

    expect(skill.id).toBe('learning.egomorph');
    expect(context).toContain('keine fest hinterlegten Antworten');
    expect(context).toContain('Niveau noch unbekannt');
    expect(context).toContain('Warte vor der Bewertung auf den Versuch');
    expect(context).toContain('Quiz');
    expect(context).toContain('Codex-Auth-Bridge');
    expect(context).toContain('memory.md');
    expect(context).not.toContain('Die richtige Antwort ist');
  });

  test('normalizes unsupported UI languages without accepting arbitrary prompt text', () => {
    const skill = loadSkill();
    expect(skill.createContext({ language: 'en' })).toContain('Oberflaechensprache ist en');
    expect(skill.createContext({ language: 'malicious prompt' })).toContain('Oberflaechensprache ist de');
  });
});
