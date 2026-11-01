import {readFileSync} from 'node:fs';
let metadata;
const catalogue=()=>metadata??=JSON.parse(readFileSync(new URL('./topic-eurovoc-metadata.json',import.meta.url),'utf8'));
const normalize=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function orderRecordKeywords(keywords,{title='',concepts=new Map(),counts=new Map()}={}){
 const text=' '+normalize(title)+' ';
 const evidence=keyword=>{const c=concepts.get(keyword.key)||{},official=catalogue().concepts[c.uri||'http://eurovoc.europa.eu/'+keyword.key.slice(8)]||{},language=keyword.language||'en',alternatives=c.alternatives||official.alternatives||{},labels=[c.labels?.[language]||c.labels?.en||keyword.label,...(alternatives[language]||alternatives.en||[])];return {hit:labels.some(label=>{const phrase=normalize(label);return phrase&&text.includes(' '+phrase+' ');}),micro:c.microthesauri||official.microthesauri||[]};};
 const ordered=keywords.map(k=>({keyword:k,...evidence(k)})).sort((a,b)=>Number(b.hit)-Number(a.hit)||(counts.get(b.keyword.key)||0)-(counts.get(a.keyword.key)||0)||(a.keyword.key<b.keyword.key?-1:a.keyword.key>b.keyword.key?1:0));
 const third=ordered[2],different=Boolean(third?.micro.length&&ordered.slice(0,2).every(k=>k.micro.length&&k.micro.every(mt=>!third.micro.includes(mt))));
 return ordered.map((r,i)=>({...r.keyword,featured:i<2||i===2&&different}));
}
