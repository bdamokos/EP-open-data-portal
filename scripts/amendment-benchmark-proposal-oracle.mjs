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
  return match&&(style||row.source?.part==='xhtml')?{value:match[1],level:style?Number(style[1]):0}:oracleInstruction(row.text,language);
};
const paragraph=row=>/^(?:Manual)?NumPar1$/iu.test(row.properties?.styleId||'')||row.source?.part==='xhtml'?/^\s*(\d+[a-z]*)[.)]\s/u.exec(row.text)?.[1]:null;
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
  const headings=rows.filter(row=>body(row)&&(/^(?:Titrearticle|ArticleTitle|Annexetitre)$/iu.test(row.properties?.styleId||'')||proposal.sourceKind==='xhtml'&&/^Article\s+\d+[a-z]*$/u.test(row.text.trim()))&&rootOf(row)?.kind===kind&&rootOf(row).value===value);
  if(headings.length!==1)return null;
  const heading=headings[0],following=rows.filter(row=>row.index>heading.index);
  const boundary=following.find(row=>(proposal.sourceKind==='xhtml'||row.properties?.styleId===heading.properties?.styleId)&&['article','annex'].includes(rootOf(row)?.kind)||/^(?:CHAPTER|SECTION|Done at|For the European Parliament)\b/u.test(row.text.trim()))||(kind==='annex'&&proposal.sourceKind==='docx'?{index:rows.at(-1).index+1}:null);
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
  // Some sources (COM(2025)580) print outer paragraph numbers as literal
  // text. Accept them only as one complete 1, 2, 3... run in an article that
  // has no NumPar paragraphs at all, all in Normal rows or starting at the
  // article's first row (its Article 2 mixes Normal and Point styles).
  const literal=row=>/^(\d+)\.\t/u.exec(row.text)?.[1];
  const literals=kind==='article'&&!amendingList&&!content.some(row=>paragraph(row))?content.filter(row=>literal(row)):[];
  const run=literals.length&&literals.every((row,i)=>literal(row)===String(i+1))
    &&(literals.every(row=>row.properties?.styleId==='Normal')||literals[0]===content[0]);
  const numbered=new Set(run?literals.map(row=>row.index):[]);
  const paragraphOf=row=>paragraph(row)??(numbered.has(row.index)?literal(row):null);
  const explicit=amendingList?[]:content.filter(row=>paragraphOf(row));
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
    const para=amendingList?null:paragraphOf(row),ref=pointOf(row);
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
  const starts=rows.filter((row,i)=>i===0||!point(row,article.language)&&(/^(?:Text1|Normal)$/iu.test(row.properties?.styleId||'')||row.source?.part==='xhtml'));
  return starts.map((row,i)=>({start:row.index,end:starts[i+1]?.index??scope.end}));
}

export function rawProposalAssertion({proposal,wording,placement}) {
  if(!oracleWords(wording.language))return unknown('oracle-raw-proposal-language-unavailable');
  const paths=wording.baseline==='present-text'?wording.targetPath?.underlying:wording.targetPath?.proposal;
  const target=address(paths?.length===1?paths[0].raw:wording.targetLabel||'',wording.language);
  if(!target)return unknown('oracle-raw-proposal-grammar-unavailable');
  return rawProposalTargetAssertion({proposal,wording,placement},target);
}
function rawProposalTargetAssertion({proposal,wording,placement},target) {
  const article=publishedContainer(proposal,target[0],wording.language);
  if(!article)return unknown('oracle-raw-article-unavailable');
  // XHTML tables can nest Roman points inside a lettered point. Raw text
  // labels alone do not establish those levels. Withhold point addresses and insertions when
  // their native DOM paths have different depths, or no usable paths.
  if(proposal.sourceKind==='xhtml'&&(placement.operation==='insert'||target.some(segment=>segment.kind==='point'))) {
    const points=article.rows.filter(row=>row.index>=article.start&&row.index<article.end&&point(row,wording.language));
    const depths=points.map(row=>/^\/\d+(?:\/\d+)*$/u.test(row.source?.path||'')?row.source.path.split('/').length:null);
    if(depths.includes(null)||new Set(depths).size>1)return unknown('oracle-raw-xhtml-point-nesting-unavailable');
  }
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
  // Unnumbered subparagraph ordinals are counted from native body rows.
  // Letter a opens a gap immediately after the named existing subparagraph.
  if(last?.kind==='subparagraph'&&last.isNew&&last.suffix==='a'&&parent?.kind==='paragraph'&&!parent.implicit) {
    const parts=subparagraphs(scope,article),anchor=parts[Number(last.base)-1];
    if(!anchor)return unknown('oracle-raw-subparagraph-unavailable');
    const rows=article.rows.filter(row=>row.index>=anchor.start&&row.index<=anchor.end);
    if(rows.length<2||rows.at(-1).index!==anchor.end||rows.some((row,i)=>!body(row)||!Number.isSafeInteger(row.source?.ordinal)||i&&(row.source.containerPath!==rows[i-1].source.containerPath||row.source.segment!==rows[i-1].source.segment||row.source.ordinal!==rows[i-1].source.ordinal+1)))return unknown('oracle-raw-source-incomplete');
    return placement.insertBefore===anchor.end&&placement.insertAfter===anchor.end-1?verified('oracle-raw-subparagraph-gap',rows.map(row=>row.index)):failed('oracle-raw-insertion-boundary-mismatch');
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
    // A childless lettered point can only receive new Roman children at its end.
    const roman=/^(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xvi{0,3}|xix|xx)$/u.test(last.value);
    if((last.value==='i'||roman&&/^[a-z]$/u.test(parent?.value??''))&&parent?.kind==='point'&&!siblings.length) {
      // Childlessness needs the parent's raw peers to run a, b, c... unbroken;
      // a flattened (i) between (a) and (b) leaves a child outside the parent.
      const peers=article.nodes.filter(node=>node.kind==='point'&&node.parent===parent.parent).sort((a,b)=>a.start-b.start);
      if(!peers.every((node,index)=>node.value===String.fromCharCode(97+index))||peers[peers.indexOf(parent)+1]?.value==='i')return unknown('oracle-raw-anchor-ambiguous');
      before=scope.end;
    }
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

// EP may print “1.” for the sole unnumbered paragraph of an article. Prove
// that address and the complete literal wording independently of parser units.
export function assertImplicitParagraphLabel({proposal,wording,placement}) {
 const unavailable=()=>unknown('oracle-implicit-paragraph-label-unavailable');
 if(!proposal||wording.language!=='en'||wording.baseline!=='commission-proposal'||placement.operation!=='replace')return unavailable();
 const target=address(wording.targetLabel||'','en');
 if(target?.length!==2||target[0].kind!=='article'||target[1].kind!=='paragraph'||target[1].value!=='1')return unavailable();
 const original=/^1\.\s+([\s\S]+)$/u.exec(wording.originalText||'');
 if(!original||!/^1\.\s+\S/u.test(wording.proposedText||''))return unavailable();
 const article=publishedContainer(proposal,target[0],'en'),node=article?.nodes[0];
 if(!node?.implicit||article.nodes.length!==1||node.kind!=='paragraph'||node.value!=='1'||node.end!==node.start+1)return unavailable();
 const row=proposal.paragraphs.find(p=>p.index===node.start),next=proposal.paragraphs.find(p=>p.index===node.end);
 if(!row||!next||row.text.includes('\uFFFC')||row.objects?.length||(proposal.anchors||[]).some(a=>a.paragraph===row.index)||!body(row)||!body(next)||row.properties?.styleId!=='Normal'||next.source.ordinal!==row.source.ordinal+1||next.source.containerPath!==row.source.containerPath||next.source.segment!==row.source.segment||row.properties.numberingLabel||/^[\d'‘“«"]/u.test(row.text.trim()))return unavailable();
 const compact=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim();
 if(compact(original[1])!==compact(row.text))return unavailable();
 if(placement.status!=='placed'||placement.span?.start!==row.index||placement.span?.end!==row.index||placement.splice?.start.paragraph!==row.index||placement.splice.start.offset!==0||placement.splice?.end.paragraph!==row.index||placement.splice.end.offset!==row.text.length)return failed('oracle-implicit-paragraph-boundary-mismatch');
 return verified('oracle-implicit-paragraph-label',[article.heading.index,row.index,next.index]);
}

// D2: a new child shares the boundary of its absent suffixed parent. The
// oracle checks the two printed numeric siblings, never another amendment's
// projected text or the placer's units/evidence.
export function assertNewParentBoundary({proposal,wording,placement}) {
  const decline=()=>unknown('oracle-new-parent-unavailable');
  if(!proposal||wording.baseline!=='commission-proposal'||wording.originalText!==''||placement.operation!=='insert')return decline();
  const path=address(wording.targetLabel||'',wording.language),parent=path?.at(-2),child=path?.at(-1);
  if(!parent||!child?.isNew||parent.suffix!=='a'||!/^\d+a$/u.test(parent.value)||!['article','point'].includes(parent.kind)||!['paragraph','point'].includes(child.kind))return decline();
  const n=Number(parent.base),base={...parent,value:String(n),base:String(n),suffix:'',isNew:false};
  let before,start;
  if(path.length===2&&parent.kind==='article') {
    const headings=proposal.paragraphs.filter(row=>/^(?:Titrearticle|ArticleTitle)$/iu.test(row.properties?.styleId||'')).map(row=>({row,ref:oracleAddress(row.text.trim().split('\n')[0],wording.language)})).filter(x=>x.ref?.length===1&&x.ref[0].kind==='article');
    if(headings.some(x=>x.ref[0].value===parent.value))return decline();
    const old=headings.filter(x=>x.ref[0].value===String(n)),next=headings.filter(x=>x.ref[0].value===String(n+1));
    if(old.length!==1||next.length!==1)return decline();
    const container=publishedContainer(proposal,base,wording.language);
    if(!container||container.end!==next[0].row.index)return decline();
    before=next[0].row.index;start=old[0].row.index;
  } else if(path.length>2&&parent.kind==='point') {
    const container=publishedContainer(proposal,path[0],wording.language);if(!container)return decline();
    const prior=container.nodes.filter(x=>x.kind==='point'&&x.value===String(n)),next=container.nodes.filter(x=>x.kind==='point'&&x.value===String(n+1));
    if(prior.length!==1||next.length!==1||prior[0].parent!==next[0].parent||prior[0].end!==next[0].start||container.nodes.some(x=>x.kind==='point'&&x.value===parent.value))return decline();
    const result=rawProposalTargetAssertion({proposal,wording,placement},[...path.slice(0,-2),{...parent,isNew:true}]);
    if(result.status!=='verified')return result;
    before=next[0].start;start=prior[0].start;
  } else return decline();
  const rows=proposal.paragraphs.filter(row=>row.index>=start&&row.index<=before);
  if(rows.length!==before-start+1||rows.some((row,i)=>!body(row)||i&&(row.source.containerPath!==rows[i-1].source.containerPath||row.source.segment!==rows[i-1].source.segment||row.source.ordinal!==rows[i-1].source.ordinal+1)))return decline();
  return placement.status==='placed'&&placement.insertBefore===before&&placement.insertAfter===before-1?verified('oracle-new-parent-numeric-boundary',[start,before]):failed('oracle-new-parent-boundary-mismatch');
}
