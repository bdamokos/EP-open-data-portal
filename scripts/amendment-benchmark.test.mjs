import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileAsync,registerSubprocesses} from '../server/test-support/subprocess.mjs';
import {producerFingerprint} from './amendment-benchmark-producers.mjs';
import os from 'node:os';
import path from 'node:path';
import {parseProposal} from '../server/proposal-structure.mjs';
import {resolveProposalPlacement} from '../server/proposal-placement.mjs';
import {documentContextPlacement} from '../server/document-context-placement.mjs';
import {resolveAmendmentPlacement} from '../server/document-context-model.mjs';
import {classify,verifyPlacement,metrics,compareBaseline,targetPatterns,oracleNormal,projectionCompatibility} from './amendment-benchmark-model.mjs';
import {InputCache,allowedInput,retryDelay,digest,apiOrigin} from './amendment-benchmark-cache.mjs';
import {options,monday,evaluateReport,acquireReport,placeableDecision,contextUrl} from './amendment-benchmark.mjs';

beforeEach(registerSubprocesses);
const apiBase='https://explorer.example';
const source=paragraphs=>({paragraphs,structureStatus:'extracted',textLanguage:'en',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paragraphs.map(()=>({styleId:'Normal',numberingComplete:true,notesComplete:true}))});
const item=paragraphs=>[{kind:'act',index:1,proposal:parseProposal(source(paragraphs),{language:'en'})}];
const wording=(targetLabel,originalText='',proposedText='New text.')=>({targetLabel,originalText,proposedText,language:'en',baseline:'commission-proposal'});
const stages=()=>({S1:{status:'passed'},S2:{status:'passed'},S3:{status:'passed'},S4:{status:'passed'},S5:{status:'placed'},S6:{status:'verified'}});
test('classifier distinguishes affirmative source absence, processing limits, unverified and false placements',()=>{
  assert.equal(classify(stages()).outcome,'correct');
  for(const reason of ['wording-comparison-grid','wording-vertical-text-loss','docx-amendment-not-extracted','input-http-503','wording-source-not-indexed']) {
    const value=stages();value.S2={status:'blocked',reason};assert.equal(classify(value).outcome,'withheld-pipeline');
  }
  for(const reason of ['source-document-unavailable','source-wording-empty']) {
    const value=stages();value.S2={status:'blocked',reason};assert.equal(classify(value).outcome,'withheld-source');
  }
  const unverified=stages();unverified.S6={status:'unverified',reason:'no-oracle'};assert.equal(classify(unverified).outcome,'placed-unverified');
  const falsePlacement=stages();falsePlacement.S1={status:'blocked',reason:'missing-link'};falsePlacement.S6={status:'failed',reason:'bad-span'};assert.equal(classify(falsePlacement).outcome,'false-placement');
  const quote=stages();quote.S3={status:'blocked',reason:'unparsed'};assert.equal(classify(quote).outcome,'correct','actual quote fallback can verify without a structured label');
});
test('replace/delete oracle reads exact splice coordinates, tolerates only provision labels and typography',()=>{
  const items=item(['Article 1','1. A café sentence.','2. A different sentence.']);
  const amendment=wording('Article 1 – paragraph 1','A cafe\u0301 sentence;','Deleted');
  const placement=resolveProposalPlacement(items,amendment);assert.equal(placement.status,'placed');
  assert.equal(verifyPlacement({placement,wording:amendment,items}).status,'verified');
  assert.equal(verifyPlacement({placement:{...placement,span:{start:2,end:2},splice:{start:{paragraph:2,offset:0},end:{paragraph:2,offset:24}}},wording:amendment,items}).status,'failed');
  assert.equal(verifyPlacement({placement:{...placement,splice:{start:{paragraph:1,offset:500},end:{paragraph:1,offset:1}}},wording:amendment,items}).reason,'oracle-invalid-span');
  assert.equal(verifyPlacement({placement,wording:{...amendment,originalText:'(not) A café sentence.'},items}).status,'failed');
});
test('introductory-part addresses are checked against their own provision',()=>{
  const items=item(['Article 1','1. Lead text of the paragraph:','(a) first point;','2. Other paragraph lead:']);
  const amendment=wording('Article 1 – paragraph 1 – introductory part','Lead text of the paragraph:','New lead:');
  const placement=resolveProposalPlacement(items,{...amendment,targetLabel:'Article 1 – paragraph 1'});assert.equal(placement.status,'placed');
  assert.equal(verifyPlacement({placement,wording:amendment,items}).status,'verified');
  const elsewhere={...placement,span:{start:3,end:3},splice:{start:{paragraph:3,offset:0},end:{paragraph:3,offset:24}}};
  assert.equal(verifyPlacement({placement:elsewhere,wording:amendment,items}).status,'failed','a span outside the addressed provision fails');
});

test('a resolution introductory part is verified only within its lead rows',()=>{
  const text=source(['The European Parliament,','1. Calls for:','(a) First point;','2. Next paragraph.','ANNEX']);
  const at=row=>({status:'placed',operation:'replace',span:{start:row,end:row}});
  const lead={...wording('Paragraph 1 – introductory part','Calls for:','Urges:'),baseline:'motion-resolution'};
  assert.equal(verifyPlacement({placement:at(1),wording:lead,text}).status,'verified');
  const child={...wording('Paragraph 1 – introductory part','(a) First point;','(a) Changed;'),baseline:'motion-resolution'};
  assert.equal(verifyPlacement({placement:at(2),wording:child,text}).status,'failed','a child point is not the introductory part');
  const bare=source(['The European Parliament,','1. Calls for change.','2. Next paragraph.','ANNEX']);
  const noChildren={...wording('Paragraph 1 – introductory part','Calls for change.','Urges change.'),baseline:'motion-resolution'};
  assert.equal(verifyPlacement({placement:at(1),wording:noChildren,text:bare}).reason,'oracle-introductory-part-unavailable');
});

test('proposal insertion oracle asserts parent, complete sibling subtree and following sibling order',()=>{
  const items=item(['Article 1','1. First.','Article 2','1. Second.']);
  const amendment=wording('Article 1 a (new)');const placement=resolveProposalPlacement(items,amendment);assert.equal(placement.status,'placed');
  assert.equal(verifyPlacement({placement,wording:amendment,items}).status,'verified');
  assert.equal(verifyPlacement({placement:{...placement,insertAfter:0,insertBefore:1},wording:amendment,items}).reason,'oracle-insertion-boundary-mismatch');
  const nested=item(['Article 1','1. First.','2. Second.','Article 2','1. Third.']);
  const child=wording('Article 1 – paragraph 1 a (new)'),placed=resolveProposalPlacement(nested,child);
  assert.equal(verifyPlacement({placement:placed,wording:child,items:nested}).status,'verified');
  assert.equal(verifyPlacement({placement:placed,wording:{...child,targetLabel:'Article 2 – paragraph 1 a (new)'},items:nested}).reason,'oracle-parent-mismatch');
  const next=structuredClone(items);next[0].proposal.units.flatMap(u=>u.children||[]).find(u=>u.kind==='article'&&u.label.number===2).label.number=1;
  assert.equal(verifyPlacement({placement,wording:amendment,items:next}).status,'failed');
});
test('resolution oracles cover numeric and recital insertion and do not accept the wrong source span',()=>{
  const text=source(['The European Parliament,','A. First recital.','B. Second recital.','1. First paragraph.','2. Second paragraph.','ANNEX']);
  for(const targetLabel of ['Paragraph 1 a (new)','Recital A a (new)']) {
    const amendment={...wording(targetLabel),baseline:'motion-resolution'};
    const placement=resolveAmendmentPlacement(text,amendment);assert.equal(placement.status,'placed',placement.reason);
    assert.equal(verifyPlacement({placement,wording:amendment,text}).status,'verified',targetLabel);
  }
  const amendment={...wording('Paragraph 1','First paragraph.'),baseline:'motion-resolution'};
  const placement=resolveAmendmentPlacement(text,amendment);assert.equal(placement.status,'placed');
  assert.equal(verifyPlacement({placement,wording:amendment,text}).status,'verified');
  assert.equal(verifyPlacement({placement:{...placement,span:{start:4,end:4}},wording:amendment,text}).reason,'oracle-original-span-mismatch');
  for(const label of ['A','AA']) {
    const recital=source(['The European Parliament,',label+'. First recital.','1. First paragraph.','ANNEX']);
    const words={...wording('Recital '+label,'First recital.'),baseline:'motion-resolution'};
    const placed=resolveAmendmentPlacement(recital,words);assert.equal(placed.status,'placed');
    assert.equal(verifyPlacement({placement:placed,wording:words,text:recital}).status,'verified','published recital prefixes may be omitted in original wording');
  }
});
test('insertion oracle checks the preceding sibling and orders multi-letter recital labels after Z',()=>{
  for(const [paragraphs,targetLabel,expected] of [
    [['3. Three.','4. Four.','3b. Misordered.','5. Five.'],'Paragraph 3 c (new)','failed'],
    [['Z. Last single-letter recital.','AA. First double-letter recital.','1. Paragraph.'],'Recital Z a (new)','verified'],
  ]) {
    const text=source(['The European Parliament,',...paragraphs,'ANNEX']),amendment={...wording(targetLabel),baseline:'motion-resolution'};
    const placement=resolveAmendmentPlacement(text,amendment);assert.equal(placement.status,'placed');
    assert.equal(verifyPlacement({placement,wording:amendment,text}).status,expected);
  }
  const heading='I. State of play',text=source(['The European Parliament,','AA. Whereas a source recital;','AB. Whereas the final recital;',heading,'1. First operative paragraph.','ANNEX']);
  text.paragraphFormats=text.paragraphs.map((_,i)=>i===3?{marks:[{kind:'bold',start:0,end:heading.length},{kind:'italic',start:0,end:heading.length}]}:{});
  const amendment={...wording('Recital AB a (new)'),baseline:'motion-resolution'},placement=resolveAmendmentPlacement(text,amendment);
  assert.equal(placement.status,'placed');assert.equal(verifyPlacement({placement,wording:amendment,text}).status,'verified','the raw bold heading closes the final recital before the heading');
});
const row=(id,outcome='correct',voteIds=['vote-1'])=>({key:id,id,outcome,reason:outcome,documentType:'legislative-report',language:'en',patterns:['article'],voteIds});
test('metrics count amendments once, preserve null zero-denominator shares and deduplicate collective/split votes',()=>{
  const value=metrics([row('a'),row('b','withheld-source'),row('c','withheld-pipeline',['vote-2'])]);
  assert.equal(value.headline,0.5);assert.equal(value.raw,1/3);assert.deepEqual(value.votes,{total:2,correct:0,share:0});
  assert.equal(metrics([]).headline,null);assert.equal(metrics([row('a','withheld-source')]).headline,null);
  assert.deepEqual(value.taxonomy[0].examples,['a']);
});
test('baseline gate reports every deterioration, catches new false placements, checks input comparability and emits metric deltas',()=>{
  const wrap=rows=>({sample:{mode:'documents'},inputs:[{url:'public',sha256:'hash'}],rows,metrics:metrics(rows)});
  const before=wrap([row('a'),row('b','withheld-pipeline')]),after=wrap([row('a','placed-unverified'),row('b','false-placement')]);
  const diff=compareBaseline(after,before);assert.equal(diff.failed,true);assert.deepEqual(diff.regressions.map(r=>r.id),['a','b']);assert.equal(diff.deltas.headline,-0.5);assert(diff.taxonomyDeltas.length);
  assert.equal(compareBaseline(before,before).failed,false);
  assert.throws(()=>compareBaseline({...after,inputs:[]},before),/hashes differ/);
  assert.equal(compareBaseline(wrap([row('a','false-placement')]),wrap([row('a','false-placement')])).failed,true);
  assert.equal(compareBaseline(wrap([]),before).regressions.length,2);
});
test('patterns retain grammar and extraction limits; sample options select exact dates and term-10 IDs',()=>{
  assert(targetPatterns(wording('Article 1 – paragraph 2 a (new)'),[{code:'vertical-text-loss'},{code:'comparison-grid'}]).includes('letter-suffix'));
  assert(targetPatterns(wording('Article -1')).includes('negative-label'));
  assert.equal(options([]).weeks,8);assert.equal(options([]).fetchMissing,false);
  assert.throws(()=>options(['--fetch','--delay-ms','0']),/at least 750/);
  assert.deepEqual(options(['--document','B-10-2026-0001','--document','B-10-2026-0001']).documents,['B-10-2026-0001']);
  assert.throws(()=>options(['--from','2026-01-01']),/ordered/);assert.throws(()=>options(['--document','A-9-2024-0001']),/term-10/);
  assert.equal(monday('2026-10-22'),'2026-10-19');
});
test('URL cache is hash-verified, offline by default, bounded and honours Retry-After for retries and the next URL',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-bench-test-'));
  try {
    const url='https://explorer.example/api/amendments?limit=50',calls=[],waits=[];
    const cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:3,delay:0,sleep:async ms=>waits.push(ms),fetcher:async (url,opts)=>{calls.push({url,opts});return calls.length===1?new Response('busy',{status:429,headers:{'Retry-After':'2'}}):new Response('{"ok":true}');}});
    const first=await cache.json(url);assert(first.value.ok);assert.equal(calls.length,2);assert(waits.some(ms=>ms>=1900));assert.equal(calls[0].opts.redirect,'manual');
    const offline=new InputCache(directory,{apiBase,fetcher:()=>{throw new Error('network forbidden');}});
    assert.equal((await offline.json(url)).value.ok,true);assert.equal(offline.requests,0);
    await assert.rejects(()=>offline.get(url+'&offset=50'),/input-not-cached/);
    const capped=new InputCache(directory,{apiBase,fetchMissing:true,cap:0});await assert.rejects(()=>capped.get(url+'&offset=50'),/request-cap-exhausted/);
    const last=new InputCache(directory,{apiBase,fetchMissing:true,cap:2,delay:0,sleep:async ms=>waits.push(ms),fetcher:async()=>new Response('busy',{status:503,headers:{'Retry-After':'3'}})});
    await assert.rejects(()=>last.get(url+'&offset=100'),/not cached/);assert.equal(last.requests,2);
    await writeFile(path.join(directory,digest(url)+'.body'),'tampered');await assert.rejects(()=>offline.get(url),/hash mismatch/);
  } finally {await rm(directory,{recursive:true,force:true});}
  assert.equal(retryDelay('2'),2000);assert.equal(retryDelay('Wed, 21 Oct 2026 00:00:03 GMT',Date.parse('2026-10-21T00:00:00Z')),3000);
  for(const url of ['http://explorer.example/api/amendments','https://explorer.example/api/healthz','https://data.europarl.europa.eu/api/v2/meps','https://example.org/x.docx'])assert.equal(allowedInput(url,apiBase),false);
});
test('official DOCX redirects use the shared host allowlist, cache both hops, and charge the request cap',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-bench-redirect-'));
  try {
    const original='https://data.europarl.europa.eu/distribution/test/file.docx',target='https://redmapl3.europarl.europa.eu/RedmapFront/media/test/file.docx';
    const cache=new InputCache(directory,{apiBase,fetchMissing:true,cap:2,delay:0,sleep:async()=>{},fetcher:async url=>url===original?new Response('',{status:302,headers:{location:target}}):new Response('DOCX')});
    const result=await cache.get(original);assert.equal(result.ok,true);assert.equal(result.url,original);assert.equal(result.resolvedSourceUrl,target);assert.equal(result.body.toString(),'DOCX');assert.equal(cache.requests,2);assert.equal(cache.manifest().length,2);
    const offline=new InputCache(directory,{apiBase});assert.equal((await offline.get(original)).body.toString(),'DOCX');assert.equal(offline.requests,0);
    const forbidden=new InputCache(directory,{apiBase,fetchMissing:true,cap:1,delay:0,sleep:async()=>{},fetcher:async()=>new Response('',{status:302,headers:{location:'https://example.org/file.docx'}})});
    await assert.rejects(()=>forbidden.get(original.replace('file.docx','bad.docx')),/unapproved-document-redirect/);assert.equal(forbidden.requests,1);
    const limited=new InputCache(directory,{apiBase,fetchMissing:true,cap:1,delay:0,sleep:async()=>{},fetcher:async()=>new Response('',{status:302,headers:{location:target.replace('file.docx','missing.docx')}})});
    await assert.rejects(()=>limited.get(original.replace('file.docx','limited.docx')),/request-cap-exhausted/);assert.equal(limited.requests,1);
  } finally {await rm(directory,{recursive:true,force:true});}
});

// A tiny synthetic DOCX, generated entirely in memory. No downloaded fixtures.
function docx(xml) {
  const name=Buffer.from('word/document.xml'),body=Buffer.from(xml),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+body.length,16);
  return Buffer.concat([local,name,body,central,name,end]);
}
const paragraph=value=>'<w:p><w:r><w:t>'+value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</w:t></w:r></w:p>';
test('report evaluation re-extracts cached DOCX despite null live wording and ignores live placement',async()=>{
  const document='B-10-2026-0001',id=document+'-AM-1',url='https://data.europarl.europa.eu/distribution/test/test_en.docx';
  const cell=value=>'<w:tc>'+paragraph(value)+'</w:tc>',tr=(a,b)=>'<w:tr>'+cell(a)+cell(b)+'</w:tr>';
  const body=docx('<w:document xmlns:w="urn:word"><w:body>'+paragraph('<Amend><Date>1.10.2026</Date><NumAm>1</NumAm>')+paragraph('<Article>Paragraph 1</Article>')+'<w:tbl>'+tr('Motion for a resolution','Amendment')+tr('First paragraph.','Changed paragraph.')+'</w:tbl>'+paragraph('</Amend>')+'</w:body></w:document>');
  const input={id,number:1,targetDocumentId:document,listId:document+'-AM-001-001',wordingSource:{url},originalText:null,proposedText:null,language:'en',decisions:[{id:'vote-1',date:'2026-10-22',sittingId:'MTG-PL-2026-10-22',amendmentIds:[id],reference:'Paragraph 1',source:{url:'https://data.europarl.europa.eu/api/v2/example',fetchedAt:'2026-10-23T00:00:00Z'}}]};
  const cache={apiBase,get:async()=>({ok:true,body,url,fetchedAt:'2026-10-23T00:00:00Z',sha256:digest(body)}),json:async url=>({input:{ok:true,url},value:{documentId:document,document:{selectedText:source(['The European Parliament,','1. First paragraph.','2. Second paragraph.','ANNEX'])},placement:{status:'placed',span:{start:999,end:999}}}})};
  const [result]=await evaluateReport([input],{mode:'documents',asOf:'2026-10-26'},cache);
  assert.equal(result.outcome,'correct',JSON.stringify(result.stages));assert.equal(result.stages.S5.span.start,1);assert.equal(result.stages.S2.status,'passed');
  const [missing]=await evaluateReport([input],{mode:'documents',asOf:'2026-10-26'},{...cache,get:async()=>({ok:false,status:503,error:'http-503',url})});assert.equal(missing.outcome,'withheld-pipeline');
  const conflict=structuredClone(input);conflict.decisions.push({...input.decisions[0],id:'old-vote',date:'2026-09-01',sittingId:'MTG-PL-2026-09-01',reference:'Paragraph 2'});
  const [conflicting]=await evaluateReport([conflict],{mode:'date-window',from:'2026-10-01',to:'2026-10-26',asOf:'2026-10-26'},cache);
  assert.equal(conflicting.stages.S5.reason,'conflicting_target_evidence','out-of-window decision evidence still constrains endpoint placement');
});

test('cleared live baseline markers do not multiply report/language proposal acquisition',async()=>{
  const document='A-10-2026-0001',url='https://data.europarl.europa.eu/distribution/test/commission.docx';
  const cell=value=>'<w:tc>'+paragraph(value)+'</w:tc>',tr=(a,b)=>'<w:tr>'+cell(a)+cell(b)+'</w:tr>';
  const block=number=>paragraph('<Amend><Date>1.10.2026</Date><NumAm>'+number+'</NumAm>')+paragraph('<Article>Article 1 – paragraph 1</Article>')+'<w:tbl>'+tr('Text proposed by the Commission','Amendment')+tr('First paragraph.','Changed paragraph.')+'</w:tbl>'+paragraph('</Amend>');
  const body=docx('<w:document xmlns:w="urn:word"><w:body>'+block(1)+block(2)+'</w:body></w:document>');
  const rows=[1,2].map(number=>({id:document+'-AM-'+number,number,targetDocumentId:document,listId:document+'-AM-001-002',wordingSource:{url},originalText:null,proposedText:null,baseline:'unknown',language:'en',decisions:[{id:'vote-'+number,date:'2026-10-22',sittingId:'MTG-PL-2026-10-22',amendmentIds:[document+'-AM-'+number],source:{url:'https://data.europarl.europa.eu/api/v2/example',fetchedAt:'2026-10-23T00:00:00Z'}}]}));
  const calls=[];
  const cache={apiBase,get:async()=>({ok:true,body,url,fetchedAt:'2026-10-23T00:00:00Z',sha256:digest(body)}),json:async url=>{calls.push(url);return {input:{ok:true,url},value:{documentId:document,baseline:{language:'en',status:'available'},proposal:{items:item(['Article 1','1. First paragraph.'])}}};}};
  const evaluated=await evaluateReport(rows,{mode:'documents',asOf:'2026-10-26'},cache);
  assert.equal(calls.length,2);assert(evaluated.every(row=>row.outcome==='correct'));
});

test('independent oracle rejects a matching phrase in the wrong addressed unit and requires unique quote fallback',()=>{
  const items=item(['Article 1','1. The same phrase.','2. The same phrase.']);
  const amendment=wording('Article 1 – paragraph 1','The same phrase.');
  const other=resolveProposalPlacement(items,{...amendment,targetLabel:'Article 1 – paragraph 2'});
  assert.equal(other.status,'placed');
  assert.equal(verifyPlacement({placement:other,wording:amendment,items}).reason,'oracle-address-span-mismatch');
  const inline=structuredClone(item(['Article 1','1. The same phrase. 2. The same phrase.']));
  const unit=inline[0].proposal.units.flatMap(u=>u.children||[]).flatMap(u=>u.children||[]).find(u=>u.kind==='paragraph');
  unit.spans=[{paragraph:1,start:0,end:18}];
  const start=inline[0].proposal.paragraphs[1].text.lastIndexOf('The same phrase.');
  const wrongInline={status:'placed',operation:'replace',itemIndex:0,span:{start:1,end:1},splice:{start:{paragraph:1,offset:start},end:{paragraph:1,offset:start+16}}};
  assert.equal(verifyPlacement({placement:wrongInline,wording:amendment,items:inline}).reason,'oracle-address-span-mismatch');
  const text=source(['The European Parliament,','1. The same phrase.','2. The same phrase.','ANNEX']);
  const unknown={...amendment,baseline:'motion-resolution',targetLabel:'Unparsed heading'};
  const placement={status:'placed',operation:'replace',span:{start:1,end:1}};
  assert.equal(verifyPlacement({placement,wording:unknown,text}).reason,'oracle-original-not-unique');
  const french={...unknown,language:'fr',targetLabel:'Paragraphe 1'};
  const frenchText={...text,paragraphs:['Le Parlement européen,',...text.paragraphs.slice(1)],textLanguage:'fr'};
  assert.equal(verifyPlacement({placement,wording:french,text:frenchText}).status,'verified');
  assert.equal(verifyPlacement({placement:{...placement,span:{start:2,end:2}},wording:french,text:frenchText}).reason,'oracle-address-span-mismatch');
  const unique=source(['The European Parliament,','1. The same phrase.','2. A unique phrase.','ANNEX']);
  assert.equal(verifyPlacement({placement,wording:unknown,text:unique}).status,'verified');
  assert.equal(oracleNormal('“(ab) A\u00a0phrase—here;”',[{value:'ab'}]),'A phrase-here');
  assert.notEqual(oracleNormal('A phrase'),oracleNormal('a phrase'));
});

test('acquisition includes all indexed lists and both contexts before checkout extraction, including unreadable variants',async()=>{
  const document='A-10-2026-0001',urls=[1,2,3].map(n=>'https://data.europarl.europa.eu/distribution/test/list'+n+'.docx');
  const rows=[1,2].map((n)=>({id:document+'-AM-'+n,targetDocumentId:document,number:n,language:'en',listId:document+'-AM-001-002',wordingSource:{url:urls[n-1]},decisions:n===1?[{date:'2026-10-22',sittingId:'MTG-PL-2026-10-22'}]:[]}));
  rows[0].variants=[{...rows[0]},{...rows[0],wordingSource:{url:urls[2]},listId:document+'-AM-003-004'}];
  const gets=[],json=[];
  const cache={apiBase,get:async url=>{gets.push(url);return {ok:true,body:Buffer.from('unreadable DOCX')};},json:async url=>{json.push(url);return {input:{ok:true,url},value:{documentId:document,version:6}};}};
  await acquireReport(rows,{mode:'documents',asOf:'2026-10-27'},cache);
  assert.deepEqual(gets,[...urls].sort());assert.equal(json.length,2);assert(!new URL(json[0]).searchParams.has('amendment'));assert(new URL(json[1]).searchParams.has('amendment'));
  const again=[];await acquireReport(rows,{mode:'documents',asOf:'2026-10-27'},{...cache,get:async url=>again.push(url)});
  assert.deepEqual(again,gets,'acquisition does not depend on any extraction result');
});

test('baseline checks full snapshot identity, warns on oracle changes and refuses live-version mismatches',()=>{
  const wrap=rows=>({snapshotId:'fixed-full-manifest',sample:{},inputs:[{url:'used',sha256:'a'},{url:'unused',sha256:'b'}],code:{files:{'scripts/amendment-benchmark-model.mjs':'old'}},compatibility:{compatible:true},rows,metrics:metrics(rows)});
  const before=wrap([row('a','withheld-pipeline')]),after=wrap([row('a')]);after.code.files['scripts/amendment-benchmark-model.mjs']='new';
  const diff=compareBaseline(after,before);assert.equal(diff.failed,false);assert.equal(diff.deltas['counts.correct'],1);assert.equal(diff.warnings.length,1);
  assert.throws(()=>compareBaseline({...after,snapshotId:'different'},before),/hashes differ/);
  const refused=compareBaseline({...after,compatibility:{compatible:false}},before);assert.equal(refused.refused,true);assert.equal(refused.failed,true);assert.deepEqual(refused.deltas,{});
  const stagesWithAcquisition=stages();stagesWithAcquisition.S4={status:'blocked',reason:'acquisition-proposal-projection-unavailable'};
  assert.equal(classify(stagesWithAcquisition).outcome,'acquisition-unavailable');
  const counts=metrics([row('a'),row('b','not-placeable',['agreement-vote']),row('c','acquisition-unavailable',['missing-vote'])]);
  assert.equal(counts.eligible,2);assert.equal(counts.total,3);assert.equal(counts.votes.total,2);assert.equal(counts.uniqueReasons.reduce((sum,r)=>sum+r.count,0),3);
});

test('transient failures are never cached and overlong Retry-After aborts without waiting',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-bench-transient-'));
  try {
    const url=apiBase+'/api/amendments?offset=0';
    for(const fetcher of [async()=>{throw new Error('network');},async()=>new Response('bad',{status:500}),async()=>new Response('busy',{status:503,headers:{'Retry-After':'61'}})]) {
      const cache=new InputCache(directory,{apiBase,fetchMissing:true,sleep:async()=>{},fetcher});
      await assert.rejects(()=>cache.get(url),/not cached/);assert.equal(cache.manifest().length,0);
      const offline=new InputCache(directory,{apiBase});await assert.rejects(()=>offline.get(url),/input-not-cached/);
    }
    assert.equal(apiOrigin(apiBase+'/'),apiBase);assert.throws(()=>apiOrigin('http://explorer.example'),/HTTPS/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

 test('provisional agreement ballots are excluded even when an amendment has other placeable decisions',()=>{
  assert.equal(placeableDecision({reference:'Provisional agreement'}),false);
  assert.equal(placeableDecision({reference:'Paragraph 1'}),true);
  assert.equal(placeableDecision({reference:null}),true);
});

test('shared endpoint orchestration preserves baseline guards and conflicting-evidence precedence',()=>{
  const chosen={...wording('Paragraph 1','First paragraph.'),baseline:'present-text',targetLabelLanguage:'en'};
  assert.equal(documentContextPlacement({chosen}).reason,'amends_existing_law');
  assert.equal(documentContextPlacement({chosen:{...chosen,baseline:'council-position'}}).reason,'council_position_unavailable');
  assert.equal(documentContextPlacement({chosen,referenceTexts:['Paragraph 1','Paragraph 2']}).reason,'conflicting_target_evidence');
  assert.notEqual(documentContextPlacement({chosen:{...chosen,baseline:'motion-resolution'},referenceTexts:['Compromise amendment','Joint statement']}).reason,'conflicting_target_evidence','unparsed references are provenance, not location evidence');
  assert.equal(documentContextPlacement({chosen:null,referenceTexts:['one','two']}).reason,'conflicting_target_evidence');
  assert.equal(documentContextPlacement({chosen,includeBody:false}),null);
  assert.equal(documentContextPlacement({amendmentRequested:false}),null);
});

test('all observed live projection versions must match checkout constants for baseline comparisons',()=>{
 const code={documentContextVersion:6,proposalParserVersion:'5',documentExtractionVersion:9};
 const make=(context=6,parser='5',extraction=9)=>[{acquisition:{contextVersions:[context],projectionVersions:[{proposalParsers:[parser],documentExtraction:extraction}]}}];
 assert.equal(projectionCompatibility(make(),code).compatible,true);
 for(const rows of [make(5),make(6,'4'),make(6,'5',8)])assert.equal(projectionCompatibility(rows,code).compatible,false);
 assert.equal(projectionCompatibility([],code).compatible,false);
});


test('placement-only mode compares rows across wrapper versions, fails false placements, and refuses producer/projection changes',()=>{
  const wrap=rows=>({sample:{},snapshotId:'frozen',inputs:[{url:'unused',sha256:'hash'}],code:{producerFingerprint:{schemaVersion:2,sha256:'same',files:{producer:'same'}}},compatibility:{compatible:false,mismatches:[{kind:'document-context',observed:5,expected:6}]},rows,metrics:metrics(rows)});
  const baseline=wrap([row('am-1')]),candidate=wrap([row('am-1','false-placement')]);
  candidate.compatibility.mismatches[0].expected=7;
  assert.equal(compareBaseline(candidate,baseline).refused,true);
  const diff=compareBaseline(candidate,baseline,{placementOnly:true});
  assert.equal(diff.scope,'placement-only-frozen-projections');assert.equal(diff.failed,true);
  assert.deepEqual(diff.regressions.map(r=>[r.id,r.before,r.after]),[['am-1','correct','false-placement']]);
  const self=compareBaseline(baseline,baseline,{placementOnly:true});assert.equal(self.failed,false);assert.deepEqual(self.regressions,[]);
  assert(Object.values(self.deltas).every(delta=>delta===0));
  const changed=structuredClone(candidate);changed.code.producerFingerprint.files.producer='changed';
  assert.equal(compareBaseline(changed,baseline,{placementOnly:true}).refused,true);
  const projection=structuredClone(candidate);projection.compatibility.mismatches.push({kind:'proposal-parser',observed:'5',expected:'6'});
  assert.equal(compareBaseline(projection,baseline,{placementOnly:true}).refused,true);
  assert.equal(compareBaseline({...candidate,compatibility:{compatible:false,mismatches:[]}},baseline,{placementOnly:true}).refused,true);
  assert.throws(()=>compareBaseline({...candidate,inputs:[]},baseline,{placementOnly:true}),/hashes differ/);
  assert.equal(options(['--placement-only']).placementOnly,true);
});

test('producer fingerprints include transitive extraction helpers and locked dependencies, excluding placement consumers',async()=>{
  const files={'server/amendment-documents.mjs':"import './docx-numbering.mjs';",'server/docx-numbering.mjs':'numbering-v1','package-lock.json':'lock-v1'};
  const read=async file=>Buffer.from(files[file]||'');
  const before=await producerFingerprint(read);
  assert(Object.hasOwn(before.files,'server/document-context.mjs'));assert(!Object.hasOwn(before.files,'server/proposal-placement.mjs'));
  files['server/docx-numbering.mjs']='changed-without-version-bump';
  assert.notEqual((await producerFingerprint(read)).sha256,before.sha256);
  files['server/docx-numbering.mjs']='numbering-v1';files['package-lock.json']='lock-v2';
  assert.notEqual((await producerFingerprint(read)).sha256,before.sha256);
});

test('cached-source CLI reports correct-to-false regression despite live wrapper incompatibility',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'amendment-bench-placement-gate-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const inputs=path.join(directory,'inputs');await mkdir(inputs);
  const document='B-10-2026-0001',id=document+'-AM-1',listId=document+'-AM-001-001',url='https://data.europarl.europa.eu/distribution/test/insert.docx';
  const cell=value=>'<w:tc>'+paragraph(value)+'</w:tc>',tr=(a,b)=>'<w:tr>'+cell(a)+cell(b)+'</w:tr>';
  const body=docx('<w:document xmlns:w="urn:word"><w:body>'+paragraph('<Amend><Date>1.10.2026</Date><NumAm>1</NumAm>')+paragraph('<Article>Paragraph 3 c (new)</Article>')+'<w:tbl>'+tr('Motion for a resolution','Amendment')+tr('','New paragraph.')+'</w:tbl>'+paragraph('</Amend>')+'</w:body></w:document>');
  const indexed={id,targetDocumentId:document,number:1,listId,language:'en',wordingSource:{url},decisions:[{id:'decision-1',date:'2026-10-22',sittingId:'MTG-PL-2026-10-22',amendmentIds:[id],source:{url:'https://data.europarl.europa.eu/api/v2/example',fetchedAt:'2026-10-23T00:00:00Z'}}]};
  const query=new URLSearchParams({limit:'50',offset:'0',lang:'en',document});
  const context={version:5,documentId:document,document:{selectedText:source(['The European Parliament,','3. Three.','4. Four.','3b. Misordered.','5. Five.','ANNEX'])}};
  const rawUrl='https://data.europarl.europa.eu/distribution/test/body-gate.docx';
  const rawBody=docx('<w:document xmlns:w="urn:word"><w:body>'+context.document.selectedText.paragraphs.map(paragraph).join('')+'</w:body></w:document>');
  const rawWork={id:'eli/dl/doc/'+document,identifier:document,work_type:'def/ep-document-types/RESOLUTION_MOTION',is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'http://publications.europa.eu/resource/authority/file-type/DOCX',is_exemplified_by:rawUrl}]}]};
  for(const [input,value] of [[rawUrl,rawBody],['https://data.europarl.europa.eu/api/v2/plenary-documents/'+document+'?format=application%2Fld%2Bjson',{data:[rawWork]}],[apiBase+'/api/amendments?'+query,{total:1,offset:0,limit:50,coverage:{servingGeneration:5},items:[indexed]}],[url,body],[contextUrl(apiBase,document,'en'),context],[contextUrl(apiBase,document,'en',indexed,indexed),context]]) {
    const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
    await writeFile(path.join(inputs,digest(input)+'.body'),bytes);
    await writeFile(path.join(inputs,digest(input)+'.json'),JSON.stringify({url:input,fetchedAt:'2026-10-27T00:00:00Z',status:200,ok:true,bytes:bytes.length,sha256:digest(bytes),error:null}));
  }
  await writeFile(path.join(directory,'snapshot.json'),JSON.stringify({schemaVersion:3,apiBase,asOf:'2026-10-27'}));
  const args=['scripts/amendment-benchmark.mjs','--api-base',apiBase,'--cache-dir',directory,'--document',document,'--placement-only'];
  const run=async extra=>{
    try {await execFileAsync(t,process.execPath,[...args,...extra],{cwd:fileURLToPath(new URL('../',import.meta.url)),maxBuffer:2*1024*1024});assert.fail('false placement must fail the CLI');}
    catch(error){assert.equal(error.code,1,error.stderr);assert(error.stdout,error.stderr);return JSON.parse(error.stdout);}
  };
  const first=await run([]),baseline=JSON.parse(await readFile(first.jsonPath,'utf8'));
  assert.equal(baseline.rows[0].outcome,'false-placement');
  baseline.rows[0].outcome='correct';baseline.rows[0].reason='oracle-verified';baseline.metrics=metrics(baseline.rows);
  const baselinePath=path.join(directory,'baseline.json');await writeFile(baselinePath,JSON.stringify(baseline));
  const result=await run(['--baseline',baselinePath]);
  assert.equal(result.scope,'full-pipeline-cached-sources');assert.equal(result.acquisition.requests,0);
  assert.equal(result.comparison.failed,true);assert.equal(result.comparison.refused,undefined);
  assert.deepEqual(result.comparison.regressions.map(row=>[row.id,row.before,row.after]),[[id,'correct','false-placement']]);
});


test('independent raw extent oracle rejects insertions after a bold subheading and both closing-separator shapes',()=>{
  for(const {targetLabel,rows,formats,badAfter} of [
    {targetLabel:'Paragraph 216 a (new)',rows:['216. Last paragraph.','European Development Funds (EDF)','217. Next paragraph.','ANNEX'],formats:{1:{marks:[{kind:'bold',start:0,end:32}]}},badAfter:2},
    {targetLabel:'Paragraph 132 a (new)',rows:['132. Last paragraph.','°','°\t°','133. Forwarding instruction.','ANNEX'],formats:{},badAfter:3},
    {targetLabel:'Paragraph 132 b (new)',rows:['132. Last paragraph.','°','°\t°','133. Forwarding instruction.','ANNEX'],formats:{},badAfter:3},
  ]) {
    const text=source(['The European Parliament,',...rows]);text.paragraphFormats=text.paragraphs.map((_,i)=>formats[i-1]||{});
    const amendment={...wording(targetLabel),baseline:'motion-resolution'};
    const placement={status:'placed',operation:'insert',insertAfter:badAfter,insertBefore:badAfter+1,evidence:[]};
    const checked=verifyPlacement({placement,wording:amendment,text});
    assert.equal(checked.status,'failed',targetLabel);assert.equal(checked.reason,'oracle-insertion-boundary-mismatch');
    assert.equal(verifyPlacement({placement:{...placement,insertAfter:1,insertBefore:2},wording:amendment,text}).status,'verified');
  }
});

test('raw extent oracle includes continuation rows, stops at section headings and withholds uncertain extents',()=>{
  const amendment={...wording('Paragraph 1 a (new)'),baseline:'motion-resolution'};
  const placement={status:'placed',operation:'insert',insertAfter:2,insertBefore:3,evidence:[]};
  for(const boundary of ['SECTION II','ANNEX I','EXPLANATORY STATEMENT']) {
    const text=source(['The European Parliament,','1. Opening paragraph;','continued wording;',boundary,'2. Another section.']);
    assert.equal(verifyPlacement({placement,wording:amendment,text}).status,'verified');
  }
  const multi=source(['The European Parliament,','2. Earlier decision.','ANNEX','The European Parliament,','1. Opening paragraph;','continued wording;','SECTION II','2. Another section.']);
  assert.equal(verifyPlacement({placement:{...placement,insertAfter:5,insertBefore:6},wording:amendment,text:multi}).status,'verified');
  const uncertain=source(['The European Parliament,','1. Opening paragraph;','Unformatted title','2. Next.','ANNEX']);
  assert.equal(verifyPlacement({placement,wording:amendment,text:uncertain}).status,'unverified');
  const missing=source(['The European Parliament,','1. Opening paragraph;','continuation;']);
  assert.equal(verifyPlacement({placement,wording:amendment,text:missing}).status,'unverified');
  const replace={...amendment,targetLabel:'Paragraph 1',originalText:'Opening paragraph;\nSECTION II'};
  const span={status:'placed',operation:'replace',span:{start:1,end:2}};
  const text=source(['The European Parliament,','1. Opening paragraph;','SECTION II','2. Another section.']);
  assert.equal(verifyPlacement({placement:span,wording:replace,text}).reason,'oracle-address-span-mismatch');
});

test('producer guard refuses empty-projection wrapper probe and source-selection changes, allowing version/consumer-only changes',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const read=file=>readFile(path.join(root,file));
  const before=await producerFingerprint(read);
  for(const file of ['server/document-context.mjs','server/proposal-baseline.mjs','server/commission-proposal-identity.mjs','server/cellar-documents.mjs'])assert(Object.hasOwn(before.files,file),file);
  assert(!Object.hasOwn(before.files,'server/proposal-matching.mjs'));
  const edited=transform=>producerFingerprint(async file=>transform(file,(await read(file)).toString()));
  const version=await edited((file,text)=>file==='server/document-context.mjs'?text.replace(/DOCUMENT_CONTEXT_VERSION=\d+/,'DOCUMENT_CONTEXT_VERSION=7'):text);
  assert.deepEqual(version,before,'only the wrapper version literal is waived');
  const empty=await edited((file,text)=>{
    if(file!=='server/document-context.mjs')return text;
    const changed=text.replace('baseline,proposal,documentId:query.id','baseline,proposal:{items:[]},documentId:query.id').replace(/DOCUMENT_CONTEXT_VERSION=\d+/,'DOCUMENT_CONTEXT_VERSION=7');
    assert.notEqual(changed,text);assert(changed.includes('proposal:{items:[]}'));return changed;
  });
  const wrap=fingerprint=>({sample:{},snapshotId:'same-inputs',inputs:[],code:{producerFingerprint:fingerprint},compatibility:{compatible:false,mismatches:[{kind:'document-context',observed:5,expected:7}]},rows:[row('unchanged')],metrics:metrics([row('unchanged')])});
  const refused=compareBaseline(wrap(empty),wrap(before),{placementOnly:true});
  assert.equal(refused.refused,true);assert.equal(refused.failed,true);assert.match(refused.reason,/producers changed/);
  for(const changedFile of ['server/proposal-baseline.mjs','server/commission-proposal-identity.mjs','server/cellar-documents.mjs']) {
    const selected=await edited((file,text)=>file===changedFile?text+'\n// changed producer\n':text);
    assert.equal(compareBaseline(wrap(selected),wrap(before),{placementOnly:true}).refused,true,changedFile);
  }
  for(const consumer of ['server/proposal-matching.mjs','server/document-context-model.mjs','server/document-context-placement.mjs'])
    assert.deepEqual(await edited((file,text)=>file===consumer?text+'\n// changed consumer\n':text),before,consumer);
});
