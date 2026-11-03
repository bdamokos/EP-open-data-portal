import {array,tail} from './activity-index-model.mjs';
const canonical=value=>String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
export const legacyAmendmentDocument=id=>/^(?:A|B|RC)-9-\d{4}-\d{4,6}$/.test(id||'');
export function agendaNamesDocument(item,id) {
  return item?.kind==='PLENARY_VOTE'&&item.date>='2024-07-16'&&item.id?.startsWith('MTG-PL-'+item.date+'-OJ-ITM-')&&item.documentIds?.includes(id);
}
export function upcomingAgenda(store,generation) {return store.source(generation,'upcoming:agenda')?.work.items||[];}
export function scheduledVotes(work,list,items,{number=null,votingLists=[] ,today=new Date().toISOString().slice(0,10)}={}) {
  const id=work?.identifier||tail(work?.id);
  return items.filter(item=>agendaNamesDocument(item,id)&&item.date>=today).flatMap(item=>{
    const ballot=votingLists.find(v=>v.sittingId==='MTG-PL-'+item.date&&v.agendaItemId===item.id&&v.documentId===id);
    const base={sittingId:'MTG-PL-'+item.date,agendaItemId:item.id};
    if(ballot)return number!==null&&ballot.rows.some(row=>row.amendments?.some(a=>a.number===number))?[{...base,basis:'voting-list'}]:[];
    // Only exact VOT-ITM events establish a previous plenary vote. DEC/OJ
    // references and later events do not supply a boundary.
    if(!Array.isArray(work?.inverse_based_on_a_realization_of)||!/^\d{4}-\d{2}-\d{2}/.test(list?.document_date||''))return [];
    const previous=array(work.inverse_based_on_a_realization_of).map(canonical).map(ref=>ref.match(/^eli\/dl\/event\/MTG-PL-(\d{4}-\d{2}-\d{2})-VOT-ITM-\d+$/)?.[1]).filter(date=>date&&date<item.date).sort().at(-1)||null;
    return !previous||list.document_date.slice(0,10)>previous?[{...base,basis:'list-date-after-earlier-vote',previousVoteDate:previous,listDate:list.document_date}]:[];
  });
}

export function withScheduledVotes(store,generation,row) {
  if(row.scope==='committee')return row;
  const work=store.source(generation,'/plenary-documents/'+row.targetDocumentId)?.work;
  const items=upcomingAgenda(store,generation),today=new Date(store.clock()).toISOString().slice(0,10);
  const decorate=variant=>({...variant,scheduledVotes:scheduledVotes(work,store.source(generation,'amendment:list:'+variant.listId)?.work,items,{number:row.number,today})});
  return {...decorate(row),...(row.variants?{variants:row.variants.map(decorate)}:{})};
}
