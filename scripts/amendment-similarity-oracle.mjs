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

// Independent typo assertion (maintainer ruling, 8 November 2026): full token
// edit distance over the addressed raw rows. The placed span must be the
// strict best; its differences total at most two words and punctuation marks,
// ignoring label formatting, and never touch a number, a list label, the word
// after a number, a list marker or either end of the quote.
const typoTokens=value=>normal(value.split('\n').map(line=>line.replace(/^\s*\(?([\p{L}\p{N}]{1,4})[.)](?=\s)/u,'§$1)')).join('\n')).replace(/[‐‑]/gu,'-').replace(/[şŞţŢ]/gu,c=>({ş:'ș',Ş:'Ș',ţ:'ț',Ţ:'Ț'})[c]).match(/§[\p{L}\p{N}]{1,4}\)|[\p{L}\p{N}]+'?|[^\s\p{L}\p{N}]/gu)||[];
function tokenEdits(a,b){
 const n=a.length,m=b.length;if(n*m>4_000_000)return null;
 const d=Array.from({length:n+1},(_,i)=>{const row=new Uint32Array(m+1);row[0]=i;return row;});
 for(let j=0;j<=m;j++)d[0][j]=j;
 for(let i=1;i<=n;i++)for(let j=1;j<=m;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
 // Walk back into maximal differing runs.
 const runs=[];let i=n,j=m,run=null;
 const close=run=>({...run,atStart:[...a.slice(0,run.i),...b.slice(0,run.j)].every(t=>!/[\p{L}\p{N}]/u.test(t))});
 while(i>0||j>0){
  if(i>0&&j>0&&a[i-1]===b[j-1]&&d[i][j]===d[i-1][j-1]){if(run){runs.push(close(run));run=null;}i--;j--;continue;}
  run??={left:[],right:[],before:null,atEnd:[...a.slice(i),...b.slice(j)].every(t=>!/[\p{L}\p{N}]/u.test(t))};
  if(i>0&&j>0&&d[i][j]===d[i-1][j-1]+1){run.left.unshift(a[--i]);run.right.unshift(b[--j]);}
  else if(i>0&&d[i][j]===d[i-1][j]+1)run.left.unshift(a[--i]);
  else run.right.unshift(b[--j]);
  run.before=[a[i-1],b[j-1]];run.i=i;run.j=j;
 }
 if(run)runs.push(close(run));
 return {distance:d[n][m],runs};
}
export function oracleTypo(original,source){
 const edits=tokenEdits(typoTokens(original),typoTokens(source));if(!edits)return null;
 let words=0;
 const isWord=t=>/^[\p{L}\p{N}]/u.test(t),isMark=t=>!/^[\p{L}\p{N}§]/u.test(t),digit=t=>/\p{N}/u.test(t??'');
 for(const run of edits.runs){
  const all=[...run.left,...run.right];
  const key=list=>list.join('').replace(/[§().]/gu,'').replace(/[аеорсхі]/giu,c=>({а:'a',е:'e',о:'o',р:'p',с:'c',х:'x',і:'i'})[c.toLowerCase()]??c);
  if(run.left.join('')===run.right.join('')||all.some(t=>t.startsWith('§'))&&key(run.left)===key(run.right))continue;
  if(all.every(t=>/^[.()]$/u.test(t))&&Math.max(run.left.length,run.right.length)===1&&run.before.some(digit))continue;
  if(all.some(t=>digit(t)||t.startsWith('§')||/^[-–—•·*]$/u.test(t))||run.before.some(digit))return null;
  if([run.left,run.right].some(list=>list.every(isMark))&&(run.atEnd||run.atStart))return null;
  words+=Math.max(...[run.left,run.right].map(list=>list.filter(isWord).length))+Math.max(...[run.left,run.right].map(list=>list.filter(isMark).length));
 }
 return words<=2?edits.distance:null;
}
export function assertTypoRows(rows,original,span){
 const key=typoTokens(original);if(key.length<5)return false;
 const scores=[];
 for(let i=0;i<rows.length;i++){
  if(!typoTokens(rows[i].text).length)continue;
  let text='';for(let j=i;j<rows.length&&j<i+40;j++){
   text+=(j===i?'':'\n')+rows[j].text;const length=typoTokens(text).length;
   if(length>key.length+8)break;
   if(length>=key.length-8&&typoTokens(rows[j].text).length)scores.push({start:rows[i].index,end:rows[j].index,text});
  }
 }
 const wanted=scores.find(row=>row.start===span.start&&row.end===span.end),distance=wanted&&oracleTypo(original,wanted.text);
 if(distance===null||distance===undefined)return false;
 return scores.every(row=>row===wanted||(tokenEdits(key,typoTokens(row.text))?.distance??0)>distance);
}

export function assertSimilarPlacement({proposal,wording,placement,address}){
 if(address.status!=='verified'||!placement.span||!placement.splice||!address.rawSourceRows)return {status:'unverified',reason:'oracle-similarity-address-unavailable'};
 const [,start,end]=address.rawSourceRows,span=placement.span;
 const rows=proposal.paragraphs.slice(start,end);
 if(placement.splice.start.offset!==0||placement.splice.end.offset!==proposal.paragraphs[span.end]?.text.length)return {status:'unverified',reason:'oracle-similarity-partial-row'};
 if(assertSimilarityRows(rows,wording.originalText,span))return {status:'verified',reason:'oracle-independent-unique-similarity'};
 return assertTypoRows(rows,wording.originalText,span)?{status:'verified',reason:'oracle-independent-typo-original'}:{status:'unverified',reason:'oracle-similarity-not-unique'};
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
