import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {amendmentsPage,amendmentById,amendmentReadProjectionSql,amendmentReadVersion} from '../server/amendments-store.mjs';
import {amendmentQuery} from '../server/amendments.mjs';
import {DocumentContext,documentContextQuery} from '../server/document-context.mjs';
import {replayRuntime,replaySourceClients} from './amendment-benchmark-replay.mjs';
import {digest} from './amendment-benchmark-cache.mjs';

// The supplied file is attached read-only and immutable. Only the compact proof
// flags are rebuilt in memory; all other views hide unpublished generations,
// including from legacy MAX(generation) fallbacks.
export class RetainedProjections {
  constructor(filename) {
    const db=new DatabaseSync(':memory:');
    try {
      db.prepare('ATTACH DATABASE ? AS retained').run(pathToFileURL(filename).href+'?mode=ro&immutable=1');
      const meta=Object.fromEntries(db.prepare('SELECT key,value FROM retained.meta').all().map(row=>[row.key,JSON.parse(row.value)]));
      const active=meta.active;
      if(!Number.isSafeInteger(active)||active<=0)throw new Error('Published generation unavailable');
      db.exec('PRAGMA temp_store=MEMORY');
      // FTS virtual tables and their reserved shadow tables are unrelated to
      // these serving paths and cannot be exposed as ordinary TEMP views.
      for(const {name} of db.prepare("PRAGMA retained.table_list").all().filter(table=>table.type==='table'&&!table.name.startsWith('sqlite_'))) {
        if(name==='amendment_read_flags')continue;
        const quoted='"'+name.replaceAll('"','""')+'"';
        const scoped=db.prepare('PRAGMA retained.table_info('+quoted+')').all().some(col=>col.name==='generation');
        db.exec('CREATE TEMP VIEW '+quoted+' AS SELECT * FROM retained.'+quoted+(scoped?' WHERE generation='+active:''));
      }
      // Derive current flags from published rows before advertising readiness.
      // No wording/source bodies or database-sized duplicate are materialized.
      db.exec('CREATE TABLE amendment_read_flags AS '+amendmentReadProjectionSql);
      db.exec('CREATE INDEX amendment_read_scope ON amendment_read_flags(generation,target,wording,proposer,splits,freshness)');
      db.exec('PRAGMA query_only=ON');
      this.db={isTransaction:true,prepare:sql=>{
        if(!/^\s*(SELECT|WITH)\b/i.test(sql))throw new Error('Retained projections are SELECT-only');
        const statement=db.prepare(sql);
        return {all:(...args)=>statement.all(...args),get:(...args)=>statement.get(...args)};
      }};
      this.close=()=>db.close();
      this.generation=active;
      this.meta={...meta,working:null,active,amendmentSnapshotGeneration:active,amendmentReadVersion};
      this.readSnapshot=operation=>operation();
    } catch(error) {db.close();throw error;}
  }
  get(key){return this.meta[key];}
  sourceMetadata(generation,key){
    if(generation!==this.generation)return null;
    const row=this.db.prepare('SELECT body,fetched_at FROM sources WHERE generation=? AND key=?').get(generation,key);
    return row?{work:JSON.parse(row.body),fetchedAt:row.fetched_at}:null;
  }
  observation(url,value,sourceFetchedAt=null) {
    const body=Buffer.from(JSON.stringify(value));
    return {url,status:null,ok:true,fetchedAt:null,bytes:body.length,sha256:digest(body),error:null,headers:{},localProjection:{representation:'retained-index-projection',generation:this.generation,sourceFetchedAt},body};
  }
  async getProjection(url,cache) {
    const u=new URL(url);
    if(u.origin==='https://data.europarl.europa.eu'&&u.pathname.startsWith('/api/v2/')) {
      const row=this.sourceMetadata(this.generation,u.pathname.slice('/api/v2'.length));
      return row?this.observation(url,{data:[row.work]},row.fetchedAt):null;
    }
    if(u.pathname==='/api/amendments')return this.observation(url,amendmentsPage(this,amendmentQuery(u.searchParams)));
    if(u.pathname.startsWith('/api/document-context/')) {
      const runtime=await replayRuntime(fileURLToPath(new URL('../',import.meta.url)));
      const request=async endpoint=>{
        const row=this.sourceMetadata(this.generation,endpoint);
        if(!row||!Number.isFinite(Date.parse(row.fetchedAt)))throw Object.assign(new Error('acquisition-unavailable'),{code:'acquisition-unavailable'});
        return {payload:{data:[row.work]},fetchedAt:row.fetchedAt,url:'retained-index:'+endpoint,stale:true};
      };
      let sourceTime=0;
      const download=async url=>{const input=await cache.get(url);if(!input.ok)throw new Error('acquisition-unavailable');sourceTime=Date.parse(input.fetchedAt);return {buffer:input.body,resolvedSourceUrl:input.resolvedSourceUrl||url,fetchedAt:input.fetchedAt,freshnessAssessed:false};};
      const {documents}=replaySourceClients(cache,runtime);
      const context=new DocumentContext({request,download,findAmendment:amendmentById,
        readText:(work,language)=>runtime.documentText(work,language,{directory:null,enqueue:false,clock:()=>sourceTime,download:async url=>({...runtime.docxContent((await download(url)).buffer),resolvedSourceUrl:url})}),
        readProposal:runtime.createProposalBaseline({documents,request}),
        readCouncil:runtime.createCouncilPositionBaseline({documents,request}),
        readExistingLaw:runtime.createExistingLawBaseline({documents})});
      const value=await context.query(documentContextQuery(u.pathname.split('/').at(-1),u.searchParams),{store:this});
      return this.observation(url,value);
    }
    return null;
  }
}
