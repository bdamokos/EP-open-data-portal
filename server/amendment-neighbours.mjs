import {amendmentReference} from './amendments.mjs';
import {descriptionText} from './amendment-splits.mjs';
import {amendmentById,amendmentGeneration} from './amendments-store.mjs';
import {committeeAmendmentReference,committeeScopeKey} from './committee-amendments.mjs';
import {fastReadsReady} from './fast-read-projections.mjs';
import {HttpError} from './http-utils.mjs';

export const AMENDMENT_NEIGHBOURS_VERSION=2;

export function amendmentNeighboursQuery(params) {
  for(const key of params.keys())if(!['amendment','list'].includes(key)||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated amendment query parameter.');
  const amendmentId=params.get('amendment'),listId=params.get('list');
  const committee=committeeAmendmentReference(amendmentId),plenary=committee?null:amendmentReference('eli/dl/doc/'+amendmentId);
  if(!committee&&!plenary)throw new HttpError(400,'invalid_amendment','Choose an exact amendment.');
  if(listId!==null&&!(committee?committee.listId===listId:new RegExp('^'+plenary.targetDocumentId+'-AM-[0-9]{1,5}-[0-9]{1,5}$').test(listId)))throw new HttpError(400,'invalid_list','Choose a published amendment list for this amendment.');
  return {amendmentId,listId,number:(committee||plenary).number,target:committee?committeeScopeKey(committee.listId):plenary.targetDocumentId,document:committee?null:plenary.targetDocumentId};
}

const inList=(row,listId)=>row?.listId===listId||Array.isArray(row?.variants)&&row.variants.some(variant=>variant?.listId===listId);
// A plenary list names its number range, which bounds the rows to look at.
const listRange=listId=>{const match=listId.match(/-AM-(\d{1,5})-(\d{1,5})$/);return match?[Number(match[1]),Number(match[2])]:[1,Number.MAX_SAFE_INTEGER];};

// Parliament's descriptions of each part. Older rows hold one language; a row may hold all of them.
const heldDescription=text=>{try{return descriptionText(text);}catch{return null;}};
const partDescriptions=part=>{
  // Stored as raw source XML; a value that can't be read is left out.
  const held=Object.entries(part.sourceDescriptions||{}).flatMap(([language,text])=>{
    const read=typeof text==='string'&&text.trim()?heldDescription(text):null;
    return read?.trim()?[[language,read]]:[];
  });
  return Object.fromEntries(held.length?held:typeof part.description==='string'&&part.language?[[part.language,part.description]]:[]);
};
export const amendmentSplitFields=row=>{
  const parts=Array.isArray(row.splitParts)?row.splitParts:[];
  const partNumber=decision=>decision.partNumber??parts.find(part=>part.id===decision.partId)?.number??null;
  return {
    splitParts:parts.map(part=>({number:part.number??null,descriptions:partDescriptions(part)})),
    decisions:(Array.isArray(row.decisions)?row.decisions:[]).map(decision=>({id:decision.id,partNumber:partNumber(decision),outcome:decision.outcome??null,method:decision.method??null,ballotStatus:decision.ballotStatus??null,totals:decision.totals??null})),
  };
};

// Previous and next by number within one exact list. A number inside the range
// still has to name this list: rows without wording belong to no list.
export function amendmentNeighbours(store,{amendmentId,listId:requested,number,target,document}) {
  const row=amendmentById(store,{document,id:amendmentId});
  if(!row)throw new HttpError(404,'amendment_not_found','This amendment is not held.');
  const listId=requested??row.listId??null;
  const authors=(row.authors||[]).filter(author=>author?.name).map(author=>({name:author.name,displayName:author.displayName??null,personId:author.personId??null}));
  const base={version:AMENDMENT_NEIGHBOURS_VERSION,amendmentId,listId,outcome:row.outcome&&row.outcome!=='unavailable'?row.outcome:null,authors,committeeProposer:row.committeeProposer??null,proposerLanguage:row.proposerSource?.language??null,onBehalfOf:row.onBehalfOf??null,...amendmentSplitFields(row)};
  if(!listId||!inList(row,listId))return {...base,previous:null,next:null};
  const generation=amendmentGeneration(store),[low,high]=listRange(listId);
  const rows=fastReadsReady(store,generation,'amendments')?'amendment_page_reads':"(SELECT generation,id,target,CAST(json_extract(body,'$.number') AS INTEGER) number FROM amendments)";
  const body=store.db.prepare('SELECT body FROM amendments WHERE generation=? AND target=? AND id=?');
  const find=(sql,...range)=>{
    for(const candidate of store.db.prepare(`SELECT id,number FROM ${rows} WHERE generation=? AND target=? AND ${sql}`).iterate(generation,target,...range)) {
      const saved=body.get(generation,target,candidate.id);
      if(saved&&inList(JSON.parse(saved.body),listId))return {id:candidate.id,number:candidate.number};
    }
    return null;
  };
  return {...base,previous:find('number>=? AND number<? ORDER BY number DESC,id DESC',low,number),next:find('number>? AND number<=? ORDER BY number,id',number,high)};
}
