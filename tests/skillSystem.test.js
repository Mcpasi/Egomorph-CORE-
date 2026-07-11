const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'skillSystem.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'skills', 'internet', 'manifest.json'), 'utf8'));

function createHarness(initialStore = {}) {
  const store = Object.assign({}, initialStore);
  const events = [];
  const context = {
    window: {},
    document: { dispatchEvent: event => events.push(event) },
    localStorage: {
      getItem: key => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
      setItem: (key, value) => { store[key] = String(value); }
    },
    fetch: jest.fn(async url => ({ ok: true, json: async () => manifest })),
    CustomEvent: function CustomEvent(type) { this.type = type; },
    console: { error: jest.fn() },
    Promise,
    JSON,
    Date,
    Object,
    Array,
    String,
    Error
  };
  vm.runInNewContext(source, context);
  return { system: context.window.EgoSkillSystem, store, events, fetchMock: context.fetch };
}

describe('manifest-driven skill system', () => {
  test('loads and validates the internet skill manifest', async () => {
    const { system, fetchMock } = createHarness();
    await system.ready;

    expect(fetchMock).toHaveBeenCalledWith('skills/internet/manifest.json', { cache: 'no-cache' });
    const skill = system.getSkill('internet.research');
    expect(skill.manifest).toEqual(expect.objectContaining({ id: 'internet.research', name: 'Internet Research', version: '1.0.0' }));
    expect(skill.manifest.profiles).toEqual(['api', 'codex']);
    expect(skill.state).toEqual(expect.objectContaining({ installed: true, enabled: true, lastRunAt: null }));
  });

  test('grants and revokes permissions and profiles before a skill can run', async () => {
    const { system } = createHarness();
    await system.ready;

    expect(system.canRun('internet.research', 'api')).toBe(true);
    system.setPermission('internet.research', 'network', false);
    expect(system.canRun('internet.research', 'api')).toBe(false);
    system.setPermission('internet.research', 'network', true);
    system.setProfiles('internet.research', ['codex']);
    expect(system.canRun('internet.research', 'api')).toBe(false);
    expect(system.canRun('internet.research', 'codex')).toBe(true);
  });

  test('protects credential-bound setup values when credential permission is revoked', async () => {
    const { system } = createHarness();
    await system.ready;
    system.setConfig('internet.research', { provider: 'google', googleApiKey: 'secret', googleCx: 'cx' });

    expect(system.getConfigForRun('internet.research')).toEqual({ provider: 'google' });
    system.setPermission('internet.research', 'credentials', true);
    expect(system.getConfigForRun('internet.research')).toEqual({ provider: 'google', googleApiKey: 'secret', googleCx: 'cx' });
  });

  test('persists install state and last-run timestamp', async () => {
    const { system, store } = createHarness();
    await system.ready;
    system.setInstalled('internet.research', false);
    system.recordRun('internet.research', new Date('2026-07-11T12:00:00.000Z'));

    const saved = JSON.parse(store.egoSkillStatesV1);
    expect(saved['internet.research'].installed).toBe(false);
    expect(saved['internet.research'].enabled).toBe(false);
    expect(saved['internet.research'].lastRunAt).toBe('2026-07-11T12:00:00.000Z');
  });

  test('migrates existing internet skill settings into manifest state', async () => {
    const { system } = createHarness({
      egoSkillInternetEnabled: 'false',
      egoInternetSearchProvider: 'google',
      egoInternetGoogleApiKey: 'legacy-key',
      egoInternetGoogleCx: 'legacy-cx'
    });
    await system.ready;

    const skill = system.getSkill('internet.research');
    expect(skill.state.enabled).toBe(false);
    expect(skill.state.permissions.credentials).toBe(true);
    expect(skill.state.config).toEqual(expect.objectContaining({ provider: 'google', googleApiKey: 'legacy-key', googleCx: 'legacy-cx' }));
  });
});
