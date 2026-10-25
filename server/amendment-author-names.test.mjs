import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAmendmentAuthorResolver} from './amendment-authors.mjs';
import {memberNameFields,authorNameVariants,resolveParallelAuthors,listAuthorResolver,alternateAuthorDescriptor} from './amendment-author-names.mjs';
const profiles=JSON.parse(readFileSync(new URL('./fixtures/speaker-names-20261017.json',import.meta.url))).examples;
const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-name-variants.json',import.meta.url)));
const date=fixture.sources[0].amendment.documentDate,source={url:fixture.sources[1].url,fetchedAt:fixture.sources[1].fetchedAt,language:'de'};
const member={id:'257155',givenName:'Danilo',familyName:'Della Valle',mandates:[{start:'2024-07-16'}]};
const resolve=createAmendmentAuthorResolver({members:[member],date});
const base={listId:'A-10-2026-0237-AM-005-014',targetDocumentId:'A-10-2026-0237',number:5,documentDate:date};
const local=fixture.sources[0].amendment,latin=fixture.sources[1].amendment;
const bridge=(a=local,b=latin)=>resolveParallelAuthors({authors:resolve(a.authors).map(author=>({...author,nameVariants:authorNameVariants(author,{...source,language:'bg'})})),amendment:a,alternate:b,resolve,source});
test('official Greek and Cyrillic person fields match exactly without transliteration, retaining Latin display',()=>{
 for(const {person} of profiles.slice(0,2)){
  const m={id:person.identifier,...memberNameFields(person),mandates:[{start:'2024-07-16'}]};
  const r=createAmendmentAuthorResolver({members:[m],date});
  const a=r([person.officialGivenName+' '+person.officialFamilyName])[0];
  assert.equal(a.status,'resolved');assert.equal(String(a.personId),person.identifier);assert.equal(a.displayName,person.givenName+' '+person.familyName);
  assert(a.nameVariants.some(v=>v.value===a.name));assert(a.nameVariants.some(v=>v.value===a.displayName));
  assert.equal(r([person.officialGivenName+' Other'])[0].personId,null);
 }
});
test('Amendment 5 preserves its Bulgarian spelling and resolves through its exact German byline',()=>{
 const [a]=bridge();assert.equal(a.personId,257155);assert.equal(a.name,'Данило Дела Вале');assert.equal(a.displayName,'Danilo Della Valle');assert.equal(a.method,'parallel_list_full_name_active_mandate');
 assert.deepEqual(a.nameVariants.map(v=>v.value),['Данило Дела Вале','Danilo Della Valle']);assert.equal(a.evidence.at(-1).source.url,source.url);
});
test('different list, amendment, target, date or unresolved counterpart cannot establish a crosswalk',()=>{
 for(const patch of [{listId:'other'},{number:6},{targetDocumentId:'other'},{documentDate:'2026-09-29'},{documentDate:null},{authors:['Danilo Dela Vale']},{authors:['Danilo Della Valle','Other']}])assert.equal(bridge(local,{...latin,...patch})[0].personId,null);
});
test('never assign multi-author names by their order',()=>{
 const two={...local,authors:['Δανίλο','Κάποιος']},other={...latin,authors:['Danilo Della Valle','Other Person']};assert(bridge(two,other).every(a=>a.personId===null));
});
test('a stored single-author crosswalk can resolve the same spelling elsewhere in this list and date',()=>{
 const r=listAuthorResolver({extraction:{amendments:[local]},alternate:{amendments:[latin]},resolve,date,source});
 const [a]=r(['Данило Дела Вале']);assert.equal(a.personId,257155);assert.equal(a.name,'Данило Дела Вале');assert.equal(a.evidence.at(-1).listId,base.listId);
 const other=listAuthorResolver({extraction:{amendments:[local]},alternate:{amendments:[latin]},resolve,date:'2026-10-01',source});assert.equal(other(['Данило Дела Вале'])[0].personId,null);
});
test('native-script homonyms with active mandates remain ambiguous',()=>{
 const person=profiles[0].person,fields=memberNameFields(person),r=createAmendmentAuthorResolver({members:[{id:1,...fields,mandates:[{start:'2024-07-16'}]},{id:2,...fields,mandates:[{start:'2024-07-16'}]}],date});assert.equal(r([fields.officialGivenName+' '+fields.officialFamilyName])[0].status,'ambiguous');
});
test('supplemental source selection uses one explicitly published Latin edition, without changing wording',()=>{
 const extraction={sourceUrl:'bg',amendments:[local]},list={distributionEvidence:{descriptors:[{url:'bg',language:'bg'},{url:source.url,language:'de'},{url:'it',language:'it'}]}};
 assert.equal(alternateAuthorDescriptor(list,extraction).url,source.url);assert.equal(extraction.sourceUrl,'bg');assert.equal(alternateAuthorDescriptor(list,{amendments:[latin]}),null);assert.equal(alternateAuthorDescriptor({},extraction),null);
});

test('the index stores the source spelling, Latin name, exact ID and both byline sources',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const {ActivityStore}=await import('./activity-index-store.mjs'),{ActivityWorker}=await import('./activity-index-worker.mjs');
 const {rebuildAmendmentTarget}=await import('./amendments-worker.mjs'),{amendmentsPage}=await import('./amendments-store.mjs');
 const {AMENDMENT_LINKS_VERSION}=await import('./activity-index-model.mjs'),{AMENDMENT_EXTRACTION_VERSION}=await import('./amendment-documents.mjs');
 const {AMENDMENT_DISTRIBUTION_PROOF_VERSION}=await import('./amendments.mjs');
 const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-name-store-')),now=Date.parse(source.fetchedAt),store=new ActivityStore(directory,{clock:()=>now});
 assert(store.acquire());const {generation}=store.beginCycle();t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
 const worker=new ActivityWorker(store,{clock:()=>now,fetchRecord:async()=>{throw Error('No page-read acquisition');}});
 const primary=fixture.sources[0],descriptor={url:primary.url,language:'bg',byteSize:null},other={url:source.url,language:'de',byteSize:null};
 const list={id:'eli/dl/doc/'+base.listId,identifier:base.listId,targetDocumentId:base.targetDocumentId,work_type:'def/ep-document-types/AMENDMENT_LIST',document_date:date,foresees_change_of:['eli/dl/doc/'+base.targetDocumentId],amendmentDistributionDeclared:true,
  is_realized_by:[['BUL',descriptor],['DEU',other]].map(([language,file])=>({language:'http://publications.europa.eu/resource/authority/language/'+language,is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:file.url}]})),
  distributionEvidence:{version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,state:'available',descriptors:[descriptor,other]},
  extraction:{parserVersion:AMENDMENT_EXTRACTION_VERSION,authorNamesVersion:1,sourceUrl:primary.url,fetchedAt:primary.fetchedAt,sourceDescriptor:descriptor,language:'bg',amendments:[local],gaps:[]},
  authorNames:{version:1,parserVersion:AMENDMENT_EXTRACTION_VERSION,primaryDescriptor:descriptor,descriptor:other,source,amendments:[latin]}};
 store.putSource(generation,'/plenary-documents/'+base.targetDocumentId,'document',{id:'eli/dl/doc/'+base.targetDocumentId,identifier:base.targetDocumentId,amendmentLinksVersion:AMENDMENT_LINKS_VERSION,work_type:'def/ep-document-types/REPORT_PLENARY',inverse_foresees_change_of:[list]},source.fetchedAt);
 store.putSource(generation,'amendment:list:'+base.listId,'amendment-list',list,source.fetchedAt);
 store.putSource(generation,'amendment:roster:'+date,'amendment-roster',{nameVersion:1,members:[member]},source.fetchedAt);
 rebuildAmendmentTarget(worker,generation,base.targetDocumentId);
 const [row]=amendmentsPage(store,{document:base.targetDocumentId}).items;
 assert.equal(row.authors[0].personId,'257155');assert.equal(row.authors[0].name,'Данило Дела Вале');assert.equal(row.authors[0].displayName,'Danilo Della Valle');assert(row.authors[0].nameVariants.some(n=>n.value==='Данило Дела Вале'&&n.source.url===primary.url));
 const saved=store.source(generation,'amendment:list:'+base.listId).work;assert.equal(saved.authorNames.source.url,source.url);assert.equal(saved.extraction.amendments[0].authors[0],'Данило Дела Вале');
 // A fresh conflicting counterpart clears a previously accepted derived link.
 const conflicting=store.source(generation,'amendment:list:'+base.listId).work;conflicting.authorNames.amendments=[{...latin,authors:['Danilo Della Valle','Other author']}];store.putSource(generation,'amendment:list:'+base.listId,'amendment-list',conflicting,source.fetchedAt);
 rebuildAmendmentTarget(worker,generation,base.targetDocumentId);const [conflicted]=amendmentsPage(store,{document:base.targetDocumentId}).items;assert.equal(conflicted.authors[0].personId,null);assert.equal(conflicted.authors[0].status,'ambiguous');
 conflicting.authorNames.amendments=[latin];store.putSource(generation,'amendment:list:'+base.listId,'amendment-list',conflicting,source.fetchedAt);rebuildAmendmentTarget(worker,generation,base.targetDocumentId);
 // A missing counterpart retains the accepted source-backed link as explicitly stale evidence.
 saved.distributionEvidence.descriptors=[descriptor,{...other,url:other.url.replace('_de','_it')}];store.putSource(generation,'amendment:list:'+base.listId,'amendment-list',saved,source.fetchedAt);
 // Also change the expanded observation, so detail reconciliation cannot restore the old descriptor.
 const target=store.source(generation,'/plenary-documents/'+base.targetDocumentId).work;target.inverse_foresees_change_of=[];store.putSource(generation,'/plenary-documents/'+base.targetDocumentId,'document',target,source.fetchedAt);
 rebuildAmendmentTarget(worker,generation,base.targetDocumentId);const [unresolved]=amendmentsPage(store,{document:base.targetDocumentId}).items;assert.equal(unresolved.authors[0].personId,'257155');assert.equal(unresolved.authors[0].latestResolution.personId,null);assert(unresolved.retainedComponents.includes('author identity'));assert.equal(unresolved.authors[0].name,'Данило Дела Вале');
});
