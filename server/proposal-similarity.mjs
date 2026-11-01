// A banded Levenshtein calculation bounds work when a passage cannot meet T.
export const SIMILARITY_THRESHOLD=.95, SIMILARITY_MARGIN=.02;
export const similarityNormal=s=>s.normalize('NFC').replace(/\u00ad/gu,'').replace(/[‘’‚‛ʻʼ]/gu,"'").replace(/[“”„‟«»]/gu,'"').replace(/\s+/gu,' ').trim();
export function characterSimilarity(left,right,threshold=SIMILARITY_THRESHOLD){
 const a=similarityNormal(left),b=similarityNormal(right),length=Math.max(a.length,b.length);
 if(!length)return 1;
 const limit=Math.floor((1-threshold)*length+1e-8);if(Math.abs(a.length-b.length)>limit)return 0;
 let previous=new Map();for(let j=0;j<=Math.min(b.length,limit);j++)previous.set(j,j);
 for(let i=1;i<=a.length;i++){
  const current=new Map();let minimum=Infinity;
  for(let j=Math.max(0,i-limit);j<=Math.min(b.length,i+limit);j++){
   const value=j===0?i:Math.min((current.get(j-1)??Infinity)+1,(previous.get(j)??Infinity)+1,(previous.get(j-1)??Infinity)+(a[i-1]===b[j-1]?0:1));current.set(j,value);minimum=Math.min(minimum,value);
  }
  if(minimum>limit)return 0;previous=current;
 }
 const distance=previous.get(b.length)??Infinity;return distance<=limit?1-distance/length:0;
}
export function similarPassage(rows,original,{threshold=SIMILARITY_THRESHOLD,margin=SIMILARITY_MARGIN}={}){
 const key=similarityNormal(original);if(key.length<30||key.length>10000)return null;
 const candidates=[];
 for(let i=0;i<rows.length;i++){
  if(!/[\p{L}\p{N}]/u.test(rows[i].text))continue;
  let text='';for(let j=i;j<rows.length&&j<i+30;j++){
   text+=(j===i?'':'\n')+rows[j].text;const length=similarityNormal(text).length;
   if(length>key.length/(threshold-margin))break;
   if(length>=key.length*(threshold-margin)&&/[\p{L}\p{N}]/u.test(rows[j].text))candidates.push({start:rows[i].index,end:rows[j].index,similarity:characterSimilarity(text,original,threshold-margin)});
  }
 }
 candidates.sort((a,b)=>b.similarity-a.similarity);
 const best=candidates[0];return best?.similarity>=threshold&&best.similarity-(candidates[1]?.similarity??0)>=margin?best:null;
}
