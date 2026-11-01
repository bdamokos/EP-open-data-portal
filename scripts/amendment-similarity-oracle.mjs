// Full Wagner-Fischer distance, deliberately separate from the production
// banded matcher. Bound candidates by independently addressed raw source rows.
const normal=s=>s.normalize('NFC').replace(/\u00ad/gu,'').replace(/[‘’‚‛ʻʼ]/gu,"'").replace(/[“”„‟«»]/gu,'"').replace(/\s+/gu,' ').trim();
export function oracleSimilarity(a,b){
 a=normal(a);b=normal(b);if(!a.length||!b.length)return a===b?1:0;
 let previous=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));previous=row;}
 return 1-previous[b.length]/Math.max(a.length,b.length);
}
export function assertSimilarityRows(rows,original,span,{threshold=.95,margin=.05}={}){
 const key=normal(original);if(key.length<30||key.length>10000)return false;
 const scores=[];
 for(let i=0;i<rows.length;i++){
  if(!/[\p{L}\p{N}]/u.test(rows[i].text))continue;
  let text='';for(let j=i;j<rows.length&&j<i+30;j++){
   text+=(j===i?'':'\n')+rows[j].text;const length=normal(text).length;
   if(length>key.length/threshold)break;
   if(length>=key.length*threshold&&/[\p{L}\p{N}]/u.test(rows[j].text))scores.push({start:rows[i].index,end:rows[j].index,score:oracleSimilarity(text,original)});
  }
 }
 scores.sort((a,b)=>b.score-a.score);
 return scores[0]?.score>=threshold&&scores[0].score-(scores[1]?.score??0)>=margin&&scores[0].start===span.start&&scores[0].end===span.end;
}
