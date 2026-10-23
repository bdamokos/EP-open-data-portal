import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {followingDossiers,dossierQuery} from './follow-dossiers.mjs';
const reference='2025/0407A(COD)',procedure='2025-0407A';
function setup(t) {
  const dir=mkdtempSync(path.join(tmpdir(),'dossier-marks-')),store=new ActivityStore(dir);assert(store.acquire());
  t.after(()=>{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(dir,{recursive:true,force:true});});
  store.setMembers([{id:'42'}]);
  const read=(references=[reference],generation=store.get('active'))=>followingDossiers(store,new URLSearchParams({epoch:store.get('marksEpoch'),generation,procedures:references.join(',')}));
  const document=(generation,id,extra={})=>store.putSource(generation,'/plenary-documents/'+id,'document',{id:'eli/dl/doc/'+id,identifier:id,work_type:'def/REPORT_PLENARY',parliamentary_term:['org/ep-10'],inverse_created_a_realization_of:['eli/dl/proc/'+procedure],title_dcterms:{en:id},document_date:'2026-10-01',...extra},'2026-10-23T10:00:00Z');
  return {store,read,document};
}
test('published dossier identities keep first marks across backdates, removal and reappearance; suffixes remain exact',t=>{
  const {store,read,document}=setup(t),g1=store.beginCycle().generation;
  store.putSource(g1,'/procedures/'+procedure,'procedure',{id:'eli/dl/proc/'+procedure,process_type:'def/COD',consists_of:[{id:'eli/dl/event/exact-stage',had_activity_type:'def/REFERRAL',activity_date:'2026-10-01'}]},'2026-10-23T10:00:00Z');
  document(g1,'A-10-2026-0001');store.publish(g1);
  const first=read();assert.equal(first.items[0].entries.length,2);assert(first.items[0].entries.every(entry=>entry.mark===g1));
  assert.equal(read(['2025/0407(COD)']).items[0].status,'unavailable');
  assert.equal(read(['2025/0407A(RSP)']).items[0].status,'unavailable');
  const g2=store.beginCycle().generation;document(g2,'A-10-2026-0002',{document_date:'2024-08-01'});
  assert.equal(read([reference],g1).items[0].entries.length,2);store.publish(g2);
  assert.equal(read().items[0].entries.find(entry=>entry.sourceId==='A-10-2026-0002').mark,g2);
  const g3=store.beginCycle().generation;store.db.prepare('DELETE FROM sources WHERE generation=? AND key=?').run(g3,'/plenary-documents/A-10-2026-0002');store.publish(g3);
  const g4=store.beginCycle().generation;document(g4,'A-10-2026-0002');document(g4,'A-9-2024-0011',{parliamentary_term:['org/ep-9']});store.publish(g4);
  assert.equal(read().items[0].entries.find(entry=>entry.sourceId==='A-10-2026-0002').mark,g2);
  assert(!read().items[0].entries.some(entry=>entry.sourceId==='A-9-2024-0011'));
  store.db.exec('PRAGMA query_only=ON');assert.equal(read().generation,g4);
});
test('failed publication rolls dossier marks back and unretained generations conflict',t=>{
  const {store,read,document}=setup(t),g1=store.beginCycle().generation;document(g1,'A-10-2026-0001');store.publish(g1);
  const g2=store.beginCycle().generation;document(g2,'A-10-2026-0002');
  store.db.exec("CREATE TEMP TRIGGER refuse_dossiers BEFORE INSERT ON procedure_marks WHEN NEW.source_id='A-10-2026-0002' BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
  assert.throws(()=>store.publish(g2),/test rollback/);assert.equal(store.get('active'),g1);assert.equal(read().items[0].entries.length,1);
  assert(!store.db.prepare('SELECT 1 FROM dossier_events WHERE generation=?').get(g2));
  store.db.exec('DROP TRIGGER refuse_dossiers');store.publish(g2);store.beginCycle();assert.throws(()=>read([reference],g1),error=>error.status===409);
});
test('batch input rejects unknown, repeated, malformed and oversized selections',()=>{
  const base={epoch:'12345678-1234-1234-1234-123456789abc',generation:'1',procedures:reference};
  for(const patch of [{procedures:reference+','+reference},{procedures:'2025/0407(COD),https://example.com'},{generation:'1e2'},{unknown:'x'},{procedures:Array.from({length:51},(_,i)=>`2025/${String(i).padStart(4,'0')}(COD)`).join(',')}])assert.throws(()=>dossierQuery(new URLSearchParams({...base,...patch})),error=>error.status===400);
});
