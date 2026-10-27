import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reportCouncilReference,resolveCouncilTree,councilCandidatesSparql,createCouncilPositionBaseline} from './council-position-baseline.mjs';
import {parsePublicLegalXhtml} from './public-legal-xhtml.mjs';
import {parseTargetLabel,proposalCandidates} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {documentContextPlacement} from './document-context-placement.mjs';
import {CellarDocuments,cellarTransportUrl} from './cellar-documents.mjs';
import {OfficialContextSources} from './official-context.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/council-position-excerpts.json',import.meta.url),'utf8'));
const metadata=readFileSync(new URL('./fixtures/council-position-metadata.rdf',import.meta.url),'utf8');
const options={language:'en',sourceUrl:fixture.sourceUrl,coverage:fixture.coverage,identity:{celex:fixture.celex}};
const identity={celex:fixture.celex,language:'en',alias:'http://publications.europa.eu/resource/consil/ST_17037_2025_REV_1',procedure:'2023/0226(COD)'};
const reportId='A-10-2026-0175',references=[{field:'DocRef',raw:'(17037/1/2025 – C10-0102/2026 – 2023/0226(COD))'}];
const report={id:'eli/dl/doc/'+reportId,work_type:'def/ep-document-types/REPORT_PLENARY',inverse_created_a_realization_of:['eli/dl/proc/2023-0226']};
const candidates=p=>proposalCandidates(p,parseTargetLabel('Article 30 – paragraph 3 – point b','en'));
test('Council identity requires an exact report, ST revision and matching COD relationship',()=>{
  const r=reportCouncilReference(report,{reportId,documentReferences:references});assert.equal(r.status,'resolved');assert.equal(r.alias,identity.alias);
  assert.equal(reportCouncilReference(report,{reportId,documentReferences:[]}).status,'unresolved');
  assert.equal(reportCouncilReference(report,{reportId,documentReferences:[...references,{field:'DocRef',raw:'17037/2/2025'}]}).status,'unresolved');
  assert.equal(reportCouncilReference({...report,inverse_created_a_realization_of:['eli/dl/proc/2023-0271']},{reportId,documentReferences:references}).status,'unresolved');
  assert.match(councilCandidatesSparql(r),/resource-type\/POSIT/);assert.match(councilCandidatesSparql(r),/2023\/0226\/COD/);
});
test('recorded Council RDF selects the normative English XHTML item and excludes reasons, wrong revisions and translations',()=>{
  const result=resolveCouncilTree(metadata,identity);assert.equal(result.status,'resolved');assert.equal(result.items[0].itemId,fixture.sourceUrl.replace('https:','http:'));
  for(const [from,to] of [['/POSIT','/STAT_REASON'],['/CONSIL','/COM'],['ST_17037_2025_REV_1','ST_17037_2025_INIT'],['2023_226','2023_271'],['_ADP_R1_POS_byCONSIL','_STAT_REASON']])assert.notEqual(resolveCouncilTree(metadata.replaceAll(from,to),identity).status,'resolved');
  assert.equal(resolveCouncilTree(metadata,{...identity,language:'hu'}).status,'language-unavailable');
  assert.throws(()=>resolveCouncilTree(metadata,{...identity,celex:'52026AG0006(02)'}));
  assert.equal(cellarTransportUrl('https://publications.europa.eu/resource/celex/52026AG0006%2801%29'),'https://publications.europa.eu/resource/celex/52026AG0006%2801%29');
  assert.throws(()=>cellarTransportUrl('https://publications.europa.eu/resource/celex/52026AG0006(01)'));
});
test('real OJ XHTML preserves paragraph, point, title, recital and annex boundaries without treating list tables as grids',()=>{
  const p=parsePublicLegalXhtml(fixture.xhtml,options),point=candidates(p)[0];assert.equal(candidates(p).length,1);assert.equal(point.kind,'point');assert(point.complete);
  assert.match(p.paragraphs[point.extent.start].text,/^\(b\) arrangements for the licensing/);
  const target=proposalCandidates(p,parseTargetLabel('Article 30 – paragraph 3','en'))[0];assert.equal(target.children.filter(c=>c.kind==='point').length,3);
  assert.equal(p.sourceKind,'xhtml');assert(p.gaps.some(g=>g.code==='excerpted-source'));
  const items=[{kind:'act',index:1,proposal:p}],place=targetLabel=>resolveProposalPlacement(items,{targetLabel,language:'en',originalText:'',proposedText:'New text'});
  const insertion=place('Annex II – point 2 a (new)');assert.equal(insertion.status,'placed');assert.equal(p.paragraphs[insertion.insertAfter].text,'(2) Production of a\u00a0known insecticidal substance');
  const title=proposalCandidates(p,parseTargetLabel('Article 30 – title','en'))[0];assert.equal(p.paragraphs[title.extent.start].text,'Code of conduct');
  const quote=p.units.flatMap(function visit(u){return [u,...u.children.flatMap(visit)];}).find(u=>u.kind==='article'&&u.label?.value==='37');const nested=quote.children.flatMap(function visit(u){return [u,...u.children.flatMap(visit)];}).filter(u=>u.scope==='quoted');assert(nested.length>0);assert(nested.every(u=>u.instructionPath));
});
test('unsupported objects and tables withhold affected passages without suppressing another complete provision',()=>{
  const xml=fixture.xhtml.replace('standard licence agreements;','standard <img src="formula.tif"/> licence agreements;');
  const p=parsePublicLegalXhtml(xml,options),bad=proposalCandidates(p,parseTargetLabel('Article 30 – paragraph 4 – point b','en'))[0];assert.equal(bad.complete,false);assert(candidates(p)[0].complete);assert(p.objects.some(o=>o.status==='unresolved'));
  assert.throws(()=>parsePublicLegalXhtml('<!DOCTYPE html [<!ENTITY x "bad">]>'+fixture.xhtml,options));
});
test('explicit note references and external links retain displayed-text offsets',()=>{
  const p=parsePublicLegalXhtml('<html><body><div id="rct_1"><p>Body <a href="#ntr1">(1)</a> with <a href="https://example.org/act">a link</a>.</p></div><p class="oj-note"><a id="ntr1">(1)</a> Note text.</p></body></html>',options);
  assert.equal(p.notes[0].text,'Note text.');assert.equal(p.paragraphs[0].text,'Body with a link.');assert.equal(p.anchors[0].offset,5);const link=p.links[0];assert.equal(p.paragraphs[0].text.slice(link.start,link.end),'a link');
});
test('Council baseline production uses cached Cellar metadata/content and exact category routing',async()=>{
  let requests=0;
  const fetchSource=async(url,options)=>{requests++;if(url.includes('/sparql?'))return Response.json({results:{bindings:[{work:{value:'http://publications.europa.eu/resource/cellar/94b1ab29-4450-11f1-8095-01aa75ed71a1'},celex:{value:fixture.celex}}]}});if(url.includes('/celex/')){assert.match(url,/%2801%29/);return new Response(metadata,{headers:{'content-type':'application/rdf+xml'}});}assert.equal(options.headers.Accept,'application/xhtml+xml');return new Response(fixture.xhtml,{headers:{'content-type':'application/xhtml+xml'}});};
  const sources=new OfficialContextSources({directory:null,fetchSource}),documents=new CellarDocuments({sources,directory:null});
  const read=createCouncilPositionBaseline({documents,request:async()=>({payload:{data:[report]},url:'https://data.europarl.europa.eu/api/v2/plenary-documents/'+reportId,fetchedAt:Date.now()})});
  const source=await read({reportId,language:'en',documentReferences:references});assert.equal(source.status,'available',JSON.stringify(source.gaps));assert.equal(source.items[0].source.format,'XHTML');
  await read({reportId,language:'en',documentReferences:references});assert.equal(requests,3);
  const p=parsePublicLegalXhtml(source.items[0].buffer,options),chosen={baseline:'council-position',baselineSource:{category:'council-position',conflicted:false},language:'en',targetLabelLanguage:'en',targetLabel:'Article 30 – paragraph 3 – point b',originalText:p.paragraphs[candidates(p)[0].extent.start].text,proposedText:'Changed'};
  assert.equal(documentContextPlacement({chosen,items:[{kind:'act',index:1,proposal:p}]}).status,'placed');
  assert.equal(documentContextPlacement({chosen:{...chosen,baselineSource:{category:'council-position',conflicted:true}},items:[{kind:'act',index:1,proposal:p}]}).reason,'conflicting_baselines');
});
test('a malformed XHTML refresh retains the last valid legal text with an explicit stale gap',async()=>{
  let now=Date.parse('2026-10-27T12:00:00Z'),invalid=false;
  const sources=new OfficialContextSources({directory:null,clock:()=>now,fetchSource:async()=>new Response(invalid?'<html><body><p>Challenge page</p></body></html>':fixture.xhtml,{headers:{'content-type':'application/xhtml+xml'}})});
  const documents=new CellarDocuments({sources,directory:null,clock:()=>now,freshMs:0}),item=resolveCouncilTree(metadata,identity).items[0],options={...item,celex:fixture.celex,language:item.languageUri};
  const accepted=await documents.content(options);now++;invalid=true;
  const retained=await documents.content(options);assert.equal(retained.source.sha256,accepted.source.sha256);assert(retained.buffer.equals(accepted.buffer));assert.equal(retained.source.stale,true);assert.equal(retained.source.refreshError,'cellar_content');
});
