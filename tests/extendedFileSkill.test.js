const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'skills', 'extendedFileSkill.js'), 'utf8');

function createHarness(fetchMock) {
  const window = {
    egoProfile: {
      getCodexConfig: () => ({ url: 'http://localhost:8787/v1/chat/completions' })
    }
  };
  const context = {
    window,
    fetch: fetchMock,
    encodeURIComponent,
    JSON,
    String,
    Error
  };
  vm.runInNewContext(source, context);
  return window.EgoExtendedFileSkill;
}

describe('extended file skill browser client', () => {
  test('reads and writes through the dedicated skill endpoint', async () => {
    const fetchMock = jest.fn(async (url, options) => ({
      ok: true,
      json: async () => ({ ok: true, file: { path: 'app.js' } })
    }));
    const skill = createHarness(fetchMock);

    await skill.read('app.js');
    await skill.write('styles/site.css', 'body {}', { overwrite: true });

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8787/egomorph/extended-files?path=app.js');
    expect(fetchMock.mock.calls[0][1].headers['X-Egomorph-Skill']).toBe('workspace.extended-files');
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:8787/egomorph/extended-files');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      path: 'styles/site.css',
      content: 'body {}',
      overwrite: true
    });
  });

  test('rejects unapproved extensions before contacting the gateway', async () => {
    const fetchMock = jest.fn();
    const skill = createHarness(fetchMock);

    await expect(skill.read('notes.md')).rejects.toThrow('nur .js, .css, .html und .py');
    await expect(skill.write('../secret.json', '{}')).rejects.toThrow('nur .js, .css, .html und .py');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
