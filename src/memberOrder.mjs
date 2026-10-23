// One fixed collation keeps the directory and its pickers consistent across
// server/browser locales and interface languages. Keep surname particles (del,
// de, van...) as displayed; compare accents but ignore case. Never use EP's
// sortLabel: it can concatenate the surname and first initial without a space.
const names = new Intl.Collator('en', {usage:'sort', sensitivity:'accent'});
export function compareMembers(a, b) {
  return names.compare(a.lastName || '', b.lastName || '')
    || names.compare(a.firstName || '', b.firstName || '')
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
