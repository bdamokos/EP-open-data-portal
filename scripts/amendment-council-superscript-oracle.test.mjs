import test from 'node:test';import assert from 'node:assert/strict';
import {councilNativeSuperscripts} from './amendment-council-superscript-oracle.mjs';
const word=(text,x,y,right,bottom)=>`<word xMin="${x}" yMin="${y}" xMax="${right}" yMax="${bottom}">${text}</word>`;
const source='Directive2 applies.\n2 Printed note body.\f';
const box=note=>`<page width="600" height="800">${word('Directive',50,100,100,113)}${word('2',100.2,99.5,104,108)}${word('applies.',105,100,145,113)}${note?word('2',50,700,54,708.5)+word('Printed',70,700,110,713)+word('note',111,700,135,713)+word('body.',136,700,165,713):''}</page>`;
test('native geometry removes a raised marker only with one matching printed footnote label',()=>{
 assert.equal(councilNativeSuperscripts(source,box(true)),'Directive applies.\n2 Printed note body.\f');
 assert.equal(councilNativeSuperscripts(source,box(false)),source);
 assert.equal(councilNativeSuperscripts(source,box(true).replace('yMax="108"','yMax="113"')),source);
 assert.equal(councilNativeSuperscripts(source,box(true).replace('>Directive<','>Different<')),source);
});
