import {unthrottledUpstream} from './test-support/upstream.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {projectDocument,documentFiles,AMENDMENT_LINKS_VERSION} from './activity-index-model.mjs';
import {AMENDMENTS_VERSION,AMENDMENT_SITTING_PROJECTION_VERSION,AMENDMENT_DISTRIBUTION_PROOF_VERSION,distributionEvidenceFor} from './amendments.mjs';
import {AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';
import {amendmentsPage,enqueueAmendment,saveAmendmentRows} from './amendments-store.mjs';
import {failAmendmentTask,rebuildAmendmentTarget} from './amendments-worker.mjs';
import {motionSourceKey} from './motion-outcomes.mjs';

const target='A-10-2026-0254',sitting='MTG-PL-2026-10-07',date='2026-10-02';
const list1=target+'-AM-001-001',list2=target+'-AM-001-002';
const url=(id,language)=>'https://data.europarl.europa.eu/distribution/example/'+id+'_'+language+'.docx';
const detail=id=>'https://data.europarl.europa.eu/api/v2/documents/'+id+'?format=application%2Fld%2Bjson';
const paragraph=value=>'<w:p><w:r><w:t>'+value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</w:t></w:r></w:p>';
function comparison({label='Article 1',original='Original',proposed='Proposal',language='en',gridLoss=false}={}) {
  const row=values=>'<w:tr>'+values.map(value=>'<w:tc>'+paragraph(value)+'</w:tc>').join('')+'</w:tr>';
  const xml='<w:document xmlns:w="urn:word"><w:body>'+paragraph('<Amend><Date>2.10.2026</Date><NumAm>1</NumAm>')+paragraph('<Members>Alex Common</Members>')+(label?paragraph('<Article>'+label+'</Article>'):'')+
    '<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/>'+(gridLoss?'<w:gridCol/>':'')+'</w:tblGrid>'+row(['Text proposed by the Commission',language==='fr'?'Amendement':'Amendment'])+row([original,proposed])+'</w:tbl>'+paragraph('</Amend>')+'</w:body></w:document>';
  const name=Buffer.from('word/document.xml'),body=Buffer.from(xml),compressed=deflateRawSync(body),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);
  return Buffer.concat([local,name,compressed,central,name,end]);
}
function fixture(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-provenance-'));let now=Date.parse('2026-10-17T08:00:00Z');
  const store=new ActivityStore(directory,{clock:()=>now});assert(store.acquire());const {generation}=store.beginCycle();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const worker=new ActivityWorker(store,{runUpstream:unthrottledUpstream,clock:()=>now,fetchRecord:async()=>{throw Error('Unexpected upstream request in provenance fixture.');}});
  const at=()=>new Date(now).toISOString();
  store.putSource(generation,'/plenary-documents/'+target,'document',{id:'eli/dl/doc/'+target,identifier:target,amendmentLinksVersion:AMENDMENT_LINKS_VERSION,work_type:'def/ep-document-types/REPORT_PLENARY',document_date:date,inverse_foresees_change_of:[],inverse_based_on_a_realization_of:['eli/dl/event/'+sitting+'-VOT-ITM-123']},at());
  store.putSource(generation,'amendment:roster:'+date,'amendment-roster',{members:[{id:'101',givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+date,fetchedAt:at()}]},at());
  const decisionSource={url:'https://data.europarl.europa.eu/api/v2/meetings/'+sitting+'/decisions?offset=0&format=application%2Fld%2Bjson',fetchedAt:at()};
  const vote={id:'eli/dl/event/'+sitting+'-DEC-1',decided_on_a_realization_of:['eli/dl/doc/'+target+'-AM-1'],decision_outcome:'def/ep-statuses/ADOPTED',referenceText:{en:'Paragraph 1, English vote reference'},source:decisionSource};
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',{amendmentVersion:AMENDMENTS_VERSION,amendmentProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION,decisions:[vote],splitRequests:[],parsedSplits:[],sources:[decisionSource]},at());
  function metadata(id,language) {
    const raw={id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/AMENDMENT_LIST',document_date:date,foresees_change_of:['eli/dl/doc/'+target],is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/'+(language==='fr'?'FRA':'ENG'),is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:url(id,language)}]}]};
    const old=store.source(generation,'amendment:list:'+id)?.work;
    const work={...projectDocument(raw),targetDocumentId:target,files:documentFiles(raw),distributionEvidence:distributionEvidenceFor(raw,{url:detail(id),fetchedAt:at(),language:null}),...(old?.extraction?{extraction:old.extraction}:{})};
    store.putSource(generation,'amendment:list:'+id,'amendment-list',work,at());return work;
  }
  async function refresh(id,options) {
    now+=1000;assert(store.renew());metadata(id,options.language || 'en');
    const key='provenance:'+id+':'+now;enqueueAmendment(store,generation,key,'amendment-extract',{listId:id,targetDocumentId:target},150);
    const raw=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key),task={...raw,body:JSON.parse(raw.body),amendmentJob:true};
    worker.downloadAmendmentDocx=async actual=>{assert.equal(actual,url(id,options.language || 'en'));return {buffer:comparison(options)};};
    await worker.task(task);return {task,source:{url:url(id,options.language || 'en'),fetchedAt:at(),language:options.language || 'en'}};
  }
  return {store,worker,generation,at,metadata,refresh,decisionSource,vote};
}

test('target labels retain their own language and source through omissions, replacements and conflicting variants',async t=>{
  const {store,refresh}=fixture(t),first=await refresh(list1,{label:'English location',language:'en'});
  await refresh(list1,{label:null,language:'fr',original:'Texte original',proposed:'Texte modifié'});
  let [item]=amendmentsPage(store,{document:target}).items;
  assert.equal(item.language,'fr');assert.equal(item.metadataSource.language,'fr');assert.equal(item.targetLabel,'English location');assert.equal(item.targetLabelLanguage,'en');assert.deepEqual(item.targetLabelSource,first.source);
  assert.equal(item.topics.find(topic=>topic.basis==='target').language,'en');
  await refresh(list2,{label:'Disposition française',language:'fr',proposed:'Autre proposition'});
  [item]=amendmentsPage(store,{document:target}).items;assert.equal(item.conflicted,true);
  assert.deepEqual(item.variants.map(variant=>[variant.listId,variant.targetLabelLanguage]),[[list1,'en'],[list2,'fr']]);
  assert.deepEqual(item.variants[0].targetLabelSource,first.source);
  const replacement=await refresh(list1,{label:'Nouvelle disposition',language:'fr'});
  [item]=amendmentsPage(store,{document:target}).items;
  const replaced=item.variants.find(variant=>variant.listId===list1);
  assert.equal(replaced.targetLabel,'Nouvelle disposition');assert.equal(replaced.targetLabelLanguage,'fr');assert.deepEqual(replaced.targetLabelSource,replacement.source);
});

test('a fresh target label uses fresh metadata independently of retained wording, and decision fallback stays explicitly English',async t=>{
  const {store,worker,generation,refresh,vote,decisionSource,at}=fixture(t);
  const first=await refresh(list1,{language:'en'});
  const fresh=await refresh(list1,{label:'Nouvelle disposition',language:'fr',gridLoss:true});
  let [item]=amendmentsPage(store,{document:target}).items;
  assert.equal(item.wordingRetained,true);assert.equal(item.wordingSource.language,'en');assert.equal(item.language,'en');assert.deepEqual(item.wordingSource,first.source);
  assert.equal(item.targetLabelLanguage,'fr');assert.deepEqual(item.targetLabelSource,fresh.source);
  // A different list has no documentary target label to retain.
  await refresh(list2,{label:null,language:'fr'});
  [item]=amendmentsPage(store,{document:target}).items;
  assert.equal(item.targetLabel,vote.referenceText.en);assert.equal(item.targetLabelLanguage,'en');assert.deepEqual(item.targetLabelSource,{...decisionSource,language:'en'});
  assert.equal(item.topics.find(topic=>topic.basis==='target').language,'en');
  const unknown={...vote};delete unknown.source;
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',{amendmentVersion:AMENDMENTS_VERSION,amendmentProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION,decisions:[unknown],splitRequests:[],parsedSplits:[],sources:[decisionSource,{...decisionSource,url:decisionSource.url.replace('offset=0','offset=50')}]},at());
  rebuildAmendmentTarget(worker,generation,target);
  [item]=amendmentsPage(store,{document:target}).items;
  assert.equal(item.targetLabelLanguage,'en');assert.equal(item.targetLabelSource,null);
});

test('legacy label language stays unknown without field-specific evidence; explicit und and mul remain unchanged',t=>{
  const {store,generation}=fixture(t),base={id:target+'-AM-1',targetDocumentId:target,number:1,targetLabel:'Unknown label',metadataSource:{url:detail(list1),fetchedAt:'2026-10-01T00:00:00Z',language:'fr'},language:'en',authors:[],decisions:[],splitParts:[],gaps:[]};
  for(const language of [undefined,'und','mul']) {
    const value={...base,...(language?{targetLabelLanguage:language}:{})},raw=JSON.stringify(value);
    store.db.prepare('INSERT OR REPLACE INTO amendments VALUES (?,?,?,?,?,?)').run(generation,value.id,target,date,'unavailable',raw);
    const [item]=amendmentsPage(store,{document:target}).items;
    assert.equal(item.targetLabelLanguage,language ?? null);assert.equal(item.targetLabelSource,null);
    assert.equal(store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,value.id).body,raw);
  }
});

test('legacy label provenance stays unknown on rebuild and retention unless its own evidence was recorded',async t=>{
  for(const conflicted of [false,true])for(const explicit of [false,true]) {
    const {store,worker,generation,metadata,refresh,at}=fixture(t);
    const originalSource={url:url(list1,'en'),fetchedAt:'2026-10-01T00:00:00Z',language:'en'};
    for(const id of conflicted?[list1,list2]:[list1]) {
      const work=metadata(id,'fr');
      const amendment={number:1,date,authors:['Alex Common'],targetLabel:'Earlier English label',originalText:'Original',proposedText:'Proposal',language:'fr',metadataSource:{url:url(id,'fr'),fetchedAt:at(),language:'fr'},gaps:[],...(explicit?{targetLabelLanguage:'en',targetLabelSource:originalSource}:{})};
      store.putSource(generation,'amendment:list:'+id,'amendment-list',{...work,extraction:{amendments:[amendment],gaps:[],parserVersion:'9',language:'fr',sourceUrl:url(id,'fr'),fetchedAt:at()}},at());
    }
    const checked=()=>{
      const [row]=amendmentsPage(store,{document:target}).items,labels=row.variants || [row];
      for(const label of labels){assert.equal(label.targetLabel,'Earlier English label');assert.equal(label.targetLabelLanguage,explicit?'en':null);assert.deepEqual(label.targetLabelSource,explicit?originalSource:null);}
    };
    rebuildAmendmentTarget(worker,generation,target);checked();
    await refresh(list1,{label:null,language:'fr'});checked();
  }
});

test('parser9 grid-loss caches and variants are withheld through pure reads, failed refresh and unsupported current-parser reparse',async t=>{
  assert.equal(AMENDMENT_EXTRACTION_VERSION,'13');
  for(const conflicted of [false,true]) {
    const {store,worker,generation,metadata,refresh,at}=fixture(t),work=metadata(list1,'en');
    const legacy={number:1,date,documentDate:date,dateBasis:'individual-amendment-document',authors:['Alex Common'],targetLabel:'Article 1',originalText:'Proposal fragment A',proposedText:'Proposal fragment B',language:'en',gaps:[]};
    const extraction={amendments:[legacy],gaps:[],parserVersion:'9',language:'en',sourceUrl:url(list1,'en'),fetchedAt:at(),sourceDescriptor:{url:url(list1,'en'),language:'en',byteSize:null}};
    store.putSource(generation,'amendment:list:'+list1,'amendment-list',{...work,extraction},at());
    const author={name:'Alex Common',personId:'101',status:'resolved',method:'exact_full_name_active_mandate',evidence:[]};
    const indexed={...legacy,id:target+'-AM-1',targetDocumentId:target,listId:list1,textParserVersion:'9',textIntegrity:'complete',proposerDate:date,proposerDateBasis:'individual-amendment-document',authors:[author],decisions:[],splitParts:[],sourceFreshness:{version:1,status:'fresh'},gaps:[]};
    const row=conflicted?{...indexed,listId:null,conflicted:true,authors:[],originalText:null,proposedText:null,variants:[indexed]}:indexed;
    const raw=JSON.stringify(row),source=store.db.prepare('SELECT body FROM sources WHERE generation=? AND key=?').get(generation,'amendment:list:'+list1).body;
    store.db.prepare('INSERT INTO amendments VALUES (?,?,?,?,?,?)').run(generation,row.id,target,date,'unavailable',raw);
    const checked=()=>{const page=amendmentsPage(store,{document:target}),item=page.items[0].variants?.[0] || page.items[0];assert.equal(page.coverage.complete,false);assert.equal(item.originalText,null);assert.equal(item.proposedText,null);assert.equal(item.authors[0].personId,'101');assert.equal(item.proposerDate,date);assert.equal(item.proposerDateBasis,'individual-amendment-document');return item;};
    if(conflicted)assert.equal(amendmentsPage(store,{document:target}).items[0].variants.length,1);
    checked();assert.equal(amendmentsPage(store,{document:target,member:'101'}).total,1);
    assert.equal(store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,row.id).body,raw);assert.equal(store.db.prepare('SELECT body FROM sources WHERE generation=? AND key=?').get(generation,'amendment:list:'+list1).body,source);
    const key='grid-migration-failure';enqueueAmendment(store,generation,key,'amendment-extract',{listId:list1,targetDocumentId:target});
    const stored=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key),task={...stored,attempts:2,body:JSON.parse(stored.body),amendmentJob:true};
    worker.downloadAmendmentDocx=async()=>{throw Error('Offline grid migration refresh failed.');};
    await assert.rejects(worker.task(task),/Offline grid migration/);assert.equal(failAmendmentTask(worker,task,Error('Offline grid migration refresh failed.')),true);
    checked();assert.deepEqual(store.source(generation,'amendment:list:'+list1).work.extraction,extraction);
    await refresh(list1,{gridLoss:true});
    const current=store.source(generation,'amendment:list:'+list1).work.extraction;
    assert.equal(current.parserVersion,AMENDMENT_EXTRACTION_VERSION);assert(current.gaps.some(gap=>gap.code==='comparison-grid'));assert.equal(current.amendments[0].wordingRetained,false);
    const [currentRow]=amendmentsPage(store,{document:target}).items;assert.equal(currentRow.originalText,null);assert.equal(currentRow.proposedText,null);assert.equal(currentRow.authors[0].personId,'101');
    await refresh(list1,{original:'',proposed:'Supported insertion'});
    const [safe]=amendmentsPage(store,{document:target}).items;assert.equal(safe.originalText,'');assert.equal(safe.proposedText,'Supported insertion');assert.equal(safe.sourceFreshness.version,AMENDMENT_DISTRIBUTION_PROOF_VERSION);
  }
});

test('conflicted rows withhold every source-specific primary claim while preserving complete variant evidence',t=>{
  const {store,worker,generation,metadata,at,vote,decisionSource}=fixture(t),sources=[];
  for(const [index,id] of [list1,list2].entries()) {
    const language=index?'fr':'en',documentDate=index?'2026-10-03':date,work=metadata(id,language),source={url:url(id,language),language,fetchedAt:at()};sources.push(source);
    const amendment={number:1,date:documentDate,documentDate,dateBasis:'individual-amendment-document',authors:index?[]:['Alex Common'],committeeProposer:index?'Published committee proposer':null,targetLabel:'Article 1',originalText:'Original '+index,proposedText:'Proposal '+index,language,gaps:[]};
    store.putSource(generation,'amendment:list:'+id,'amendment-list',{...work,extraction:{parserVersion:AMENDMENT_EXTRACTION_VERSION,amendments:[amendment],gaps:[],language,sourceUrl:source.url,fetchedAt:source.fetchedAt,sourceDescriptor:{url:source.url,language,byteSize:null}}},at());
  }
  rebuildAmendmentTarget(worker,generation,target);
  const empty=['committeeProposer','onBehalfOf','date','documentDate','listDocumentDate','dateBasis','proposerDate','proposerDateBasis','wordingSource','metadataSource','proposerSource','sourceFreshness','textParserVersion','originalText','proposedText','language'];
  const check=row=>{assert.equal(row.conflicted,true);assert.deepEqual(row.authors,[]);for(const field of empty)assert.equal(row[field],null,field);assert.equal(row.textIntegrity,'unavailable');assert.equal(row.wordingRetained,false);assert.equal(row.proposerRetained,false);assert.equal(row.recordRetained,false);assert.equal(row.targetDocumentDate,date);assert.equal(row.decisions[0].outcome,'ADOPTED');assert.equal(row.variants[0].authors[0].personId,'101');assert.equal(row.variants[0].documentDate,date);assert.equal(row.variants[1].committeeProposer,'Published committee proposer');assert.equal(row.variants[1].documentDate,'2026-10-03');assert.deepEqual(row.variants.map(variant=>variant.metadataSource),sources);};
  const selected=()=>store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,target+'-AM-1').body;
  check(JSON.parse(selected()));check(amendmentsPage(store,{document:target}).items[0]);
  assert.equal(JSON.parse(selected()).targetLabel,vote.referenceText.en);assert.equal(JSON.parse(selected()).targetLabelLanguage,'en');assert.deepEqual(JSON.parse(selected()).targetLabelSource,{...decisionSource,language:'en'});
  const original=JSON.parse(selected()),legacy={...original,authors:[{name:'Arbitrary combined proposer',personId:'303',status:'resolved'}],committeeProposer:'Last variant',targetLabel:'Arbitrary combined provision',targetLabelLanguage:'fr',targetLabelSource:sources[1],date:'2026-10-03',documentDate:'2026-10-03',listDocumentDate:date,dateBasis:'individual-amendment-document',proposerDate:'2026-10-03',proposerDateBasis:'individual-amendment-document',wordingSource:sources[1],metadataSource:sources[1],proposerSource:sources[1],sourceFreshness:original.variants[1].sourceFreshness,textParserVersion:AMENDMENT_EXTRACTION_VERSION,textIntegrity:'complete',wordingRetained:true,proposerRetained:true,recordRetained:true};
  const raw=JSON.stringify(legacy);store.db.prepare('UPDATE amendments SET body=? WHERE generation=? AND id=?').run(raw,generation,legacy.id);
  const sourceRows=store.db.prepare('SELECT key,body,fetched_at FROM sources WHERE generation=? ORDER BY key').all(generation);
  check(amendmentsPage(store,{document:target}).items[0]);assert.equal(amendmentsPage(store,{document:target,member:'303'}).total,0);
  for(const field of ['targetLabel','targetLabelLanguage','targetLabelSource'])assert.equal(amendmentsPage(store,{document:target}).items[0][field],null,field);
  const match=amendmentsPage(store,{document:target,member:'101'});assert.equal(match.total,1);assert.equal(match.items[0].authorMatch.basis,'variant');
  assert.equal(selected(),raw);assert.deepEqual(store.db.prepare('SELECT key,body,fetched_at FROM sources WHERE generation=? ORDER BY key').all(generation),sourceRows);
});

test('a retained target label and its derived topic stay aligned after a store merge and legacy reads',t=>{
  const {store,generation}=fixture(t),source={url:url(list1,'en'),fetchedAt:'2026-10-01T00:00:00Z',language:'en'};
  const targetMetadata={id:target,date,listProjectionVersion:AMENDMENT_LINKS_VERSION},dossier={id:'ENV',label:'ENV',basis:'dossier'};
  const row={id:target+'-AM-1',targetDocumentId:target,number:1,date,documentDate:date,proposerDate:date,proposerDateBasis:'individual-amendment-document',targetLabel:'Article 1',targetLabelLanguage:'en',targetLabelSource:source,authors:[],decisions:[],splitParts:[],topics:[dossier],sources:[source],gaps:[]};
  const topic={id:'target:Article 1',label:'Article 1',basis:'target',language:'en',source};
  saveAmendmentRows(store,generation,targetMetadata,[row],{complete:false,gaps:[]});
  saveAmendmentRows(store,generation,targetMetadata,[{...row,targetLabel:null,targetLabelLanguage:null,targetLabelSource:null,topics:[dossier],metadataSource:{...source,language:'fr'}}],{complete:false,gaps:[]});
  const selected=()=>store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,row.id).body;
  let stored=JSON.parse(selected());assert.equal(stored.targetLabel,'Article 1');assert.deepEqual(stored.topics,[dossier,topic]);
  const raw=JSON.stringify({...stored,topics:[dossier,{id:'target:obsolete',label:'Obsolete label',basis:'target',language:'fr'}]});
  store.db.prepare('UPDATE amendments SET body=? WHERE generation=? AND id=?').run(raw,generation,row.id);
  const served=amendmentsPage(store,{document:target}).items[0];assert.equal(served.targetLabel,'Article 1');assert.deepEqual(served.topics,[dossier,topic]);assert.equal(selected(),raw);
});
