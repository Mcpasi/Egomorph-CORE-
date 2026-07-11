const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'skills', 'internetSkill.js'), 'utf8');

function createHarness(fetchImpl) {
  const context = {
    window: {},
    fetch: fetchImpl || jest.fn(),
    module: { exports: {} },
    encodeURIComponent,
    parseInt,
    RegExp,
    String,
    Math,
    Array,
    Error
  };

  vm.runInNewContext(source, context);
  return { context, skill: context.window.EgoInternetSkill };
}

describe('internetSkill', () => {
  test('does not decide research intent with keywords and only normalizes queries', () => {
    const { skill } = createHarness();

    expect(source).not.toMatch(/TRIGGERS|isLikelyResearchRequest/);
    expect(skill.isResearchRequest).toBeUndefined();
    expect(skill.extractQuery('Suche fuer mich "Quantencomputer 2026" aus dem Netz und fasse zusammen')).toBe('Quantencomputer 2026');
  });

  test('parses DuckDuckGo instant-answer results into prompt context', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        Heading: 'EgoMorph',
        AbstractText: 'EgoMorph ist ein Browser-Assistent.',
        AbstractURL: 'https://example.test/egomorph',
        AbstractSource: 'Example',
        RelatedTopics: [
          { Text: 'EgoMorph PWA - weitere Infos', FirstURL: 'https://example.test/pwa' }
        ]
      })
    }));
    const { skill } = createHarness(fetchMock);

    const result = await skill.search('Suche EgoMorph im Internet', { limit: 2 });
    const prompt = skill.formatForPrompt(result);

    expect(fetchMock.mock.calls[0][0]).toContain('api.duckduckgo.com');
    expect(result.results).toHaveLength(2);
    expect(prompt).toContain('Internet-Recherche zu: EgoMorph');
    expect(prompt).toContain('https://example.test/egomorph');
  });

  test('queries Google Programmable Search when configured', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          {
            title: 'Google Treffer 1',
            snippet: 'Ein echter Web-Snippet.',
            link: 'https://example.test/one',
            displayLink: 'example.test'
          },
          {
            title: 'Google Treffer 2',
            snippet: 'Noch ein Web-Snippet.',
            link: 'https://example.test/two',
            displayLink: 'example.test'
          }
        ]
      })
    }));
    const { skill } = createHarness(fetchMock);

    const result = await skill.search('Suche aktuelle Webdaten', {
      limit: 2,
      language: 'de',
      config: {
        enabled: true,
        provider: 'google',
        googleApiKey: 'google-key',
        googleCx: 'search-engine-id'
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('www.googleapis.com/customsearch/v1');
    expect(fetchMock.mock.calls[0][0]).toContain('key=google-key');
    expect(fetchMock.mock.calls[0][0]).toContain('cx=search-engine-id');
    expect(fetchMock.mock.calls[0][0]).toContain('lr=lang_de');
    expect(result.results).toEqual([
      expect.objectContaining({ title: 'Google Treffer 1', url: 'https://example.test/one' }),
      expect.objectContaining({ title: 'Google Treffer 2', url: 'https://example.test/two' })
    ]);
  });

  test('does not call network search when disabled by configuration', async () => {
    const fetchMock = jest.fn();
    const { skill } = createHarness(fetchMock);

    const result = await skill.search('Suche Thema aus dem Netz', {
      config: { enabled: false }
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.results).toEqual([]);
  });

  test('falls back to Wikipedia when DuckDuckGo has no usable snippets', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ RelatedTopics: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            search: [
              { title: 'Test Thema', snippet: 'Ein <b>kurzer</b> Treffer.', pageid: 123 }
            ]
          }
        })
      });
    const { skill } = createHarness(fetchMock);

    const result = await skill.search('Recherchiere Test Thema', { limit: 3, language: 'de' });

    expect(fetchMock.mock.calls[1][0]).toContain('wikipedia.org');
    expect(result.results[0]).toEqual(expect.objectContaining({
      title: 'Test Thema',
      snippet: 'Ein kurzer Treffer.',
      source: 'Wikipedia'
    }));
  });
});
