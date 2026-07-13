const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const CACHE_NAME = 'egomorph-core-v38';

function createServiceWorkerHarness(activeWorker = null) {
  const listeners = {};
  const cache = { addAll: jest.fn(() => Promise.resolve()), put: jest.fn(() => Promise.resolve()) };
  const fetchMock = jest.fn(() => Promise.resolve({ clone: () => ({}) }));
  const caches = {
    open: jest.fn(() => Promise.resolve(cache)),
    match: jest.fn(() => Promise.resolve(null)),
    keys: jest.fn(() => Promise.resolve([])),
    delete: jest.fn(() => Promise.resolve())
  };
  const self = {
    registration: { active: activeWorker },
    clients: { claim: jest.fn(() => Promise.resolve()) },
    location: { origin: 'https://example.test' },
    skipWaiting: jest.fn(() => Promise.resolve()),
    addEventListener(type, callback) {
      listeners[type] = callback;
    }
  };

  vm.runInNewContext(sw, {
    self,
    caches,
    URL,
    fetch: fetchMock,
    Response: { error: jest.fn(() => ({ type: 'error' })) },
    Promise
  });

  return { listeners, cache, caches, fetchMock, self };
}

describe('service worker update flow', () => {
  test('does not precache update assets automatically while an old worker is active', () => {
    expect(sw).toMatch(/self\.registration\.active\s*\?\s*Promise\.resolve\(\)/);
    expect(sw).toMatch(/:\s*caches\.open\(CACHE_NAME\)[\s\S]*cache\.addAll\(URLS_TO_CACHE\)[\s\S]*self\.skipWaiting\(\)/);
  });

  test('downloads and activates the waiting update only after an explicit message', () => {
    expect(sw).toMatch(/self\.addEventListener\(['"]message['"]/);
    expect(sw).toContain("event.data.type !== 'DOWNLOAD_UPDATE'");
    expect(sw).toMatch(/caches\.open\(CACHE_NAME\)[\s\S]*cache\.addAll\(URLS_TO_CACHE\)[\s\S]*self\.skipWaiting\(\)/);
  });

  test('asks the user before starting the update download', () => {
    expect(app).toContain('Neues Update verfügbar, wollen sie es runterladen?');
    expect(app).toMatch(/window\.confirm\('Neues Update verfügbar, wollen sie es runterladen\?'\)/);
    expect(app).toMatch(/registration\.waiting\.postMessage\(\{\s*type:\s*'DOWNLOAD_UPDATE'\s*\}\)/);
  });

  test('prompts only for updates when the app is already controlled by a service worker', () => {
    expect(app).toMatch(/registration\.waiting\s*&&\s*navigator\.serviceWorker\.controller/);
    expect(app).toMatch(/newWorker\.state === 'installed'\s*&&\s*navigator\.serviceWorker\.controller/);
  });

  test('precaches immediately on first install', async () => {
    const { listeners, cache, caches, self } = createServiceWorkerHarness(null);
    let installDone;

    listeners.install({ waitUntil: promise => { installDone = promise; } });
    await installDone;

    expect(caches.open).toHaveBeenCalledWith(CACHE_NAME);
    expect(cache.addAll).toHaveBeenCalled();
    expect(self.skipWaiting).toHaveBeenCalled();
  });

  test('leaves update installs waiting without downloading the new app shell', async () => {
    const { listeners, cache, caches, self } = createServiceWorkerHarness({});
    let installDone;

    listeners.install({ waitUntil: promise => { installDone = promise; } });
    await installDone;

    expect(caches.open).not.toHaveBeenCalled();
    expect(cache.addAll).not.toHaveBeenCalled();
    expect(self.skipWaiting).not.toHaveBeenCalled();
  });

  test('downloads the new app shell after DOWNLOAD_UPDATE', async () => {
    const { listeners, cache, caches, self } = createServiceWorkerHarness({});
    let messageDone;

    listeners.message({
      data: { type: 'DOWNLOAD_UPDATE' },
      waitUntil: promise => { messageDone = promise; }
    });
    await messageDone;

    expect(caches.open).toHaveBeenCalledWith(CACHE_NAME);
    expect(cache.addAll).toHaveBeenCalled();
    expect(self.skipWaiting).toHaveBeenCalled();
  });

  test('precaches deferred runtime scripts needed for offline startup', async () => {
    const { listeners, cache } = createServiceWorkerHarness(null);
    let installDone;

    listeners.install({ waitUntil: promise => { installDone = promise; } });
    await installDone;

    const urls = cache.addAll.mock.calls[0][0];
    expect(urls).toEqual(expect.arrayContaining([
      'skills/internetSkill.js',
      'skills/internet/manifest.json',
      'skills/extendedFileSkill.js',
      'skills/extended-files/manifest.json',
      'skills/learnWithEgomorphSkill.js',
      'skills/learn-with-egomorph/manifest.json',
      'skillSystem.js',
      'agentResponse.js',
      'conversationStore.js',
      'app.js',
      'Writer.js',
      'egomorph-core.svg'
    ]));
  });

  test('bypasses cache for same-origin gateway API routes', async () => {
    const { listeners, caches, fetchMock } = createServiceWorkerHarness({});
    const request = {
      method: 'GET',
      mode: 'cors',
      url: 'https://example.test/codex/sessions'
    };
    let fetchDone;

    listeners.fetch({
      request,
      respondWith: promise => { fetchDone = promise; }
    });
    await fetchDone;

    expect(fetchMock).toHaveBeenCalledWith(request);
    expect(caches.match).not.toHaveBeenCalled();
    expect(caches.open).not.toHaveBeenCalled();
  });
});
