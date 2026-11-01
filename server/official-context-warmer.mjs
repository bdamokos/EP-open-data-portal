import {OfficialContextSources,officialSourceUrl,parseProcedurePage,procedureReference} from './official-context.mjs';
import {EurovocCatalog} from './eurovoc.mjs';
import {ProcedureContext} from './procedure-context.mjs';
import {ProcedureProgress} from './procedure-progress.mjs';
import {findReferences} from './legal-reference-text.mjs';
import {integerFromEnvironment} from './config.mjs';
import {drainOfficialHints} from './official-context-hints.mjs';
const DAY=86400_000;
export const CONTEXT_LANGUAGES='bg es cs da de et el en fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv'.split(' ');

// Walk only explicit identifiers and exact reference numbers, including cited
// acts in saved question text. Titles never establish a procedure relationship.
export function contextReferences(work) {
  const ids=new Set(),keys=new Set();
  const visit=value=>{
    if(typeof value==='string') {
      const id=value.match(/^(?:https?:\/\/data\.europarl\.europa\.eu\/)?eli\/dl\/proc\/(\d{4}-\d{4}[A-Z]?)$/)?.[1];
      if(id)ids.add(id);
      for(const ref of findReferences(value))keys.add(ref.key);
    }else if(Array.isArray(value))value.forEach(visit);
    else if(value&&typeof value==='object')Object.values(value).forEach(visit);
  };
  visit(work);return {ids:[...ids],keys:[...keys]};
}
export class OfficialContextWarmer {
  constructor(store,{clock=Date.now,sources=new OfficialContextSources({writable:true}),catalog,context,progress,references,dailyOriginLimit=integerFromEnvironment('OFFICIAL_CONTEXT_DAILY_ORIGIN_LIMIT',2000,1,100000)}={}) {
    Object.assign(this,{store,clock,sources});this.catalog=catalog||new EurovocCatalog(sources);
    this.context=context||new ProcedureContext(sources,this.catalog);this.progress=progress||new ProcedureProgress(sources);
    this.references=references;this.nextAt=0;this.dailyOriginLimit=dailyOriginLimit;
    this.sources.beforeFetch=origin=>this.admitOrigin(origin);
    this.sources.cache.assertWriter=()=>this.store.assertWriter();
    this.catalog.cache&&(this.catalog.cache.assertWriter=()=>this.store.assertWriter());
  }
  admitOrigin(origin) {
    this.store.assertWriter();
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(new Date(this.clock()));
    const key='officialContextOrigin:'+origin,old=this.store.get(key);
    const usage=old?.day===day?old:{day,count:0};
    if(usage.count>=this.dailyOriginLimit)throw Object.assign(new Error('Official context daily origin budget exhausted.'),{retryAfter:86400});
    this.store.set(key,{day,count:usage.count+1});
  }
  due(){return this.clock()>=this.nextAt;}
  initialize() {
    if(this.initialized)return;
    this.store.assertWriter();
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS official_context_jobs(kind TEXT,value TEXT,language TEXT,date TEXT,next_check INTEGER DEFAULT 0,attempts INTEGER DEFAULT 0,PRIMARY KEY(kind,value,language));
      CREATE INDEX IF NOT EXISTS official_context_due ON official_context_jobs(next_check,date DESC);
      CREATE INDEX IF NOT EXISTS official_context_source_date ON sources(generation,COALESCE(json_extract(body,'$.document_date'),json_extract(body,'$.activity_date'),'') DESC,key DESC)`);
    this.initialized=true;
  }
  enqueue(kind,value,language,date='') {
    this.store.assertWriter();
    this.store.db.prepare('INSERT INTO official_context_jobs(kind,value,language,date) VALUES (?,?,?,?) ON CONFLICT(kind,value,language) DO UPDATE SET date=MAX(date,excluded.date)').run(kind,value,language,date);
  }
  procedure(reference,date) {
    this.store.transaction(()=>{for(const language of CONTEXT_LANGUAGES)for(const kind of ['context','events','documents'])this.enqueue(kind,reference,language,date);});
  }
  discover() {
    const generation=this.store.get('active');if(!generation)return;
    let cursor=this.store.get('officialContextCursor');
    if(!cursor||cursor.generation!==generation)cursor={generation,date:'9999',key:'\uffff'};
    if(cursor.complete&&this.clock()-cursor.complete<7*DAY)return;
    if(cursor.complete)cursor={generation,date:'9999',key:'\uffff'};
    const rows=this.store.db.prepare(`SELECT key,body,COALESCE(json_extract(body,'$.document_date'),json_extract(body,'$.activity_date'),'') date FROM sources
      WHERE generation=? AND (COALESCE(json_extract(body,'$.document_date'),json_extract(body,'$.activity_date'),''),key)<(?,?)
      ORDER BY COALESCE(json_extract(body,'$.document_date'),json_extract(body,'$.activity_date'),'') DESC,key DESC LIMIT 50`).all(generation,cursor.date,cursor.key);
    for(const row of rows) {
      const {ids,keys}=contextReferences(JSON.parse(row.body));
      for(const id of ids)this.enqueue('mapping',id,'en',row.date);
      for(const key of keys) {
        if(key.startsWith('procedure:'))this.procedure(key.slice(10),row.date);
        else for(const language of CONTEXT_LANGUAGES)this.enqueue('reference',key,language,row.date);
      }
    }
    const last=rows.at(-1);this.store.set('officialContextCursor',last?{generation,date:last.date,key:last.key}:{...cursor,complete:this.clock()});
  }
  async step(worker) {
    this.initialize();this.store.transaction(()=>this.discover());
    for(const url of drainOfficialHints())try{officialSourceUrl(url);this.enqueue('url',url,'','9999');}catch{/* Reject unsupported hints. */}
    const job=this.store.db.prepare('SELECT * FROM official_context_jobs WHERE next_check<=? ORDER BY (next_check=0) DESC,date DESC,next_check,kind,value,language LIMIT 1').get(this.clock());
    if(!job){this.nextAt=this.clock()+60_000;return false;}
    const {kind,value,language,date}=job,options={priority:'background'};
    try {
      worker.controller.signal.throwIfAborted();
      if(kind==='mapping') {
        let item=(await this.catalog.known([value],language)).get(value);
        if(!item||item.stale)item=(await this.catalog.load([value],language,options)).get(value);
        if(item?.reference)this.procedure(item.reference,date);
      } else if(kind==='context') {
        const result=await this.context.query({reference:value,language},options);
        if(result.topicError)throw new Error('Procedure topics unavailable.');
        const sourceLanguage=language==='fr'?'fr':'en';
        const url='https://oeil.europarl.europa.eu/oeil/'+sourceLanguage+'/procedure-file?'+new URLSearchParams({reference:value});
        const page=await this.sources.get(url,options);
        for(const summary of parseProcedurePage(page.html,value,sourceLanguage).summaries)this.enqueue('url',summary.url,'',date);
      } else if(kind==='events'||kind==='documents') {
        const result=await this.progress.query({reference:value,language,detail:kind},options);
        if(result.fallback?.status==='unavailable')throw new Error('Procedure timeline unavailable.');
      } else if(kind==='url') {
        await this.sources.get(value,options);
        const url=officialSourceUrl(value);
        if(url.pathname.endsWith('/procedure-file')) {
          const reference=url.searchParams.get('reference');
          try {procedureReference(reference);this.procedure(reference,date);}catch(error){if(error?.code!=='invalid_reference')throw error;}
        }
      }
      else if(kind==='reference') {
        const result=await this.references.query({keys:[value],language});
        if(result.references?.some(item=>item.status==='unavailable'))throw new Error('Reference mapping unavailable.');
        for(const item of result.references||[])if(item.procedure)this.procedure(item.procedure,date);
      }
      this.store.assertWriter();worker.controller.signal.throwIfAborted();
      this.store.db.prepare('UPDATE official_context_jobs SET next_check=?,attempts=0 WHERE kind=? AND value=? AND language=?').run(this.clock()+7*DAY,kind,value,language);
    }catch(error) {
      worker.controller.signal.throwIfAborted();this.store.assertWriter();
      const delay=Math.max(60_000*2**Math.min(job.attempts,10),Number(error.retryAfter||0)*1000);
      this.store.db.prepare('UPDATE official_context_jobs SET next_check=?,attempts=attempts+1 WHERE kind=? AND value=? AND language=?').run(this.clock()+delay,kind,value,language);
    }
    this.nextAt=0;return true;
  }
}
