import {memberVotesRoute} from './memberVotesPresentation.mjs';

// Browser fields belong to the selected member and are separate from API keys.
const fields={week:'week',sitting:'sittingId',positions:'positions',alignment:'alignment',offset:'offset',decision:'decisionId',snapshot:'snapshotId',expanded:'expandedSubjectIds',document:'documentId',amendment:'amendmentId',list:'listId','wording-lang':'wordingLanguage',view:'view',adopted:'adoptedId',invalid:'invalid'};
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const documentId=value=>/^(?:A|B|RC)-10-\d{4}-\d{4,6}$/.test(value);
const defaults=()=>({week:'latest',sittingId:null,positions:'all',alignment:'all',offset:0,decisionId:null,snapshotId:null,expandedSubjectIds:[],context:null});

export function isMemberVotesParam(key) {
  return key.startsWith('mv-')&&Object.hasOwn(fields,key.slice(3));
}

export function readMemberVotesJourney(query,memberId) {
  const result={memberId,state:defaults(),adoptedId:null,invalid:false};
  if(!memberId||query.get('member')!==String(memberId))return result;
  const values=Object.create(null);
  for(const [key,value] of query)if(key.startsWith('mv-')) {
    if(!isMemberVotesParam(key)||Object.hasOwn(values,key)||value.length>(key==='mv-expanded'?8192:512)){result.invalid=true;continue;}
    values[key]=value;
  }
  const get=key=>Object.hasOwn(values,'mv-'+key)?values['mv-'+key]:null;
  const state=result.state;
  if([...query.keys()].some(key=>key.startsWith('mv-'))&&!Object.hasOwn(values,'mv-positions'))state.positions='recorded';
  for(const key of ['week','sitting','positions','alignment','decision','snapshot'])if(get(key)!==null)state[fields[key]]=get(key);
  if(get('offset')!==null){if(!/^(?:0|[1-9]\d{0,4})$/.test(get('offset')))result.invalid=true;else state.offset=Number(get('offset'));}
  if(get('expanded')!==null)try {
    const ids=JSON.parse(get('expanded'));
    if(!Array.isArray(ids)||ids.length>50||!ids.every(identifier)||new Set(ids).size!==ids.length)result.invalid=true;
    else state.expandedSubjectIds=ids;
  }catch{result.invalid=true;}
  const contextKeys=['document','amendment','list','wording-lang','view','adopted'];
  if(contextKeys.some(key=>get(key)!==null)) {
    if(!state.decisionId||!documentId(get('document')||'')||!['document','adopted'].includes(get('view')))result.invalid=true;
    const amendment=get('amendment'),list=get('list'),wordingLanguage=get('wording-lang'),adopted=get('adopted');
    if(amendment!==null&&(!amendment.startsWith(get('document')+'-AM-')||!/^\d+(?:-\d+)?$/.test(amendment.slice((get('document')+'-AM-').length))||get('view')!=='document'))result.invalid=true;
    if(list!==null&&(!amendment||!identifier(list)))result.invalid=true;
    if(wordingLanguage!==null&&(!amendment||!list||get('view')!=='document'||wordingLanguage!=='unknown'&&!/^[a-z]{2}$/.test(wordingLanguage)))result.invalid=true;
    if(adopted!==null&&(get('view')!=='adopted'||!/^TA-10-\d{4}-\d{4,6}$/.test(adopted)))result.invalid=true;
    state.context={documentId:get('document')||'',view:get('view'),...(amendment!==null?{amendmentId:amendment}:{}),...(list!==null?{listId:list}:{}),...(wordingLanguage!==null?{wordingLanguage:wordingLanguage==='unknown'?null:wordingLanguage}:{})};
    result.adoptedId=adopted;
  }
  if(get('invalid')!==null)result.invalid=true;
  // Reuse the module's request validation; invalid links never request a fallback.
  try{memberVotesRoute(memberId,state);if(state.sittingId!==null)memberVotesRoute(memberId,{...state,sittingId:null});}catch{result.invalid=true;}
  return result;
}

export function memberVotesJourneyParams(journey) {
  const query=new URLSearchParams(),state=journey.state;
  const put=(key,value)=>{if(value!==null&&value!==undefined&&String(value).length<=(key==='expanded'?8192:512))query.set('mv-'+key,String(value));};
  if(journey.invalid)put('invalid','1');
  if(state.week!=='latest')put('week',state.week);
  put('sitting',state.sittingId);
  put('positions',state.positions);
  if(state.alignment&&state.alignment!=='all')put('alignment',state.alignment);
  if(state.offset)put('offset',state.offset);
  put('decision',state.decisionId);put('snapshot',state.snapshotId);
  if(state.expandedSubjectIds.length)put('expanded',JSON.stringify(state.expandedSubjectIds));
  if(state.context){put('document',state.context.documentId);put('view',state.context.view);put('amendment',state.context.amendmentId);put('list',state.context.listId);put('adopted',journey.adoptedId);if(Object.hasOwn(state.context,'wordingLanguage'))put('wording-lang',state.context.wordingLanguage??'unknown');}
  return query;
}

export function memberVotesHistoryMode(previous,next,requestedReplace=false) {
  const stable=state=>JSON.stringify([state.sittingId,state.positions,state.alignment??'all',state.offset,state.decisionId,state.expandedSubjectIds,contextKey(state.context)]);
  return requestedReplace&&stable(previous)===stable(next)&&(previous.week===next.week||previous.week==='latest')?'replace':'push';
}

const contextKey=context=>context?[context.documentId,context.view,context.amendmentId??null,context.listId??null,Object.hasOwn(context,'wordingLanguage')?[true,context.wordingLanguage]:[false]]:null;

export function memberVotesScrollKey(journey) {
  const state=journey.state;
  return JSON.stringify([journey.memberId,state.week,state.sittingId,state.positions,state.alignment??'all',state.offset,state.decisionId,contextKey(state.context),journey.adoptedId]);
}

const scrollSelectors=['main.explorer','.explorer-profile-body','.member-votes','.member-votes-pane:not([hidden])'];
export function captureMemberJourneyScroll(root) {
  return scrollSelectors.map(selector=>root.querySelector(selector)?.scrollTop||0);
}
export function restoreMemberJourneyScroll(root,positions) {
  if(!Array.isArray(positions)||positions.length!==scrollSelectors.length||!positions.every(value=>Number.isFinite(value)&&value>=0&&value<=10000000))return;
  scrollSelectors.forEach((selector,index)=>{const node=root.querySelector(selector);if(node)node.scrollTop=positions[index];});
}
