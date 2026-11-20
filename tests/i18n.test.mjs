import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const i18n = require('../src/shared/i18n.js');

test('ja and en translation dictionaries contain identical non-empty keys', () => {
  const jaKeys = Object.keys(i18n.MESSAGES.ja).sort();
  const enKeys = Object.keys(i18n.MESSAGES.en).sort();

  assert.deepEqual(enKeys, jaKeys);

  for (const key of jaKeys) {
    assert.ok(i18n.MESSAGES.ja[key].trim().length > 0, `Empty ja message for ${key}`);
    assert.ok(i18n.MESSAGES.en[key].trim().length > 0, `Empty en message for ${key}`);
  }
});

test('resolveLanguage handles explicit ja/en and browser auto detection', () => {
  assert.equal(i18n.resolveLanguage('en', 'ja-JP'), 'en');
  assert.equal(i18n.resolveLanguage('ja', 'en-US'), 'ja');
  assert.equal(i18n.resolveLanguage('auto', 'ja-JP'), 'ja');
  assert.equal(i18n.resolveLanguage('auto', 'ja'), 'ja');
  assert.equal(i18n.resolveLanguage('auto', 'en-US'), 'en');
  assert.equal(i18n.resolveLanguage('auto', 'fr-FR'), 'en');
});

test('t interpolates placeholders accurately in both Japanese and English', () => {
  assert.equal(
    i18n.t('ja', 'savedImageWithSvg', { ext: 'PNG', width: 1600, height: 1200 }),
    'PNG + SVG (1600×1200) を保存しました'
  );
  assert.equal(
    i18n.t('en', 'savedImageWithSvg', { ext: 'PNG', width: 1600, height: 1200 }),
    'Saved PNG + SVG (1600×1200)'
  );
});
