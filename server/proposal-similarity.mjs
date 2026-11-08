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

export function singleWordDifference(left,right) {
 const parts=value=>value.normalize('NFC').match(/[\p{L}\p{N}]+|[^\s]/gu)||[];
 const a=parts(left),b=parts(right),long=a.length>b.length?a:b,short=a.length>b.length?b:a;
 if(long.length>512||short.length<3||long.length!==short.length+1)return false;
 let i=0;while(i<short.length&&short[i]===long[i])i++;
 return /^\p{L}+$/u.test(long[i]||'')&&short.slice(i).every((value,j)=>value===long[i+j+1]);
}

// A quoted original can carry a normal typo (maintainer ruling, 8 November
// 2026): at most TYPO_TOKENS changed words and punctuation marks. Label
// formatting ("37 b" for "37b", "1." or "(1)" for "1)") is not a change. A
// number, a list label, a word right after a number or a list marker never
// differs: another cross-reference or label is not a typo, and neither are
// words added at either end of the quote. Every passage that
// does not overlap the best one must be at least TYPO_MARGIN tokens further
// from the quote, and no overlapping passage may tie it.
export const TYPO_TOKENS=2, TYPO_MARGIN=3;
// Line-start labels become one token ("(a)", "a)" and "a." read "§a)"); an
// elided article keeps its apostrophe ("l'").
const typoTokens=value=>similarityNormal(value.replace(/^[ \t]*\(?([\p{L}\p{N}]{1,4})[.)](?=\s)/gmu,'§$1)')).replace(/[‐‑]/gu,'-').replace(/[şŞţŢ]/gu,c=>({ş:'ș',Ş:'Ș',ţ:'ț',Ţ:'Ț'})[c]).match(/§[\p{L}\p{N}]{1,4}\)|[\p{L}\p{N}]+'?|[^\s\p{L}\p{N}]/gu)||[];
// Banded token edit distance; returns cap+1 once the band is exceeded.
function tokenDistance(a,b,cap) {
 const n=a.length,m=b.length;if(Math.abs(n-m)>cap)return cap+1;
 const width=2*cap+1,big=cap+1;let previous=new Int32Array(width).fill(big),current=new Int32Array(width);
 // Cell j of row i lives at j-i+cap.
 for(let j=0;j<=Math.min(m,cap);j++)previous[j+cap]=j;
 for(let i=1;i<=n;i++){
  current.fill(big);let minimum=big;
  for(let j=Math.max(0,i-cap);j<=Math.min(m,i+cap);j++){
   const k=j-i+cap;
   let value=j===0?i:big;
   if(j>0){value=Math.min(value,(k>0?current[k-1]:big)+1,previous[k]+(a[i-1]===b[j-1]?0:1));}
   if(k+1<width)value=Math.min(value,previous[k+1]+1);
   current[k]=Math.min(value,big);if(current[k]<minimum)minimum=current[k];
  }
  if(minimum>cap)return big;[previous,current]=[current,previous];
 }
 return Math.min(previous[m-n+cap],big);
}
// Differing regions between two token lists, from a longest common subsequence.
function tokenRegions(a,b) {
 const n=a.length,m=b.length;if(n*m>4_000_000)return null;
 const dp=Array.from({length:n+1},()=>new Uint32Array(m+1));
 for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
 const regions=[];let i=0,j=0,open=null;
 const close=()=>{if(open){regions.push({...open,left:a.slice(open.i,i),right:b.slice(open.j,j)});open=null;}};
 while(i<n||j<m){
  if(i<n&&j<m&&a[i]===b[j]){close();i++;j++;continue;}
  if(!open)open={i,j};
  if(j<m&&(i===n||dp[i][j+1]>=dp[i+1][j]))j++;else i++;
 }
 close();
 return regions;
}
const numeric=token=>/\p{N}/u.test(token??'');
// Labels compare by their characters only: Cyrillic and Latin look-alikes,
// brackets and full stops do not change a label.
const homoglyphs={'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','і':'i','А':'A','Е':'E','О':'O','Р':'P','С':'C','Х':'X','І':'I'};
const labelKey=list=>list.join('').replace(/[§().]/gu,'').replace(/[аеорсхіАЕОРСХІ]/gu,c=>homoglyphs[c]);
function typoCost(regions,a,b) {
 let cost=0;
 const words=list=>list.filter(token=>/^[\p{L}\p{N}]/u.test(token)).length,marks=list=>list.filter(token=>!/^[\p{L}\p{N}§]/u.test(token)).length;
 for(const region of regions){
  const tokens=[...region.left,...region.right];
  // Spacing inside a label ("37 b" for "37b"), or one full stop or bracket right
  // after a number ("30a." for "30a"), is formatting.
  if(region.left.join('')===region.right.join('')||tokens.some(token=>token.startsWith('§'))&&labelKey(region.left)===labelKey(region.right))continue;
  if(tokens.every(token=>/^[.()]$/u.test(token))&&Math.max(region.left.length,region.right.length)===1&&(numeric(a[region.i-1])||numeric(b[region.j-1])))continue;
  if(tokens.some(token=>numeric(token)||token.startsWith('§')||/^[-–—•·*]$/u.test(token))||numeric(a[region.i-1])||numeric(b[region.j-1]))return null;
  // Words added or dropped at either end move the passage boundary instead.
  const mark=list=>list.every(token=>!/[\p{L}\p{N}]/u.test(token));
  if((mark(region.left)||mark(region.right))&&(mark(a.slice(0,region.i))&&mark(b.slice(0,region.j))||mark(a.slice(region.i+region.left.length))&&mark(b.slice(region.j+region.right.length))))return null;
  cost+=Math.max(words(region.left),words(region.right))+Math.max(marks(region.left),marks(region.right));
 }
 return cost;
}
const rowTokens=new WeakMap();
const tokensOf=row=>{let tokens=rowTokens.get(row);if(!tokens){tokens=typoTokens(row.text);rowTokens.set(row,tokens);}return tokens;};
function typoWindows(rows,size,slack) {
 const out=[];
 for(let i=0;i<rows.length;i++){
  if(!tokensOf(rows[i]).length)continue;
  let length=0;
  for(let j=i;j<rows.length&&j<i+40;j++){
   if(rows[j].index!==rows[i].index+(j-i))break;
   length+=tokensOf(rows[j]).length;
   if(length>size+slack)break;
   if(length>=size-slack&&tokensOf(rows[j]).length)out.push({start:rows[i].index,end:rows[j].index,rows:rows.slice(i,j+1)});
  }
 }
 return out;
}
const windowTokens=window=>window.rows.flatMap(tokensOf);
export function typoPassage(rows,allRows,original) {
 const key=typoTokens(original);if(key.length<5||key.length>2000)return null;
 const cap=TYPO_TOKENS*2+TYPO_MARGIN;
 const local=typoWindows(rows,key.length,cap).map(w=>({...w,distance:tokenDistance(key,windowTokens(w),cap)})).sort((x,y)=>x.distance-y.distance);
 const best=local[0];
 if(!best||best.distance>cap||local.some(w=>w!==best&&w.distance===best.distance))return null;
 const tokens=windowTokens(best),regions=tokenRegions(key,tokens),cost=regions&&typoCost(regions,key,tokens);
 if(cost===null||cost===undefined||cost>TYPO_TOKENS)return null;
 const limit=best.distance+TYPO_MARGIN-1;
 for(const w of typoWindows(allRows,key.length,limit)){
  if(w.start<=best.end&&w.end>=best.start)continue;
  if(tokenDistance(key,windowTokens(w),limit)<=limit)return null;
 }
 return {start:best.start,end:best.end,distance:best.distance,cost};
}
