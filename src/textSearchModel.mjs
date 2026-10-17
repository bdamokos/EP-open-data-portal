// FTS excerpts are plain text with two marker characters, never HTML.
export function searchSnippetParts(value) {
  const parts=[];let marked=false;
  for(const part of String(value??'').split(/([\u0002\u0003])/u)) {
    if(part==='\u0002')marked=true;
    else if(part==='\u0003')marked=false;
    else if(part)parts.push({text:part,match:marked});
  }
  return parts;
}

export function searchRangeParts(value,ranges) {
  const text=String(value??''),parts=[];let cursor=0;
  for(const range of ranges||[]){
    if(!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<cursor||range.end<=range.start||range.end>text.length)continue;
    if(range.start>cursor)parts.push({text:text.slice(cursor,range.start),match:false});
    parts.push({text:text.slice(range.start,range.end),match:true});cursor=range.end;
  }
  if(cursor<text.length)parts.push({text:text.slice(cursor),match:false});
  return parts;
}

export const textReadKey=hit=>JSON.stringify([hit.sourceId,hit.sourceKey]);
export function parseTextReadKey(value) {
  try{const pair=JSON.parse(value);return Array.isArray(pair)&&pair.length===2&&pair.every(v=>typeof v==='string'&&v.length>0&&v.length<=200)?{sourceId:pair[0],sourceKey:pair[1]}:null;}catch{return null;}
}

// Browser find uses accent-insensitive literal matching and retains UTF-16
// offsets in the original text, including decomposed accents and ligatures.
export function findTextOffsets(value,query,limit=1000) {
  const fold=s=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase();
  const needle=fold(String(query).trim());if(!needle)return [];
  let text='';const starts=[],ends=[];
  for(const part of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(String(value))) {
    const normalized=fold(part.segment);text+=normalized;
    for(let i=0;i<normalized.length;i++){starts.push(part.index);ends.push(part.index+part.segment.length);}
  }
  const hits=[];let cursor=0;
  while(hits.length<limit){const index=text.indexOf(needle,cursor);if(index<0)break;hits.push({start:starts[index],end:ends[index+needle.length-1]});cursor=index+needle.length;}
  return hits;
}
