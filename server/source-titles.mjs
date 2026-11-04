import {decodeCharacterReferences} from './character-references.mjs';

const scriptCharacters='0123456789+-=()';
const scripts={sub:'₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎',sup:'⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾'};
// Recognize only common title formatting, including quoted attributes. Unknown
// tags and incomplete tokens remain literal text, never executable HTML.
const formattingTag=/<(\/?)(sub|sup|b|strong|i|em|u|span|small|br)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;

// Keep titles as plain text. Published sub/sup pairs become Unicode where the
// whole content is representable, otherwise retain their text without wrappers.
// Decode one layer only; unknown markup stays text and still needs escaping.
export function sourceTitle(value) {
  if(typeof value!=='string')return value;
  const plain=decodeCharacterReferences(value,'source-title').replace(formattingTag,(token,closing,name)=>{
    const tag=name.toLowerCase();
    if(tag==='br')return ' ';
    if(tag!=='sub'&&tag!=='sup'||/\/\s*>$/.test(token))return '';
    return '<'+closing+tag+'>';
  });
  return plain.replace(/<(sub|sup)>([^<>]*)<\/\1>/g,(_pair,tag,content)=>{
    const characters=[...content];
    return characters.every(character=>scriptCharacters.includes(character))
      ?characters.map(character=>scripts[tag.toLowerCase()][scriptCharacters.indexOf(character)]).join('')
      :content;
  }).replace(/<\/?(?:sub|sup)>/g,'');
}

// Derived maps leave the retained source literal and language keys untouched.
export function sourceTitles(titles) {
  return Object.fromEntries(Object.entries(titles||{}).map(([language,title])=>[language,sourceTitle(title)]));
}
