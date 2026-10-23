import {ALL_ENTITIES} from '@nodable/entities';

// Decode one source-text layer, never HTML. Unknown/malformed references and
// literal markup stay text; callers must still use normal output escaping.
export function sourceTitle(value) {
  if(typeof value!=='string')return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#X[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,(entity,name)=>{
    if(name[0]!=='#')return Object.hasOwn(ALL_ENTITIES,name)?ALL_ENTITIES[name]:entity;
    const code=name[1]==='x'||name[1]==='X'?Number.parseInt(name.slice(2),16):Number(name.slice(1));
    return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):entity;
  });
}

// Derived maps leave the retained source literal and language keys untouched.
export function sourceTitles(titles) {
  return Object.fromEntries(Object.entries(titles||{}).map(([language,title])=>[language,sourceTitle(title)]));
}
