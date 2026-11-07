import {array,procedureIds} from './activity-index-model.mjs';
import {amendmentGeneration} from './amendments-store.mjs';
import {upcomingSource} from './upcoming-amendments.mjs';
const DAY=86400000;
const tail=x=>String(x?.id||x||'').split('/').at(-1);
const itemId=node=>node.activity_id||tail(node.id);
const kind=node=>tail(node.had_activity_type);
const documents=node=>array(node.based_on_a_realization_of).map(tail);
// Newly tabled reports can lack the procedure link and carry only its tabling event.
function documentProcedures(work) {
  const events=array(work?.inverse_based_on_a_realization_of).map(tail).flatMap(id=>/^(\d{4}-\d{4}[A-Z]?)-DEPOT-/.exec(id)?.[1]||[]);
  return [...new Set([...(work?procedureIds(work):[]),...events])];
}
function debateItem(work,sittingId) {
  const day=Date.parse(sittingId.slice(7)),found=array(work?.inverse_based_on_a_realization_of).map(tail).filter(id=>{
    const date=/^MTG-PL-(\d{4}-\d{2}-\d{2})-OJ-ITM-D-\d+$/.exec(id)?.[1];
    return date&&Date.parse(date)<=day&&day-Date.parse(date)<7*DAY;
  });
  return new Set(found).size===1?found[0]:null;
}
// The voting slot's document-less debate item ("Texts on which debate is
// closed") is recognised by its place on the agenda, never by its title.
function closedDebateItem(agenda) {
  const votes=new Set(agenda.filter(n=>kind(n)==='PLENARY_VOTE').map(n=>tail(n.id||n.activity_id)));
  const slots=agenda.filter(n=>kind(n)==='MEETING_PART'&&array(n.consists_of).some(ref=>votes.has(tail(ref))));
  const children=new Set(slots.flatMap(n=>array(n.consists_of).map(tail)));
  const found=agenda.filter(n=>kind(n)==='PLENARY_DEBATE'&&children.has(itemId(n))&&!documents(n).length&&!array(n.inverse_was_scheduled_in).length);
  return found.length===1?itemId(found[0]):null;
}
// A voting list proves that its document is voted in that sitting, but the
// agenda can lag: a document-less vote item or no vote item until after the vote.
export function placeVotingLists(lists,agenda,sourceOf) {
  const votes=agenda.filter(n=>kind(n)==='PLENARY_VOTE');
  return lists.map(list=>{
    const id=list.documentId;if(!id)return list;
    const named=votes.filter(n=>documents(n).includes(id));
    if(named.length===1)return {...list,agendaItemId:itemId(named[0]),placement:'vote-item'};
    if(named.length)return list;
    if(list.agendaItemId)return {...list,placement:'vote-item'};
    const work=sourceOf(id),procedures=documentProcedures(work);
    const same=votes.filter(n=>!documents(n).length&&array(n.inverse_was_scheduled_in).some(ref=>procedures.includes(tail(ref))));
    if(same.length===1)return {...list,agendaItemId:itemId(same[0]),placement:'procedure'};
    const debate=debateItem(work,list.sittingId),closed=closedDebateItem(agenda),primary=debate||closed;
    return primary?{...list,agendaItemId:primary,placement:'debate',alsoOn:debate&&closed?[closed]:[],procedureIds:procedures}:list;
  });
}
export function heldDocument(store,id) {
  return store?.db?upcomingSource(store,amendmentGeneration(store),'/plenary-documents/'+id):null;
}
