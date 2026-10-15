import {readFileSync} from 'node:fs';

const authority=JSON.parse(readFileSync(new URL('./insights-country-labels.json',import.meta.url),'utf8'));
const normalize=value=>String(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const aliases={GBR:['UK','U.K.','Britain'],USA:['US','U.S.','USA','United States of America'],TUR:['Turkey'],VNM:['Vietnam'],CZE:['Czech Republic'],RUS:['Russian Federation'],KOR:['Republic of Korea'],PRK:['Democratic People’s Republic of Korea'],CIV:['Ivory Coast']};
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=authority.labels.flatMap(place=>[place.label,...(aliases[place.id]||[])].map(label=>({place,label:normalize(label),short:/^[A-Z.]{2,5}$/.test(label)})));
const labels=new Map(patterns.map(entry=>[entry.label,entry]));
// One longest-name scan avoids testing every country against every title.
const placePattern=new RegExp('(?<![\\p{L}])(?:'+[...labels.keys()].sort((a,b)=>b.length-a.length).map(label=>escape(label).replaceAll(' ','[ -]+')).join('|')+')(?![\\p{L}])','gu');
const cache=new Map();
export function titlePlaces(title) {
  const raw=String(title||'');if(cache.has(raw))return cache.get(raw);
  const text=normalize(raw),candidates=[];
  for(const match of text.matchAll(placePattern)) {
    const entry=labels.get(match[0].replace(/[ -]+/g,' '))||labels.get(match[0]);if(!entry)continue;
    if(entry.short&&!/^[A-Z.]+$/.test(raw.slice(match.index,match.index+match[0].length)))continue;
    candidates.push({id:entry.place.id,label:entry.place.label,start:match.index,end:match.index+match[0].length});
  }
  candidates.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start);
  const spans=[],places=new Map();
  for(const match of candidates)if(!spans.some(s=>match.start<s.end&&match.end>s.start)){spans.push(match);places.set(match.id,{id:match.id,label:match.label,token:normalize(match.label).replace(/[^\p{L}]+/gu,'-').replace(/^-|-$/g,'')});}
  const result={places:[...places.values()],text:text.split('').map((c,i)=>spans.some(s=>i>=s.start&&i<s.end)?' ':c).join('')};
  cache.set(raw,result);if(cache.size>6000)cache.delete(cache.keys().next().value);return result;
}
export const countryLabelSource={url:authority.sourceUrl,scheme:authority.scheme,fetchedAt:authority.fetchedAt,count:authority.labels.length};
