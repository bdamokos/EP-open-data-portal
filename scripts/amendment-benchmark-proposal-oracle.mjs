// Independent assertions on published English rows. This module deliberately
// reads neither proposal.units nor placement evidence, target parser, segmenter
// or matching normaliser. Unknown source grammars remain unverified.
const unknown=reason=>({status:'unverified',reason});
const failed=reason=>({status:'failed',reason});
const verified=(reason,rows)=>({status:'verified',reason,rawSourceRows:rows});
const number=value=>/^\d+$/u.test(value)?Number(value):/^[a-z]$/u.test(value)?value.charCodeAt(0)-96:null;
const point=row=>{
  const match=/^\s*\(([a-z]+|\d+)\)\s/u.exec(row.text),style=/^Point(\d+)(?:letter|number)?$/iu.exec(row.properties?.styleId||'');
  return match&&style?{value:match[1],level:Number(style[1])}:null;
};
const paragraph=row=>/^(?:Manual)?NumPar1$/iu.test(row.properties?.styleId||'')?/^\s*(\d+[a-z]*)[.)]\s/u.exec(row.text)?.[1]:null;
const body=row=>row.source?.container==='body'&&row.source?.complete===true&&row.complete!==false;

function address(raw) {
  const parts=raw.split('\n')[0].split(/\s+[–—]\s+/u),segments=[];
  for(const part of parts) {
    const match=/^(Article|Annex|paragraph|subparagraph|point)\s+(-?[a-zA-Z\d]+(?:\s+[a-z]+)?)(\s*\(new\))?$/iu.exec(part);
    if(match)segments.push({kind:match[1].toLowerCase(),value:match[2],isNew:Boolean(match[3])});
    else if(/^(title|introductory part)$/u.test(part))segments.push({kind:part});
    else return null;
  }
  return ['article','annex'].includes(segments[0]?.kind)?segments:null;
}

function publishedContainer(proposal,root) {
  const {kind,value}=root;
  const rows=proposal.paragraphs;
  const headings=rows.filter(row=>body(row)&&(kind==='annex'?['ANNEX '+value]:['Article '+value,'Article ['+value+']']).includes(row.text.trim().split('\n')[0].trim()));
  if(headings.length!==1)return null;
  const heading=headings[0],following=rows.filter(row=>row.index>heading.index);
  const boundary=following.find(row=>/^Article\s*\[?\d+[a-z]*\]?(?:\s*\n|$)/u.test(row.text.trim())||/^(?:CHAPTER|SECTION|ANNEX)\b/u.test(row.text.trim())||/^(?:Done at|For the European Parliament)\b/u.test(row.text))||(kind==='annex'&&proposal.sourceKind==='docx'?{index:rows.at(-1).index+1}:null);
  if(!boundary)return null;
  const content=following.filter(row=>row.index<boundary.index);
  if(!content.length||content.some(row=>!body(row)))return null;
  let title=null;
  const first=content[0],second=content[1];
  if(kind==='article'&&!paragraph(first)&&!point(first)&&!/^Article\b/u.test(first.text)&&(/^(?:Titrearticle|ArticleTitle)$/iu.test(first.properties?.styleId||'')
    ||second&&!paragraph(first)&&!point(first)&&first.text.length<180&&!/[.;:!?]$/u.test(first.text.trim())))title=first;
  const start=title?title.index+1:first.index;
  const nodes=[],stack=[];
  const explicit=content.filter(row=>paragraph(row));
  if(!explicit.length) {
    const plain=content.filter(row=>row.index>=start&&!point(row)&&!/^['‘’"“”]/u.test(row.text.trim()));
    const starts=content.some(row=>point(row))?[plain[0]]:plain;
    for(const [i,row] of starts.entries())if(row)nodes.push({kind:'paragraph',value:String(i+1),start:row.index,end:starts[i+1]?.index??boundary.index,parent:null,implicit:true});
  }
  for(const row of content.filter(row=>row.index>=start)) {
    const para=paragraph(row),ref=point(row);
    if(para) {
      stack.length=0;
      nodes.push({kind:'paragraph',value:para,start:row.index,end:boundary.index,parent:null});
    } else if(ref) {
      while(stack.length&&stack.at(-1).level>=ref.level)stack.pop();
      const parent=stack.at(-1)||nodes.findLast(node=>node.kind==='paragraph'&&node.start<=row.index);
      if(!parent)return null;
      const node={kind:'point',...ref,start:row.index,end:boundary.index,parent};
      nodes.push(node);stack.push(node);
    }
  }
  for(let i=0;i<nodes.length;i++) {
    const node=nodes[i];
    const next=nodes.slice(i+1).find(next=>node.kind==='paragraph'?next.kind==='paragraph':next.kind==='paragraph'||next.kind==='point'&&next.level<=node.level);
    node.end=Math.min(node.end,next?.start??boundary.index);
  }
  return {heading,title,start,end:boundary.index,nodes,rows};
}

function subparagraphs(scope,article) {
  // The numbered/implicit lead is subparagraph 1. An unnumbered Text1/Normal
  // row after it starts the next published subparagraph. Point descendants
  // belong to the preceding lead, never create extra subparagraph ordinals.
  const rows=article.rows.filter(row=>row.index>=scope.start&&row.index<scope.end);
  const starts=rows.filter((row,i)=>i===0||!point(row)&&/^(?:Text1|Normal)$/iu.test(row.properties?.styleId||''));
  return starts.map((row,i)=>({start:row.index,end:starts[i+1]?.index??scope.end}));
}

export function rawProposalAssertion({proposal,wording,placement}) {
  if(wording.language!=='en')return unknown('oracle-raw-proposal-language-unavailable');
  const target=address(wording.targetLabel||'');
  if(!target)return unknown('oracle-raw-proposal-grammar-unavailable');
  const article=publishedContainer(proposal,target[0]);
  if(!article)return unknown('oracle-raw-article-unavailable');
  let scope={start:article.start,end:article.end},parent=null,sub=null;
  const tail=target.slice(1),last=tail.at(-1);
  if(last?.kind==='title') {
    if(tail.length!==1||!article.title)return unknown('oracle-raw-title-unavailable');
    scope={start:article.title.index,end:article.title.index+1};
  } else for(const segment of tail.filter(segment=>segment!==last||!segment.isNew)) {
    if(segment.kind==='introductory part') {
      const children=article.nodes.filter(node=>node.parent===parent);
      const end=children.length?Math.min(...children.map(node=>node.start)):scope.end;
      scope={...scope,end};
      // A quoted replacement after a colon is not part of the introduction.
      const first=article.rows.find(row=>row.index===scope.start);
      if(first?.text.trimEnd().endsWith(':'))scope.end=scope.start+1;
    } else if(segment.kind==='subparagraph') {
      sub=subparagraphs(scope,article)[Number(segment.value)-1];
      if(!sub)return unknown('oracle-raw-subparagraph-unavailable');
      scope=sub;
    } else if(['paragraph','point'].includes(segment.kind)) {
      const candidates=article.nodes.filter(node=>node.kind===segment.kind&&node.value===segment.value&&node.parent===parent&&node.start>=scope.start&&node.start<scope.end);
      if(candidates.length!==1)return unknown('oracle-raw-address-unavailable');
      parent=candidates[0];scope={start:parent.start,end:Math.min(parent.end,scope.end)};
    } else return unknown('oracle-raw-proposal-grammar-unavailable');
  }
  if(placement.operation!=='insert') {
    const span=placement.span;
    if(!span||span.start<scope.start||span.end>=scope.end)return failed('oracle-raw-address-span-mismatch');
    return verified('oracle-raw-addressed-source-span',[article.heading.index,scope.start,scope.end]);
  }
  if(!last?.isNew||last.kind!=='point')return unknown('oracle-raw-insertion-grammar-unavailable');
  const siblings=article.nodes.filter(node=>node.kind==='point'&&node.parent===parent&&node.start>=scope.start&&node.start<scope.end);
  if(new Set(siblings.map(node=>node.value)).size!==siblings.length)return unknown('oracle-raw-anchor-ambiguous');
  const spaced=/^([a-z]|\d+)\s+([a-z]+)$/u.exec(last.value);
  let before;
  if(last.value==='-a'||last.value==='-1') {
    const first=siblings[0];if(!first||!['a','1'].includes(first.value))return unknown('oracle-raw-first-sibling-unavailable');
    before=first.start;
  } else if(spaced) {
    const base=spaced[1],suffix=spaced[2],rank=number(suffix);
    if(rank===null)return unknown('oracle-raw-insertion-grammar-unavailable');
    const candidates=siblings.filter(node=>node.value===base||node.value.startsWith(base)&&number(node.value.slice(base.length))!==null&&number(node.value.slice(base.length))<rank);
    if(!candidates.length)return unknown('oracle-raw-anchor-unavailable');
    const anchor=candidates.at(-1),next=siblings[siblings.indexOf(anchor)+1];
    if(next&&(next.value===base+suffix||number(next.value)!==null&&number(base)!==null&&number(next.value)<=number(base)))return failed('oracle-raw-sibling-order-mismatch');
    before=anchor.end;
  } else {
    const rank=number(last.value);
    if(last.value==='i'&&parent?.kind==='point'&&!siblings.length)before=scope.end;
    else if(rank!==null&&rank>1) {
      const preceding=siblings.filter(node=>number(node.value)===rank-1);
      if(preceding.length!==1||siblings.some(node=>node.value===last.value))return unknown('oracle-raw-anchor-unavailable');
      before=preceding[0].end;
    } else return unknown('oracle-raw-insertion-grammar-unavailable');
  }
  if(placement.insertBefore!==before||placement.insertAfter!==before-1)return failed('oracle-raw-insertion-boundary-mismatch');
  return verified('oracle-raw-sibling-boundary',[article.heading.index,scope.start,before]);
}
