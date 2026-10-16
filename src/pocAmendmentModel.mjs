const outcomes = {ADOPTED:'Adopted',REJECTED:'Rejected',LAPSED:'Lapsed',WITHDRAWN:'Withdrawn',mixed:'Mixed outcomes',unavailable:'Outcome unavailable'};
export const amendmentOutcomeLabel = value => outcomes[value] || outcomes.unavailable;
export function amendmentProcedure(value) {
  let reference=String(value||'').trim();
  if(/^https?:\/\//i.test(reference)){try{reference=new URL(reference).searchParams.get('reference')||reference;}catch{/* Keep invalid input for the API's explicit validation. */}}
  const match=reference.match(/^(\d{4})[/-](\d{4})([A-Z]?)(?:\([A-Z]{2,8}\))?$/i);
  return match ? `${match[1]}-${match[2]}${match[3].toUpperCase()}` : reference;
}
export function amendmentRoute({document,procedure,member,outcome,offset=0,language='en',limit=20}={}) {
  const params=new URLSearchParams({lang:language,limit:String(limit),offset:String(Math.max(0,Number.isSafeInteger(offset)?offset:0))});
  if(document)params.set('document',document);
  if(procedure)params.set('procedure',amendmentProcedure(procedure));
  if(member&&/^[1-9]\d*$/.test(String(member)))params.set('member',String(member));
  if(Object.hasOwn(outcomes,outcome)&&outcome!=='')params.set('outcome',outcome);
  return 'amendments?'+params;
}
export function amendmentHref(path,{document,procedure,member,language='en'}={}) {
  const params=new URLSearchParams({poc:'1',lang:language,view:'amendments'});
  if(document)params.set('am-document',document);
  if(procedure)params.set('am-procedure',procedure);
  if(member)params.set('am-member',String(member));
  return path+'?'+params;
}
export function amendmentGroups(items,by='dossier') {
  const groups=new Map();
  for(const item of items) {
    let key,label,basis;
    if(by==='target'){key=item.targetLabel||'unknown';label=item.targetLabel||'Target provision unavailable';basis='Target provision in the amendment document';}
    else if(by==='topic') {const topic=item.topics?.[0];key=topic?`${topic.basis}:${topic.id}`:'unknown';label=topic?.label||'Topic unavailable';basis=topic?.basis==='dossier'?'Dossier subject classification':topic?.basis==='target'?'Target provision':'No topic classification recorded';}
    else {const procedure=item.procedureIds?.[0];key=procedure||item.targetDocumentId||'unknown';label=procedure||item.targetDocumentId||'Dossier unavailable';basis=procedure?'Exact procedure reference':'Target document';}
    if(!groups.has(key))groups.set(key,{id:key,label,basis,items:[]});
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}
export function amendmentDecisionScope(item,decision) {
  if(decision.partId||decision.partNumber!==undefined&&decision.partNumber!==null)return 'Split part'+(decision.partNumber!==undefined&&decision.partNumber!==null?' '+decision.partNumber:'');
  if(decision.collective||decision.amendmentIds?.length>1)return 'Collective decision';
  if(item.splitParts?.length)return 'Amendment decision';
  return 'Whole amendment';
}
export function amendmentDecisionPart(parts,decision) {
  // An explicit ID always takes precedence, including when that ID is not indexed.
  if(decision.partId)return parts.find(part=>part.id===decision.partId)||null;
  if(decision.partNumber===undefined||decision.partNumber===null)return null;
  const candidates=parts.filter(part=>part.number!==undefined&&part.number!==null&&String(part.number)===String(decision.partNumber));
  return candidates.length===1?candidates[0]:null;
}
export function publicAmendmentSource(value) {
  try {const url=new URL(typeof value==='string'?value:value?.url);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
const quoted=value=>typeof value==='string'&&value?`“${value}”`:'';
// Summarise supported, explicitly typed plans; never manufacture a text selection.
export function amendmentPlanSummary(plan) {
  if(!plan||typeof plan!=='object')return [];
  const describe=(node,depth=0)=>{
    if(!node||typeof node!=='object'||depth>8)return null;
    let text;
    if(node.type==='all')text='The whole amendment text';
    else if(node.type==='text'&&quoted(node.quote))text='The text '+quoted(node.quote);
    else if(node.type==='delete_operation'&&quoted(node.quote))text='The amendment’s deletion of '+quoted(node.quote)+' (an edit operation)';
    else if(node.type==='character'&&quoted(node.character)&&quoted(node.within)&&Number.isInteger(node.characterOccurrence))text='Occurrence '+node.characterOccurrence+' of '+quoted(node.character)+' within '+quoted(node.within);
    else if(node.type==='difference'){
      const base=describe(node.base,depth+1),except=describe(node.except,depth+1);
      if(!base||!except)return null;
      text=base+', excluding '+(node.except?.type==='union'?'('+except+')':except);
    }
    else if(node.type==='union'){
      if(!Array.isArray(node.items)||!node.items.length)return null;
      const items=node.items.map(item=>describe(item,depth+1));
      if(items.some(item=>!item))return null;
      text=items.join('; together with ');
    }
    else return null;
    if(Array.isArray(node.occurrences)&&node.occurrences.length)text+=' · occurrence'+(node.occurrences.length===1?' ':'s ')+node.occurrences.join(', ');
    else if(Number.isInteger(node.expectedCount))text+=' · '+node.expectedCount+' expected occurrence'+(node.expectedCount===1?'':'s');
    if(node.scope){const scope=describe(node.scope,depth+1);if(!scope)return null;text+=' · within '+scope;}
    return text;
  };
  const description=describe(plan);
  return description?[description]:[];
}
