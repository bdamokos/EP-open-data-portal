// Full Wagner-Fischer distance, deliberately separate from the production
// banded matcher. Bound candidates by independently addressed raw source rows.
const normal=s=>s.normalize('NFC').replace(/\u00ad/gu,'').replace(/[‘’‚‛ʻʼ]/gu,"'").replace(/[“”„‟«»]/gu,'"').replace(/\s+/gu,' ').trim();
export function oracleSimilarity(a,b){
 a=normal(a);b=normal(b);if(!a.length||!b.length)return a===b?1:0;
 let previous=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));previous=row;}
 return 1-previous[b.length]/Math.max(a.length,b.length);
}
export function assertSimilarityRows(rows,original,span,{threshold=.95,margin=.02}={}){
 const key=normal(original);if(key.length<30||key.length>10000)return false;
 const scores=[];
 for(let i=0;i<rows.length;i++){
  if(!/[\p{L}\p{N}]/u.test(rows[i].text))continue;
  let text='';for(let j=i;j<rows.length&&j<i+30;j++){
   text+=(j===i?'':'\n')+rows[j].text;const length=normal(text).length;
   if(length>key.length/(threshold-margin))break;
   if(length>=key.length*(threshold-margin)&&/[\p{L}\p{N}]/u.test(rows[j].text))scores.push({start:rows[i].index,end:rows[j].index,score:oracleSimilarity(text,original)});
  }
 }
 scores.sort((a,b)=>b.score-a.score);
 return scores[0]?.score>=threshold&&scores[0].score-(scores[1]?.score??0)>=margin&&scores[0].start===span.start&&scores[0].end===span.end;
}

export function assertSimilarPlacement({proposal,wording,placement,address}){
 if(address.status!=='verified'||!placement.span||!placement.splice||!address.rawSourceRows)return {status:'unverified',reason:'oracle-similarity-address-unavailable'};
 const [,start,end]=address.rawSourceRows,span=placement.span;
 const rows=proposal.paragraphs.slice(start,end);
 if(placement.splice.start.offset!==0||placement.splice.end.offset!==proposal.paragraphs[span.end]?.text.length)return {status:'unverified',reason:'oracle-similarity-partial-row'};
 return assertSimilarityRows(rows,wording.originalText,span)?{status:'verified',reason:'oracle-independent-unique-similarity'}:{status:'unverified',reason:'oracle-similarity-not-unique'};
}

// Resolution candidates are independently delimited raw provisions, rather than
// runtime units or the placement's evidence. Labels are removed by the caller.
export function assertResolutionSimilarity(candidates,original,span) {
 const key=normal(original);if(key.length<80||key.length>10000)return false;
 const scores=candidates.map(row=>{
  const value=normal(row.text);let prefix=0;
  while(prefix<Math.min(value.length,key.length)&&value[prefix]===key[prefix])prefix++;
  return {...row,score:Math.min(value.length,key.length)/Math.max(value.length,key.length)>=.93?oracleSimilarity(value,key):0,prefix:prefix>=80&&prefix<Math.min(value.length,key.length)?prefix/Math.min(value.length,key.length):0};
 });
 const wanted=scores.find(row=>row.start===span.start&&row.end===span.end);
 if(!wanted||wanted.complete===false)return false;
 return (wanted.score>=.95&&scores.every(row=>row===wanted||row.score<=wanted.score-.02&&row.prefix<.5))
  ||(wanted.prefix>=.5&&scores.every(row=>row===wanted||row.prefix<=wanted.prefix-.02&&row.score<.93));
}

// Independently allow one inserted/omitted alphabetic word; every digit and
// punctuation token remains literal. This is not a substitution distance.
export function oracleSingleWord(left,right) {
 const tokenize=value=>value.normalize('NFC').match(/[\p{L}\p{N}]+|[^\s]/gu)||[];
 const a=tokenize(left),b=tokenize(right);if(Math.min(a.length,b.length)<3||Math.max(a.length,b.length)>512||Math.abs(a.length-b.length)!==1)return false;
 const long=a.length>b.length?a:b,short=a.length>b.length?b:a;
 for(let omitted=0;omitted<long.length;omitted++)if(/^\p{L}+$/u.test(long[omitted])&&short.every((word,i)=>word===long[i<omitted?i:i+1]))return true;
 return false;
}
