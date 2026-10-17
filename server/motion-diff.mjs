// Document identity is established by the source graph before any paragraph alignment.
export const DIFF_LIMITS=Object.freeze({paragraphs:600,characters:300000,wordCells:250000});
const normalize=value=>String(value).normalize('NFC').replace(/\u00ad/g,'').replace(/\s+/gu,' ').trim();
const openings={
  bg:'Европейският парламент',es:'El Parlamento Europeo',cs:'Evropský parlament',da:'Europa-Parlamentet',de:'Das Europäische Parlament',et:'Euroopa Parlament',
  el:'Το Ευρωπαϊκό Κοινοβούλιο',en:'The European Parliament',fr:'Le Parlement européen',ga:'Parlaimint na hEorpa',hr:'Europski parlament',it:'Il Parlamento europeo',
  lv:'Eiropas Parlaments',lt:'Europos Parlamentas',hu:'Az Európai Parlament',mt:'Il-Parlament Ewropew',nl:'Het Europees Parlement',pl:'Parlament Europejski',
  pt:'O Parlamento Europeu',ro:'Parlamentul European',sk:'Európsky parlament',sl:'Evropski parlament',fi:'Euroopan parlamentti',sv:'Europaparlamentet',
};
const openingVariants={fi:['Euroopan parlamentti, joka'],sv:['Europaparlamentet utfärdar denna resolution']};
export function motionBody(text,language) {
  const anchors=text.noteAnchors || text.anchors || [];
  const paragraphs=(text.paragraphs || []).map((value,index)=>{
    let marked=value;
    // Insert backwards so equal-offset references retain their order in the source.
    for(const anchor of anchors.filter(a=>a.paragraph===index).reverse().sort((a,b)=>b.offset-a.offset))marked=marked.slice(0,anchor.offset)+'['+anchor.label+']'+marked.slice(anchor.offset);
    return marked;
  }),opening=openings[language];
  // Some translations use the same Parliament heading on the cover and in the body.
  // Require a following citation/recital/operative item and one unambiguous boundary.
  const normalized=paragraphs.map(normalize),starts=[];
  if(opening)for(let i=0;i<normalized.length;i++) {
    if(![opening,...(openingVariants[language] || [])].some(value=>normalized[i].replace(/[,;:]$/,'').toLocaleLowerCase(language)===value.toLocaleLowerCase(language)))continue;
    let next=i+1;while(next<normalized.length&&!normalized[next])next++;
    if(/^(?:[–—−\-•]\s*\S|(?:\d+|\p{Lu}{1,3})[.)]\s+\S)/u.test(normalized[next] || ''))starts.push(i);
  }
  const start=starts.length===1?starts[0]:-1;
  if(start<0)return {status:'unavailable',reason:'The resolution body could not be separated from the cover material in this language.'};
  if(text.notesStatus==='not-extracted')return {status:'unavailable',reason:'The document notes have not been extracted for this saved text.'};
  if(text.extractionWarnings?.length)return {status:'unavailable',reason:text.extractionWarnings.join(' ')};
  let citation=0,other=0;
  const blocks=paragraphs.slice(start+1).map((raw,index)=>{
    const value=normalize(raw),match=value.match(/^(\d+|\p{Lu}{1,3})[.)]\s+(.+)$/u);
    if(match)return {index,kind:/^\d+$/.test(match[1])?'paragraph':'recital',label:match[1],text:match[2]};
    if(/^[–—−\-•]\s*/u.test(value))return {index,kind:'citation',label:String(++citation),text:value.replace(/^[–—−\-•]\s*/u,'')};
    return {index,kind:'text',label:String(++other),text:value};
  });
  for(const note of text.notes || [])blocks.push({index:blocks.length,kind:'footnote',label:note.label,text:normalize(note.text)});
  if(!blocks.length)return {status:'unavailable',reason:'The resolution body is empty.'};
  if(blocks.length>DIFF_LIMITS.paragraphs || blocks.reduce((n,p)=>n+p.text.length,0)>DIFF_LIMITS.characters)
    return {status:'unavailable',reason:'This resolution exceeds the supported comparison size. Open the source documents to compare it.'};
  return {status:'available',blocks};
}
const tokens=value=>value.match(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*|[^\p{L}\p{N}]/gu) || [];
const words=value=>value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
function histogram(value) {
  const result=new Map();for(const word of words(value))result.set(word,(result.get(word) || 0)+1);return result;
}
function similarity(a,b) {
  if(a.kind!==b.kind)return 0;
  if(Math.min(a.text.length,b.text.length)/Math.max(a.text.length,b.text.length)<0.35)return 0;
  let overlap=0;for(const [word,count] of a.words)overlap+=Math.min(count,b.words.get(word) || 0);
  return 2*overlap/(a.wordCount+b.wordCount || 1);
}
export function wordDiff(before,after) {
  if(before===after)return [{type:'equal',text:before}];
  const a=tokens(before),b=tokens(after),out=[];
  const push=(type,text)=>{if(!text)return;if(out.at(-1)?.type===type)out.at(-1).text+=text;else out.push({type,text});};
  // Retain all wording when an unusually long paragraph would make LCS expensive.
  if(a.length*b.length>DIFF_LIMITS.wordCells)return [{type:'removed',text:before},{type:'added',text:after}];
  const matrix=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)matrix[i][j]=a[i]===b[j]?matrix[i+1][j+1]+1:Math.max(matrix[i+1][j],matrix[i][j+1]);
  let i=0,j=0;
  while(i<a.length || j<b.length) {
    if(i<a.length && j<b.length && a[i]===b[j]){push('equal',a[i++]);j++;}
    else if(i<a.length && (j===b.length || matrix[i+1][j]>=matrix[i][j+1]))push('removed',a[i++]);
    else push('added',b[j++]);
  }
  return out;
}
export function compareMotionBodies(before,after) {
  const enrich=blocks=>blocks.map(block=>{const counts=histogram(block.text);return {...block,words:counts,wordCount:[...counts.values()].reduce((a,b)=>a+b,0)};});
  const a=enrich(before),b=enrich(after),pairs=new Map(),used=new Set();
  // Exact passages can be recognised even after moving. Repeated passages pair in source order.
  for(let i=0;i<a.length;i++) {
    const j=b.findIndex((p,j)=>!used.has(j) && p.kind===a[i].kind && p.text===a[i].text);
    if(j>=0){pairs.set(i,j);used.add(j);}
  }
  const scores=new Map();
  for(let i=0;i<a.length;i++)if(!pairs.has(i))for(let j=0;j<b.length;j++)if(!used.has(j)) {
    const score=similarity(a[i],b[j]);if(score>=0.58)scores.set(i+':'+j,score);
  }
  const candidates=[...scores].map(([key,score])=>({i:Number(key.split(':')[0]),j:Number(key.split(':')[1]),score}));
  for(const c of candidates.sort((x,y)=>y.score-x.score || x.i-y.i || x.j-y.j)) {
    if(pairs.has(c.i) || used.has(c.j))continue;
    const alternative=candidates.some(other=>(other.i===c.i && other.j!==c.j || other.j===c.j && other.i!==c.i) && other.score>c.score-0.08);
    if(!alternative){pairs.set(c.i,c.j);used.add(c.j);}
  }
  const clean=block=>block?{index:block.index,kind:block.kind,label:block.label,text:block.text}:null;
  let wordBudget=2000000;
  const rows=b.map((block,j)=>{
    const i=[...pairs].find(([,target])=>target===j)?.[0];
    const previous=i===undefined?null:a[i],kind=previous?previous.text===block.text?'unchanged':'changed':'added';
    const cost=previous && kind==='changed'?tokens(previous.text).length*tokens(block.text).length:0;
    wordBudget-=Math.min(cost,DIFF_LIMITS.wordCells);
    return {kind,before:clean(previous),after:clean(block),referenceChanged:Boolean(previous && ['paragraph','recital','footnote'].includes(block.kind) && previous.label!==block.label),
      segments:previous?wordBudget<0 && kind==='changed'?[{type:'removed',text:previous.text},{type:'added',text:block.text}]:wordDiff(previous.text,block.text):[{type:'added',text:block.text}]};
  });
  // Keep unmatched originals near their next matched passage, rather than losing their source order.
  for(let i=a.length-1;i>=0;i--)if(!pairs.has(i)) {
    const next=rows.findIndex(row=>row.before && row.before.index>i);
    rows.splice(next<0?rows.length:next,0,{kind:'removed',before:clean(a[i]),after:null,referenceChanged:false,segments:[{type:'removed',text:a[i].text}]});
  }
  const summary={changed:0,added:0,removed:0,unchanged:0,referenceChanged:0};
  for(const row of rows){summary[row.kind]++;if(row.referenceChanged)summary.referenceChanged++;}
  return {rows,summary};
}
