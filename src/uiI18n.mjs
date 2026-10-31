/** UI messages only. Never pass parliamentary wording or API strings through this catalogue. */
export const UI_LANGUAGES = Object.freeze('bg cs da de el en es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split(' '));
const languages = new Set(UI_LANGUAGES);
const categories = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const own = (object, key) => Object.hasOwn(object, key);
const namePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Keep regional/Unicode preferences for Intl; unsupported and malformed tags use the fallback. */
export function normalizeUiLocale(language, fallback = 'en') {
  function canonical(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const locale = Intl.getCanonicalLocales(value.trim().replaceAll('_', '-'))[0];
      return languages.has(new Intl.Locale(locale).language) ? (locale==='pt'?'pt-PT':locale) : null;
    } catch { return null; }
  }
  return canonical(language) ?? canonical(fallback) ?? 'en';
}

// Only named slots and escaped braces are syntax. Values are never parsed again.
function tokenize(template) {
  const tokens = [];
  let literal = '';
  const flush = () => { if (literal) tokens.push(literal); literal = ''; };
  for (let i = 0; i < template.length;) {
    const char = template[i];
    if ((char === '{' || char === '}') && template[i + 1] === char) {
      literal += char; i += 2;
    } else if (char === '{') {
      const end = template.indexOf('}', i + 1);
      const name = template.slice(i + 1, end);
      if (end < 0 || !namePattern.test(name)) throw new TypeError('Invalid UI message placeholder');
      flush(); tokens.push(Object.freeze({name})); i = end + 1;
    } else {
      if (char === '}') throw new TypeError('Escape literal UI message braces as {{ or }}');
      literal += char; i++;
    }
  }
  flush();
  return Object.freeze(tokens);
}

function compile(message) {
  if (typeof message === 'string') return Object.freeze({forms: Object.freeze({other: tokenize(message)})});
  if (!message || typeof message !== 'object' || Array.isArray(message)
      || !namePattern.test(message.plural ?? '') || typeof message.other !== 'string'
      || (message.type !== undefined && !['cardinal', 'ordinal'].includes(message.type))) {
    throw new TypeError('A plural UI message needs a named plural field and an other form');
  }
  const forms = Object.create(null);
  for (const [key, value] of Object.entries(message)) {
    if (key === 'plural' || key === 'type') continue;
    if (!categories.has(key) || typeof value !== 'string') throw new TypeError(`Invalid UI plural form: ${key}`);
    forms[key] = tokenize(value);
  }
  return Object.freeze({plural: message.plural, type: message.type ?? 'cardinal', forms: Object.freeze(forms)});
}

function signature(message) {
  return [...new Set(Object.values(message.forms).flatMap(tokens => tokens
    .filter(token => typeof token !== 'string').map(token => token.name)))].sort().join(',');
}

/**
 * Snapshot injected catalogues once. No bundled translations, mutable global locale,
 * HTML interpretation or implicit lookup of arbitrary source text.
 * Missing translations fall back as a whole message; unknown IDs return unchanged.
 */
export function createUiI18n({source, translations = {}, sourceLocale = 'en'}) {
  const baseLocale = normalizeUiLocale(sourceLocale);
  const baseLanguage = new Intl.Locale(baseLocale).language;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('UI source catalogue is required');
  const sources = new Map(Object.entries(source).map(([id, value]) => [id, compile(value)]));
  const catalogues = new Map();
  for (const [language, catalogue] of Object.entries(translations)) {
    if (!languages.has(language) || language === baseLanguage) throw new TypeError(`Invalid UI translation language: ${language}`);
    if (!catalogue || typeof catalogue !== 'object' || Array.isArray(catalogue)) throw new TypeError(`Invalid UI catalogue: ${language}`);
    const messages = new Map();
    for (const [id, value] of Object.entries(catalogue)) {
      const original = sources.get(id);
      if (!original) throw new TypeError(`Unknown UI translation ID: ${id}`);
      const message = compile(value);
      if (message.plural !== original.plural || message.type !== original.type || signature(message) !== signature(original)) {
        throw new TypeError(`UI translation placeholders or plural contract differ: ${language}/${id}`);
      }
      messages.set(id, message);
    }
    catalogues.set(language, messages);
  }

  function forLocale(language) {
    const locale = normalizeUiLocale(language, baseLocale);
    const languageCode = new Intl.Locale(locale).language;
    const numbers = new Map();
    const plurals = new Map();
    function number(value, messageLocale = locale) {
      if (!numbers.has(messageLocale)) numbers.set(messageLocale, new Intl.NumberFormat(messageLocale));
      return numbers.get(messageLocale).format(value);
    }
    function pluralCategory(value, type = 'cardinal', messageLocale = locale) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('UI plural count must be a finite number');
      const key = `${messageLocale}/${type}`;
      if (!plurals.has(key)) plurals.set(key, new Intl.PluralRules(messageLocale, {type}));
      return plurals.get(key).select(value);
    }
    function render(id, values, rich, counts = {}) {
      const translated = catalogues.get(languageCode)?.get(id);
      const message = translated ?? sources.get(id);
      if (!message) return rich ? [id] : id;
      const messageLocale = translated || languageCode === baseLanguage ? locale : baseLocale;
      let category = 'other';
      if (message.plural) {
        if (!own(counts, message.plural) && !own(values, message.plural)) throw new TypeError(`Missing UI plural count: ${id}/${message.plural}`);
        const count = own(counts, message.plural) ? counts[message.plural] : values[message.plural];
        if (typeof count !== 'number' || !Number.isFinite(count)) throw new TypeError(`UI plural count must be a finite number: ${id}/${message.plural}`);
        category = pluralCategory(count, message.type, messageLocale);
      }
      const tokens = message.forms[category] ?? message.forms.other;
      const parts = tokens.map(token => {
        if (typeof token === 'string') return token;
        if (!own(values, token.name) || values[token.name] === undefined) throw new TypeError(`Missing UI placeholder: ${id}/${token.name}`);
        const value = values[token.name];
        if (typeof value === 'number' || typeof value === 'bigint') return number(value, messageLocale);
        if (rich || typeof value === 'string') return value;
        throw new TypeError(`Text UI placeholder must be a string or number: ${id}/${token.name}`);
      });
      return rich ? parts : parts.join('');
    }
    return Object.freeze({locale, language: languageCode, number, pluralCategory,
      messageLocale: id => catalogues.get(languageCode)?.has(id) || languageCode === baseLanguage ? locale : baseLocale,
      pluralCategoryFor: (id, value, type = 'cardinal') => pluralCategory(value, type,
        catalogues.get(languageCode)?.has(id) || languageCode === baseLanguage ? locale : baseLocale),
      t: (id, values = {}, counts = {}) => render(id, values, false, counts),
      rich: (id, values = {}, counts = {}) => render(id, values, true, counts)});
  }
  return Object.freeze({sourceLocale: baseLocale, forLocale});
}
