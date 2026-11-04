import {decodeCharacterReferences} from './character-references.mjs';

const scriptCharacters='0123456789+-=()';
const scripts={sub:'₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎',sup:'⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾'};
// Consume every tag as a whole token so formatting-looking text inside an
// unknown tag's quoted attributes stays literal in both processing passes.
const tagTokenSource=String.raw`<(\/?)([a-z][^\s/<>"']*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>`;
const tagToken=new RegExp(tagTokenSource,'gi');
const scriptOrTag=new RegExp(String.raw`<(sub|sup)>([^<>]*)<\/\1>|`+tagTokenSource,'gi');
const formattingTags=new Set(['sub','sup','b','strong','i','em','u','span','small','br']);

// Keep titles as plain text. Published sub/sup pairs become Unicode where the
// whole content is representable, otherwise retain their text without wrappers.
// Decode one layer only; unknown markup stays text and still needs escaping.
export function sourceTitle(value) {
  if(typeof value!=='string')return value;
  const plain=decodeCharacterReferences(value,'source-title').replace(tagToken,(token,closing,name)=>{
    const tag=name.toLowerCase();
    if(!formattingTags.has(tag))return token;
    if(tag==='br')return ' ';
    if(tag!=='sub'&&tag!=='sup'||/\/\s*>$/.test(token))return '';
    return '<'+closing+tag+'>';
  });
  return plain.replace(scriptOrTag,(token,tag,content,_closing,name)=>{
    if(!tag)return /^(?:sub|sup)$/i.test(name)?'':token;
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
