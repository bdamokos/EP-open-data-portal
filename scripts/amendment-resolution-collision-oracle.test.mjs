import test from 'node:test';import assert from 'node:assert/strict';
import {assertResolutionCollision} from './amendment-resolution-collision-oracle.mjs';
function zip(xml){const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(raw.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(raw.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(local.length+name.length+raw.length,42);central.writeUInt32LE(0,42);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+raw.length,16);return Buffer.concat([local,name,raw,central,name,end]);}
function sample(language='fi') {
 const alphabet=language==='bg'?'абвгдежзийклмнопрстуфхцчшщ':'abcdefghijklmnopqrstuvwxyz';
 const rows=['1. Lead:',...[...alphabet].map(c=>c+') Point.'),(language==='bg'?'aа':'aa')+') Serial.','2. End.'];
 const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+rows.map(t=>'<w:p><w:r><w:t>'+t+'</w:t></w:r></w:p>').join('')+'</w:body></w:document>';
 return {text:{nativeBuffer:zip(xml),paragraphs:rows,paragraphSources:rows.map((_,i)=>({path:`/w:document[1]/w:body[1]/w:p[${i+1}]`}))},wording:{language,baseline:'motion-resolution',originalText:'',targetLabel:language==='bg'?'Параграф 1 – буква a а (нова)':'1 kohta – a a alakohta (uusi)',proposedText:language==='bg'?'аа) New.':'a a) New.'},placement:{operation:'insert',insertAfter:1,insertBefore:2}};
}
test('native serial runs distinguish a new aa from the existing ordinal after z',()=>{
 for(const lang of ['fi','bg']){const s=sample(lang);assert.equal(assertResolutionCollision(s).status,'verified');assert.equal(assertResolutionCollision({...s,placement:{...s.placement,insertAfter:27,insertBefore:28}}).status,'failed');}
});
test('unknown native bytes, changed proposed number and non-new labels do not verify',()=>{
 const s=sample();assert.equal(assertResolutionCollision({...s,text:{...s.text,nativeBuffer:null}}).status,'unverified');
 for(const wording of [{...s.wording,proposedText:'ab) New.'},{...s.wording,targetLabel:'1 kohta – a a alakohta'}])assert.equal(assertResolutionCollision({...s,wording}).status,'unverified');
});
