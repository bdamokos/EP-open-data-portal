// Native Poppler geometry only. This module never reads projected note anchors.
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const decode=s=>s.replace(/&#(x[0-9a-f]+|\d+);/giu,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&lt;/gu,'<').replace(/&gt;/gu,'>').replace(/&quot;/gu,'"').replace(/&apos;/gu,"'").replace(/&amp;/gu,'&');
export function councilNativeSuperscripts(raw,bbox){
 const pages=raw.split('\f'),native=[...String(bbox??'').matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/gu)];
 if(native.length!==pages.filter(p=>p.trim()).length)return raw;
 const attribute=(s,key)=>Number(new RegExp('\\b'+key+'="([\\d.]+)"','u').exec(s)?.[1]);
 for(const [i,page] of native.entries()){
  const words=[...page[2].matchAll(/<word\b([^>]*)>([^<]*)<\/word>/gu)].map(m=>({text:decode(m[2]),x:attribute(m[1],'xMin'),right:attribute(m[1],'xMax'),top:attribute(m[1],'yMin'),bottom:attribute(m[1],'yMax')}));
  const heights=words.map(w=>w.bottom-w.top).filter(h=>h>0).sort((a,b)=>a-b),height=heights[Math.floor(heights.length/2)],left=Math.min(...words.map(w=>w.x)),pageHeight=attribute(page[1],'height');
  if(!height||!Number.isFinite(pageHeight))continue;
  const small=w=>/^\d{1,3}$/u.test(w.text)&&w.bottom-w.top<height*.8;
  const notes=words.filter(w=>small(w)&&Math.abs(w.x-left)<1&&w.top>pageHeight*2/3);
  for(const [j,mark] of words.entries()){
   if(!small(mark)||mark.x-left<=1||notes.filter(n=>n.text===mark.text).length!==1)continue;
   const previous=words[j-1],next=words[j+1];
   if(!previous||!next||previous.bottom-previous.top<height*.9||mark.bottom>previous.bottom-1||Math.abs(mark.top-previous.top)>height||mark.x-previous.right<-.2||mark.x-previous.right>3)continue;
   const pattern=new RegExp('('+escape(previous.text)+')\\s*'+escape(mark.text)+'(?=\\s*'+escape(next.text)+')','gu');
   const matches=[...pages[i].matchAll(pattern)];if(matches.length!==1)continue;
   pages[i]=pages[i].replace(pattern,'$1');
  }
 }return pages.join('\f');
}
