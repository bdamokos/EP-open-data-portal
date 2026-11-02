import {amendmentGeneration} from './amendments-store.mjs';
// The optional lane runs only inside the existing leased source writer.
import {runWithRequestSignal} from './request-budget.mjs';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {runBaseBackfill,backfillContext,retryableBaseSelection} from './base-source-backfill-context.mjs';
import {baseSourceStore,baseSelectionInput,baseSelectionInputKey} from './base-source-store.mjs';
import {odp} from './odp.mjs';
import {downloadDocx,downloadDocxBuffer,allowedDownload,docxParts} from './document-text.mjs';
import {distributionEvidenceFor,sameDocxDescriptor} from './amendments.mjs';
import {amendmentSourceStore} from './amendment-source-store.mjs';
import {proposalBaseline} from './proposal-baseline.mjs';
import {councilPositionBaseline} from './council-position-baseline.mjs';
import {existingLawBaseline} from './existing-law-baseline.mjs';
import {commissionReferences,commissionProcedures} from './commission-proposal-identity.mjs';
import {hasCouncilQuotation} from './report-council-quotation.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const hasWording=row=>['originalText','proposedText'].some(key=>typeof row[key]==='string'&&row[key].trim().length>0);
const exact=id=>/^(?:A|B|RC)-10-\d{4}-\d{4,6}$/.test(id||'');
export function prepareBaseBackfill(store){
  const run=()=>{store.db.exec(`CREATE TABLE IF NOT EXISTS base_backfill_jobs(key TEXT PRIMARY KEY,target TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',retry_at INTEGER NOT NULL DEFAULT 0,reason TEXT);
    CREATE INDEX IF NOT EXISTS base_backfill_list_target ON sources(generation,json_extract(body,'$.targetDocumentId')) WHERE kind='amendment-list';
    CREATE INDEX IF NOT EXISTS base_backfill_due ON base_backfill_jobs(state,retry_at,key);`);store.set('baseBackfillSchema',1);};
  if(store.db.isTransaction)run();else store.transaction(run);
}
export function backfillJobs(list){
  const id=list.targetDocumentId;if(!exact(id))return [];
  const rows=list.extraction?.amendments||[],languages=[...new Set(['en',...rows.filter(hasWording).map(r=>r.language||list.extraction.language)])].filter(l=>/^[a-z]{2}$/.test(l||'')).sort();
  const jobs=[];
  const pointer=row=>{const listId=row?.listId||list.identifier||String(list.id||'').split('/').at(-1);return typeof listId==='string'&&listId.startsWith(id+'-AM-')&&Number.isInteger(row?.number)?{nativeReference:{listId,number:row.number}}:{};};
  for(const language of languages){
    jobs.push({target:id,kind:'document',language});
    if(id.startsWith('A-'))jobs.push({target:id,kind:'proposal',language,reportId:id,...pointer(rows.find(r=>Number.isInteger(r.number)))});
    for(const row of rows){
      const documentReferences=row.documentReferences||[],options={documentReferences};
      if(row.baseline==='present-text'&&row.baselineSource?.conflicted===false)jobs.push({target:id,kind:'law',targetPath:row.targetPath,documentReferences,documentDate:row.documentDate,date:row.date,language});
      if(row.baseline==='council-position'||hasCouncilQuotation(row))jobs.push({target:id,kind:'council',reportId:id,language,...options});
      if(row.baseline==='commission-proposal'){
        const ids=[...new Set(documentReferences.flatMap(r=>commissionReferences(r.raw).map(r=>r.celex)))];
        jobs.push({target:id,kind:'proposal',language,...options,...pointer(row),...(id.startsWith('A-')?{reportId:id}:ids.length===1?{celex:ids[0]}:{})});
      }
    }
  }
  return [...new Map(jobs.map(job=>[JSON.stringify(job),job])).values()];
}
export class BaseSourceBackfill {
  constructor(store,{directory=process.env.ODP_CACHE_DIR,clock=Date.now,read=odp,download=downloadDocx,downloadNative=downloadDocxBuffer,proposal=proposalBaseline,council=councilPositionBaseline,law=existingLawBaseline,retention=directory&&baseSourceStore(directory),log=value=>console.info('[base-source-backfill]',JSON.stringify(value))}={}){
    Object.assign(this,{store,directory,clock,read,download,downloadNative,proposal,council,law,retention,log});this.stopped=false;
  }
  due(){return !this.stopped&&Boolean(this.directory)&&(!this.store.get('baseBackfillListSourcesVersion')||!this.store.get('baseBackfillNativeInputsVersion')||!this.store.get('baseBackfillSeeded')||Boolean(this.store.db.prepare("SELECT 1 FROM base_backfill_jobs WHERE state='pending' AND retry_at<=? LIMIT 1").get(this.clock())));}
  seed(){
    const s=this.store,g=s.get('baseBackfillGeneration')||s.get('baseBackfillListSourcesGeneration')||s.get('active');if(!g)return false;
    const cursor=s.get('baseBackfillCursor')||'',rows=s.db.prepare("SELECT key,body FROM sources WHERE generation=? AND key>? AND key LIKE 'amendment:list:%' ORDER BY key LIMIT 100").all(g,cursor);
    const save=()=>{s.assertWriter();s.set('baseBackfillGeneration',g);for(const row of rows)for(const job of this.jobsForList(g,JSON.parse(row.body))){const body=JSON.stringify(job);s.db.prepare('INSERT OR IGNORE INTO base_backfill_jobs(key,target,body) VALUES (?,?,?)').run(hash(body),job.target,body);}if(rows.length)s.set('baseBackfillCursor',rows.at(-1).key);if(rows.length<100)s.set('baseBackfillSeeded',true);};
    if(s.db.isTransaction)save();else s.transaction(save);this.log(this.status());return rows.length===100;
  }
  jobsForList(g,list){
    if(!exact(list.targetDocumentId))return [];
    const sources=this.store.db.prepare("SELECT key,body FROM sources WHERE generation=? AND kind='amendment-list' AND json_extract(body,'$.targetDocumentId')=?").all(g,list.targetDocumentId);
    const listIds=new Set(sources.map(r=>r.key.slice('amendment:list:'.length))),lists=sources.map(r=>({...JSON.parse(r.body),backfillListId:r.key.slice('amendment:list:'.length)}));
    const indexed=this.store.db.prepare('SELECT body FROM amendments WHERE generation=? AND target=?').all(amendmentGeneration(this.store),list.targetDocumentId).flatMap(r=>{const row=JSON.parse(r.body);return [row,...(row.variants||[])];}).filter(r=>listIds.has(r.listId));
    return backfillJobs({...list,extraction:{amendments:[...lists.flatMap(l=>(l.extraction?.amendments||[]).map(r=>({...r,listId:r.listId||l.backfillListId,language:r.language||l.extraction.language}))),...indexed]}});
  }
  async held({url,accept,language,descriptor}){
    await (this.retention.ready??=this.retention.reconcile());
    for(const {record} of this.retention.records.values())if(record.status===200&&record.url===url&&(!accept||(record.request?.accept===accept||accept==='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'&&record.request?.accept==='application/zip;type=akn4eu'))&&(!language||record.request?.language===language)&&(!descriptor||sameDocxDescriptor(record.descriptor,descriptor)&&(!descriptor.issued||Date.parse(record.fetchedAt)>=Date.parse(descriptor.issued)))){
      const buffer=await readFile(path.join(this.retention.directory,record.sha256+'.blob'));if(buffer.length===record.bytes&&hash(buffer)===record.sha256){this.hits++;return {record,buffer};}
    }
    return null;
  }
  nativePointer(job){
    if(job.nativeReference)return job.nativeReference;
    const generation=this.store.get('active')||this.store.get('baseBackfillGeneration');if(!generation)return null;
    for(const row of this.store.db.prepare("SELECT key,body FROM sources WHERE generation=? AND kind='amendment-list' AND json_extract(body,'$.targetDocumentId')=? ORDER BY key").all(generation,job.reportId)){
      const list=JSON.parse(row.body),amendment=list.extraction?.amendments?.find(r=>Number.isInteger(r.number));
      if(amendment)return {listId:row.key.slice('amendment:list:'.length),number:amendment.number};
    }
    return null;
  }
  async prepareProposal(job,signal){
    if(!job.reportId?.startsWith('A-')||job.nativeReferencePair)return job;
    const pointer=this.nativePointer(job);
    if(!pointer&&!job.documentReferences?.some(r=>commissionProcedures(r.raw).some(p=>p.endsWith('(NLE)'))))return job;
    const array=v=>v==null?[]:Array.isArray(v)?v:[v],id=v=>String(v?.id||v||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
    const read=async(endpoint,wanted)=>{
      const record=await this.read(endpoint,{}, {priority:'background',signal}),work=record.payload?.data?.find(w=>id(w)==='eli/dl/doc/'+wanted);
      if(!work)throw new Error('native-reference-source-unavailable');
      return {work,record,source:{url:record.url,fetchedAt:new Date(record.fetchedAt).toISOString(),stale:Boolean(record.stale),refreshInProgress:Boolean(record.refreshInProgress),refreshError:record.refreshError||null}};
    };
    const root=await read('/plenary-documents/'+job.reportId,job.reportId);
    const nle=[...array(root.work.is_realized_by).flatMap(e=>Object.values(e.title_alternative||{}).flat()),...(job.documentReferences||[]).map(r=>r.raw)].some(raw=>commissionProcedures(raw).some(p=>p.endsWith('(NLE)')));
    if(!nle)return job;
    const unavailable=reason=>({...job,nativeReferencePair:{report:{status:'unresolved',reason},list:{status:'unresolved',reason}}});
    if(!pointer||job.language!=='en')return unavailable('native-reference-selected-amendment-unavailable');
    const linked=array(root.work.inverse_foresees_change_of).filter(v=>id(v)==='eli/dl/doc/'+pointer.listId);
    if(linked.length!==1)return unavailable('native-reference-list-relationship');
    const listRoot=typeof linked[0]==='object'&&linked[0].is_realized_by?{work:linked[0],source:root.source}:await read('/documents/'+pointer.listId,pointer.listId);
    const list=listRoot.work;
    if(id(list)!=='eli/dl/doc/'+pointer.listId||id(list.work_type)!=='def/ep-document-types/AMENDMENT_LIST'||!array(list.foresees_change_of).some(v=>id(v)==='eli/dl/doc/'+job.reportId))return unavailable('native-reference-list-relationship');
    const descriptors=new Map();
    for(const work of [root.work,list])for(const d of distributionEvidenceFor(work).descriptors)if(d.language===job.language)descriptors.set(d.url,{...d,format:'DOCX'});
    const {DocumentContext}=await import('./document-context.mjs');
    const reader=new DocumentContext({download:async url=>{
      const descriptor=descriptors.get(url);if(!descriptor)throw new Error('native-reference-list-declaration');
      const retained=await this.held({url,descriptor});
      if(retained)return {buffer:retained.buffer,fetchedAt:retained.record.fetchedAt,resolvedSourceUrl:retained.record.resolvedSourceUrl||url};
      const cached=await amendmentSourceStore(this.store).read(descriptor);
      if(cached)this.hits++;else if(backfillContext())backfillContext().downloaded=true;
      const value=cached?{...cached,resolvedSourceUrl:url}:await this.downloadNative(url,{priority:'background',signal,expectedByteSize:descriptor.byteSize});
      if(!await this.retention.save({url,resolvedSourceUrl:value.resolvedSourceUrl,status:200,fetchedAt:value.fetchedAt,request:{accept:'*/*',language:job.language},headers:{'content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},descriptor},value.buffer)){
        if(backfillContext())backfillContext().full=true;throw Object.assign(new Error('Base source storage full'),{code:'base_source_full'});
      }
      return value;
    }});
    const files=distributionEvidenceFor(list).descriptors.filter(d=>d.language===job.language&&allowedDownload(d.url));
    if(files.length!==1)return unavailable('native-reference-list-declaration');
    const loaded=await reader.readList(list,files[0],job.reportId),rows=loaded.extraction.amendments.filter(r=>r.number===pointer.number);
    if(rows.length!==1)return unavailable('native-reference-selected-amendment-unavailable');
    const row=rows[0],chosen={...row,listId:pointer.listId,language:job.language,targetLabelLanguage:job.language,source:loaded.source};
    const selections=new Map([[pointer.listId+'|'+job.language,{...loaded,list,file:files[0],metadataSource:listRoot.source}]]);
    const nativeReferencePair=await reader.readNleReferences({id:job.reportId,amendmentId:job.reportId+'-AM-'+pointer.number},chosen,root.work,read,[],selections,root.source);
    return {...job,nativeReferencePair};
  }
  requestInput(job){
    if(job.kind==='proposal')return {reportId:job.reportId,celex:job.celex,language:job.language||'en',documentReferences:job.documentReferences||[],...(job.nativeReferencePair?{nativeReferencePair:job.nativeReferencePair}:{})};
    if(job.kind==='council')return {reportId:job.reportId,language:job.language||'en',documentReferences:job.documentReferences||[]};
    const {kind,target,nativeReference,...input}=job;return input;
  }
  seedListSources(){
    const s=this.store,g=s.get('baseBackfillListSourcesGeneration')||s.get('baseBackfillGeneration')||s.get('active');if(!g)return false;
    const rows=s.db.prepare("SELECT key,body FROM sources WHERE generation=? AND key>? AND key LIKE 'amendment:list:%' ORDER BY key LIMIT 100").all(g,s.get('baseBackfillListSourcesCursor')||'');
    const save=()=>{
      s.assertWriter();s.set('baseBackfillListSourcesGeneration',g);
      for(const row of rows){const list=JSON.parse(row.body),listId=row.key.slice('amendment:list:'.length);
        if(!exact(list.targetDocumentId)||!new RegExp('^'+list.targetDocumentId+'-AM-\\d{1,5}-\\d{1,5}$').test(listId))continue;
        const job={kind:'amendment-list',target:list.targetDocumentId,listId},body=JSON.stringify(job);
        s.db.prepare('INSERT OR IGNORE INTO base_backfill_jobs(key,target,body) VALUES (?,?,?)').run(hash(body),job.target,body);
      }
      if(rows.length)s.set('baseBackfillListSourcesCursor',rows.at(-1).key);
      if(rows.length<100)s.set('baseBackfillListSourcesVersion',1);
    };
    if(s.db.isTransaction)save();else s.transaction(save);
    this.log(this.status());return rows.length===100;
  }
  async collectListSource(job,signal){
    const g=this.store.get('active')||this.store.get('baseBackfillGeneration');
    const saved=this.store.db.prepare("SELECT body FROM sources WHERE generation=? AND key=? AND kind='amendment-list'").get(g,'amendment:list:'+job.listId);
    if(!saved)return {status:'unresolved',gaps:['indexed-list-unavailable']};
    const indexed=JSON.parse(saved.body);
    if(indexed.targetDocumentId!==job.target)return {status:'unresolved',gaps:['list-target-conflict']};
    const rows=[...(indexed.extraction?.amendments||[]).map(r=>({...r,language:r.language||indexed.extraction.language})),...this.store.db.prepare('SELECT body FROM amendments WHERE generation=? AND target=?').all(amendmentGeneration(this.store),job.target).flatMap(r=>{const a=JSON.parse(r.body);return [a,...(a.variants||[])];}).filter(r=>r.listId===job.listId)];
    const wording=new Set(rows.filter(hasWording).map(r=>r.language));
    const root=await this.read('/plenary-documents/'+job.target,{}, {priority:'background',signal});
    const id=v=>String(v?.id||v||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''),array=v=>v==null?[]:Array.isArray(v)?v:[v];
    const base=root.payload?.data?.find(w=>id(w)==='eli/dl/doc/'+job.target);
    if(!base)return {status:'unresolved',gaps:['document-identity-unavailable']};
    const baseLanguages=[...new Set(distributionEvidenceFor(base).descriptors.map(d=>d.language).filter(Boolean))];
    if(!baseLanguages.length||baseLanguages.some(l=>wording.has(l)))return {status:'available'};
    const expanded=array(base.inverse_foresees_change_of).filter(l=>id(l)==='eli/dl/doc/'+job.listId&&l.is_realized_by);
    const record=expanded.length===1?{payload:{data:expanded}}:await this.read('/documents/'+job.listId,{}, {priority:'background',signal});
    const list=record.payload?.data?.find(w=>id(w)==='eli/dl/doc/'+job.listId);
    if(!list||id(list.work_type)!=='def/ep-document-types/AMENDMENT_LIST'||!array(list.foresees_change_of).some(v=>id(v)==='eli/dl/doc/'+job.target))return {status:'unresolved',gaps:['list-target-conflict']};
    const descriptors=distributionEvidenceFor(list).descriptors.filter(d=>allowedDownload(d.url)),language=baseLanguages.find(l=>descriptors.some(d=>d.language===l));
    if(!language)return {status:'unresolved',gaps:['shared-list-language-unavailable']};
    const files=descriptors.filter(d=>d.language===language);
    if(files.length!==1)return {status:'unresolved',gaps:['ambiguous-list-distribution']};
    const descriptor=files[0],sources=amendmentSourceStore(this.store);
    if(await sources.read(descriptor)){this.hits++;return {status:'available'};}
    const retained=await this.held({url:descriptor.url,descriptor});
    let value;
    if(retained)value={buffer:retained.buffer,fetchedAt:retained.record.fetchedAt};
    else{if(backfillContext())backfillContext().downloaded=true;value=await this.downloadNative(descriptor.url,{priority:'background',signal,expectedByteSize:descriptor.byteSize});}
    try{docxParts(value.buffer);}catch(error){throw Object.assign(error,{code:'invalid_docx'});}
    if(!await sources.save(descriptor,value.buffer,value.fetchedAt,{listId:job.listId,signal})){
      if(backfillContext())backfillContext().full=true;throw Object.assign(new Error('Amendment source storage full'),{code:'base_source_full'});
    }
    return {status:'available'};
  }
  async collect(job,signal){
    if(job.kind==='amendment-list')return this.collectListSource(job,signal);
    if(job.kind!=='document'){
      if(job.kind==='proposal')job=await this.prepareProposal(job,signal);
      const input=this.requestInput(job),inputKey=baseSelectionInputKey(baseSelectionInput(input));
      await (this.retention.ready??=this.retention.reconcile());
      const selections=[...this.retention.records.values()].map(v=>v.record).filter(r=>r.selection?.type==={proposal:'proposal',council:'council',law:'existing-law'}[job.kind]&&baseSelectionInputKey(r.selection.input)===inputKey);
      const decisions=[];
      for(const record of selections){
        const buffer=await readFile(path.join(this.retention.directory,record.sha256+'.blob'));
        if(hash(buffer)!==record.sha256)throw new Error('retained-selection-hash');
        decisions.push(JSON.parse(buffer));
      }
      for(const a of decisions)for(const b of decisions){
        if(a.workId&&b.workId&&a.workId!==b.workId||a.celex&&b.celex&&a.celex!==b.celex)return {status:'unresolved',gaps:['conflicting-retained-selection']};
        for(const x of a.items||[])for(const y of b.items||[])if(x.itemId===y.itemId&&['expressionId','manifestationId'].some(k=>x[k]&&y[k]&&x[k]!==y[k])||x.kind&&x.kind===y.kind&&Number.isInteger(x.index)&&x.index===y.index&&x.itemId!==y.itemId)return {status:'unresolved',gaps:['conflicting-retained-selection']};
      }
      decisions.sort((a,b)=>Number(b.status==='available')-Number(a.status==='available'));

      if(decisions.length){
        const selected=decisions[0];
        if(!['available','partial'].includes(selected.status)&&!retryableBaseSelection(selected))return selected;
        if(backfillContext())backfillContext().selection=selected;
      }
      if(job.kind==='proposal'&&!job.reportId&&!job.celex)return {status:'unresolved',gaps:['proposal-identity-unavailable']};
      return this[job.kind==='proposal'?'proposal':job.kind==='council'?'council':'law'](input);
    }
    const result=await this.read('/plenary-documents/'+job.target,{}, {priority:'background',signal});
    const work=result.payload?.data?.find(w=>w.id==='eli/dl/doc/'+job.target||w.id==='https://data.europarl.europa.eu/eli/dl/doc/'+job.target);
    if(!work)return {status:'unresolved',gaps:['document-identity-unavailable']};
    const files=distributionEvidenceFor(work).descriptors.filter(f=>f.language===job.language);
    if(files.length!==1)return {status:'unresolved',gaps:[files.length?'ambiguous-docx-distribution':'language-unavailable']};
    const descriptor=files[0];
    if(await this.held({url:descriptor.url,descriptor}))return {status:'available'};
    const held=await amendmentSourceStore(this.store).read(descriptor);
    if(held){
      this.hits++;
      if(!await this.retention.save({url:descriptor.url,status:200,fetchedAt:held.fetchedAt,request:{accept:'*/*',language:descriptor.language},headers:{'content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},descriptor:{...descriptor,format:'DOCX',sourceId:job.target}},held.buffer)){
        if(backfillContext())backfillContext().full=true;
        throw Object.assign(new Error('Base source storage full'),{code:'base_source_full'});
      }
      return {status:'available'};
    }
    await this.download(descriptor.url,{priority:'background',signal,expectedByteSize:descriptor.byteSize,directory:this.directory,retainedDescriptor:{...descriptor,format:'DOCX',sourceId:job.target}});return {status:'available'};
  }
  async step(signal){
    this.store.assertWriter();
    if(!this.store.get('baseBackfillListSourcesVersion')){if(this.seedListSources())return true;if(!this.store.get('baseBackfillListSourcesVersion'))return false;}
    if(!this.store.get('baseBackfillNativeInputsVersion')){
      const recovered=this.store.db.prepare("UPDATE base_backfill_jobs SET state='pending',retry_at=0,reason=NULL WHERE key IN (SELECT key FROM base_backfill_jobs WHERE state='unresolved' AND (reason LIKE '%native-nle-%' OR reason LIKE '%ambiguous-retained-selection%') LIMIT 100)").run().changes;
      if(recovered===100){this.log(this.status());return true;}
      this.store.set('baseBackfillNativeInputsVersion',1);
    }
    if(!this.store.get('baseBackfillSeeded')){if(this.seed())return true;if(!this.store.get('baseBackfillSeeded'))return false;}
    const row=this.store.db.prepare("SELECT * FROM base_backfill_jobs WHERE state='pending' AND retry_at<=? ORDER BY retry_at,key LIMIT 1").get(this.clock());if(!row)return false;
    // Discovery is local and must not spend its first turn on a full disk scan.
    if(!this.retention.reconciled){this.log(this.status('inventory'));await (this.retention.ready??=this.retention.reconcile());}
    const context={held:query=>this.held(query),hit:()=>this.hits++,full:false};this.hits=0;let state='done',reason=null,retry=0;
    try{
      const result=await runBaseBackfill(context,()=>runWithRequestSignal(signal,()=>this.collect(JSON.parse(row.body),signal)));
      if(result.status!=='available'){
        reason=JSON.stringify(result.gaps||[result.status]);
        const transient=retryableBaseSelection(result);
        state=transient?'pending':'unresolved';if(transient)retry=this.clock()+300_000;
      }else if(this.hits&&!context.downloaded)state='skipped-held';
    }catch(error){reason=error.code||error.message;state=/invalid|unsupported|404|410|format|exceeds|size does not match|Unapproved/.test(reason)?'failed':'pending';retry=Math.max(this.clock()+300_000,error.retryAt||0,this.clock()+Number(error.retryAfter||0)*1000);}
    if(context.full){this.stopped=true;this.store.set('baseBackfillStop','storage-full');this.log(this.status());return false;}
    this.store.assertWriter();this.store.db.prepare('UPDATE base_backfill_jobs SET state=?,retry_at=?,reason=? WHERE key=?').run(state,retry,reason,row.key);
    this.store.set('baseBackfillStop',null);this.log(this.status());return true;
  }
  status(phase){
    const counts={total:0,done:0,'skipped-held':0,unresolved:0,failed:0,pending:0};
    for(const row of this.store.db.prepare(`SELECT state,COUNT(*) n FROM (SELECT target,CASE WHEN SUM(state='pending')>0 THEN 'pending' WHEN SUM(state='failed')>0 THEN 'failed' WHEN SUM(state='unresolved')>0 THEN 'unresolved' WHEN SUM(state='done')>0 THEN 'done' ELSE 'skipped-held' END state FROM base_backfill_jobs GROUP BY target) GROUP BY state`).all()){counts[row.state]=row.n;counts.total+=row.n;}
    const amendmentSources=this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='amendment_sources'").get()?this.store.db.prepare('SELECT COUNT(*) AS files,COALESCE(SUM(size),0) AS bytes FROM (SELECT sha256,MAX(size) size FROM amendment_sources GROUP BY sha256)').get():{files:0,bytes:0};
    return {phase:phase||(!this.store.get('baseBackfillListSourcesVersion')?'list-discovery':!this.store.get('baseBackfillNativeInputsVersion')?'recovery':!this.store.get('baseBackfillSeeded')?'base-discovery':counts.pending?'acquisition':'complete'),discovery:{listGeneration:this.store.get('baseBackfillListSourcesGeneration')??null,listCursor:this.store.get('baseBackfillListSourcesCursor')??null,baseGeneration:this.store.get('baseBackfillGeneration')??null,baseCursor:this.store.get('baseBackfillCursor')??null},targets:counts,amendmentSources,stop:this.stopped?'storage-full':null,bytes:this.retention.reconciled?[...this.retention.blobs.values()].reduce((n,b)=>n+b.bytes,0):null,diskBytes:this.retention.reconciled?this.retention.totalBytes:null,files:this.retention.reconciled?this.retention.blobs.size:null,bindings:this.retention.reconciled?this.retention.records.size:null};
  }
}
