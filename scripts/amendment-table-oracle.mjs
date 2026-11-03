import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
const normal=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
const words=nodes=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>key==='w:t'?value.map(item=>item['#text']??''):key==='w:tab'?['\t']:['w:br','w:cr'].includes(key)?['\n']:key==='w:noBreakHyphen'?['‑']:key==='w:softHyphen'?['­']:Array.isArray(value)?[words(value)]:[])).join('');
const forbidden=/"(?:w:(?:drawing|pict|object|sdt|altChunk|del|moveFrom|instrText|sym)|m:oMath(?:Para)?)"/u;
const empty=row=>row.kind==='paragraph'&&!row.hidden&&!row.numbered&&!row.text.trim()&&!forbidden.test(JSON.stringify(row.nodes));
// Native top-level neighbours and every table-cell paragraph are checked before
// projection indices enter the assertion. No runtime table layout or proof is read.
const cached=new WeakMap();
export function nativeAttachedTables(text) {
  if(cached.has(text))return cached.get(text);
  if(!text?.nativeBuffer||text.paragraphSources?.length!==text.paragraphs?.length)return [];
  let body;try{body=quotedWordBody(text.nativeBuffer);}catch{return [];}
  const results=[];cached.set(text,results);let tableNumber=0;
  const byPath=new Map(text.paragraphSources.map((source,index)=>[source.path,index]));
  for(let at=0;at<body.length;at++) {
    const table=body[at];if(table.kind!=='other'||!table.nodes['w:tbl'])continue;
    tableNumber++;
    const prior=body[at-1],match=prior?.kind==='paragraph'&&/^([1-9]\d*)[.)]\s+[\s\S]*:\s*$/u.exec(prior.text);
    if(!match||prior.hidden||prior.numbered||table.hidden||forbidden.test(JSON.stringify(table.nodes)))continue;
    const path='/w:document[1]/w:body[1]/w:tbl['+tableNumber+']',native=[];let valid=true;
    function walk(nodes,parent) {
      const counts=new Map();
      for(const node of nodes)for(const [key,value] of Object.entries(node)) {
        if(key===':@'||key==='#text')continue;
        const count=(counts.get(key)||0)+1;counts.set(key,count);const own=parent+'/'+key+'['+count+']';
        if(key==='w:p'){const valueText=words(value).trim();if(valueText)native.push({path:own,text:valueText});}
        else if(['w:tr','w:tc'].includes(key))walk(value,own);
        else if(!['w:tblPr','w:tblGrid','w:trPr','w:tcPr'].includes(key))valid=false;
      }
    }
    walk(table.nodes['w:tbl'],path);
    let following=at+1;while(following<body.length&&empty(body[following]))following++;
    const next=body[following];
    if(!valid||!native.length||next?.kind!=='paragraph'||next.hidden||next.numbered||!new RegExp('^'+(Number(match[1])+1)+'[.)]\\s','u').test(next.text))continue;
    const start=byPath.get(prior.path),after=byPath.get(next.path);
    if(!Number.isInteger(start)||after!==start+native.length+1||normal(text.paragraphs[start])!==normal(prior.text)||normal(text.paragraphs[after])!==normal(next.text))continue;
    if(!text.paragraphSources[start].complete||!text.paragraphSources[after].complete)continue;
    if(native.some((row,i)=>byPath.get(row.path)!==start+i+1||!text.paragraphSources[start+i+1].complete||normal(row.text)!==normal(text.paragraphs[start+i+1])))continue;
    results.push({start,end:after-1,following:after,label:match[1]});
  }
  return results;
}
