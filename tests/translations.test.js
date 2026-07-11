const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const localeFiles = ['de', 'en', 'fr'];
const chatStatusKeys = [
  'chatModelStatusIdle',
  'chatModelLoading',
  'chatModelNoTransformers',
  'chatModelErrorPrefix',
  'chatModelWaitingTransformers',
  'chatModelLoadingPct',
  'chatModelInitializing',
  'chatModelReady',
  'chatModelNeedsLoad',
  'chatModelApiActive',
  'chatModelCodexActive',
  'chatModelProfilePrefix',
  'chatModelNoLocalLLM'
];

function loadLocales() {
  const context = { window: {} };
  for (const lang of localeFiles) {
    const source = fs.readFileSync(path.join(root, 'translations', `${lang}.js`), 'utf8');
    vm.runInNewContext(source, context, { filename: `${lang}.js` });
  }
  return context.window.EgoMorphLocales;
}

describe('translation files', () => {
  test('de, en, and fr expose the same UI translation keys', () => {
    const locales = loadLocales();
    const expected = Object.keys(locales.de.ui).sort();

    for (const lang of localeFiles) {
      expect(Object.keys(locales[lang].ui).sort()).toEqual(expected);
    }
  });

  test('chat model status strings are translated in every locale', () => {
    const locales = loadLocales();

    for (const lang of localeFiles) {
      for (const key of chatStatusKeys) {
        expect(locales[lang].ui[key]).toEqual(expect.any(String));
        expect(locales[lang].ui[key].length).toBeGreaterThan(0);
      }
    }
  });

  test('removed classification translations do not return', () => {
    const locales = loadLocales();
    for (const lang of localeFiles) {
      expect(locales[lang].categoryDisplayNames).toBeUndefined();
      expect(locales[lang].categoryResponses).toBeUndefined();
      expect(Object.keys(locales[lang].ui).some(key => /emotion|category/i.test(key))).toBe(false);
    }
  });
});
