import test from 'node:test';import assert from 'node:assert/strict';import {resolveAmendmentPlacement} from './document-context-model.mjs';
function sample(language='fi') {
 const bg=language==='bg',alphabet=bg?'абвгдежзийклмнопрстуфхцчшщ':'abcdefghijklmnopqrstuvwxyz',paragraphs=[bg?'Европейският парламент,':'Euroopan parlamentti,','1. Lead:',...[...alphabet].map(c=>c+') Point.'),(bg?'aа':'aa')+') Serial.','2. End.'];
 return {text:{textLanguage:language,paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphFormats:paragraphs.map((_,i)=>({indent:i>1&&i<29?4:2}))},wording:{language,baseline:'motion-resolution',originalText:'',proposedText:bg?'аа) New.':'a a) New.',targetLabel:bg?'Параграф 1 – буква a а (нова)':'1 kohta – a a alakohta (uusi)'}};
}
test('a colliding two-letter point follows its base without changing the serial label',()=>{
 for(const lang of ['fi','bg']){const s=sample(lang),result=resolveAmendmentPlacement(s.text,s.wording);assert.equal(result.status,'placed',result.reason);assert.equal(result.insertAfter,2);assert.equal(result.insertBefore,3);assert.equal(result.evidence[0].basis,'colliding-new-point');}
});
test('unproven families, incorrect proposed numbers and incomplete sources do not use the collision policy',()=>{
 const s=sample();for(const patch of [{targetLabel:'1 kohta – a a alakohta'},{proposedText:'ab) New.'}])assert.notEqual(resolveAmendmentPlacement(s.text,{...s.wording,...patch}).status,'placed',JSON.stringify(patch));
 s.text.paragraphSources[10].complete=false;assert(!resolveAmendmentPlacement(s.text,s.wording).evidence.some(e=>e.basis==='colliding-new-point'));
});
