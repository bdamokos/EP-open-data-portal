import {array,tail} from './activity-index-model.mjs';
import {brusselsDay} from './analysis-period.mjs';
const canonical=value=>String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
export const legacyAmendmentDocument=id=>/^(?:A|B|RC)-9-\d{4}-\d{4,6}$/.test(id||'');
export function agendaNamesDocument(item,id) {
  return item?.kind==='PLENARY_VOTE'&&item.date>='2024-07-16'&&item.id?.startsWith('MTG-PL-'+item.date+'-OJ-ITM-')&&item.documentIds?.includes(id);
}
export function upcomingSource(store,generation,key) {const row=store.db.prepare('SELECT body FROM sources WHERE generation=? AND key=?').get(generation,key);return row?JSON.parse(row.body):null;}
export function upcomingAgenda(store,generation) {return upcomingSource(store,generation,'upcoming:agenda')?.items||[];}
export function scheduledVotes(work,list,items,{number=null,votingLists=[],today=brusselsDay()}={}) {
  const id=work?.identifier||tail(work?.id);
  const candidates=items.filter(item=>agendaNamesDocument(item,id)&&item.date>=today);
  // No matching upcoming agenda item is a known empty scope, even when
  // earlier plenary history has not been observed.
  if(!candidates.length)return [];
  const ballotFor=item=>votingLists.find(v=>v.sittingId==='MTG-PL-'+item.date&&v.agendaItemId===item.id&&v.documentId===id);
  // Held projections predate the history-observed flag. Their array alone
  // cannot prove there was no earlier vote; only an exact ballot can classify.
  const historyKnown=work?.plenaryVoteHistoryObserved===true&&Array.isArray(work?.inverse_based_on_a_realization_of)&&/^\d{4}-\d{2}-\d{2}/.test(list?.document_date||'');
  if(!historyKnown&&candidates.some(item=>!ballotFor(item)))return null;
  return candidates.flatMap(item=>{
    const ballot=ballotFor(item);
    const base={sittingId:'MTG-PL-'+item.date,agendaItemId:item.id};
    if(ballot){const numbers=new Set(number===null?(list?.extraction?.amendments||[]).map(a=>a.number):[number]);return ballot.rows.some(row=>row.amendments?.some(a=>numbers.has(a.number)))?[{...base,basis:'voting-list'}]:[];}
    // Only exact VOT-ITM events establish a previous plenary vote. DEC/OJ
    // references and later events do not supply a boundary.
    const previous=array(work.inverse_based_on_a_realization_of).map(canonical).map(ref=>({id:ref,date:ref.match(/^eli\/dl\/event\/MTG-PL-(\d{4}-\d{2}-\d{2})-VOT-ITM-\d+$/)?.[1]})).filter(event=>event.date&&event.date<item.date).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)).at(-1)||null;
    return !previous||list.document_date.slice(0,10)>previous.date?[{...base,basis:'list-date-after-earlier-vote',previousVoteDate:previous?.date||null,previousVoteId:previous?.id||null,listDate:list.document_date}]:[];
  });
}

// PR 1's store reader can supply official ballots without changing the exact
// classifier or the API fields. Until it is installed, list-date scope applies.
export function upcomingVotingLists(store,items) {return [...new Set(items.map(item=>'MTG-PL-'+item.date))].flatMap(sitting=>store.votingListsForSitting?.(sitting)||[]);}
export function upcomingScopeContext(store,generation) {
  const agenda=upcomingSource(store,generation,'upcoming:agenda');
  const items=agenda?.items||[];
  return {agenda,items,votingLists:upcomingVotingLists(store,items),sources:new Map(),today:brusselsDay(store.clock?.()??Date.now())};
}
export function withScheduledVotes(store,generation,row,context=upcomingScopeContext(store,generation)) {
  if(row.scope==='committee')return row;
  const read=key=>{if(!context.sources.has(key))context.sources.set(key,upcomingSource(store,generation,key));return context.sources.get(key);};
  const work=context.agenda?read('/plenary-documents/'+row.targetDocumentId):null;
  const decorate=variant=>({...variant,scheduledVotes:!context.agenda?null:scheduledVotes(work||{identifier:row.targetDocumentId},read('amendment:list:'+variant.listId),context.items,{number:row.number,today:context.today,votingLists:context.votingLists})});
  return {...decorate(row),...(row.variants?{variants:row.variants.map(decorate)}:{})};
}
