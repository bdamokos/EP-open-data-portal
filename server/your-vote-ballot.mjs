import {persistBallotBindings} from './ballot-bindings-store.mjs';
export {prepareBallotBindings,persistBallotBindings,readBallotBindings} from './ballot-bindings-store.mjs';
import {ballotScheduledFor} from './ballot-source-adapter.mjs';
import {references,identifier,deriveVoteEvidence} from './vote-evidence.mjs';
import {isWholeProposalVote} from './vote-scope.mjs';
// The voteScope final-label family; binding deliberately requires exact case.
export const FINAL_BALLOT_LABELS=new Set(['Motion for a resolution (as a whole)','Draft legislative resolution (as a whole)','Legislative resolution (as a whole)']);
// Only this procedural label is present in the verified September fixtures.
const PROCEDURAL_BALLOT_LABELS=new Set(['Request for referral back to committee']);
const array=x=>x==null?[]:Array.isArray(x)?x:[x];
const ids=(x,kind='event')=>references(x,kind).map(identifier);
const term=x=>String(x||'').split('/').at(-1);
export function ballotKey(documentId,row) {
  let suffix;
  if(row.amendments?.length) {
    const cp=[...new Set(row.amendments.map(a=>a.cp).filter(x=>x!=null))];
    if(cp.length>1||cp.length&&row.amendments.some(a=>a.cp==null))return null;
    suffix='am:'+ [...new Set(row.amendments.map(a=>a.number))].sort((a,b)=>a-b).join('+')+(cp.length?':cp'+cp[0]:'');
  } else if(row.kind==='text')suffix='text:'+row.subject.join(' / ');
  else if(row.kind==='motion'&&row.motion)suffix='motion:'+row.motion;
  else if(row.kind==='final')suffix='final';
  else if(row.kind==='procedural')suffix='procedural:'+String(row.label||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  else return null;
  return documentId+':'+suffix+(row.part!=null?':part'+row.part:'');
}
function matches(row,doc,raw,derived) {
  if(raw._conflictingSourceObservations)return false;
  const full=ids(raw.decided_on_a_realization_of,'doc'),partial=ids(raw.decided_on_a_part_of_a_realization_of,'doc'),all=[...full,...partial];
  if(array(raw.decided_on_a_realization_of).length!==full.length||array(raw.decided_on_a_part_of_a_realization_of).length!==partial.length)return false;
  const xml=typeof raw.decisionAboutId_XMLLiteral==='string'?raw.decisionAboutId_XMLLiteral:'',comment=raw.comment?.en||'';
  const marker=symbol=>new RegExp('<symbol\\b[^>]*\\bhref=[\"\'][^\"\']*/'+symbol+'[\"\'][^>]*>').test(xml);
  const split=full.filter(id=>/-SPLIT-\d+-\d+$/.test(id)).map(id=>Number(id.split('-').at(-1)));
  const commentPart=/^(\d+)(?:\/|$)/.exec(comment)?.[1];
  if(new Set(split).size>1||split.length&&commentPart&&split[0]!==Number(commentPart))return false;
  const part=split[0]??(commentPart?Number(commentPart):null);
  if((row.part??null)!==part)return false;
  if(row.amendments.length) {
    const expected=row.amendments.map(a=>doc+'-AM-'+a.number).sort(),actual=all.filter(id=>/-AM-\d+$/.test(id)).sort();
    if(JSON.stringify([...new Set(expected)])!==JSON.stringify([...new Set(actual)]))return false;
    const cp=marker('PC')?Number(/<text>(\d+)<\/text>/.exec(xml)?.[1]):null;
    if(row.amendments.some(a=>(a.cp??null)!==cp))return false;
    if(cp!==null&&!partial.length)return false;
    return !all.some(id=>!/-AM-\d+$/.test(id)&&!/-SPLIT-\d+-\d+$/.test(id));
  }
  if(row.kind==='text')return marker('§')&&row.subject.join(' / ')===raw.referenceText?.en&&Number(raw.activity_order)===row.row;
  if(row.kind==='motion')return /^B\d+-\d+\/\d{4}$/.test(raw.referenceText?.en||'')&&raw.referenceText.en.replace(/^B(\d+)-(\d+)\/(\d{4})$/,'B-$1-$3-$2')===row.motion;
  if(row.kind==='final')return Number(raw.activity_order)===row.row&&(FINAL_BALLOT_LABELS.has(raw.referenceText?.en?.trim())||isWholeProposalVote(raw,derived));
  if(row.kind==='procedural')return Number(raw.activity_order)===row.row&&PROCEDURAL_BALLOT_LABELS.has(raw.referenceText?.en?.trim());
  // Other procedural labels do not establish identity.
  return false;
}
export function ballotContext(day,amendments=[],derive=deriveVoteEvidence) {
  const derived=derive(day,{includeBindingEvidence:true}),byAgenda=new Map(),parents=new Map();
  const conflicting=new Set((day.conflictingResults||[]).map(r=>r.activity_id||identifier(r.id)));
  for(const result of day.results){const id=result.activity_id||identifier(result.id);if(!conflicting.has(id))parents.set(id,[...new Set(ids(result.executed))]);}
  for(const decision of day.decisions){const owners=ids(decision.inverse_consists_of);if(owners.length!==1)continue;for(const agenda of parents.get(owners[0])||[]){const rows=byAgenda.get(agenda)||[];rows.push(decision);byAgenda.set(agenda,rows);}}
  return {derived,byAgenda,amendmentsById:new Map(amendments.map(a=>[a.id,a]))};
}
function decisionKind(raw,derived) {
  const components=[...ids(raw.decided_on_a_realization_of,'doc'),...ids(raw.decided_on_a_part_of_a_realization_of,'doc')];
  if(components.some(id=>/-AM-\d+$/.test(id)))return 'amendment';
  if(/<symbol\b[^>]*\bhref=["'][^"']*\/§["']/.test(raw.decisionAboutId_XMLLiteral||''))return 'text';
  const label=raw.referenceText?.en?.trim()||'';
  if(FINAL_BALLOT_LABELS.has(label)||isWholeProposalVote(raw,derived))return 'final';
  if(/^B\d+-\d+\/\d{4}$/.test(label))return 'motion';
  if(/^(?:Request|Referral|Motion to refer|Postponement|Closure|Adjournment)\b/.test(label))return 'procedural';
  if(/oral amendment/i.test(label))return 'oral';
  return null;
}
export function assembleBallot({document,agendaItemId,day={decisions:[],results:[],requests:[]},amendments=[],votingList=null,retained=[],context=ballotContext(day,amendments)}) {
  const {derived,amendmentsById}=context,decisions=context.byAgenda.get(agendaItemId)||[];
  const withdrawn=new Set(votingList?.notes?.withdrawn||[]),inadmissible=new Set(votingList?.notes?.inadmissible||[]);
  const rows=votingList?[...votingList.rows]:amendments.filter(a=>ballotScheduledFor(a,agendaItemId,day.sittingId)).sort((a,b)=>a.number-b.number).map((a,index)=>({row:index+1,kind:'amendment',subject:[a.targetLabel||a.label||''],subjectLanguage:a.targetLabelLanguage||null,amendments:[{number:Number(a.id.match(/-AM-(\d+)$/)?.[1]),cp:null}],authors:[...new Set([...(a.authors||[]).map(author=>author.displayName||author.name).filter(Boolean),...(a.committeeProposer?[a.committeeProposer]:[]),...array(a.onBehalfOf)])],part:null,parentRow:null}));
  if(votingList)for(const number of [...withdrawn,...inadmissible])if(!rows.some(r=>r.amendments?.some(a=>a.number===number)))rows.push({row:0,kind:'amendment',subject:[],amendments:[{number,cp:null}],part:null});
  const result=rows.filter(row=>row.kind!=='heading'&&!(row.vote?.split&&row.part==null&&rows.some(r=>r.parentRow===row.row))).map(row=>{
    const key=ballotKey(document,row);if(!key)return null;
    const candidates=decisions.filter(raw=>matches(row,document,raw,derived));
    const raw=candidates.length===1?candidates[0]:null;
    const attached=(row.amendments||[]).map(a=>amendmentsById.get(document+'-AM-'+a.number)).filter(Boolean).map(item=>Object.fromEntries(['id','number','listId','targetLabel','originalText','proposedText','language'].map(key=>[key,item[key]])));
    const status=row.amendments?.some(a=>withdrawn.has(a.number))?'withdrawn':row.amendments?.some(a=>inadmissible.has(a.number))?'inadmissible':null;
    const scheme=votingList?.notes?.votingScheme?.find(s=>row.amendments?.some(a=>s.target.amendment===a.number&&(s.target.cp??null)===(a.cp??null))||row.kind==='text'&&s.target.text===row.subject.join(' / '));
    const fallsIf=rows.filter(r=>r.falls?.amendments.some(target=>row.amendments.some(a=>a.number===target.number&&(a.cp??null)===(target.cp??null)))||row.motion&&r.falls?.motions?.includes(row.motion)).map(r=>({key:ballotKey(document,r),amendments:r.amendments.map(a=>a.number),motion:r.motion||null}));
    return {...row,fallsIf,key,documentId:document,revision:votingList?.revision?.sha256||null,status,amendmentRows:attached,partText:scheme?.parts.find(p=>p.index===row.part)?.text||null,decisionId:raw?.activity_id||null,decisionOrder:raw?Number(raw.activity_order):null,outcome:raw?term(raw.decision_outcome):null,binding:raw?'matched':'unbound'};
  }).filter(Boolean);
  // Persisted rows contain only stable identity, never voting-list text or revisions.
  for(const saved of retained)if(!result.some(r=>r.key===saved.key)) {const raw=decisions.find(d=>d.activity_id===saved.decisionId);const numbers=/\:am:([\d+]+)/.exec(saved.key)?.[1]?.split('+').map(Number)||[];result.push({...saved,kind:numbers.length?'amendment':saved.key.includes(':text:')?'text':saved.key.includes(':motion:')?'motion':saved.key.includes(':procedural:')?'procedural':'final',documentId:document,revision:null,part:Number(/:part(\d+)$/.exec(saved.key)?.[1])||null,decisionOrder:raw?Number(raw.activity_order):null,amendments:numbers.map(number=>({number,cp:Number(/:cp(\d+)/.exec(saved.key)?.[1])||null})),amendmentRows:[],subject:saved.key.includes(':text:')?[saved.key.split(':text:')[1].replace(/:part\d+$/,'')]:[],outcome:raw?term(raw.decision_outcome):null,binding:raw?'matched':'unbound'});}
  const counts=new Map();for(const row of result)if(row.decisionId)counts.set(row.decisionId,(counts.get(row.decisionId)||0)+1);
  for(const row of result)if(counts.get(row.decisionId)>1){row.decisionId=null;row.outcome=null;row.binding='unbound';}
  const keys=new Set();for(let i=result.length-1;i>=0;i--)if(keys.has(result[i].key))result.splice(i,1);else keys.add(result[i].key);
  if(decisions.length)result.sort((a,b)=>(a.decisionOrder??(a.row||Infinity))-(b.decisionOrder??(b.row||Infinity)));
  const bound=new Set(result.map(r=>r.decisionId).filter(Boolean));
  const kinds=new Set(rows.map(row=>row.kind==='block'?'amendment':row.kind));
  // Unbound is not evidence of an addition: a same-kind list row remains a
  // possible counterpart, even when exact identity or position disagrees.
  return {rows:result,added:decisions.filter(d=>votingList&&!bound.has(d.activity_id)&&decisionKind(d,derived)&&!kinds.has(decisionKind(d,derived))).map(d=>({decisionId:d.activity_id,label:d.referenceText?.en||'',outcome:term(d.decision_outcome)})),bindings:result.filter(r=>r.decisionId).map(r=>({key:r.key,decisionId:r.decisionId}))};
}
// Largest of For, Against and Abstain; a top tie has no majority. Exclude
// non-attached members and members without verified, dated group membership.
export function groupMajorities(voters) {
  const groups=new Map();for(const voter of voters)if(voter.group?.code&&!['NI','unavailable'].includes(voter.group.code)&&voter.position&&voter.status==='recorded') {const counts=groups.get(voter.group.code)||{for:0,against:0,abstaining:0};if(voter.position in counts)counts[voter.position]++;groups.set(voter.group.code,counts);}
  return [...groups].map(([id,counts])=>{const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);return {id,counts,position:sorted[0][1]>sorted[1][1]?sorted[0][0]:null};});
}
export function retainSittingBallotBindings(store,day,lists) {
  store.assertWriter();
  const context=ballotContext(day);
  for(const votingList of lists) {
    if(!votingList.documentId||!votingList.agendaItemId)continue;
    const ballot=assembleBallot({document:votingList.documentId,agendaItemId:votingList.agendaItemId,day,votingList,context});
    persistBallotBindings(store.db,{sitting:day.sittingId,agenda:votingList.agendaItemId,document:votingList.documentId,bindings:ballot.bindings});
  }
}
