import {documentFileEdition} from './document-file-edition.mjs';
import {DOCX_EXTRACTION_VERSION} from './docx-source-structure.mjs';
import {DOCX_FORMATTING_VERSION} from './docx-formatting.mjs';
import {createHash} from 'node:crypto';
import {documentText,documentTextCapacity,DOCUMENT_TEXT_VERSION,allowedDownload} from './document-text.mjs';
import {documentBodyHints} from './document-body-hints.mjs';
import {array,documentFiles,tail} from './activity-index-model.mjs';
import {sourceMissing,missingSourceDelay,transientSourceDelay,confirmSourceRejection,SOURCE_RECHECK_MS} from './source-retry.mjs';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {runWithRequestSignal} from './request-budget.mjs';

const parserVersion=[DOCUMENT_TEXT_VERSION,DOCX_EXTRACTION_VERSION,DOCX_FORMATTING_VERSION].join(':');
export const bodyDiscoverySql=`SELECT source_key,date,source_id,mep,category FROM items
 WHERE generation=? AND (date,source_id,mep,category)<(?,?,?,?)
 ORDER BY date DESC,source_id DESC,mep DESC,category DESC LIMIT 8`;
export const bodyUndatedDiscoverySql=`SELECT source_key,date,source_id,mep,category FROM items
 WHERE generation=? AND date IS NULL AND (source_id,mep,category)<(?,?,?)
 ORDER BY source_id DESC,mep DESC,category DESC LIMIT 8`;
export const bodyDueSql='SELECT * FROM document_body_jobs WHERE next_check<=? ORDER BY priority DESC,next_check LIMIT 1';
export function prepareDocumentBodies(store){
  store.assertWriter();store.db.exec(`CREATE TABLE IF NOT EXISTS document_body_jobs (
    key TEXT PRIMARY KEY,source_key TEXT,id TEXT,language TEXT,edition TEXT,priority INTEGER,
    next_check INTEGER DEFAULT 0,attempts INTEGER DEFAULT 0,rejection TEXT,error TEXT,state TEXT);
    CREATE INDEX IF NOT EXISTS document_body_due ON document_body_jobs(next_check,priority DESC);
    CREATE INDEX IF NOT EXISTS document_body_discovery ON items(generation,date DESC,source_id DESC,mep DESC,category DESC);`);
  store.set('documentBodySchema',1);
}
const generation=store=>store.get('working')?.generation||store.get('active')||0;
const scope=(key,work)=>/^\/(plenary-documents|adopted-texts|parliamentary-questions|committee-documents)\//.test(key)&&
  (/-10-/.test(work.identifier||tail(work.id))||key.startsWith('/committee-documents/')&&(array(work.parliamentary_term).map(tail).includes('10')||!work.parliamentary_term&&String(work.document_date||'')>='2024-07-16'));
export class DocumentBodyCollector {
  constructor(store,{read=documentText,hints=documentBodyHints,directory=process.env.ODP_CACHE_DIR,capacity=documentTextCapacity}={}){Object.assign(this,{store,read,hints,directory,capacity});}
  discovery(){return `${generation(this.store)}:${new Date(this.store.clock()).toISOString().slice(0,10)}:${parserVersion}`;}
  due(){return Boolean(this.directory&&(this.store.get('documentBodySchema')!==1||this.hints.size||this.store.get('documentBodyDiscovery')!==this.discovery()||this.store.db.prepare('SELECT 1 FROM document_body_jobs WHERE next_check<=? LIMIT 1').get(this.store.clock())));}
  enqueue(sourceKey,work,priority=0,language=null){
    if(!scope(sourceKey,work))return;
    for(const selected of [work,...array(work.inverse_answers_to)]){
      const id=selected.identifier||tail(selected.id);
      const files=documentFiles(selected).filter(file=>file.format==='DOCX'&&allowedDownload(file.url));
      for(const file of files){
        if(language&&file.language!==language)continue;
        const edition=JSON.stringify([{...file,...documentFileEdition(array(selected.is_realized_by).flatMap(expression=>array(expression.is_embodied_by)).find(manifestation=>manifestation.is_exemplified_by===file.url))},parserVersion]);
        const key=createHash('sha256').update(JSON.stringify([id,file.language,file.url])).digest('hex');
        this.store.db.prepare(`INSERT INTO document_body_jobs(key,source_key,id,language,edition,priority) VALUES (?,?,?,?,?,?)
          ON CONFLICT(key) DO UPDATE SET source_key=excluded.source_key,priority=MAX(priority,excluded.priority),
          next_check=CASE WHEN edition<>excluded.edition OR (excluded.priority>=1000000000 AND state='retained') THEN 0 ELSE next_check END,
          attempts=CASE WHEN edition<>excluded.edition THEN 0 ELSE attempts END,
          rejection=CASE WHEN edition<>excluded.edition THEN NULL ELSE rejection END,state=CASE WHEN edition<>excluded.edition THEN NULL ELSE state END,edition=excluded.edition`).run(key,sourceKey,id,file.language,edition,priority);
      }
    }
  }
  admit(){
    const store=this.store,gen=generation(store);
    for(const hint of this.hints.drain()){
      // Exact source lookup; answers belong to their question's metadata.
      const id=hint.id.replace(/-ASW$/,''),row=store.db.prepare("SELECT key,body FROM sources WHERE generation=? AND kind='document' AND json_extract(body,'$.identifier')=? LIMIT 1").get(gen,id);
      if(row)this.enqueue(row.key,JSON.parse(row.body),1000000000,hint.language);
    }
    if(store.get('documentBodyDiscovery')===this.discovery())return;
    const cursor=store.get('documentBodyCursor'),position=cursor?.discovery===this.discovery()?cursor.position:['9999','\uffff','\uffff','\uffff'];
    const undated=position[0]===null;
    const rows=undated?store.db.prepare(bodyUndatedDiscoverySql).all(gen,...position.slice(1)):store.db.prepare(bodyDiscoverySql).all(gen,...position);
    for(const row of rows){
      const source=store.source(gen,row.source_key);
      if(!source)continue;
      const current=Boolean(store.db.prepare('SELECT 1 FROM members WHERE id=?').get(row.mep));
      this.enqueue(row.source_key,source.work,(current?100000000:0)+Number(String(row.date||'').replaceAll('-','')));
    }
    if(rows.length<8){
      if(!undated)store.set('documentBodyCursor',{discovery:this.discovery(),position:[null,'\uffff','\uffff','\uffff']});
      else {store.set('documentBodyDiscovery',this.discovery());store.set('documentBodyCursor',null);}
    }
    else {const last=rows.at(-1);store.set('documentBodyCursor',{discovery:this.discovery(),position:[last.date,last.source_id,last.mep,last.category]});}
  }
  async step(worker,{requestBudget=Infinity}={}){
    if(!this.directory)return false;
    const store=this.store;store.assertWriter();this.admit();await yieldTurn();worker.controller.signal.throwIfAborted();
    const now=store.clock();
    const previous=store.get('documentBodyCapacity');
    const capacity=await this.capacity(this.directory,{reconcile:previous?.state==='capacity'&&now-previous.checkedAt>=60000});
    const speculative=capacity.bytes+(capacity.reservationBytes||0)>capacity.highWaterBytes;
    store.set('documentBodyCapacity',{...capacity,state:speculative?'capacity':'collecting',checkedAt:previous?.state==='capacity'&&now-previous.checkedAt<60000?previous.checkedAt:now});
    const job=store.db.prepare(bodyDueSql).get(now);
    if(!job||requestBudget<1||speculative&&job.priority<1000000000||capacity.maxBytes-capacity.bytes<(capacity.reservationBytes||1)||worker.requests>=worker.budget||worker.monotonic()>=worker.runDeadline)return false;
    const source=store.source(generation(store),job.source_key)?.work;
    const work=job.id.endsWith('-ASW')?array(source?.inverse_answers_to).find(answer=>(answer.identifier||tail(answer.id))===job.id):source;
    if(!work){store.db.prepare('DELETE FROM document_body_jobs WHERE key=?').run(job.key);return true;}
    try{
      worker.requests++;
      const result=await runWithRequestSignal(worker.controller.signal,()=>this.read(work,job.language,{directory:this.directory,collector:true,collectorPdfOnly:['pdf-pending','pdf-retry'].includes(job.state),requestBudget,enqueue:false,clock:store.clock,selectedFile:JSON.parse(job.edition)[0]}));
      if(result.status!=='available')throw Object.assign(new Error(result.reason||'Document text unavailable.'),{code:'source_parser_rejection'});
      worker.controller.signal.throwIfAborted();store.assertWriter();
      store.db.prepare("UPDATE document_body_jobs SET next_check=?,attempts=0,rejection=NULL,error=NULL,state='retained' WHERE key=?").run(now+7*86400000,job.key);
    }catch(error){
      if(worker.controller.signal.aborted)throw error;
      store.assertWriter();
      if(error.code==='document_body_pdf_pending'){store.db.prepare("UPDATE document_body_jobs SET state='pdf-pending',next_check=0 WHERE key=?").run(job.key);return true;}
      const {rejection,confirmed}=confirmSourceRejection(job.rejection?JSON.parse(job.rejection):null,error,{descriptor:job.edition,parserVersion,now});
      const delay=error.code==='document_text_capacity'?3600000:confirmed?SOURCE_RECHECK_MS:sourceMissing(error)?missingSourceDelay(job.attempts):transientSourceDelay(job.attempts);
      store.db.prepare('UPDATE document_body_jobs SET next_check=?,attempts=attempts+1,rejection=?,error=?,state=? WHERE key=?').run(now+Math.max(delay,(error.retryAfter||0)*1000),rejection?JSON.stringify(rejection):null,String(error.message).slice(0,250),confirmed?'permanent-source-issue':error.code==='document_text_capacity'?'capacity':['pdf-pending','pdf-retry'].includes(job.state)?'pdf-retry':'transient',job.key);
    }
    return true;
  }
}
