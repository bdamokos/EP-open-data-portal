import {oracleAddress,oracleWords,oracleInstruction} from './amendment-oracle-grammar.mjs';
// Independent assertions on published rows in the 24 official languages. This module deliberately
// reads neither proposal.units nor placement evidence, target parser, segmenter
// or matching normaliser. Unknown source grammars remain unverified.
const unknown=reason=>({status:'unverified',reason});
const failed=reason=>({status:'failed',reason});
const verified=(reason,rows)=>({status:'verified',reason,rawSourceRows:rows});
const number=value=>{
 if(/^\d+$/u.test(value))return Number(value);
 const latin=['bis','ter','quater','quinquies','sexies','septies','octies','nonies','decies'];if(latin.includes(value))return latin.indexOf(value)+1;
 const alphabet=/^[a-z]{1,3}$/u.test(value)?'abcdefghijklmnopqrstuvwxyz':/^[α-ω]{1,3}$/u.test(value)?'αβγδεζηθικλμνξοπρστυφχψω':/^[а-я]{1,3}$/u.test(value)?'абвгдежзийклмнопрстуфхцчшщъьюя':null;
 return alphabet?[...value].reduce((n,c)=>n*alphabet.length+alphabet.indexOf(c)+1,0):null;
};
const point=(row,language)=>{
  const match=/^\s*\(([a-z]+|\d+)\)\s/u.exec(row.text),style=/^Point(\d+)(?:letter|number)?$/iu.exec(row.properties?.styleId||'');
  return match&&style?{value:match[1],level:Number(style[1])}:oracleInstruction(row.text,language);
};
const paragraph=row=>/^(?:Manual)?NumPar1$/iu.test(row.properties?.styleId||'')?/^\s*(\d+[a-z]*)[.)]\s/u.exec(row.text)?.[1]:null;
const body=row=>row.source?.container==='body'&&row.source?.complete===true&&row.complete!==false;

function address(raw,language) {
 const segments=oracleAddress(raw.split('\n')[0],language);
 return ['article','annex'].includes(segments?.[0]?.kind)?segments:null;
}

function publishedContainer(proposal,root,language) {
  const {kind,value}=root;
  let amendingList=false;const numberedInstructions=new Set();
  const pointOf=row=>{if(!amendingList)return point(row,language);const instruction=oracleInstruction(row.text,language);return instruction?.level===0&&!numberedInstructions.has(row.index)?null:instruction;};
  const rows=proposal.paragraphs;
  const rootOf=row=>{const first=row.text.trim().split('\n')[0];const parsed=language==='fr'&&/^Article\s+premier$/iu.test(first)?[{kind:'article',value:'1'}]:oracleAddress(first,language);return parsed?.length===1?parsed[0]:null;};
  const headings=rows.filter(row=>body(row)&&/^(?:Titrearticle|ArticleTitle|Annexetitre)$/iu.test(row.properties?.styleId||'')&&rootOf(row)?.kind===kind&&rootOf(row).value===value);
  if(headings.length!==1)return null;
  const heading=headings[0],following=rows.filter(row=>row.index>heading.index);
  const boundary=following.find(row=>row.properties?.styleId===heading.properties?.styleId&&['article','annex'].includes(rootOf(row)?.kind)||/^(?:CHAPTER|SECTION|Done at|For the European Parliament)\b/u.test(row.text.trim()))||(kind==='annex'&&proposal.sourceKind==='docx'?{index:rows.at(-1).index+1}:null);
  if(!boundary)return null;
  const content=following.filter(row=>row.index<boundary.index);
  if(!content.length)return null;
  // The unnumbered amending article has one lead paragraph and a printed
  // instruction list. Styled paragraphs inside its quotations are not outer
  // paragraphs. Establish this from the published lead and first instruction.
  const annexList=kind==='annex'&&oracleInstruction(content[0]?.text||'',language)?.value==='1';
  amendingList=annexList||!paragraph(content[0])&&content[0]?.text.trimEnd().endsWith(':')&&oracleInstruction(content[1]?.text||'',language)?.value==='1';
  if(amendingList){
    // Follow the printed consecutive outer list. A quoted paragraph numbered
    // 11 (LT's definition of a catch certificate) cannot end instruction 1.
    let next=1;
    const form=row=>/^\s*(\(\d+\)|\d+[.)])\s/u.exec(row.text)?.[1].replace(/\d+/u,'#');
    for(const row of content){
      if(annexList&&form(row)!==form(content[0]))continue;
      const instruction=oracleInstruction(row.text,language);if(instruction?.level===0&&instruction.value===String(next)){numberedInstructions.add(row.index);next++;}
    }
  }
  let title=null;
  const first=content[0],second=content[1];
  if(kind==='article'&&!paragraph(first)&&!pointOf(first)&&!/^Article\b/u.test(first.text)&&(/^(?:Titrearticle|ArticleTitle)$/iu.test(first.properties?.styleId||'')
    ||second&&!paragraph(first)&&!pointOf(first)&&first.text.length<180&&!/[.;:!?]$/u.test(first.text.trim())))title=first;
  const start=title?title.index+1:first.index;
  const nodes=[],stack=[];
  const explicit=amendingList?[]:content.filter(row=>paragraph(row));
  if(!explicit.length) {
    const plain=content.filter(row=>row.index>=start&&!pointOf(row)&&!/^['‘’"“”]/u.test(row.text.trim()));
    const firstPoint=content.find(row=>pointOf(row));
    // A bare annex can begin with its first instruction, without an
    // unnumbered lead. Its internal paragraph starts at that instruction.
    const starts=firstPoint?[plain.find(row=>row.index<firstPoint.index)??(kind==='annex'?firstPoint:undefined)]:plain;
    for(const [i,row] of starts.entries())if(row)nodes.push({kind:'paragraph',value:String(i+1),start:row.index,end:starts[i+1]?.index??boundary.index,parent:null,implicit:true});
  }
  for(const row of content.filter(row=>row.index>=start)) {
    if(!body(row))continue;
    const para=amendingList?null:paragraph(row),ref=pointOf(row);
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
  return {heading,title,start,end:boundary.index,nodes,rows,language};
}

function subparagraphs(scope,article) {
  // The numbered/implicit lead is subparagraph 1. An unnumbered Text1/Normal
  // row after it starts the next published subparagraph. Point descendants
  // belong to the preceding lead, never create extra subparagraph ordinals.
  const rows=article.rows.filter(row=>row.index>=scope.start&&row.index<scope.end);
  const starts=rows.filter((row,i)=>i===0||!point(row,article.language)&&/^(?:Text1|Normal)$/iu.test(row.properties?.styleId||''));
  return starts.map((row,i)=>({start:row.index,end:starts[i+1]?.index??scope.end}));
}

export function rawProposalAssertion({proposal,wording,placement}) {
  if(!oracleWords(wording.language))return unknown('oracle-raw-proposal-language-unavailable');
  const target=address(wording.targetLabel||'',wording.language);
  if(!target)return unknown('oracle-raw-proposal-grammar-unavailable');
  const article=publishedContainer(proposal,target[0],wording.language);
  if(!article)return unknown('oracle-raw-article-unavailable');
  let scope={start:article.start,end:article.end},parent=null,sub=null;
  const tail=target.slice(1),last=tail.at(-1);
  if(last?.kind==='title') {
    if(tail.length!==1||!article.title)return unknown('oracle-raw-title-unavailable');
    scope={start:article.title.index,end:article.title.index+1};
  } else for(const segment of tail.filter(segment=>placement.operation!=='insert'||segment!==last||!segment.isNew)) {
    if(segment.kind==='introductory-part') {
      const children=article.nodes.filter(node=>node.parent===parent);
      const end=children.length?Math.min(...children.map(node=>node.start)):scope.end;
      scope={...scope,end};
      // A quoted replacement after a colon is not part of the introduction.
      const first=article.rows.find(row=>row.index===scope.start);
      if(first?.text.trimEnd().endsWith(':'))scope.end=scope.start+1;
    } else if(segment.kind==='subparagraph') {
      // An unnumbered amending introduction owns the whole printed list.
      // Some editions call that containing paragraph a first subparagraph.
      const implicit=article.nodes.filter(node=>node.kind==='paragraph'&&node.implicit);
      const next=tail[tail.indexOf(segment)+1];
      if(!parent&&segment.value==='1'&&next?.kind==='point'&&implicit.length===1&&article.rows[implicit[0].start]?.text.trimEnd().endsWith(':')&&article.nodes.some(node=>node.parent===implicit[0]&&node.kind==='point'&&node.value==='1')){
        parent=implicit[0];scope={start:parent.start,end:parent.end};continue;
      }
      sub=subparagraphs(scope,article)[Number(segment.value)-1];
      if(!sub)return unknown('oracle-raw-subparagraph-unavailable');
      scope=sub;
    } else if(['paragraph','point'].includes(segment.kind)) {
      if(segment.kind==='point'&&!parent){const implicit=article.nodes.filter(node=>node.kind==='paragraph'&&node.implicit);if(implicit.length===1)parent=implicit[0];}
      const candidates=article.nodes.filter(node=>node.kind===segment.kind&&node.value===segment.value&&node.parent===parent&&node.start>=scope.start&&node.start<scope.end);
      if(candidates.length!==1)return unknown('oracle-raw-address-unavailable');
      parent=candidates[0];scope={start:parent.start,end:Math.min(parent.end,scope.end)};
    } else return unknown('oracle-raw-proposal-grammar-unavailable');
  }
  if(placement.operation!=='insert') {
    const span=placement.span;
    if(!span||span.start<scope.start||span.end>=scope.end)return failed('oracle-raw-address-span-mismatch');
    if(article.rows.filter(row=>row.index>=span.start&&row.index<=span.end).some(row=>!body(row)))return unknown('oracle-raw-source-incomplete');
    return verified('oracle-raw-addressed-source-span',[article.heading.index,scope.start,scope.end]);
  }
  if(!last?.isNew||last.kind!=='point')return unknown('oracle-raw-insertion-grammar-unavailable');
  if(!parent&&last.kind==='point'){const implicit=article.nodes.filter(node=>node.kind==='paragraph'&&node.implicit);if(implicit.length===1)parent=implicit[0];}
  const siblings=article.nodes.filter(node=>node.kind==='point'&&node.parent===parent&&node.start>=scope.start&&node.start<scope.end);
  if(new Set(siblings.map(node=>node.value)).size!==siblings.length)return unknown('oracle-raw-anchor-ambiguous');
  const spaced=last.suffix?[null,last.base,last.suffix]:null;
  let before;
  if(last.value==='-a'||last.value==='-1') {
    const first=siblings[0];if(!first||!['a','1'].includes(first.value))return unknown('oracle-raw-first-sibling-unavailable');
    before=first.start;
  } else if(spaced) {
    const base=spaced[1],suffix=spaced[2],rank=number(suffix);
    if(rank===null)return unknown('oracle-raw-insertion-grammar-unavailable');
    const candidates=siblings.filter(node=>node.value===base||node.value.startsWith(base)&&/^[\p{Ll}]+$/u.test(node.value.slice(base.length))&&number(node.value.slice(base.length))!==null&&number(node.value.slice(base.length))<rank);
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
  const extentStart=siblings.find(node=>node.end===before)?.start??parent?.start??scope.start;
  if(article.rows.filter(row=>row.index>=extentStart&&row.index<before).some(row=>!body(row)))return unknown('oracle-raw-source-incomplete');
  if(placement.insertBefore!==before||placement.insertAfter!==before-1)return {...failed('oracle-raw-insertion-boundary-mismatch'),expectedBefore:before,actualBefore:placement.insertBefore,rawSourceRows:[article.heading.index,scope.start,before]};
  return verified('oracle-raw-sibling-boundary',[article.heading.index,scope.start,before]);
}
