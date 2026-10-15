const nameKey = name => name.normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();
export function linkedCoAuthors(authors = []) {
  const seen = new Set();
  return authors.filter(author => {
    if (!author?.profileAvailable || !Number.isSafeInteger(author.id) || author.id <= 0 || typeof author.name !== 'string' || !author.name.trim() || !['AUTHOR','QUESTION_AUTHOR'].includes(author.role) || seen.has(author.id)) return false;
    seen.add(author.id);return true;
  });
}
export function coAuthorSegments(text, authors = []) {
  const original = text.normalize('NFC');
  const people = linkedCoAuthors(authors);
  const groups = new Map();
  for (const person of people) {
    const key = nameKey(person.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(person);
  }
  const unique = people.filter(person => groups.get(nameKey(person.name)).length === 1);
  if (!unique.length) return [{ text: original, id: null }];
  const alternatives = unique.map(person => ({ person, pattern: person.name.normalize('NFC').trim().split(/\s+/u).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+') })).sort((a,b) => b.person.name.length-a.person.name.length);
  const matcher = new RegExp(alternatives.map(item => `(${item.pattern})`).join('|'), 'giu');
  const parts = [];let cursor = 0;
  for (const match of original.matchAll(matcher)) {
    const start = match.index, end = start+match[0].length;
    if (/^[\p{L}\p{N}]$/u.test(original[start-1] || '') || /^[\p{L}\p{N}]$/u.test(original[end] || '')) continue;
    const index = match.slice(1).findIndex(value => value !== undefined);
    if (start > cursor) parts.push({ text: original.slice(cursor,start), id:null });
    parts.push({ text:match[0], id:alternatives[index].person.id });cursor=end;
  }
  if (cursor < original.length) parts.push({ text:original.slice(cursor),id:null });
  return parts.length ? parts : [{ text:original,id:null }];
}
export function coAuthorProfileUrl(path, language, id) {
  if (!Number.isSafeInteger(id) || id<=0) throw new Error('Invalid MEP identifier.');
  return `${path}?${new URLSearchParams({poc:'1',lang:language,member:String(id),module:'profile'})}`;
}
