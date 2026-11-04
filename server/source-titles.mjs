import {decodeCharacterReferences} from './character-references.mjs';

const scriptCharacters='0123456789+-=()';
const scripts={sub:'₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎',sup:'⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾'};

// Keep titles as plain text. Published sub/sup pairs become Unicode where the
// whole content is representable, otherwise retain their text without wrappers.
// Decode one layer only; unknown markup stays text and still needs escaping.
export function sourceTitle(value) {
  if(typeof value!=='string')return value;
  return decodeCharacterReferences(value,'source-title').replace(/<(sub|sup)\s*>([^<>]*)<\/\1\s*>/gi,(_pair,tag,content)=>{
    const characters=[...content];
    return characters.every(character=>scriptCharacters.includes(character))
      ?characters.map(character=>scripts[tag.toLowerCase()][scriptCharacters.indexOf(character)]).join('')
      :content;
  });
}

// Derived maps leave the retained source literal and language keys untouched.
export function sourceTitles(titles) {
  return Object.fromEntries(Object.entries(titles||{}).map(([language,title])=>[language,sourceTitle(title)]));
}
