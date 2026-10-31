import {defaultUi} from './uiDefault.mjs';
const motionId=/^(?:B|RC)-10-\d{4}-\d{4,6}$/;
const adoptedId=/^TA-10-\d{4}-\d{4,6}$/;
const own=(value,key)=>Boolean(value&&typeof value==='object'&&Object.hasOwn(value,key));
const get=(value,key)=>own(value,key)?value[key]:undefined;
const bounded=value=>typeof value==='string'&&value.length>0&&value.length<=512;
const memberId=value=>typeof value==='string'&&/^[1-9]\d{0,12}$/.test(value)&&Number.isSafeInteger(Number(value));

export const MOTION_JOURNEY_KEYS=Object.freeze(['ma-member','ma-source','ma-owner','ma-text','ma-open','ma-scope','ma-offset','ma-amendment','ma-list','ma-view','ma-context-view','ma-context-target','ma-wording-lang','ma-ta']);
const fields=Object.freeze({open:'ma-open',scope:'ma-scope',offset:'ma-offset',amendmentId:'ma-amendment',variantListId:'ma-list',view:'ma-view',contextView:'ma-context-view',contextTarget:'ma-context-target',wordingLanguage:'ma-wording-lang'});
const defaults=()=>({open:false,scope:'member',offset:0,amendmentId:null,variantListId:null,view:'amendments',contextView:'document',contextTarget:'text'});

/** Only exact activity relationships become options; no authorship or outcome is copied. */
export function motionTextChoices(activity) {
  const choices=[],seen=new Set();
  const add=(record,related=false)=>{
    const id=get(record,'sourceId');
    if(!bounded(id)||!motionId.test(id)||related&&!id.startsWith('RC-')||seen.has(id))return;
    seen.add(id);choices.push({id,kind:id.startsWith('RC-')?'joint':'original',title:typeof get(record,'title')==='string'?get(record,'title'):'',titleLanguage:typeof get(record,'titleLanguage')==='string'?get(record,'titleLanguage'):null});
  };
  add(activity);
  const related=get(activity,'relatedJointMotions');
  if(Array.isArray(related))for(const record of related)add(record,true);
  return choices;
}

const hasChoice=(choices,id)=>Array.isArray(choices)&&choices.some(choice=>own(choice,'id')&&choice.id===id&&motionId.test(id));
const amendmentFor=(id,documentId)=>{
  if(!bounded(id)||!motionId.test(documentId||''))return false;
  const match=id.match(/^((?:B|RC)-10-\d{4}-\d{4,6})-AM-(\d{1,5})$/);
  return Boolean(match&&match[1]===documentId&&Number(match[2])>0);
};
const listFor=(id,documentId)=>{
  if(!bounded(id)||!motionId.test(documentId||''))return false;
  const match=id.match(/^((?:B|RC)-10-\d{4}-\d{4,6})-AM-(\d{1,5})-(\d{1,5})$/);
  return Boolean(match&&match[1]===documentId&&Number(match[2])>0&&Number(match[3])>=Number(match[2]));
};
const validWordingPin=(state,documentId)=>state.wordingLanguage===undefined||Boolean(amendmentFor(state.amendmentId,documentId)&&listFor(state.variantListId,documentId)&&
  state.contextView==='document'&&state.contextTarget==='amendment'&&(state.wordingLanguage===null||typeof state.wordingLanguage==='string'&&/^[a-z]{2}$/.test(state.wordingLanguage)));

export function createMotionJourney(binding,factoryDefaults=defaults(), ui = defaultUi) {
  const documentId=hasChoice(binding.choices,binding.sourceId)?binding.sourceId:null;
  return {documentId,amendments:{...factoryDefaults},selectedTA:null,status:documentId?'available':'unavailable',reason:documentId?null:ui.t("motionJourney.reason42"),requested:false};
}

/** Invalid requested identities stay selected and unavailable, never a replacement row. */
export function normalizeMotionJourney(value,binding,factoryDefaults=defaults(), ui = defaultUi) {
  const base=createMotionJourney(binding,factoryDefaults, ui),input=get(value,'amendments');
  const amendments={...factoryDefaults};
  for(const key of Object.keys(fields))if(own(input,key)&&input[key]!==undefined)amendments[key]=input[key];
  const documentId=own(value,'documentId')?value.documentId:base.documentId;
  const selectedTA=own(value,'selectedTA')?value.selectedTA:null;
  let reason=null;
  if(!hasChoice(binding.choices,documentId))reason=ui.t("motionJourney.reason53");
  else if(typeof amendments.open!=='boolean'||!['member','all'].includes(amendments.scope)||!Number.isSafeInteger(amendments.offset)||amendments.offset<0||amendments.offset>1_000_000||
    !['amendments','context'].includes(amendments.view)||!['document','adopted'].includes(amendments.contextView)||!['text','amendment'].includes(amendments.contextTarget)||
    amendments.view==='context'&&!amendments.open||['amendmentId','variantListId'].some(key=>amendments[key]!==null&&(typeof amendments[key]!=='string'||amendments[key].length>512)))reason=ui.t("motionJourney.reason56");
  else if(selectedTA!==null&&(!bounded(selectedTA)||!adoptedId.test(selectedTA)))reason=ui.t("motionJourney.reason57");
  // A bad amendment selection must not hide this exact motion's whole-text actions.
  let selectionReason=null;
  if(amendments.amendmentId!==null&&!amendmentFor(amendments.amendmentId,documentId))selectionReason=ui.t("motionJourney.reason60");
  else if(amendments.variantListId!==null&&(!amendments.amendmentId||!listFor(amendments.variantListId,documentId)))selectionReason=ui.t("motionJourney.reason61");
  else if(amendments.view==='context'&&amendments.contextTarget==='amendment'&&!amendments.amendmentId)selectionReason=ui.t("motionJourney.reason62");
  if(!validWordingPin(amendments,documentId))selectionReason=ui.t("motionJourney.reason63");
  return {documentId,amendments,selectedTA,status:reason?'unavailable':'available',reason:reason||selectionReason,requested:get(value,'requested')===true};
}

export function readMotionJourney(query,binding,factoryDefaults=defaults(), ui = defaultUi) {
  const base=createMotionJourney(binding,factoryDefaults, ui);
  const entries=[...query].filter(([key])=>key.startsWith('ma-'));
  if(!entries.length)return base;
  if(query.get('member')!==String(binding.memberId)||query.get('view'))return {...base,status:'inactive',reason:null};
  const unavailable=reason=>({...base,documentId:query.get('ma-text'),requested:true,status:'unavailable',reason});
  if(entries.length>MOTION_JOURNEY_KEYS.length||entries.some(([key,value])=>!MOTION_JOURNEY_KEYS.includes(key)||value.length>512||query.getAll(key).length!==1))return unavailable(ui.t("motionJourney.reason56"));
  if(!memberId(query.get('ma-member'))||!bounded(query.get('ma-source'))||!motionId.test(query.get('ma-source'))||query.has('ma-owner')&&!bounded(query.get('ma-owner')))return unavailable(ui.t("motionJourney.reason56"));
  // A different mounted activity/member must never consume this reader's selection.
  if(query.get('ma-member')!==String(binding.memberId)||query.get('ma-source')!==binding.sourceId||
    query.has('ma-owner')&&query.get('ma-owner')!==binding.ownerId)return {...base,status:'inactive',reason:null};
  const amendments={...factoryDefaults};
  for(const [field,key] of Object.entries(fields))if(query.has(key)){
    const raw=query.get(key);
    amendments[field]=field==='open'?(raw==='1'?true:raw==='0'?false:raw):field==='offset'?(/^\d{1,7}$/.test(raw)?Number(raw):NaN):field==='wordingLanguage'&&raw==='unknown'?null:raw;
  }
  return normalizeMotionJourney({documentId:query.has('ma-text')?query.get('ma-text'):base.documentId,amendments,selectedTA:query.get('ma-ta'),requested:true},binding,factoryDefaults, ui);
}

/** A text choice is a fresh reader, while the surrounding member remains untouched. */
export function changeMotionText(documentId,binding,factoryDefaults=defaults(), ui = defaultUi) {
  return normalizeMotionJourney({documentId,amendments:{...factoryDefaults},selectedTA:null,requested:true},binding,factoryDefaults, ui);
}

/** Fixed semantic order; the parent composes member/activity/language around this key. */
export function motionJourneyKey(state) {
  const s=state.amendments,hasPin=own(s,'wordingLanguage')&&s.wordingLanguage!==undefined;
  return JSON.stringify([state.status,state.documentId,s.open,s.scope,s.offset,s.amendmentId,s.variantListId,s.view,s.contextView,s.contextTarget,
    hasPin,hasPin?s.wordingLanguage:null,state.selectedTA]);
}

export function motionJourneyParams(binding,state, ui = defaultUi) {
  const query=new URLSearchParams(),next=normalizeMotionJourney(state,binding, undefined, ui);
  if(get(state,'status')!=='available'||next.status!=='available'||!memberId(String(binding.memberId))||!motionId.test(binding.sourceId)||!validWordingPin(next.amendments,next.documentId))return query;
  query.set('ma-member',String(binding.memberId));query.set('ma-source',binding.sourceId);
  if(bounded(binding.ownerId))query.set('ma-owner',binding.ownerId);
  query.set('ma-text',next.documentId);
  for(const [field,key] of Object.entries(fields)){
    const value=next.amendments[field];
    if(field==='wordingLanguage'){if(value!==undefined)query.set(key,value??'unknown');}
    else if(value!==null)query.set(key,field==='open'?(value?'1':'0'):String(value));
  }
  if(next.selectedTA!==null)query.set('ma-ta',next.selectedTA);
  return query;
}

/** One complete URL transaction; preserves App, mv-, search, and hash state. */
export function motionJourneyUrl(href,binding,state, ui = defaultUi) {
  const url=new URL(href);
  if(url.searchParams.get('member')!==String(binding.memberId)||url.searchParams.get('view'))return url;
  const params=motionJourneyParams(binding,state, ui);
  if(!params.size)return url;
  for(const key of [...url.searchParams.keys()])if(key.startsWith('ma-'))url.searchParams.delete(key);
  for(const [key,value] of params)url.searchParams.set(key,value);
  return url;
}
