// Limits include tokenisation, the Myers frontier, and its backtracking trace.
export const TEXT_DIFF_LIMITS=Object.freeze({characters:20_000,tokens:4_000,editDistance:512,work:1_000_000});
const pieces=text=>text.match(/[\p{L}\p{M}\p{N}_]+|\s+|[^\p{L}\p{M}\p{N}_\s]/gu)||[];

function tokenize(text,language) {
  let segmenter;
  try {if(typeof Intl.Segmenter==='function')segmenter=new Intl.Segmenter(language||undefined,{granularity:'word'});} catch { /* Unknown source language: use the lossless fallback. */ }
  const tokens=[];
  for(const part of segmenter?segmenter.segment(text):[{segment:text}]) {
    tokens.push(...pieces(part.segment));
    if(tokens.length>TEXT_DIFF_LIMITS.tokens)return null;
  }
  return tokens;
}
function merge(segments) {
  const result=[];
  for(const segment of segments) {
    if(!segment.text)continue;
    if(result.at(-1)?.type===segment.type)result.at(-1).text+=segment.text;
    else result.push({...segment});
  }
  return result;
}
function phrases(segments) {
  // A shared space between two edits belongs to BOTH reconstructed sides.
  // Duplicate it into a deletion and insertion, never move it to just one side.
  const expanded=segments.flatMap((segment,index)=>segment.type==='equal'&&/^\s+$/u.test(segment.text)&&
    index>0&&index<segments.length-1&&segments[index-1].type!=='equal'&&segments[index+1].type!=='equal'?
    [{type:'delete',text:segment.text},{type:'insert',text:segment.text}]:[segment]);
  const result=[];
  let deleted='',inserted='';
  const flush=()=>{if(deleted)result.push({type:'delete',text:deleted});if(inserted)result.push({type:'insert',text:inserted});deleted='';inserted='';};
  for(const segment of expanded) {
    if(segment.type==='equal'){flush();result.push(segment);}
    else if(segment.type==='delete')deleted+=segment.text;
    else inserted+=segment.text;
  }
  flush();return result;
}

/** Bounded, lossless token diff. Similarity is 2 * unchanged UTF-16 length / total length. */
export function textDiff(original,proposed,language) {
  const limits=TEXT_DIFF_LIMITS;
  if(original.length>limits.characters||proposed.length>limits.characters)return {status:'too-large'};
  const a=tokenize(original,language),b=tokenize(proposed,language);
  if(!a||!b)return {status:'too-large'};
  const frontier=new Map([[1,0]]),trace=[];
  let work=0;
  for(let distance=0;distance<=Math.min(a.length+b.length,limits.editDistance);distance++) {
    trace.push(new Map(frontier));
    for(let diagonal=-distance;diagonal<=distance;diagonal+=2) {
      if(++work>limits.work)return {status:'too-large'};
      const down=diagonal===-distance||diagonal!==distance&&(frontier.get(diagonal-1)??-Infinity)<(frontier.get(diagonal+1)??-Infinity);
      let x=down?(frontier.get(diagonal+1)??0):(frontier.get(diagonal-1)??0)+1,y=x-diagonal;
      while(x<a.length&&y<b.length&&a[x]===b[y]) {
        if(++work>limits.work)return {status:'too-large'};
        x++;y++;
      }
      frontier.set(diagonal,x);
      if(x<a.length||y<b.length)continue;
      const reversed=[];
      for(let d=distance;d>=0;d--) {
        const previous=trace[d],k=x-y;
        const down=k===-d||k!==d&&(previous.get(k-1)??-Infinity)<(previous.get(k+1)??-Infinity);
        const previousK=down?k+1:k-1,previousX=previous.get(previousK)??0,previousY=previousX-previousK;
        while(x>previousX&&y>previousY)reversed.push({type:'equal',text:a[--x]}),y--;
        if(d>0) {
          if(x===previousX)reversed.push({type:'insert',text:b[--y]});
          else reversed.push({type:'delete',text:a[--x]});
        }
      }
      const segments=merge(reversed.reverse());
      const unchanged=segments.reduce((sum,segment)=>sum+(segment.type==='equal'?segment.text.length:0),0);
      return {status:'ok',segments:phrases(segments),similarity:original.length+proposed.length?2*unchanged/(original.length+proposed.length):1};
    }
  }
  return {status:'too-large'};
}
