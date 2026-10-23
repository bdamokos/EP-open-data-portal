import {followMarksVersion,markedKinds,followIndexComplete} from './follow-marks.mjs';
import {HttpError} from './http-utils.mjs';
import {odpLanguage} from './odp.mjs';
import {savedItemPreview} from './insights-saved.mjs';

export function followingQuery(view,search) {
  const allowed=view==='following-status'?[]:view==='following-manifest'?['epoch','generation']:['epoch','generation','member','lang'];
  for(const key of search.keys())if(!allowed.includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated following query.');
  if(view==='following-status')return {};
  const epoch=search.get('epoch'),raw=search.get('generation');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(epoch||''))throw new HttpError(400,'invalid_epoch','An index epoch is required.');
  if(!/^[1-9]\d*$/.test(raw||'')||!Number.isSafeInteger(Number(raw)))throw new HttpError(400,'invalid_generation','A positive generation is required.');
  if(view==='following-manifest')return {epoch,generation:Number(raw)};
  const member=search.get('member');
  if(!/^[1-9]\d{0,8}$/.test(member||''))throw new HttpError(400,'invalid_member','A valid member ID is required.');
  return {epoch,generation:Number(raw),member,language:odpLanguage(search.get('lang')||'en')};
}

function generationInfo(store,generation) {
  if(store.get('followMarksVersion')!==followMarksVersion)return null;
  return store.db.prepare(`SELECT published_at,index_complete,roster_basis,EXISTS(SELECT 1 FROM follow_summary WHERE generation=?) AS ready
    FROM follow_generations WHERE generation=?`).get(generation,generation);
}

export function followingStatus(store) {
  const active=store.get('active')||0,generation=active||store.get('working')?.generation||0;
  const info=active?generationInfo(store,active):null;
  return {epoch:store.get('marksEpoch'),generation,marksReady:Boolean(info?.ready),indexComplete:Boolean(active&&info?.index_complete&&followIndexComplete(store,active)),publishedAt:info?.published_at||null};
}

// All identity reads are covering. Only the selected 200 previews load JSON bodies.
export const followingIdsSql=markedKinds.map(([,index,predicate],number)=>`SELECT current.source_id AS source_id,${number} AS kind,mark.mark AS mark,current.date AS date FROM
  (SELECT source_id,MAX(date) AS date FROM items INDEXED BY ${index} WHERE generation=? AND mep=? AND ${predicate} GROUP BY source_id) current
  JOIN item_marks mark ON mark.mep=? AND mark.kind=${number} AND mark.source_id=current.source_id`).join(' UNION ALL ')+' ORDER BY mark DESC,date DESC,source_id DESC,kind';

export function followingResponse(store,view,search) {
  const query=followingQuery(view,search),status=followingStatus(store);
  if(view==='following-status')return {status:200,body:status,cacheControl:'public, max-age=60'};
  const unavailable=()=>({status:503,body:{error:{code:'marks_unavailable',message:'Update checks are not available yet.'}}});
  if(!status.marksReady)return unavailable();
  if(query.epoch!==status.epoch||![store.get('active'),store.get('previous')].includes(query.generation))return {
    status:409,body:{error:{code:'generation_changed',message:'The index generation has changed.',epoch:status.epoch,generation:status.generation}}};
  const info=generationInfo(store,query.generation);
  if(!info?.ready)return unavailable();
  const common={epoch:query.epoch,generation:query.generation,rosterBasis:info.roster_basis};
  let body;
  if(view==='following-manifest') {
    const rows=store.db.prepare('SELECT * FROM follow_summary WHERE generation=? ORDER BY mep').all(query.generation);
    body={...common,indexComplete:Boolean(info.index_complete),members:Object.fromEntries(rows.map(row=>[row.mep,[row.activity_mark,row.answer_mark,row.activity_count,row.answer_count]]))};
  } else {
    const exists=store.db.prepare('SELECT 1 FROM follow_summary WHERE generation=? AND mep=?').get(query.generation,query.member);
    const rows=exists?store.db.prepare(followingIdsSql).all(...markedKinds.flatMap(()=>[query.generation,query.member,query.member])):[];
    const readers=markedKinds.map(([,index,predicate])=>store.db.prepare(`SELECT source_id,date,body FROM items INDEXED BY ${index} WHERE generation=? AND mep=? AND source_id=? AND date IS ? AND ${predicate} LIMIT 1`));
    const entries=rows.slice(0,200).map(row=>({
      ...savedItemPreview(store,query.generation,readers[row.kind].get(query.generation,query.member,row.source_id,row.date),query.language),kind:markedKinds[row.kind][0],mark:row.mark,
    }));
    body={...common,member:query.member,status:exists?'available':'outside-roster',ids:rows.map(row=>[row.source_id,row.kind,row.mark]),entries,truncated:Math.max(0,rows.length-entries.length)};
  }
  return {status:200,body,cacheControl:'public, max-age=3600'};
}
