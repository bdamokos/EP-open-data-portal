import {XMLParser} from 'fast-xml-parser';
// Candidates are retrieval routes, not declarations of published language editions.
const values=v=>v==null?[]:Array.isArray(v)?v:[v];
export function distributionCandidate(work,language='en') {
  if(!/^[a-z]{2}$/.test(language)||values(work?.is_realized_by).some(e=>values(e.is_embodied_by).length))return null;
  const id=work?.identifier||String(work?.id||'').split('/').at(-1),match=id?.match(/^(A|B|RC)-(9|10)-(\d{4})-(\d{4})(-AM-(\d+)-(\d+))?$/);
  if(!match)return null;
  const type=String(work.work_type?.id||work.work_type||'').split('/').at(-1),list=Boolean(match[5]);
  if(type!==(list?'AMENDMENT_LIST':match[1]==='B'?'RESOLUTION_MOTION':match[1]==='RC'?'RESOLUTION_MOTION_JOINT':null))return null;
  if(list&&(Number(match[6])<1||Number(match[7])<Number(match[6])||Number(match[7])-Number(match[6])>=500))return null;
  const dir={A:'reds_iPlRp',B:'reds_iPlRe',RC:'reds_iPlRc'}[match[1]]+(list?'_Amd':'');
  return {url:`https://data.europarl.europa.eu/distribution/${dir}/${id}/${id}_${language}.docx`,language,format:'DOCX',byteSize:null,issued:null,identityRequired:true,documentId:id};
}
export function nativeDistributionText(xml) {
  const tree=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml),runs=[];
  const walk=nodes=>{for(const node of nodes)for(const [key,value] of Object.entries(node)){if(key==='w:t')runs.push(value.map(v=>v['#text']??'').join(''));else if(Array.isArray(value))walk(value);}};walk(tree);return runs.join('');
}
export function verifyDistributionText(paragraphs,id) {
  const match=id.match(/^(A|B|RC)-(9|10)-(\d{4})-(\d{4})(?:-AM-(\d+)-(\d+))?$/);if(!match)return false;
  const [,kind,term,year,number,first,last]=match;
  const text=paragraphs.join('\n').replace(/[\u2011\u2013]/g,'-').replace(/<\s*(\/?)\s*([\w-]+)\s*>/g,'<$1$2>');
  const blocks=first?text.split('<Amend>').slice(1).map(x=>x.split('</Amend>')[0]):[text];
  if(!blocks.length)return false;
  const token=new RegExp('\\b'+(kind==='RC'?'B':kind)+term+'[-\\s]?'+number+'/'+year+'\\b'),type={A:'report',B:'(?:motion for a resolution|proposal for a decision)',RC:'joint motion for a resolution'}[kind];
  const seen=new Set();
  for(const block of blocks) {
    if(!token.test(block)||!new RegExp('<TitreType>\\s*'+type+'\\s*</TitreType>','i').test(block))return false;
    if(first){const numbers=[...block.matchAll(/<NumAm>\s*(\d+)(?:\/rev)?\s*<\/NumAm>/g)].map(m=>Number(m[1]));if(!numbers.length||numbers.some(n=>n<Number(first)||n>Number(last)))return false;for(const n of numbers)seen.add(n);}
  }
  return !first||seen.size===Number(last)-Number(first)+1;
}
export function requireDistributionIdentity(paragraphs,id) {
  if(!verifyDistributionText(paragraphs,id))throw Object.assign(new Error('Standard distribution file does not prove its exact document identity, class and amendment range.'),{code:'distribution_identity_unverified'});
}
