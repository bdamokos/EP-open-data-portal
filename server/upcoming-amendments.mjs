import {array,tail} from './activity-index-model.mjs';
const canonical=value=>String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
export const legacyAmendmentDocument=id=>/^(?:A|B|RC)-9-\d{4}-\d{4,6}$/.test(id||'');
export function agendaNamesDocument(item,id) {
  return item?.kind==='PLENARY_VOTE'&&item.date>='2024-07-16'&&item.id?.startsWith('MTG-PL-'+item.date+'-OJ-ITM-')&&item.documentIds?.includes(id);
}
export function upcomingSource(store,generation,key) {const row=store.db.prepare('SELECT body FROM sources WHERE generation=? AND key=?').get(generation,key);return row?JSON.parse(row.body):null;}
export function upcomingAgenda(store,generation) {return upcomingSource(store,generation,'upcoming:agenda')?.items||[];}
export function scheduledVotes(work,list,items,{number=null,votingLists=[] ,today=new Date().toISOString().slice(0,10)}={}) {
  const id=work?.identifier||tail(work?.id);
  if((work?.plenaryVoteHistoryObserved===false||!Array.isArray(work?.inverse_based_on_a_realization_of)||!/^\d{4}-\d{2}-\d{2}/.test(list?.document_date||''))&&!votingLists.length)return null;
  return items.filter(item=>agendaNamesDocument(item,id)&&item.date>=today).flatMap(item=>{
    const ballot=votingLists.find(v=>v.sittingId==='MTG-PL-'+item.date&&v.agendaItemId===item.id&&v.documentId===id);
    const base={sittingId:'MTG-PL-'+item.date,agendaItemId:item.id};
    if(ballot){const numbers=new Set(number===null?(list?.extraction?.amendments||[]).map(a=>a.number):[number]);return ballot.rows.some(row=>row.amendments?.some(a=>numbers.has(a.number)))?[{...base,basis:'voting-list'}]:[];}
    // Only exact VOT-ITM events establish a previous plenary vote. DEC/OJ
    // references and later events do not supply a boundary.
    if(work?.plenaryVoteHistoryObserved===false||!Array.isArray(work?.inverse_based_on_a_realization_of)||!/^\d{4}-\d{2}-\d{2}/.test(list?.document_date||''))return [];
    const previous=array(work.inverse_based_on_a_realization_of).map(canonical).map(ref=>({id:ref,date:ref.match(/^eli\/dl\/event\/MTG-PL-(\d{4}-\d{2}-\d{2})-VOT-ITM-\d+$/)?.[1]})).filter(event=>event.date&&event.date<item.date).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)).at(-1)||null;
    return !previous||list.document_date.slice(0,10)>previous.date?[{...base,basis:'list-date-after-earlier-vote',previousVoteDate:previous?.date||null,previousVoteId:previous?.id||null,listDate:list.document_date}]:[];
  });
}

// PR 1's store reader can supply official ballots without changing the exact
// classifier or the API fields. Until it is installed, list-date scope applies.
export function upcomingVotingLists(store,items) {return [...new Set(items.map(item=>'MTG-PL-'+item.date))].flatMap(sitting=>store.votingListsForSitting?.(sitting)||[]);}
export function upcomingScopeContext(store,generation) {
  const agenda=upcomingSource(store,generation,'upcoming:agenda');
  return {agenda,items:agenda?.items||[],sources:new Map(),today:new Date(store.clock?.()??Date.now()).toISOString().slice(0,10)};
}
export function withScheduledVotes(store,generation,row,context=upcomingScopeContext(store,generation)) {
  if(row.scope==='committee')return row;
  const read=key=>{if(!context.sources.has(key))context.sources.set(key,upcomingSource(store,generation,key));return context.sources.get(key);};
  const work=context.agenda?read('/plenary-documents/'+row.targetDocumentId):null;
  const votingLists=context.agenda?upcomingVotingLists(store,context.items):[];
  const decorate=variant=>({...variant,scheduledVotes:!context.agenda?null:scheduledVotes(work,read('amendment:list:'+variant.listId),context.items,{number:row.number,today:context.today,votingLists})});
  return {...decorate(row),...(row.variants?{variants:row.variants.map(decorate)}:{})};
}
