// The optional lane runs only inside the existing leased source writer.
import {runWithRequestSignal} from './request-budget.mjs';
import {CellarDocuments} from './cellar-documents.mjs';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {runBaseBackfill} from './base-source-backfill-context.mjs';
import {baseSourceStore} from './base-source-store.mjs';
import {odp} from './odp.mjs';
import {downloadDocx} from './document-text.mjs';
import {distributionEvidenceFor,sameDocxDescriptor} from './amendments.mjs';
import {amendmentSourceStore} from './amendment-source-store.mjs';
import {proposalBaseline} from './proposal-baseline.mjs';
import {councilPositionBaseline} from './council-position-baseline.mjs';
import {existingLawBaseline} from './existing-law-baseline.mjs';
import {commissionReferences} from './commission-proposal-identity.mjs';
import {hasCouncilQuotation} from './report-council-quotation.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const exact=id=>/^(?:A|B|RC)-10-\d{4}-\d{4,6}$/.test(id||'');
export function prepareBaseBackfill(store){
  const run=()=>{store.db.exec(`CREATE TABLE IF NOT EXISTS base_backfill_jobs(key TEXT PRIMARY KEY,target TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',retry_at INTEGER NOT NULL DEFAULT 0,reason TEXT);
    CREATE INDEX IF NOT EXISTS base_backfill_list_target ON sources(generation,json_extract(body,'$.targetDocumentId')) WHERE kind='amendment-list';
    CREATE INDEX IF NOT EXISTS base_backfill_due ON base_backfill_jobs(state,retry_at,key);`);store.set('baseBackfillSchema',1);};
  if(store.db.isTransaction)run();else store.transaction(run);
}
export function backfillJobs(list){
  const id=list.targetDocumentId;if(!exact(id))return [];
  const rows=list.extraction?.amendments||[],languages=[...new Set(['en',...rows.filter(r=>typeof r.originalText==='string'||typeof r.proposedText==='string').map(r=>r.language||list.extraction.language)])].filter(l=>/^[a-z]{2}$/.test(l||'')).sort();
  const jobs=[];
  for(const language of languages){
    jobs.push({target:id,kind:'document',language});
    if(id.startsWith('A-'))jobs.push({target:id,kind:'proposal',language,reportId:id});
    for(const row of rows){
      const documentReferences=row.documentReferences||[],options={documentReferences};
      if(row.baseline==='present-text'&&row.baselineSource?.conflicted===false)jobs.push({target:id,kind:'law',targetPath:row.targetPath,documentReferences,documentDate:row.documentDate,date:row.date,language});
      if(row.baseline==='council-position'||hasCouncilQuotation(row))jobs.push({target:id,kind:'council',reportId:id,language,...options});
      if(row.baseline==='commission-proposal'){
        const ids=[...new Set(documentReferences.flatMap(r=>commissionReferences(r.raw).map(r=>r.celex)))];
        jobs.push({target:id,kind:'proposal',language,...options,...(id.startsWith('A-')?{reportId:id}:ids.length===1?{celex:ids[0]}:{})});
      }
    }
  }
  return [...new Map(jobs.map(job=>[JSON.stringify(job),job])).values()];
}
export class BaseSourceBackfill {
  constructor(store,{directory=process.env.ODP_CACHE_DIR,clock=Date.now,read=odp,download=downloadDocx,proposal=proposalBaseline,council=councilPositionBaseline,law=existingLawBaseline,retention=directory&&baseSourceStore(directory),log=value=>console.info('[base-source-backfill]',JSON.stringify(value))}={}){
    Object.assign(this,{store,directory,clock,read,download,proposal,council,law,retention,log});this.stopped=false;
  }
  due(){return !this.stopped&&Boolean(this.directory)&&(!this.store.get('baseBackfillSeeded')||Boolean(this.store.db.prepare("SELECT 1 FROM base_backfill_jobs WHERE state='pending' AND retry_at<=? LIMIT 1").get(this.clock())));}
  seed(){
    const s=this.store,g=s.get('baseBackfillGeneration')||s.get('active');if(!g)return false;
    const cursor=s.get('baseBackfillCursor')||'',rows=s.db.prepare("SELECT key,body FROM sources WHERE generation=? AND key>? AND key LIKE 'amendment:list:%' ORDER BY key LIMIT 100").all(g,cursor);
    const save=()=>{s.assertWriter();s.set('baseBackfillGeneration',g);for(const row of rows)for(const job of this.jobsForList(g,JSON.parse(row.body))){const body=JSON.stringify(job);s.db.prepare('INSERT OR IGNORE INTO base_backfill_jobs(key,target,body) VALUES (?,?,?)').run(hash(body),job.target,body);}if(rows.length)s.set('baseBackfillCursor',rows.at(-1).key);if(rows.length<100)s.set('baseBackfillSeeded',true);};
    if(s.db.isTransaction)save();else s.transaction(save);return rows.length===100;
  }
  jobsForList(g,list){
    if(!exact(list.targetDocumentId))return [];
    const lists=this.store.db.prepare("SELECT body FROM sources WHERE generation=? AND kind='amendment-list' AND json_extract(body,'$.targetDocumentId')=?").all(g,list.targetDocumentId).map(r=>JSON.parse(r.body));
    return backfillJobs({...list,extraction:{amendments:lists.flatMap(l=>(l.extraction?.amendments||[]).map(r=>({...r,language:r.language||l.extraction.language})))}});
  }
  async held({url,accept,language,descriptor}){
    await (this.retention.ready??=this.retention.reconcile());
    for(const {record} of this.retention.records.values())if(record.status===200&&record.url===url&&(!accept||(record.request?.accept===accept||accept==='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'&&record.request?.accept==='application/zip;type=akn4eu'))&&(!language||record.request?.language===language)&&(!descriptor||sameDocxDescriptor(record.descriptor,descriptor)&&(!descriptor.issued||Date.parse(record.fetchedAt)>=Date.parse(descriptor.issued)))){
      const buffer=await readFile(path.join(this.retention.directory,record.sha256+'.blob'));if(buffer.length===record.bytes&&hash(buffer)===record.sha256){this.hits++;return {record,buffer};}
    }
    return null;
  }
  async collect(job,signal){
    if(job.kind!=='document'){
      await (this.retention.ready??=this.retention.reconcile());
      const selections=[...this.retention.records.values()].map(v=>v.record).filter(r=>r.selection?.type==={proposal:'proposal',council:'council',law:'existing-law'}[job.kind]&&r.selection.input?.reportId===job.reportId&&job.reportId&&r.selection.input.language===job.language);
      if(selections.length>1)return {status:'unresolved',gaps:['ambiguous-retained-selection']};
      if(selections.length===1){
        const record=selections[0],buffer=await readFile(path.join(this.retention.directory,record.sha256+'.blob'));
        if(hash(buffer)!==record.sha256)throw new Error('retained-selection-hash');
        const selected=JSON.parse(buffer);if(!['available','partial'].includes(selected.status))return selected;
        const documents=new CellarDocuments();
        for(const item of selected.items||[])await documents.content({...item,celex:selected.celex,language:item.languageUri});
        return {...selected,status:selected.gaps?.length?'partial':'available'};
      }
      if(job.kind==='proposal'&&!job.reportId&&!job.celex)return {status:'unresolved',gaps:['proposal-identity-unavailable']};
      return this[job.kind==='proposal'?'proposal':job.kind==='council'?'council':'law'](job);
    }
    const result=await this.read('/plenary-documents/'+job.target,{}, {priority:'background',signal});
    const work=result.payload?.data?.find(w=>w.id==='eli/dl/doc/'+job.target||w.id==='https://data.europarl.europa.eu/eli/dl/doc/'+job.target);
    if(!work)return {status:'unresolved',gaps:['document-identity-unavailable']};
    const files=distributionEvidenceFor(work).descriptors.filter(f=>f.language===job.language);
    if(files.length!==1)return {status:'unresolved',gaps:[files.length?'ambiguous-docx-distribution':'language-unavailable']};
    const descriptor=files[0];
    if(await this.held({url:descriptor.url,descriptor})||await amendmentSourceStore(this.store).read(descriptor)){this.hits++;return {status:'available'};}
    await this.download(descriptor.url,{priority:'background',signal,expectedByteSize:descriptor.byteSize,directory:this.directory,retainedDescriptor:descriptor});return {status:'available'};
  }
  async step(signal){
    this.store.assertWriter();
    await (this.retention.ready??=this.retention.reconcile());
    if(!this.store.get('baseBackfillSeeded')){if(this.seed())return true;if(!this.store.get('baseBackfillSeeded'))return false;}
    const row=this.store.db.prepare("SELECT * FROM base_backfill_jobs WHERE state='pending' AND retry_at<=? ORDER BY retry_at,key LIMIT 1").get(this.clock());if(!row)return false;
    const context={held:query=>this.held(query),hit:()=>this.hits++,full:false};this.hits=0;let state='done',reason=null,retry=0;
    try{
      const result=await runBaseBackfill(context,()=>runWithRequestSignal(signal,()=>this.collect(JSON.parse(row.body),signal)));
      if(result.status!=='available'){
        reason=JSON.stringify(result.gaps||[result.status]);
        const transient=/rate|limited|timeout|cancel|busy|http|source-unavailable|stale|fetch|request|ECONN/i.test(reason);
        state=transient?'pending':'unresolved';if(transient)retry=this.clock()+300_000;
      }else if(this.hits&&!context.downloaded)state='skipped-held';
    }catch(error){reason=error.code||error.message;state=/invalid|unsupported|404|410|format|exceeds|size does not match|Unapproved/.test(reason)?'failed':'pending';retry=Math.max(this.clock()+300_000,error.retryAt||0,this.clock()+Number(error.retryAfter||0)*1000);}
    if(context.full){this.stopped=true;this.store.set('baseBackfillStop','storage-full');this.log(this.status());return false;}
    this.store.assertWriter();this.store.db.prepare('UPDATE base_backfill_jobs SET state=?,retry_at=?,reason=? WHERE key=?').run(state,retry,reason,row.key);
    this.store.set('baseBackfillStop',null);this.log(this.status());return true;
  }
  status(){
    const counts={total:0,done:0,'skipped-held':0,unresolved:0,failed:0,pending:0};
    for(const row of this.store.db.prepare(`SELECT state,COUNT(*) n FROM (SELECT target,CASE WHEN SUM(state='pending')>0 THEN 'pending' WHEN SUM(state='failed')>0 THEN 'failed' WHEN SUM(state='unresolved')>0 THEN 'unresolved' WHEN SUM(state='done')>0 THEN 'done' ELSE 'skipped-held' END state FROM base_backfill_jobs GROUP BY target) GROUP BY state`).all()){counts[row.state]=row.n;counts.total+=row.n;}
    return {targets:counts,stop:this.stopped?'storage-full':null,bytes:[...this.retention.blobs.values()].reduce((n,b)=>n+b.bytes,0),diskBytes:this.retention.totalBytes,files:this.retention.blobs.size,bindings:this.retention.records.size};
  }
}
