export const MEMBER_VOTES_PAGE_SIZE=50;
const positions=new Set(['recorded','all']);
const languages=new Set('bg es cs da de et el en fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv'.split(' '));
const topLevelDocument=/^(?:A|B|RC)-10-\d{4}-\d{4,6}$/;
const amendmentDocument=/^((?:A|B|RC)-10-\d{4}-\d{4,6})-AM-\d+(?:-\d+)?$/;
const decision=/^MTG-PL-(\d{4}-\d{2}-\d{2})-DEC-\d+$/;
const sitting=/^MTG-PL-(\d{4}-\d{2}-\d{2})$/;
const snapshot=/^[a-f0-9]{64}$/;
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const stringArray=value=>Array.isArray(value)&&value.every(item=>typeof item==='string');
const stringMap=value=>isObject(value)&&Object.values(value).every(item=>typeof item==='string');
const nullableString=value=>value===null||typeof value==='string';
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const dateOffset=(value,days)=>new Date(Date.parse(value+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const monday=value=>date(value)&&new Date(value+'T12:00:00Z').getUTCDay()===1;
const validDecision=value=>typeof value==='string'&&decision.test(value)&&date(value.match(decision)[1]);
const validSitting=value=>typeof value==='string'&&sitting.test(value)&&date(value.match(sitting)[1]);
const unique=values=>[...new Set(values)];

export function memberVotesRoute(memberId,state={},language='en') {
  if(!/^[1-9]\d*$/.test(String(memberId))||!Number.isSafeInteger(Number(memberId)))throw new RangeError('Invalid member identifier.');
  const {week='latest',sittingId=null,positions:filter='recorded',offset=0,decisionId=null,snapshotId=null}=state;
  if(!positions.has(filter)||!integer(offset)||offset>10000||!languages.has(language))throw new RangeError('Invalid member-vote request.');
  if(sittingId!==null&&!validSitting(sittingId)||sittingId===null&&week!=='latest'&&!monday(week))throw new RangeError('Invalid vote period.');
  if(decisionId!==null&&!validDecision(decisionId)||snapshotId!==null&&!snapshot.test(snapshotId))throw new RangeError('Invalid member-vote selection.');
  const params=new URLSearchParams(sittingId?{sitting:sittingId}:{week});
  params.set('positions',filter);params.set('lang',language);params.set('offset',String(offset));params.set('limit',String(MEMBER_VOTES_PAGE_SIZE));
  if(decisionId!==null)params.set('decision',decisionId);
  if(snapshotId!==null)params.set('snapshot',snapshotId);
  return 'member-votes/'+memberId+'?'+params;
}

function matchesPeriod(period,state,unavailable) {
  if(!isObject(period))return false;
  if(state.sittingId)return period.kind==='sitting'&&period.sittingId===state.sittingId&&period.week===null&&period.from===state.sittingId.slice(7)&&period.to===period.from&&date(period.from);
  if(period.kind!=='week'||period.sittingId!==null)return false;
  if(period.week===null)return (state.week??'latest')==='latest'&&unavailable&&period.from===null&&period.to===null;
  return monday(period.week)&&period.from===period.week&&period.to===dateOffset(period.week,6)&&((state.week??'latest')==='latest'||state.week===period.week);
}
function withinPeriod(item,period,withSitting=true) {
  if(!isObject(item)||!validDecision(item.id)||!date(item.date)||item.id.match(decision)[1]!==item.date)return false;
  if(!period.from||!period.to||item.date<period.from||item.date>period.to)return false;
  if(withSitting&&(!validSitting(item.sittingId)||item.sittingId.slice(7)!==item.date||period.sittingId&&item.sittingId!==period.sittingId))return false;
  return true;
}
function outcomeShape(item) {
  return isObject(item)&&nullableString(item.method)&&nullableString(item.outcome)&&['conducted','not-conducted','unknown'].includes(item.ballotStatus)&&isObject(item.scope)&&['whole-text','amendment','split-part','procedural','unclassified'].includes(item.scope.kind)&&isObject(item.actualPosition)&&['recorded','no-record','unavailable','conflicting','not-conducted'].includes(item.actualPosition.status)&&[null,'for','against','abstaining'].includes(item.actualPosition.position)&&isObject(item.intention)&&['reported','not-reported','unavailable'].includes(item.intention.status)&&Array.isArray(item.intention.positions)&&item.intention.positions.every(position=>['for','against','abstaining'].includes(position))&&isObject(item.totals)&&['for','against','abstaining'].every(key=>item.totals[key]===null||integer(item.totals[key]));
}
function componentShape(part) {
  return isObject(part)&&typeof part.componentId==='string'&&typeof part.uri==='string'&&nullableString(part.requestUri)&&(part.number===null||typeof part.number==='string'||typeof part.number==='number'&&Number.isFinite(part.number))&&isObject(part.contentByLanguage)&&Object.values(part.contentByLanguage).every(content=>isObject(content)&&typeof content.sourceLiteral==='string'&&nullableString(content.text));
}
function requesterShape(requester) {
  return isObject(requester)&&['id','uri','type'].every(key=>typeof requester[key]==='string')&&stringMap(requester.scopeByLanguage)&&stringMap(requester.organizationLabels)&&stringArray(requester.organizationReferences)&&stringArray(requester.organizationAliasReferences)&&requester.binding==='exact-decision-was_motivated_by';
}
function usableVote(item,period) {
  return withinPeriod(item,period)&&outcomeShape(item)&&nullableString(item.title)&&nullableString(item.titleLanguage)&&stringMap(item.titles)&&stringMap(item.referenceTexts)&&nullableString(item.subjectId)&&isObject(item.context)&&['documentIds','amendmentIds','componentIds'].every(key=>stringArray(item.context[key]))&&Array.isArray(item.parts)&&item.parts.every(part=>componentShape(part)&&typeof part.requestId==='string'&&typeof part.resultId==='string'&&stringMap(part.requestScopeByLanguage)&&Array.isArray(part.contextComponents)&&part.contextComponents.every(componentShape))&&Array.isArray(item.rollCallRequesters)&&item.rollCallRequesters.every(requesterShape)&&isObject(item.resultRelationship)&&['consistent','single-direction','ambiguous','unlinked'].includes(item.resultRelationship.binding);
}
export function validateMemberVotesResponse(data,{memberId,state={}}) {
  if(!isObject(data)||data.version!==2||!isObject(data.member)||data.member.id!==String(memberId)||!/^\d+$/.test(data.member.id))return false;
  if(data.positions!==(state.positions??'recorded')||!isObject(data.coverage)||!['complete','partial','unavailable'].includes(data.coverage.status)||data.coverage.termWide!==false)return false;
  if(!matchesPeriod(data.period,state,data.coverage.status==='unavailable')||typeof data.snapshotId!=='string'||!snapshot.test(data.snapshotId)||state.snapshotId&&data.snapshotId!==state.snapshotId)return false;
  const page=data.pagination;
  if(!isObject(page)||page.offset!==(state.offset??0)||page.limit!==MEMBER_VOTES_PAGE_SIZE||!['offset','limit','returned','observedTotal','filteredTotal'].every(key=>integer(page[key])))return false;
  if(!Array.isArray(data.items)||page.returned!==data.items.length||page.returned>page.limit||page.filteredTotal>page.observedTotal||page.returned>Math.max(0,page.filteredTotal-page.offset))return false;
  if(page.nextOffset!==(page.offset+page.returned<page.filteredTotal?page.offset+page.returned:null)||page.nextOffset!==null&&page.returned===0)return false;
  if(!data.items.every(item=>usableVote(item,data.period))||new Set(data.items.map(item=>item.id)).size!==data.items.length)return false;
  if(data.positions==='recorded'&&data.items.some(item=>item.actualPosition.status!=='recorded'))return false;
  if(!Array.isArray(data.subjects)||data.subjects.some(subject=>!isObject(subject)||typeof subject.id!=='string'||!nullableString(subject.title)||!nullableString(subject.titleLanguage)||!stringMap(subject.titles)||!stringArray(subject.documentIds)||!stringArray(subject.agendaItemIds)||!isObject(subject.counts)||!['observed','filtered','page'].every(key=>integer(subject.counts[key]))||subject.counts.page>subject.counts.filtered||subject.counts.filtered>subject.counts.observed||subject.counts.page!==data.items.filter(item=>item.subjectId===subject.id).length||!Array.isArray(subject.wholeTextDecisions)||!subject.wholeTextDecisions.every(item=>withinPeriod(item,data.period,false)&&outcomeShape(item)&&item.scope.kind==='whole-text')))return false;
  if(!isObject(data.selected))return false;
  if(state.decisionId) {
    if(data.selected.status==='found')return usableVote(data.selected.item,data.period)&&data.selected.item.id===state.decisionId;
    return ['not-found-in-scanned-data','unavailable'].includes(data.selected.status)&&data.selected.item===null;
  }
  return data.selected.status==='not-requested'&&data.selected.item===null;
}

export function groupMemberVotes(data) {
  const subjects=new Map();
  for(const subject of data.subjects||[])subjects.set(subject.id,subjects.has(subject.id)?null:subject);
  const groups=new Map();
  for(const item of data.items||[]) {
    const subject=item.subjectId&&['consistent','single-direction'].includes(item.resultRelationship?.binding)?subjects.get(item.subjectId):null;
    const id=subject?subject.id:'decision:'+item.id;
    if(!groups.has(id))groups.set(id,{id,subject:subject||null,items:[]});
    groups.get(id).items.push(item);
  }
  for(const [id,subject] of subjects)if(subject&&!groups.has(id)&&subject.wholeTextDecisions?.length)groups.set(id,{id,subject,items:[]});
  return [...groups.values()];
}

export function displayVoteTitle(title) {
  if(typeof title!=='string')return '';
  return title.replace(/(?<![\w*])\*{2,3}(?:III|II|I)(?![\w*])/g,'').replace(/^\*{1,3}\s+|(?:^|\s)\*{1,3}$/g,'').replace(/\s{2,}/g,' ').trim();
}
function sourceLabel(labels,language) {
  if(!isObject(labels))return null;
  return [labels[language],labels.en,...Object.values(labels)].find(value=>typeof value==='string'&&value.trim())||null;
}
export function memberVoteLabel(vote,language='en') {
  if(vote.scope?.kind==='whole-text')return 'Final vote';
  const amendments=unique((vote.context?.amendmentIds||[]).filter(id=>amendmentDocument.test(id)).map(id=>id.slice(id.indexOf('-AM-')+4)));
  const parts=unique((vote.parts||[]).map(part=>part.number).filter(value=>typeof value==='string'&&value.trim()||typeof value==='number'&&Number.isFinite(value)).map(String));
  const label=[];
  if(amendments.length)label.push((amendments.length===1?'Amendment ':'Amendments ')+amendments.join(', '));
  if(parts.length)label.push((parts.length===1?'Part ':'Parts ')+parts.join(', '));
  return label.join(' · ')||sourceLabel(vote.referenceTexts,language)||'Decision';
}
export function memberVotePosition(vote) {
  if(vote.ballotStatus==='not-conducted'||vote.actualPosition?.status==='not-conducted')return 'Not put to a vote';
  if(vote.actualPosition?.status==='recorded'&&!['VOTE_HAND','VOTE_SECRET','VOTE_SECRET_BALLOT'].includes(vote.method))return {for:'For',against:'Against',abstaining:'Abstained'}[vote.actualPosition.position]||'No recorded position for this vote.';
  return 'No recorded position for this vote.';
}
export function memberVoteOutcome(vote) {
  return {ADOPTED:'Adopted',REJECTED:'Rejected',LAPSED:'Lapsed',WITHDRAWN:'Withdrawn',CANCELLED:'Cancelled'}[vote.outcome]||'Outcome unavailable';
}
export function memberVoteTotals(vote) {
  if(vote.ballotStatus!=='conducted'||!['for','against','abstaining'].every(key=>typeof vote.totals?.[key]==='number'&&Number.isFinite(vote.totals[key])&&vote.totals[key]>=0))return null;
  const {for:forVotes,against,abstaining}=vote.totals;
  const total=forVotes+against+abstaining;
  return Number.isFinite(total)?{for:forVotes,against,abstaining,total}:null;
}
export function votingRecordUrl(vote) {
  if(!validSitting(vote.sittingId)||!date(vote.date)||vote.sittingId.slice(7)!==vote.date||vote.date<'2024-07-16'||vote.date>new Date().toISOString().slice(0,10)||vote.date>='2030-01-01')return null;
  return 'https://www.europarl.europa.eu/doceo/document/PV-10-'+vote.date+'-VOT_EN.html';
}
export function topLevelVoteDocuments(vote) {
  return unique((vote.context?.documentIds||[]).filter(id=>typeof id==='string'&&topLevelDocument.test(id)));
}
export function exactAmendmentTargets(vote) {
  return unique((vote.context?.amendmentIds||[]).filter(id=>typeof id==='string'&&amendmentDocument.test(id))).map(amendmentId=>({documentId:amendmentId.match(amendmentDocument)[1],amendmentId}));
}
