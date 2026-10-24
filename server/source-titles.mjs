import {decodeCharacterReferences} from './character-references.mjs';

// Decode one source-text layer, never HTML. Unknown/malformed references and
// literal markup stay text; callers must still use normal output escaping.
export function sourceTitle(value) {
  if(typeof value!=='string')return value;
  return decodeCharacterReferences(value,'source-title');
}

// Derived maps leave the retained source literal and language keys untouched.
export function sourceTitles(titles) {
  return Object.fromEntries(Object.entries(titles||{}).map(([language,title])=>[language,sourceTitle(title)]));
}
