import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {amendmentsPage,amendmentById} from '../server/amendments-store.mjs';
import {amendmentQuery} from '../server/amendments.mjs';
import {DocumentContext,documentContextQuery} from '../server/document-context.mjs';
import {replayRuntime,replaySourceClients} from './amendment-benchmark-replay.mjs';
import {digest} from './amendment-benchmark-cache.mjs';

// Use the serving projections, with a deliberately tiny SELECT-only store.
// TEMP views live in memory and hide every unpublished generation, including
// from legacy MAX(generation) fallbacks. The supplied file is always immutable.
const queryScript=`import sqlite3,sys,pathlib,json
c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro&immutable=1',uri=True)
c.row_factory=sqlite3.Row
try:
 active=json.loads(c.execute("SELECT value FROM meta WHERE key='active'").fetchone()[0])
 if type(active)!=int or active<=0: raise ValueError('Published generation unavailable')
 if sys.argv[4] and active!=int(sys.argv[4]): raise ValueError('Retained published generation changed')
 c.execute('PRAGMA temp_store=MEMORY')
 tables=c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
 for row in tables:
  name=row[0]
  quoted='"'+name.replace('"','""')+'"'
  if any(col[1]=='generation' for col in c.execute('PRAGMA main.table_info('+quoted+')')):
   c.execute('CREATE TEMP VIEW '+quoted+' AS SELECT * FROM main.'+quoted+' WHERE generation='+str(active))
 c.set_authorizer(lambda action,*args: sqlite3.SQLITE_OK if action in (sqlite3.SQLITE_SELECT,sqlite3.SQLITE_READ,sqlite3.SQLITE_FUNCTION,sqlite3.SQLITE_RECURSIVE) else sqlite3.SQLITE_DENY)
 print(json.dumps([dict(r) for r in c.execute(sys.argv[2],json.loads(sys.argv[3]))]))
finally: c.close()
`;
export class RetainedProjections {
  constructor(filename) {
    const all=(sql,args=[])=>JSON.parse(execFileSync('python3',['-c',queryScript,filename,sql,JSON.stringify(args),String(this.generation??'')],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']}));
    this.db={isTransaction:true,prepare:sql=>({all:(...args)=>all(sql,args),get:(...args)=>all(sql,args)[0]})};
    const meta=Object.fromEntries(all('SELECT key,value FROM meta').map(row=>[row.key,JSON.parse(row.value)]));
    this.generation=meta.active;
    this.meta={...meta,working:null,active:meta.active,amendmentSnapshotGeneration:meta.active};
    this.readSnapshot=operation=>operation();
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
