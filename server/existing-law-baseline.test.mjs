import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {actCelex,existingLawReference,selectConsolidation,resolveExistingLawTree,createExistingLawBaseline} from './existing-law-baseline.mjs';
import {resolveExistingLawPlacement,existingLawReplacement} from './existing-law-placement.mjs';
import {parsePublicLegalXhtml} from './public-legal-xhtml.mjs';
import {CellarDocuments} from './cellar-documents.mjs';
import {OfficialContextSources} from './official-context.mjs';
import {proposalCandidates,parseTargetLabel} from './proposal-structure.mjs';

const fixtures=JSON.parse(readFileSync(new URL('./fixtures/existing-law-excerpts.json',import.meta.url)));
const cbam=fixtures[0];
const chosen=(f,target)=>({baseline:'present-text',baselineSource:{category:'present-text',conflicted:false},documentDate:'2026-09-09',language:f.language,targetPath:{proposal:[{raw:'Article 1 – paragraph 1 – point 3 b (new)'}],underlying:[{document:f.baseCelex,raw:target}]},documentReferences:[]});
const projection=f=>parsePublicLegalXhtml(f.xhtml,{language:f.language,identity:{celex:f.celex,work:f.workId},sourceUrl:f.sourceUrl,coverage:f.coverage});
const baseline=f=>({status:'available',baseCelex:f.baseCelex,celex:f.celex,workId:f.workId,amendmentDate:'2026-09-09',language:f.language});
test('complete statutory citations identify their exact type, year and number; titles cannot identify an act',()=>{
  for(const [raw,celex]of [['Regulation (EU) 2023/956','32023R0956'],['Regulation (EC) No 1223/2009','32009R1223'],['Decision (EU) 2015/1814','32015D1814'],['Dyrektywa 2007/2/WE','32007L0002'],['Directive 2003/87/EC','32003L0087'],['Regulation (EC) No 1907/2006','32006R1907']])assert.equal(actCelex(raw),celex);
  assert.equal(actCelex('Carbon border adjustment mechanism'),null);
  assert.equal(actCelex('Regulation (EU) 2023/956 and Regulation (EU) 2024/1689'),null);
});
test('the prospective Cosmetics citation remains unavailable even when its wording also matches an earlier version',()=>{
  const options={...chosen(cbam,'Article 15 – paragraph 2'),documentDate:'2026-04-24',targetPath:{underlying:[{document:'Regulation (EC) No 1223/2009',raw:'Article 15 – paragraph 2 – first subparagraph'}]},documentReferences:[{field:'Consolidation',raw:'02009R1223-20260501'}]};
  assert.deepEqual(existingLawReference(options).gaps,['existing-law-prospective-version']);
  assert.deepEqual(existingLawReference({...options,documentReferences:[{raw:'02023R0956-20251020'}]}).gaps,['existing-law-version-conflict']);
  assert.equal(existingLawReference({...options,documentReferences:[],documentDate:null}).status,'unresolved');
});
test('historical selection refuses same-date production ambiguity and later creation dates',()=>{
  const identity=existingLawReference(chosen(cbam,'Article 5 – paragraph 1'));
  const rows=cbam.productionRows;
  assert.equal(selectConsolidation(rows,identity).celex,cbam.celex);
  assert.equal(selectConsolidation(rows,identity).productionVersion,'001');
  const family=rows.find(r=>r.celex?.value===cbam.celex);
  assert.deepEqual(selectConsolidation([...rows,{...family,work:{value:'http://publications.europa.eu/resource/cellar/11111111-1111-1111-1111-111111111111'}}],identity).gaps,['existing-law-production-conflict']);
  assert.deepEqual(selectConsolidation(rows.map(r=>r===family?{...r,created:{value:'2026-10-01'}}:r),identity).gaps,['existing-law-production-after-amendment']);
  assert.deepEqual(selectConsolidation(rows.map(r=>r===family?{...r,expressionVersion:{value:'002'}}:r),identity).gaps,['existing-law-production-conflict']);
});
test('recorded consolidation RDF requires the basic act, date, production work and exact language expression',()=>{
  for(const f of fixtures){const options={...f,language:f.language};const r=resolveExistingLawTree(f.rdf,options);assert.equal(r.status,'resolved',f.name);assert.equal(r.items[0].itemId,f.item.itemId);
    assert.notEqual(resolveExistingLawTree(f.rdf,{...options,baseCelex:'32024R1689'}).status,'resolved');
    assert.notEqual(resolveExistingLawTree(f.rdf,{...options,date:'2025-01-01'}).status,'resolved');
    assert.notEqual(resolveExistingLawTree(f.rdf,{...options,language:'ga'}).status,'resolved');
  }
});
test('consolidation markup retains numbered paragraphs, grid points and subsequent unnumbered subparagraphs',()=>{
  const p=projection(cbam),point=proposalCandidates(p,parseTargetLabel('Article 27 – paragraph 2 – point a','en'))[0];assert(point.complete);assert.match(p.paragraphs[point.extent.start].text,/^\(a\) slightly modifying/);
  assert.equal(proposalCandidates(p,parseTargetLabel('Article 3 – point 15','en')).length,1);
  const msr=projection(fixtures[1]),para=proposalCandidates(msr,parseTargetLabel('Article 1 – paragraph 5 a','en'))[0];assert.match(msr.paragraphs[para.extent.start].text,/^5a\./);
  const ets=projection(fixtures[3]),paragraph=proposalCandidates(ets,parseTargetLabel('Article 10a – paragraph 1','en'))[0];assert(paragraph.children.filter(u=>u.kind==='subparagraph').length>=5);
});
test('the consolidated CBAM binding clause stays outside the final article',()=>{
  const p=projection(cbam),closing=p.units.find(unit=>unit.kind==='body');assert(closing);assert.equal(closing.normative,true);
  assert.deepEqual(p.paragraphs.slice(closing.extent.start,closing.extent.end).map(p=>p.text),['This Regulation shall be binding in its entirety and directly applicable in all Member States.']);
  const article=proposalCandidates(p,parseTargetLabel('Article 30','en'))[0];assert(article.extent.end<=closing.extent.start);assert(closing.complete);
});
test('existing-law placements require exact wording, preserve the published wrapper and reject wrong versions',()=>{
  const p=projection(cbam),target='Article 5 – paragraph 1',unit=proposalCandidates(p,parseTargetLabel(target,'en'))[0],originalText=p.paragraphs[unit.extent.start].text;
  const proposedText='(3b) in Article 5, paragraph 1 is replaced by the following:\n"1. Replacement wording." ;';
  const amendment={...chosen(cbam,target),originalText,proposedText},items=[{kind:'act',index:1,proposal:p}],r=resolveExistingLawPlacement(items,amendment,baseline(cbam));
  assert.equal(r.status,'placed');assert.equal(r.operation,'replace');assert.equal(r.outerOperation,'insert');assert.equal(r.proposedText,'1. Replacement wording.');assert.equal(proposedText.slice(r.proposedRange.start,r.proposedRange.end),r.proposedText);
  assert.equal(r.instruction+ r.proposedText+r.closing,proposedText);
  assert.equal(resolveExistingLawPlacement(items,{...amendment,originalText:originalText.replace('Any importer','Every importer')},baseline(cbam)).status,'unresolved');
  assert.equal(resolveExistingLawPlacement(items,amendment,{...baseline(cbam),baseCelex:'32024R1689'}).status,'unresolved');
  assert.equal(resolveExistingLawPlacement(items,amendment,{...baseline(cbam),status:'partial'}).status,'unresolved');
});
test('a partial Article 8 quotation cannot implement the published whole-article replacement',()=>{
  const p=projection(cbam),unit=proposalCandidates(p,parseTargetLabel('Article 8','en'))[0],originalText=p.paragraphs[unit.extent.end-1].text;
  const r=resolveExistingLawPlacement([{kind:'act',index:1,proposal:p}],{...chosen(cbam,'Article 8'),originalText,proposedText:'(6a) Article 8 is replaced by the following:\n"Replacement."'},baseline(cbam));
  assert.equal(r.reason,'existing-law-instruction-scope-conflict');
});
test('INSPIRE point/article discrepancy stays unresolved, and Polish replacement offsets are exact',()=>{
  const f=fixtures[2],p=projection(f);assert.equal(resolveExistingLawPlacement([{kind:'act',index:1,proposal:p}],{...chosen(f,'Punkt 12'),originalText:'Artykuł 12',proposedText:'6b) art. 12 otrzymuje brzmienie:\n„New text”'},baseline(f)).reason,'existing-law-target-unavailable');
  const text='10a) w art. 17 wprowadza się następujące zmiany:\na) ust. 1 otrzymuje brzmienie:\n1. Nowy tekst.';
  const r=existingLawReplacement(text,'pl');assert.equal(text.slice(r.start,r.end),'1. Nowy tekst.');
});
test('public acquisition reuses Cellar negotiation, cache and exact discovered item identities',async()=>{
  let calls=0;const sources=new OfficialContextSources({directory:null,fetchSource:async url=>{calls++;return url.includes('/sparql?')?Response.json({results:{bindings:cbam.productionRows}}):new Response(url.includes('/celex/')?cbam.rdf:cbam.xhtml,{headers:{'content-type':url.includes('/celex/')?'application/rdf+xml':'application/xhtml+xml'}});}});
  const read=createExistingLawBaseline({documents:new CellarDocuments({sources,directory:null})}),options=chosen(cbam,'Article 5 – paragraph 1');
  const r=await read(options);assert.equal(r.status,'available',JSON.stringify(r.gaps));assert.equal(r.items[0].itemId,cbam.item.itemId);assert.equal(r.celex,cbam.celex);assert.equal(r.selectionBasis,'latest-consolidation-at-amendment-date');
  await read(options);assert.equal(calls,3);
});
