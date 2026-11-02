import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {languageMetrics,compareLanguages,parityLocation,appendLanguageBaseline,LANGUAGES,LANGUAGE_SAMPLE,evaluateLanguages} from './amendment-language-benchmark.mjs';
import {rawDocument,rawExpected,verifyLanguagePlacement,simpleAddress} from './amendment-language-oracle.mjs';
import {options} from './amendment-benchmark.mjs';
import {InputCache,digest} from './amendment-benchmark-cache.mjs';
import {replayRuntime,publicDocumentUrl} from './amendment-benchmark-replay.mjs';
import {fileURLToPath} from 'node:url';

const row=(language,outcome='correct',more={})=>({key:'list:5:'+language,identity:'list:5',language,outcome,reason:outcome,location:{section:1,kind:'recital',value:'13',scope:'body'},...more});
const report=rows=>({snapshotId:'fixed',sample:['sample'],inputs:['bytes'],oracleVersion:1,rows});
test('language mode is explicit and keeps the default identity benchmark',()=>{
  assert.equal(options(['--languages','--record-language-baseline']).languages,true);
  assert.equal(options([]).languages,undefined);
  assert.throws(()=>options(['--record-language-baseline']),/requires --languages/);
  assert.equal(LANGUAGES.length,24);
  assert.ok(LANGUAGE_SAMPLE.some(s=>s.type==='second-reading'));
});
test('each language keeps its own denominator, missing extraction and withholding reasons',()=>{
  const rows=[row('en'),row('fi','placed-unverified',{location:null}),row('hr','withheld',{reason:'amendment-not-extracted',location:null}),row('ga','withheld',{reason:'language-wording-unpublished',location:null})];
  const m=languageMetrics(rows);
  assert.equal(m.find(m=>m.language==='hr').total,1);
  assert.deepEqual(m.find(m=>m.language==='hr').withheldByReason,{'amendment-not-extracted':1});
  assert.equal(m.find(m=>m.language==='fi').behindEnglish,1);
  assert.equal(m.find(m=>m.language==='fi').sameLocation,0);
  assert.equal(m.find(m=>m.language==='fi').locatedPairs,0);
});
test('parity compares exact list and number, with semantic locations rather than source offsets',()=>{
  const rows=[row('en'),row('fi'),row('lt','correct',{location:{section:2,kind:'recital',value:'13',scope:'body'}}),row('nl','correct',{identity:'another-list:5'})];
  const m=languageMetrics(rows);
  assert.equal(m.find(m=>m.language==='fi').sameLocation,1);
  assert.equal(m.find(m=>m.language==='lt').sameLocation,0);
  assert.equal(m.find(m=>m.language==='nl').paired,0);
});
test('language gate rejects a loss in any language even when English improves',()=>{
  const before=report([row('en','withheld'),row('fi')]),after=report([row('en'),row('fi','withheld')]);
  const gate=compareLanguages(after,before);
  assert.equal(gate.failed,true);assert.equal(gate.regressions[0].key,'list:5:fi');
  assert.equal(compareLanguages(report([row('en'),row('fi')]),before).failed,false);
});
test('language gate rejects false placements, removed rows, duplicate identities and changed snapshots',()=>{
  const base=report([row('en'),row('fi')]);
  assert.equal(compareLanguages(report([row('en'),row('fi','false-placement')]),base).failed,true);
  assert.equal(compareLanguages(report([row('en')]),base).failed,true);
  assert.throws(()=>compareLanguages(report([row('en'),row('en')]),base),/Duplicate/);
  assert.throws(()=>compareLanguages({...base,snapshotId:'new'},base),/snapshot/);
  assert.throws(()=>compareLanguages({...base,oracleVersion:2},base),/oracle/);
});
function docx(xml) {
  return execFileSync('python3',['-c',"import io,sys,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,'w'); z.writestr('word/document.xml',sys.stdin.buffer.read()); z.close(); sys.stdout.buffer.write(b.getvalue())"],{input:`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${xml}</w:body></w:document>`});
}
const p=value=>'<w:p><w:r><w:t>'+value+'</w:t></w:r></w:p>';
const cell=value=>'<w:tc>'+p(value)+'</w:tc>';
test('raw cell observations catch the real Finnish deletion even if extracted operation says replace',()=>{
  const xml=p('Tarkistus &lt;NumAm&gt;5&lt;/NumAm&gt;')+p('Tarkistus 5')+p('Ehdotus asetukseksi')+p('Johdanto-osan 13 kappale')+'<w:tbl><w:tr>'+cell('Komission teksti')+cell('Tarkistus')+'</w:tr><w:tr>'+cell('(13) Published original.')+cell('Poistetaan.')+'</w:tr></w:tbl>';
  const raw=rawDocument(docx(xml)),expected=rawExpected(raw.amendments[0],'fi');
  assert.equal(raw.amendments.length,1);assert.equal(expected.number,5);assert.equal(expected.operation,'delete');
  assert.equal(expected.targetLabel,'Johdanto-osan 13 kappale');
  assert.equal(verifyLanguagePlacement({expected,placement:{status:'placed',operation:'replace'}}).reason,'raw-operation-mismatch');
  assert.ok(expected.cellPaths[0][0].endsWith('/w:tc[1]'));
});
test('raw census retains Croatian headings and unsupported comparison layouts',()=>{
  const raw=rawDocument(docx(p('Amandman 1')+'<w:tbl><w:tr>'+cell('One merged column')+'</w:tr></w:tbl>'));
  assert.equal(raw.amendments.length,1);assert.equal(raw.amendments[0].gap,'raw-comparison-layout');
});
test('raw location assertions reject a placement in the wrong numbered source paragraph',()=>{
  const paths=['/opening','/one','/two'];
  const rawText={motionDocument:true,paragraphs:[{body:true,text:'The European Parliament,',path:paths[0]},{body:true,text:'1. Same original.',path:paths[1]},{body:true,text:'2. Same original.',path:paths[2]}]};
  const text={paragraphs:rawText.paragraphs.map(p=>p.text),paragraphSources:paths.map(path=>({path}))};
  const expected={operation:'replace',language:'en',sectionKind:'resolution',originalText:'Same original.',targetLabel:'Paragraph 1'};
  assert.equal(verifyLanguagePlacement({expected,placement:{status:'placed',operation:'replace',span:{start:2,end:2}},text,rawText}).reason,'raw-address-mismatch');
  assert.equal(verifyLanguagePlacement({expected,placement:{status:'placed',operation:'replace',span:{start:1,end:1}},text,rawText}).status,'verified');
});
test('unavailable section and complex target expectations stay unverified',()=>{
  assert.equal(simpleAddress('Article 1 – paragraph 2'),null);
  const rawText={paragraphs:[{body:true,text:'1. Original.',path:'/one'}]},text={paragraphs:['1. Original.'],paragraphSources:[{path:'/one'}]};
  assert.equal(verifyLanguagePlacement({expected:{operation:'replace',originalText:'Original.',targetLabel:'Paragraph 1'},placement:{status:'placed',operation:'replace',span:{start:0,end:0}},text,rawText}).reason,'raw-section-unverified');
});

test('location parity preserves source labels while comparing translated insertion conventions',()=>{
  const make=(language,value)=>row(language,'correct',{placement:{operation:'insert'},location:{section:'resolution',kind:'paragraph',value,scope:'body'}});
  assert.deepEqual(parityLocation(make('en','5b')),parityLocation(make('fr','5ter')));
  assert.deepEqual(parityLocation(make('en','5a')),parityLocation(make('el','5α')));
  assert.equal(make('fr','5ter').location.value,'5ter');
});

test('transport maintenance keeps a baseline only with identical raw expectations and assertions',()=>{
  const base={...report([row('en')]),oracleFingerprint:'old'};
  const same={...base,oracleFingerprint:'new'};
  assert.equal(compareLanguages(same,base).failed,false);
  assert.match(compareLanguages(same,base).warnings[0],/all raw expectations/);
  assert.throws(()=>compareLanguages({...same,rows:[row('en','correct',{expected:{operation:'delete'}})]},base),/raw expectations/);
});

test('ratchet retries never rewrite the baseline or append a duplicate row',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-language-ratchet-'));
  try {
    const first={...report([row('en')]),code:{head:'main'},oracleFingerprint:'policy'};
    const saved=await appendLanguageBaseline(directory,first),bytes=await readFile(saved.record.file,'utf8');
    assert.equal(saved.appended,true);
    const retry=await appendLanguageBaseline(directory,{...first,comparison:{failed:false}});
    assert.equal(retry.appended,false);
    assert.equal(await readFile(saved.record.file,'utf8'),bytes);
    assert.equal((await readFile(path.join(directory,'ratchet.jsonl'),'utf8')).trim().split('\n').length,1);
    assert.equal((await readdir(path.join(directory,'output'))).length,1);
    assert.equal((await appendLanguageBaseline(directory,{...first,code:{head:'next'}})).appended,true);
    assert.equal((await readFile(path.join(directory,'ratchet.jsonl'),'utf8')).trim().split('\n').length,2);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('published AM5 deletion verifies the actual splice and fails a one-character mutation',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/amendment-language-splice.json',import.meta.url),'utf8'));
  const expected=rawExpected(fixture.comparison,fixture.language);
  const paragraphs=Array.from({length:fixture.observed.index+1},(_,index)=>({text:'',source:{path:'/unretained-'+index}}));
  paragraphs[fixture.observed.index]={text:fixture.observed.text,source:{path:fixture.observed.path}};
  const args={expected,items:[{proposal:{paragraphs}}],rawItems:[{paragraphs:fixture.sourceParagraphs}]};
  const verified=verifyLanguagePlacement({...args,placement:fixture.placement});
  assert.equal(verified.status,'verified');assert.equal(fixture.observed.text.length,198);
  const placement=structuredClone(fixture.placement);placement.splice.end.offset=1;
  const verification=verifyLanguagePlacement({...args,placement});
  assert.equal(verification.status,'failed');assert.equal(verification.reason,'raw-proposal-recital-splice-mismatch');
  const before=report([row('en','correct',{placement:fixture.placement,verification:verified})]);
  const after=report([row('en','false-placement',{placement,verification})]);
  assert.equal(compareLanguages(after,before).failed,true);
  for(const mutate of [
    p=>{delete p.splice;},
    p=>{p.splice.start.paragraph--;},
    p=>{p.splice.end.paragraph++;},
    p=>{p.splice.start.offset=-1;},
    p=>{p.splice.end.offset=199;},
    p=>{p.splice.end.offset=0.5;},
    p=>{p.splice.start.offset=10;p.splice.end.offset=1;},
  ]) {const invalid=structuredClone(fixture.placement);mutate(invalid);assert.equal(verifyLanguagePlacement({...args,placement:invalid}).reason,'raw-invalid-splice');}
  const prefix=structuredClone(fixture.placement);prefix.splice.start.offset=1;
  assert.equal(verifyLanguagePlacement({...args,placement:prefix}).reason,'raw-proposal-recital-splice-mismatch');
});


test('a missing frozen edition is explicit on each language row without contaminating another edition',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'frozen-language-gap-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const apiBase='https://explorer.example',documentId='B-10-2026-0001',listId=documentId+'-AM-001-002';
  const bodyUrl='https://data.europarl.europa.eu/distribution/test/body.docx',missingUrl=bodyUrl.replace('body','missing'),wordingUrl=bodyUrl.replace('body','wording');
  const body=docx(p('MOTION FOR A EUROPEAN PARLIAMENT RESOLUTION')+p('The European Parliament,')+p('1. First paragraph.'));
  const amendment=number=>p('&lt;Amend&gt;&lt;NumAm&gt;'+number+'&lt;/NumAm&gt;')+p('&lt;Article&gt;Paragraph 1&lt;/Article&gt;')+'<w:tbl><w:tr>'+cell('Motion for a resolution')+cell('Amendment')+'</w:tr><w:tr>'+cell('First paragraph.')+cell('Changed paragraph.')+'</w:tr></w:tbl>'+p('&lt;/Amend&gt;');
  const wording=docx(amendment(1)+amendment(2));
  const cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:3,delay:0,sleep:async()=>{},fetcher:async url=>{
    if(url===publicDocumentUrl(documentId))return Response.json({data:[]});
    assert([bodyUrl,wordingUrl].includes(url));return new Response(url===bodyUrl?body:wording);
  }});
  for(const url of [publicDocumentUrl(documentId),bodyUrl,wordingUrl])await cache.get(url);
  const sample=[{documentId,listId,type:'motion',numbers:[1,2],editions:[{language:'en',body:{url:missingUrl},wording:{url:wordingUrl}},{language:'fr',body:{url:bodyUrl},wording:{url:wordingUrl}}]}],manifest=cache.manifest(),snapshotId=digest(JSON.stringify({sample,inputs:manifest}));
  const before=await Promise.all((await readdir(directory)).sort().map(async file=>[file,digest(await readFile(path.join(directory,file)))]));
  const offline=new InputCache(directory,{apiBase,cap:0,fetcher:()=>assert.fail('network forbidden')});await offline.seal(manifest,{snapshotId});
  const runtime=await replayRuntime(fileURLToPath(new URL('../',import.meta.url))),rows=await evaluateLanguages(sample,offline,runtime);
  assert.equal(rows.length,4);
  for(const row of rows.filter(r=>r.language==='en')){assert.equal(row.outcome,'acquisition-unavailable');assert.equal(row.reason,'frozen-input-absent');assert.deepEqual(row.acquisition.frozenInputGaps,[{reason:'frozen-input-absent',url:missingUrl,accept:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',snapshotId}]);}
  for(const row of rows.filter(r=>r.language==='fr')){assert.notEqual(row.outcome,'acquisition-unavailable');assert.equal(row.acquisition,undefined);}
  assert.equal(languageMetrics(rows).find(m=>m.language==='en').withheldByReason['frozen-input-absent'],2);
  assert.deepEqual(offline.manifest(),manifest);assert.equal(offline.requests,0);assert.equal(digest(JSON.stringify({sample,inputs:offline.manifest()})),snapshotId);
  assert.deepEqual(await Promise.all((await readdir(directory)).sort().map(async file=>[file,digest(await readFile(path.join(directory,file)))])),before);
});
