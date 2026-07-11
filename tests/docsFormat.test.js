const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const markdownFiles = [
  'README.md',
  'README_EN.md',
  'DOKUMENTATION.md',
  'DOKUMENTATION_EN.md',
  'doku.md',
  'PWABUILDER.md',
  'agents.md',
  'AGENTS.md',
  'CHANGELOG.md'
];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

describe('documentation format', () => {
  test.each(markdownFiles)('%s has balanced fenced code blocks', file => {
    const source = read(file);
    const fences = source.match(/^```/gm) || [];
    expect(fences.length % 2).toBe(0);
  });

  test('referenced PWABuilder assetlinks template exists', () => {
    expect(fs.existsSync(path.join(root, '.well-known', 'assetlinks.json.template'))).toBe(true);
  });
});
