const labels = {'org/COM':'Commission','org/CS':'Council'};
const array=value=>value==null?[]:Array.isArray(value)?value:[value];

function reference(value) {
  let id=typeof value==='string'?value:value?.id;
  if(typeof id!=='string')return null;
  if(id.includes('://')) {
    try {
      const url=new URL(id);
      if(!['http:','https:'].includes(url.protocol)||url.hostname!=='data.europarl.europa.eu'||url.port||url.username||url.password||url.search||url.hash)return null;
      id=url.pathname.slice(1);
    }catch{return null;}
  }
  return id;
}
export const organizationId=value=>/^org\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(reference(value)||'')?reference(value):null;
export const validAddresseeFilter=value=>value==='unavailable'||typeof value==='string'&&organizationId(value)===value;
export const addresseeLabel=id=>id==='unavailable'?'Addressee unavailable':labels[id]||id;
export const questionNumber=id=>/^([EPO])-\d{1,2}-(\d{4})-(\d{6})$/.test(id)?id.replace(/^([EPO])-\d{1,2}-(\d{4})-(\d{6})$/,'$1-$3/$2'):id;

// Use only explicit addressee participation, never authors or answer creators.
export function questionAddressees(work) {
  const found=new Map();
  for(const participation of array(work?.workHadParticipation)) {
    if(reference(participation?.participation_role)!=='def/ep-roles/ADDRESSEE')continue;
    for(const organization of array(participation.had_participant_organization)) {
      const id=organizationId(organization);if(!id)continue;
      const entry=found.get(id)||{id,uri:'https://data.europarl.europa.eu/'+id,label:addresseeLabel(id),participationIds:[]};
      if(typeof participation.id==='string'&&!entry.participationIds.includes(participation.id))entry.participationIds.push(participation.id);
      found.set(id,entry);
    }
  }
  return [...found.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export function matchesAddressee(addressees,selected) {
  return !selected||(selected==='unavailable'?!addressees?.length:addressees?.some(item=>item.id===selected));
}
