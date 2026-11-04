// Independent acquisition oracle. Reads native template fields, never placement output.
import {XMLParser} from 'fast-xml-parser';
export function distributionOracle(xml,{id}) {
  const tree=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml);
  const runs=[];const walk=nodes=>{for(const n of nodes)for(const [k,v] of Object.entries(n)){if(k==='w:t')runs.push(v.map(x=>x['#text']??'').join(''));else if(Array.isArray(v))walk(v);}};walk(tree);
  const text=runs.join('').replace(/[\u2011\u2013]/g,'-').replace(/<\s*(\/?)\s*(\w[\w-]*)\s*>/g,'<$1$2>');
  const m=id.match(/^(A|B|RC)-(\d+)-(\d{4})-(\d{4})(?:-AM-(\d+)-(\d+))?$/);if(!m)return false;
  const [,kind,term,year,number,first,last]=m;
  const native=kind==='RC'?'B':kind;
  const token=new RegExp('\\b'+native+term+'[-\\s]?'+number+'/'+year+'\\b');
  const type=kind==='A'?'report':kind==='RC'?'joint motion for a resolution':'(?:motion for a resolution|proposal for a decision)';
  const parts=first?text.split('<Amend>').slice(1).map(x=>x.split('</Amend>')[0]):[text];
  if(!parts.length)return false;
  const numbers=new Set();
  for(const part of parts){if(!token.test(part)||!new RegExp('<TitreType>\\s*'+type+'\\s*</TitreType>','i').test(part))return false;if(first){const ns=[...part.matchAll(/<NumAm>\s*(\d+)(?:\/rev)?\s*<\/NumAm>/g)].map(x=>Number(x[1]));if(!ns.length||ns.some(n=>n<Number(first)||n>Number(last)))return false;ns.forEach(n=>numbers.add(n));}}
  return !first||numbers.size===Number(last)-Number(first)+1;
}
