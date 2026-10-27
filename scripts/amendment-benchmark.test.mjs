import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseProposal} from '../server/proposal-structure.mjs';
import {resolveProposalPlacement} from '../server/proposal-placement.mjs';
import {documentContextPlacement} from '../server/document-context-placement.mjs';
import {resolveAmendmentPlacement} from '../server/document-context-model.mjs';
import {classify,verifyPlacement,metrics,compareBaseline,targetPatterns,oracleNormal} from './amendment-benchmark-model.mjs';
import {InputCache,allowedInput,retryDelay,digest,apiOrigin} from './amendment-benchmark-cache.mjs';
import {options,monday,evaluateReport,acquireReport,placeableDecision} from './amendment-benchmark.mjs';

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
  assert.equal(placement.status,'placed');assert.equal(verifyPlacement({placement,wording:amendment,text}).status,'unverified','a styled Roman section heading is not proof of a backwards recital sequence');
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
  assert.equal(documentContextPlacement({chosen,referenceTexts:['one','two']}).reason,'conflicting_target_evidence');
  assert.equal(documentContextPlacement({chosen:null,referenceTexts:['one','two']}).reason,'conflicting_target_evidence');
  assert.equal(documentContextPlacement({chosen,includeBody:false}),null);
  assert.equal(documentContextPlacement({amendmentRequested:false}),null);
});
