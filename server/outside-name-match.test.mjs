import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOutsideName,matchOutsideName,resolveOutsideSpeaker} from './outside-speaker-country.mjs';
const appearance={id:'speech',personId:'1',date:'2026-01-21',term:10,header:{name:'Example Speaker',role:'Guest speaker'},debatePlaces:[]};
const position=(extra={})=>({id:'Q2',statement:'Q1$dated-position',start:'2020-01-01',end:null,countries:['PRT'],jurisdictions:[],...extra});
const candidate=(extra={})=>({qid:'Q1',revision:12,human:true,names:[{value:'Example Speaker',language:'en',kind:'label'}],positions:[position()],citizenships:['PRT'],...extra});
const record=candidates=>({status:'available',candidates,fetchedAt:'2026-11-02T12:00:00Z',urls:['https://www.wikidata.org/wiki/Q1']});
test('only NFC, whitespace collapse and Unicode case folding normalize speaker names',()=>{
 assert.equal(normalizeOutsideName('  NATAŠA\tPirc  Musar '),normalizeOutsideName('Natas\u030ca Pirc Musar'));assert.equal(normalizeOutsideName('Straße'),normalizeOutsideName('STRASSE'));assert.equal(normalizeOutsideName('ΟΣ'),normalizeOutsideName('ος'));assert.notEqual(normalizeOutsideName('Nataša'),normalizeOutsideName('Natasa'));assert.notEqual(normalizeOutsideName('İpek'),normalizeOutsideName('Ipek'));assert.notEqual(normalizeOutsideName('ı'),normalizeOutsideName('I'));
});
test('exact label or alias plus a started office on the speech day is required',()=>{
 const c=candidate();assert.equal(matchOutsideName(appearance,record([c])).country,'PRT');c.names=[{value:'Other name',kind:'label'},{value:'EXAMPLE SPEAKER',kind:'alias'}];assert.equal(matchOutsideName(appearance,record([c])).status,'matched');
 c.positions[0].start=null;assert.equal(matchOutsideName(appearance,record([c])).status,'none');c.positions[0].start='2026-01-22';assert.equal(matchOutsideName(appearance,record([c])).status,'none');c.positions[0].start='2026-01-21';c.positions[0].end='2026-01-21';assert.equal(matchOutsideName(appearance,record([c])).status,'matched');c.positions[0].end='2026-01-20';assert.equal(matchOutsideName(appearance,record([c])).status,'none');
});
test('the single-candidate gate precedes country selection and requires a human',()=>{
 assert.equal(matchOutsideName(appearance,record([candidate({human:false})])).status,'none');assert.equal(matchOutsideName(appearance,record([candidate({names:[{value:'Example Speeker'}]})])).status,'none');
 const two=record([candidate(),candidate({qid:'Q3',positions:[position({countries:[],hasCountry:true})]})]);assert.equal(matchOutsideName(appearance,two).status,'ambiguous');const resolution=resolveOutsideSpeaker('1',[appearance],{wikidata:two});assert.equal(resolution.addresses.size,0);assert.equal(resolution.diagnostics[0].status,'ambiguous');assert.equal(resolution.unavailable.length,0);
});
test('office country wins citizenship, jurisdiction resolves Greenland, and international offices never borrow nationality',()=>{
 assert.equal(matchOutsideName(appearance,record([candidate({citizenships:['DNK'],positions:[position({countries:['GRL']})]})])).country,'GRL');assert.equal(matchOutsideName(appearance,record([candidate({citizenships:['DNK'],positions:[position({countries:[],jurisdictions:['GRL'],hasJurisdiction:true})]})])).country,'GRL');
 assert.equal(matchOutsideName(appearance,record([candidate({positions:[position({countries:[],jurisdictions:[]})]})])).country,'PRT');
 assert.equal(matchOutsideName(appearance,record([candidate({positions:[position({international:true})]})])).status,'none');assert.equal(matchOutsideName(appearance,record([candidate({positions:[position({countries:[],hasCountry:true})]})])).status,'none');
});
test('option A stays primary without Wikidata; only supplementary missing data withholds the quarter',()=>{
 const leader={...appearance,header:{name:'Example Speaker',role:'Prime Minister of Portugal'},debatePlaces:['PRT']};const a=resolveOutsideSpeaker('1',[leader]);assert.equal(a.addresses.get('speech').country,'PRT');assert.deepEqual(a.unavailable,[]);
 assert.deepEqual(resolveOutsideSpeaker('1',[appearance]).unavailable,['speech']);assert.deepEqual(resolveOutsideSpeaker('1',[appearance],{wikidata:{status:'none'}}).unavailable,[]);
 for(const role of ['Special Adviser to the President of the European Commission','President-in-Office of the Council','President of the UN General Assembly'])assert.equal(resolveOutsideSpeaker('1',[{...appearance,header:{...appearance.header,role}}],{wikidata:record([candidate()])}).addresses.size,0);
});
