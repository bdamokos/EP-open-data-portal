// Exact reference forms a search query can be. Parsing never consults data.
const documentForms=[
  /^(A|B|RC|T|C)(\d{1,2})-(\d{4})\/(\d{4})$/i,
  /^(A|B|RC|TA|C)-(\d{1,2})-(\d{4})-(\d{4})$/i,
];
const committeeDocument=/^((?:[A-Z]{3,5}|CJ\d{2})-(?:AM|PR|PA|AD|AL)-\d{4,9})$/i;

export function searchReference(text) {
  const value=String(text??'').trim().replace(/\s+/g,' ');
  const procedure=value.match(/^(\d{4})\/(\d{4}[A-Z]?)(?:\(([A-Z]{2,8})\))?$/)||value.match(/^(\d{4})-(\d{4}[A-Z]?)()$/);
  if(procedure)return {kind:'dossier',process:procedure[1]+'-'+procedure[2],type:procedure[3]||null};
  const plenary=documentForms[0].exec(value),dashed=documentForms[1].exec(value);
  if(plenary||dashed) {
    const [prefix,term,year,number]=plenary?[plenary[1],plenary[2],plenary[4],plenary[3]]:[dashed[1],dashed[2],dashed[3],dashed[4]];
    const code=prefix.toUpperCase().replace(/^T$/,'TA'),id=`${code}-${Number(term)}-${year}-${number}`;
    return {kind:'document',id,keys:['/'+(code==='TA'?'adopted-texts':'plenary-documents')+'/'+id]};
  }
  const committee=value.match(committeeDocument);
  if(committee) {
    const id=committee[1].toUpperCase();
    return {kind:'document',id,keys:['/documents/'+id,'/committee-documents/'+id,'committee:association:'+id]};
  }
  const commission=value.match(/^COM ?\((\d{4})\) ?0*(\d{1,4})(?: final)?$/i);
  if(commission)return {kind:'commission',key:`com:${commission[1]}/${Number(commission[2])}`,label:`COM(${commission[1]}) ${Number(commission[2])}`};
  const member=value.match(/^(MEP )?(\d{6})$/i);
  if(member)return {kind:'member',id:member[2],explicit:Boolean(member[1])};
  return null;
}
