const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// Keep the original spelling and spacing, including decomposed accents and ligatures.
export function speechHighlightParts(text,term) {
  const value=String(text??''),needle=String(term??'').normalize('NFKC').trim();
  if(!needle)return [{text:value,match:false}];
  const normalized=value.normalize('NFKC');
  let offsets;
  if(normalized!==value){
    offsets=[];
    for(const part of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(value)){
      const size=part.segment.normalize('NFKC').length;
      for(let i=0;i<size;i++)offsets.push([part.index,part.index+part.segment.length]);
    }
  }
  const pattern=needle.split(/\s+/u).map(escape).join('\\s+');
  const matcher=new RegExp('(?<![\\p{L}\\p{M}\\p{N}])'+pattern+'(?![\\p{L}\\p{M}\\p{N}])','giu');
  const parts=[];let cursor=0;
  for(const found of normalized.matchAll(matcher)){
    const start=offsets?offsets[found.index][0]:found.index;
    const end=offsets?offsets[found.index+found[0].length-1][1]:found.index+found[0].length;
    if(start<cursor)continue;
    if(start>cursor)parts.push({text:value.slice(cursor,start),match:false});
    parts.push({text:value.slice(start,end),match:true});cursor=end;
  }
  if(cursor<value.length||!parts.length)parts.push({text:value.slice(cursor),match:false});
  return parts;
}
