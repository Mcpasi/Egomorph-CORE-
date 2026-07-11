const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Writer.js'), 'utf8');

describe('Writer.js', () => {
  test('fallback lock copy mentions every profile that can run the writer agent', () => {
    expect(source).toContain('Full-, API- oder Codex-Modus');
    expect(source).toContain('Nur im Full-, API- oder Codex-Modus verfuegbar');
  });
});
