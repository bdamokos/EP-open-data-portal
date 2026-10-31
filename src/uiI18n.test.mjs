import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {createUiI18n, normalizeUiLocale, UI_LANGUAGES} from './uiI18n.mjs';

test('normalizes EU locale tags without discarding region or number preferences', () => {
  assert.equal(UI_LANGUAGES.length, 24);
  assert.equal(normalizeUiLocale(' PT_pt '), 'pt-PT');
  assert.equal(normalizeUiLocale('FR-ca-u-nu-latn'), 'fr-CA-u-nu-latn');
  assert.equal(normalizeUiLocale('EL'), 'el');
  for (const value of ['zh-CN', 'xx', 'en--GB', '', null, undefined, {}, ['fr']]) {
    assert.equal(normalizeUiLocale(value), 'en');
    assert.equal(normalizeUiLocale(value, 'hu-HU'), 'hu-HU');
  }
  assert.equal(normalizeUiLocale('xx', 'invalid'), 'en');
});

test('whole messages reorder named slots, preserve source bytes and never reparse values', () => {
  const original = 'A-10-2026-0175 · Ελληνικά\n{literal} <b>public text</b>';
  const i18n = createUiI18n({source: {
    result: '{person}: {content}', braces: '{{name}}: {name}', blank: '',
  }, translations: {hu: {result: '{content} — {person}'}}});
  assert.equal(i18n.forLocale('en').t('result', {person: 'Ágnes', content: original}), `Ágnes: ${original}`);
  assert.equal(i18n.forLocale('hu').t('result', {person: 'Ágnes', content: original}), `${original} — Ágnes`);
  assert.equal(i18n.forLocale('hu').t('braces', {name: '{untouched}'}), '{name}: {untouched}');
  assert.equal(i18n.forLocale('hu').t('blank'), '');
  assert.equal(i18n.forLocale('hu').t('unknown.{exact-id}'), 'unknown.{exact-id}');
});

test('rich interpolation moves and repeats caller-owned nodes without serializing them', () => {
  const i18n = createUiI18n({source: {sentence: 'Read {link} for {name}.'},
    translations: {fr: {sentence: '{name} : {link}, puis {link}.'}}});
  const link = createElement('a', {href: '/public/document'}, 'A-10-2026-0175');
  const name = createElement('strong', null, 'Ágnes');
  assert.deepEqual(i18n.forLocale('fr').rich('sentence', {link, name}), [name, ' : ', link, ', puis ', link, '.']);
  assert.throws(() => i18n.forLocale('fr').t('sentence', {link, name}), /must be a string or number/);
});

test('selects actual CLDR categories for all 24 EU languages', () => {
  const cases = {
    bg: [[1,'one'],[2,'other']], cs: [[2,'few'],[1.5,'many']], da: [[1,'one'],[2,'other']],
    de: [[1,'one'],[0,'other']], el: [[1,'one'],[2,'other']], en: [[1,'one'],[0,'other']],
    es: [[1,'one'],[2,'other']], et: [[1,'one'],[2,'other']], fi: [[1,'one'],[2,'other']],
    fr: [[0,'one'],[2,'other']], ga: [[2,'two'],[3,'few'],[7,'many'],[11,'other']],
    hr: [[2,'few'],[21,'one']], hu: [[1,'one'],[2,'other']], it: [[1,'one'],[2,'other']],
    lt: [[2,'few'],[1.5,'many']], lv: [[0,'zero'],[21,'one']], mt: [[2,'two'],[3,'few'],[11,'many']],
    nl: [[1,'one'],[2,'other']], pl: [[2,'few'],[5,'many'],[1.5,'other']],
    pt: [[0,'other'],[2,'other']], ro: [[0,'few'],[1,'one']], sk: [[2,'few'],[1.5,'many']],
    sl: [[1,'one'],[2,'two'],[3,'few'],[1.5,'few']], sv: [[1,'one'],[2,'other']],
  };
  const forms = {plural: 'count', zero: 'zero {count}', one: 'one {count}', two: 'two {count}',
    few: 'few {count}', many: 'many {count}', other: 'other {count}'};
  // Synthetic category labels are test fixtures, never production translations.
  const translations = Object.fromEntries(UI_LANGUAGES.filter(code => code !== 'en').map(code => [code, {count: forms}]));
  const i18n = createUiI18n({source: {count: forms}, translations});
  assert.deepEqual(Object.keys(cases).sort(), [...UI_LANGUAGES].sort());
  for (const [language, examples] of Object.entries(cases)) {
    const formatter = i18n.forLocale(language);
    for (const [count, category] of examples) {
      assert.equal(formatter.pluralCategory(count), category, `${language}/${count}`);
      assert.equal(formatter.t('count', {count}), `${category} ${new Intl.NumberFormat(language).format(count)}`);
    }
  }
  assert.equal(i18n.forLocale('pt-PT').pluralCategory(0), 'other');
  assert.equal(i18n.forLocale('pt-BR').pluralCategory(0), 'one');
});

test('whole-message fallback uses source plural rules, including non-English sources', () => {
  const i18n = createUiI18n({source: {count: {plural: 'n', one: '{n} item', other: '{n} items'}}, translations: {fr: {}}});
  assert.equal(i18n.forLocale('fr').t('count', {n: 0}), '0 items');
  assert.equal(i18n.forLocale('sl').t('count', {n: 2}), '2 items');
  const polish = createUiI18n({sourceLocale: 'pl', source: {count: {plural: 'n', few: '{n} rekordy', other: '{n} rekordów'}}});
  assert.equal(polish.forLocale('en').t('count', {n: 2}), '2 rekordy');
  assert.equal(polish.forLocale('xx').locale, 'pl');
});

test('supports ordinal selection, other-form fallback and rich plural messages', () => {
  const i18n = createUiI18n({source: {
    rank: {plural: 'n', type: 'ordinal', one: '{n}st', two: '{n}nd', few: '{n}rd', other: '{n}th'},
    count: {plural: 'n', other: '{link}: {n}'},
  }, translations: {ga: {count: {plural: 'n', other: '{n}: {link}'}}}});
  const en = i18n.forLocale('en');
  assert.deepEqual([1,2,3,4,11,21].map(n => en.t('rank', {n})), ['1st','2nd','3rd','4th','11th','21st']);
  const link = createElement('a', null, 'Public document');
  assert.deepEqual(i18n.forLocale('ga').rich('count', {n: 2, link}), ['2', ': ', link]);
});

test('snapshots catalogues and isolates concurrent locale formatters', async () => {
  const source = {message: '{name}', count: {plural: 'n', other: '{n}'}};
  const translations = {hu: {message: 'HU {name}'}};
  const i18n = createUiI18n({source, translations});
  source.message = 'changed'; source.count.other = 'changed'; translations.hu.message = 'changed';
  const results = await Promise.all(['en','hu','en','hu'].map(async language => {
    await Promise.resolve(); return i18n.forLocale(language).t('message', {name: 'Ágnes'});
  }));
  assert.deepEqual(results, ['Ágnes','HU Ágnes','Ágnes','HU Ágnes']);
  assert.equal(i18n.forLocale('en').t('count', {n: 0}), '0');
  assert.equal(i18n.forLocale('hu').number(12345.6), new Intl.NumberFormat('hu').format(12345.6));
  assert.equal(i18n.forLocale('en').t('count', {n: -1}), '-1');
});

test('rejects invalid catalogues and missing or invalid runtime values explicitly', () => {
  const source = {message: '{name}', count: {plural: 'n', one: 'One', other: '{n} items'}};
  for (const translation of ['{wrong}', {plural: 'name', other: '{name}'}, '{name} {extra}']) {
    assert.throws(() => createUiI18n({source, translations: {fr: {message: translation}}}), /contract differ/);
  }
  assert.throws(() => createUiI18n({source, translations: {fr: {unknown: 'Value'}}}), /Unknown UI translation ID/);
  assert.throws(() => createUiI18n({source, translations: {xx: {}}}), /language/);
  for (const message of ['{unfinished', 'unescaped }', {plural: 'n', one: 'One'}, {plural: 'n', other: 'All', few: 2}]) {
    assert.throws(() => createUiI18n({source: {message}}), TypeError);
  }
  const en = createUiI18n({source}).forLocale('en');
  assert.throws(() => en.t('message'), /Missing UI placeholder/);
  assert.throws(() => en.t('message', Object.create({name: 'inherited'})), /Missing UI placeholder/);
  assert.throws(() => en.t('count'), /Missing UI plural count/);
  for (const n of [undefined,null,'2',NaN,Infinity]) assert.throws(() => en.t('count', {n}), /finite number/);
  assert.equal(en.t('message', {name: ''}), '');
});

test('rich plural selection keeps the caller node separate from its numeric count',()=>{
  const node=Object.freeze({source:'A-10-2026-001234'});
  const i18n=createUiI18n({source:{items:{plural:'count',one:'{count} item',other:'{count} items'}},translations:{pl:{items:{plural:'count',one:'{count} rzecz',few:'{count} rzeczy',many:'{count} rzeczy',other:'{count} rzeczy'}}}});
  assert.deepEqual(i18n.forLocale('pl').rich('items',{count:node},{count:22}),[node,' rzeczy']);
  assert.deepEqual(i18n.forLocale('en').rich('items',{count:node},{count:1}),[node,' item']);
});
