import {createHash} from 'node:crypto';
import {proposalDocx} from './proposal-docx.mjs';
import {parseLabelSegment,parseTargetLabel,unitLabel,proposalNumber,proposalLanguage,isBareLabel} from './proposal-labels.mjs';
import {officialDocumentUrl} from './proposal-math.mjs';
import {instructionOperation} from './proposal-instructions.mjs';
import {proposalRegion} from './proposal-regions.mjs';
import {quotationClosed} from './proposal-quotation.mjs';
export {parseTargetLabel,unitLabel};
export {normaliseForMatching} from './proposal-matching.mjs';
export const PROPOSAL_PARSER_VERSION='7';
const MAX_TEXT=8*1024*1024,MAX_PARAGRAPHS=100000;
const parseCache=new Map(),candidateIndexes=new WeakMap();
const MAX_CACHE_BYTES=64*1024*1024,MAX_CACHE_ENTRIES=8;let cacheBytes=0;
const opening=/^[‘“„«"'”]/u;
const nonnormative=new Set(['frontmatter','memorandum','signature','financial-statement']);
const stylePoint=/^(?:Manual)?Point(\d)/i;
const firstLine=text=>text.split(/\r?\n/,1)[0].trim();
const cleanLead=text=>text.replace(opening,'').trimStart();
const label=(kind,value,language)=>({kind,...(proposalNumber(String(value),language)??{value:String(value),number:null,suffix:''}),isNew:false});
const key=segments=>segments.map(segment=>`${segment.kind}:${segment.value}${segment.occurrence?`~${segment.occurrence}`:''}`).join('/');

function heading(text,language,style) {
  const line=firstLine(cleanLead(text));
  if(/Annexetitre/i.test(style)&&isBareLabel(line,'annex',language))return {kind:'annex',value:'',number:null,suffix:'',isNew:false,raw:line};
  if(/Titrearticle/i.test(style)&&isBareLabel(line,'article',language))return {kind:'article',value:'?',number:null,suffix:'',isNew:false,raw:line,unavailable:true};
  if(line.length>120&&!/Annexetitre|Titrearticle|Titrefamille|Titrechapitre|SectionTitle/i.test(style))return null;
  let parsed=parseLabelSegment(line,language);
  if(parsed&&['article','annex','chapter','section','title'].includes(parsed.kind))return parsed;
  const words=line.split(/\s+/);
  for(let n=Math.min(words.length,5);n>=2;n--){parsed=parseLabelSegment(words.slice(0,n).join(' ').replace(/\.$/,''),language);if(parsed&&['chapter','section','title'].includes(parsed.kind))return parsed;}
  // Commission templates sometimes place an annex title in the same paragraph.
  // Only a heading style permits accepting a prefix of that paragraph.
  if(/Annexetitre|Titrearticle|Titrefamille|Titrechapitre/i.test(style)) {
    for(let n=Math.min(words.length,5);n>=2;n--){parsed=parseLabelSegment(words.slice(0,n).join(' '),language);if(parsed&&['article','annex','chapter','section','title'].includes(parsed.kind))return parsed;}
  }
  return null;
}
function leadingNumber(text,language,style,numbering=null,activePoints=[]) {
  const line=cleanLead(text);
  const dottedRoman=/^[ivxlcdm]+\.\s+/u.test(line)&&
    (stylePoint.test(style)||/^Text\d/i.test(style)||/Roman/i.test(numbering?.format??''));
  if(!/^[\d(•–—-]/u.test(line)&&! /^[\p{L}]{1,8}[)\]]/u.test(line)&&!dottedRoman)return null;
  const point=line.match(/^\(?([\p{L}\d]+(?:\.\d+)*(?:\s+[\p{L}]{1,3})?)[)\]]\s*/u)??
    (dottedRoman?line.match(/^([ivxlcdm]+)\.\s+/u):null);
  if(point) {
    const value=proposalNumber(point[1],language);if(!value)return null;
    const previous=activePoints.at(-1)?.unit.label?.value;
    const alphabeticSibling=previous?.length===1&&point[1].length===1&&point[1].charCodeAt(0)===previous.charCodeAt(0)+1;
    const sameTextStyle=style===activePoints.at(-1)?.style;
    const numeric=/^\d/.test(point[1]),styleLevel=style.match(stylePoint)?.[1]??
      (/^[ivxlcdm]+$/u.test(point[1])&&!(sameTextStyle&&alphabeticSibling)?style.match(/^Text(\d)/i)?.[1]:undefined);
    // A glyph such as c or i does not establish a deeper Roman list.
    const level=Number.isInteger(numbering?.level)?numbering.level:styleLevel!==undefined?Number(styleLevel):numeric?0:1;
    const hierarchyAmbiguous=!numbering&&styleLevel===undefined&&/^[ivxlcdm]+$/u.test(point[1])&&!!previous&&
      !(previous.length===1&&point[1].length===1&&point[1].charCodeAt(0)===previous.charCodeAt(0)+1);
    return {kind:'point',...value,isNew:false,level,prefix:point[0],...(numbering?{numbering}:{}),...(hierarchyAmbiguous?{hierarchyAmbiguous:true}:{})};
  }
  const paragraph=line.match(/^(\d+(?:\.\d+)*)\.(?:\s+|(?=\p{Lu}))/u)??line.match(/^(\d+(?:\.\d+)*(?:[.‑–-]?\s*[\p{L}]{1,3})?)\.(?:\s+|(?=\p{Lu}))/u);
  if(paragraph){const parsed=proposalNumber(paragraph[1],language);if(!parsed)return null;const level=numbering?.level??style.match(stylePoint)?.[1];return {kind:level===undefined?'paragraph':'point',...parsed,isNew:false,prefix:paragraph[0],...(level===undefined?{}:{level:Number(level)}),...(numbering?{numbering}:{})};}
  if(/^[•–—-](?:\s|\t)/u.test(line))return {kind:'indent',value:'',number:null,suffix:'',isNew:false,prefix:line.slice(0,1)};
  return null;
}
function instruction(text,language) {
  const operation=instructionOperation(text,language);if(!operation)return null;
  // Exact label hints only. A later resolver must verify the act identity and
  // the complete inner target; these are never promoted to proposal paths.
  const targets=[];
  const words=cleanLead(text).replace(/^\(?[\p{L}\d]+[).]\s*/u,'').split(/\s+/);
  for(let start=0;start<Math.min(words.length,35);start++)for(let width=2;width<=4;width++) {
    const found=parseLabelSegment(words.slice(start,start+width).join(' ').replace(/[,:;]$/,''),language);
    if(found&&!targets.some(target=>target.kind===found.kind&&target.value===found.value))targets.push(found);
  }
  return {operation,raw:text,underlyingTargets:targets};
}

/** Parse one exact proposal content item. No network requests or cross-language fallback. */
function parseProposalUncached(input,{language='en',item='act',sourceUrl=null,identity=null}={}) {
  language=proposalLanguage(language);
  if(!['act','annex'].includes(item))throw new RangeError('Proposal item must be act or annex.');
  let content;
  if(Buffer.isBuffer(input)||input instanceof Uint8Array)content=proposalDocx(Buffer.from(input),{sourceUrl});
  else if(typeof input==='string')content={paragraphs:input.split(/\r?\n/),sourceKind:'text'};
  else if(input&&Array.isArray(input.paragraphs))content=input;
  else throw new TypeError('Expected a DOCX buffer, text, or an extracted document with paragraphs.');
  if(content.paragraphs.length>MAX_PARAGRAPHS||content.paragraphs.some(value=>typeof value!=='string'))throw new RangeError('Proposal paragraphs exceed supported limits.');
  let bytes=0;const hash=createHash('sha256');
  for(const text of content.paragraphs){bytes+=Buffer.byteLength(text);if(bytes>MAX_TEXT)throw new RangeError('Proposal text exceeds 8 MiB.');hash.update(text).update('\n');}
  const sourceHash=Buffer.isBuffer(input)||input instanceof Uint8Array?createHash('sha256').update(input).digest('hex'):hash.digest('hex');
  // parseProposal supplies the same effective URL used by its cache key.
  const namespace=createHash('sha256').update(JSON.stringify({identity,sourceUrl,sourceHash,language,item})).digest('hex').slice(0,24);
  const gaps=(content.extractionGaps??[]).map(gap=>({...gap})),objectsByParagraph=new Map();
  if(content.coverage?.complete===false)gaps.push({code:'excerpted-source',message:'This input contains selected source excerpts; omitted content has not been parsed.'});
  for(const object of content.documentObjects??[]) {
    if(!Number.isInteger(object.paragraph)||object.paragraph<0||object.paragraph>=content.paragraphs.length)throw new TypeError('Invalid proposal object position.');
    const objectCopy={...object,complete:object.complete??object.status==='mapped',sourceUrl:officialDocumentUrl(object.sourceUrl)??sourceUrl};
    if(objectCopy.kind==='math'&&!objectCopy.complete)gaps.push({code:'unresolved-math',paragraph:object.paragraph,sourcePath:object.path,message:'A source equation could not be converted without changing its mathematics.'});
    const list=objectsByParagraph.get(object.paragraph)??[];list.push(objectCopy);objectsByParagraph.set(object.paragraph,list);
  }
  const notes=(content.notes??[]).map(note=>{
    const objects=note.objects??[],unexplained=[...note.text.matchAll(/\uFFFC/g)].some(match=>!objects.some(object=>object.offset===match.index));
    const complete=note.complete!==false&&!unexplained&&objects.every(object=>object.complete);
    if(!complete)gaps.push({code:'incomplete-note',note:note.id,message:'A source note contains unconverted or unverified content.'});
    return {...note,objects,complete};
  });
  const noteById=new Map(notes.map(note=>[note.id,note])),notesByParagraph=new Map();
  for(const anchor of content.anchors??[]){const list=notesByParagraph.get(anchor.paragraph)??[];list.push(anchor.note);notesByParagraph.set(anchor.paragraph,list);}
  const paragraphs=content.paragraphs.map((text,index)=>{
    const source=content.paragraphSources?.[index]??null,properties=content.paragraphProperties?.[index]??null,objects=objectsByParagraph.get(index)??[];
    const unexplained=[...text.matchAll(/\uFFFC/g)].some(match=>!objects.some(object=>object.offset===match.index));
    const complete=!unexplained&&objects.every(object=>object.complete)&&(notesByParagraph.get(index)??[]).every(id=>noteById.get(id)?.complete)&&properties?.numberingComplete!==false&&properties?.notesComplete!==false&&properties?.annotationsComplete!==false&&
      (source?.complete!==false||objects.length>0&&!!properties&&properties.numberingComplete&&properties.notesComplete);
    return {index,text,source,properties,objects,complete};
  });
  const sourceStructured=content.sourceKind==='docx'||content.structureStatus==='extracted'&&content.paragraphSources?.length===paragraphs.length;
  if(!sourceStructured)gaps.push({code:'source-structure-unavailable',message:'Text is retained; original tables, objects and source boundaries cannot be verified from plain text.'});
  for(const warning of content.extractionWarnings??[])if(/blocks could not be read|automatic|note.*(?:missing|exceed|unknown|empty)/iu.test(warning))gaps.push({code:'extraction-gap',message:warning});
  const root={id:`proposal-v${PROPOSAL_PARSER_VERSION}:${namespace}`,kind:'proposal',path:[],scope:'proposal',normative:false,children:[],content:[],extent:{start:0,end:paragraphs.length}};
  const parents=new WeakMap(),duplicates=new WeakMap(),replacementConsumed=new WeakSet(),anonymousIds=new WeakMap();
  function make(parent,kind,at,{segment=null,normative=parent.normative,scope=parent.scope,...details}={}) {
    let path=parent.path;
    if(segment) {
      if(segment.hierarchyAmbiguous){details.pathConflict=true;gaps.push({code:'ambiguous-point-level',paragraph:at,path:[...parent.path,segment],message:'The source does not establish whether this point is a sibling or a nested list item.'});}
      const seen=duplicates.get(parent)??new Map(),signature=`${segment.kind}:${segment.value}`,matches=seen.get(signature)??[];
      if(matches.length){segment={...segment,occurrence:matches.length+1};for(const previous of matches)previous.pathConflict=true;details.pathConflict=true;gaps.push({code:'duplicate-label',paragraph:at,path:[...parent.path,segment],message:'Repeated source label; no unique target address is asserted.'});}
      path=[...parent.path,segment];
      const unit={id:`${root.id}/${key(path)}`,kind,label:segment,path,scope,normative,extent:{start:at,end:at},content:[],spans:[],children:[],pathConflict:false,...details};
      matches.push(unit);seen.set(signature,matches);duplicates.set(parent,seen);parent.children.push(unit);parents.set(unit,parent);return unit;
    }
    const ids=anonymousIds.get(parent)??new Map(),signature=`${kind}@${at}`,count=(ids.get(signature)??0)+1;ids.set(signature,count);anonymousIds.set(parent,ids);
    const unit={id:`${root.id}/${key(path)}/${signature}${count>1?`~${count}`:''}`,kind,path,scope,normative,extent:{start:at,end:at},content:[],spans:[],children:[],pathConflict:false,...details};
    parent.children.push(unit);parents.set(unit,parent);return unit;
  }
  function retain(unit,index) {
    unit.content.push(index);(unit.spans??=[]).push({paragraph:index,start:0,end:paragraphs[index].text.length});let current=unit;
    while(current&&current!==root){current.extent.end=Math.max(current.extent.end,index+1);current=parents.get(current);}
  }
  function underlyingContext(unit) {
    const chain=[];
    for(let current=unit;current&&current!==root;current=parents.get(current))if(current.instruction)chain.unshift(...current.instruction.underlyingTargets);
    return chain.filter((segment,index)=>!chain.slice(0,index).some(previous=>previous.kind===segment.kind&&previous.value===segment.value));
  }
  const underlyingProvision=(base,segment)=>{
    if(base.at(-1)?.kind===segment.kind&&base.at(-1)?.value===segment.value)return base;
    if(segment.kind==='paragraph'){const at=base.findIndex(item=>item.kind==='paragraph');if(at>=0)return [...base.slice(0,at),segment];}
    return [...base,segment];
  };
  function observedQuotation(text,state,index){
    const before=state.ambiguities??0,closed=quotationClosed(text,state,language);
    if((state.ambiguities??0)>before)state.ambiguousParagraph=index;
    if(state.ambiguous&&!state.root.boundaryAmbiguous){
      state.root.boundaryAmbiguous=true;
      state.boundaryGap={code:'ambiguous-quotation-boundary',paragraph:index,path:state.root.path,message:'An apostrophe or quotation mark does not establish a unique replacement boundary.'};
      gaps.push(state.boundaryGap);
    }
    return closed;
  }
  function inlineQuotation(owner,index) {
    if(!owner.instruction)return;
    const text=paragraphs[index].text,match=/:\s*([‘“„«"'”])/u.exec(text);
    if(!match)return;
    const offset=match.index+match[0].length-1,inner=text.slice(offset),header=heading(inner,language,''),number=leadingNumber(inner,language,'');
    const context=underlyingContext(owner);
    replacementConsumed.add(owner);
    const scope=make(owner,'quotation',index,{segment:{kind:'quotation',value:String(owner.children.filter(child=>child.kind==='quotation').length+1)},scope:'quoted',instructionPath:owner.path,underlyingPath:context,boundaryBasis:'quotation-mark'});
    const segment=header??number;
    const target=make(scope,segment?.kind??'subparagraph',index,{...(segment?{segment}:{}),scope:'quoted',instructionPath:owner.path,underlyingPath:header?[header]:number?underlyingProvision(context,number):context});
    retain(target,index);target.spans=[{paragraph:index,start:offset,end:text.length}];
    owner.spans.at(-1).end=offset;
    const state={owner,ownerLevel:points.at(-1)?.level??-1,root:scope,last:target,container:header?target:scope,
      paragraph:number?.kind==='paragraph'?target:null,points:number?.kind==='point'?[{unit:target,level:number.level}]:[],
      underlyingPath:header?[header]:context,marks:[],implicit:false};
    if(!observedQuotation(inner,state,index))quote=state;
  }
  let area=make(root,'frontmatter',0,{normative:false}),container=null,paragraph=null,points=[],quote=null,sectionStack=[],last=null;
  const reset=()=>{container=null;paragraph=null;points=[];quote=null;sectionStack=[];last=null;};
  function region(kind,at,normative) {area=make(root,kind,at,{normative});reset();return area;}
  function baseContainer(){return container?.kind==='article'?container:sectionStack.at(-1)?.unit??container??area;}
  function implicit(at) {
    if(!paragraph)paragraph=make(baseContainer(),'paragraph',at,{segment:label('paragraph','1',language),implicit:true});
    return paragraph;
  }
  const articleTitle=(index,article)=>article?.kind==='article'&&
    (/Titrearticle/i.test(paragraphs[index].properties?.styleId??'')||article.extent.start===index-1&&
      (/NormalCentered/i.test(paragraphs[index].properties?.styleId??'')||content.paragraphFormats?.[index]?.align==='center'));
  function continuation(points,index) {
    if(/^[;,.]+$/u.test(paragraphs[index].text.trim()))return;
    const indent=content.paragraphFormats?.[index]?.indent;
    // Word's text indentation distinguishes a paragraph continuation from a
    // continuation inside its final point. Keep unformatted text conservative.
    if(Number.isFinite(indent))while(points.length){
      const pointIndent=content.paragraphFormats?.[points.at(-1).unit.extent.start]?.indent;
      if(!Number.isFinite(pointIndent)||indent>=pointIndent)break;
      points.pop();
    }
  }
  function closeQuote(sourceBoundary=null){
    // A source instruction/annex heading immediately after a possible trailing
    // delimiter independently verifies that boundary. An earlier ambiguous
    // apostrophe followed by more replacement text remains unresolved.
    if(sourceBoundary!==null&&quote.ambiguities===1&&quote.ambiguousTail&&quote.ambiguousParagraph===sourceBoundary-1){
      delete quote.root.boundaryAmbiguous;gaps.splice(gaps.indexOf(quote.boundaryGap),1);
    }
    quote=null;last=points.at(-1)?.unit??paragraph??container??area;
  }
  const tableStart=new Map(),tableParagraphs=new Set();
  const tables=(content.tables??[]).filter(table=>Array.isArray(table.paragraphs));
  const outerTables=tables.filter(table=>!tables.some(parent=>parent!==table&&table.sourcePath.startsWith(parent.sourcePath+'/')));
  const emptyTables=new Map();
  for(const table of outerTables){if(!table.paragraphs.length){const anchor=table.anchor??paragraphs.length,list=emptyTables.get(anchor)??[];list.push(table);emptyTables.set(anchor,list);continue;}tableStart.set(Math.min(...table.paragraphs),table);for(const index of table.paragraphs)tableParagraphs.add(index);}
  let tableUnit=null;
  for(let i=0;i<paragraphs.length;i++) {
    for(const table of emptyTables.get(i)??[])make(quote?.last??points.at(-1)?.unit??paragraph??container??area,'table',i,{table});
    const p=paragraphs[i],text=p.text,style=p.properties?.styleId??'',trim=text.trim(),lead=cleanLead(trim),headed=heading(trim,language,style),sourceRegion=proposalRegion(trim,language);
    if(tableParagraphs.has(i)) {
      if(tableStart.has(i)) {
        const table=tableStart.get(i),parent=quote?.last??points.at(-1)?.unit??paragraph??container??area;
        tableUnit=make(parent,'table',i,{table:{...table,nestedTables:tables.filter(nested=>nested.sourcePath.startsWith(table.sourcePath+'/'))}});
      }
      retain(tableUnit,i);continue;
    }
    if(!quote&&(/Exposdesmotifstitre/i.test(style)||sourceRegion==='memorandum')){region('memorandum',i,false);retain(area,i);continue;}
    if(!quote&&(/Fichefinanciretitre/i.test(style)||sourceRegion==='financial-statement'||/^LEGISLATIVE FINANCIAL (?:AND DIGITAL )?STATEMENT$/iu.test(trim))){region('financial-statement',i,false);retain(area,i);continue;}
    if(!quote&&!nonnormative.has(area.kind)&&(/^(?:Fait|Institutionquisigne|Personnequisigne)$/i.test(style)||sourceRegion==='signature'||/^Done at\b/iu.test(trim))){region('signature',i,false);retain(area,i);continue;}
    if(['frontmatter','memorandum'].includes(area.kind)&&(/Rfrenceinterinstitutionnelle|Typedudocument|Statut/i.test(style)||/^\d{4}\/\d{4}\s*\((?:COD|CNS|APP)\)$/u.test(trim))){region('preamble',i,false);retain(make(area,'title',i),i);continue;}
    if(nonnormative.has(area.kind)&&area.kind!=='frontmatter') {retain(area,i);continue;}
    const pointLevel=style.match(stylePoint)?.[1];
    if(quote&&pointLevel!==undefined&&Number(pointLevel)<=quote.ownerLevel&&!opening.test(trim)&&
      leadingNumber(trim,language,style,p.properties?.numbering,points)&&instruction(lead,language)){
      quote.root.closingBoundaryBasis='instruction-style';closeQuote(i);
    }
    if(quote&&headed?.kind==='annex'&&/Annexetitre/i.test(style)&&!opening.test(trim)){quote.root.closingBoundaryBasis='source-heading';closeQuote(i);}
    if(!quote&&(/Formuledadoption/i.test(style)||sourceRegion==='enacting-formula'||/^(?:HAVE ADOPTED|HAS ADOPTED|HÄRIGENOM FÖRESKRIVS)/u.test(trim))) {
      region('body',i,true);retain(make(area,'enacting-formula',i),i);continue;
    }
    // A quoted replacement heading can only open inside its source instruction.
    const followingReplacement=last?.instruction&&!replacementConsumed.has(last)&&['replace','insert'].includes(last.instruction.operation)&&/:\s*$/.test(last.instruction.raw)&&pointLevel===undefined&&
      (!headed||last.instruction.underlyingTargets.some(target=>target.kind===headed.kind&&target.value===headed.value));
    const startsQuote=(opening.test(trim)||followingReplacement)&&!quote&&(points.length>0||paragraph?.instruction||container?.kind==='annex');
    if(startsQuote) {
      const owner=points.at(-1)?.unit??paragraph??container,level=points.at(-1)?.level??-1;
      replacementConsumed.add(owner);
      owner.instruction??={operation:'unknown',raw:owner.content.map(index=>paragraphs[index].text).join('\n'),underlyingTargets:[]};
      const context=underlyingContext(owner);
      const scope=make(owner,'quotation',i,{segment:{kind:'quotation',value:String(owner.children.filter(child=>child.kind==='quotation').length+1)},scope:'quoted',instructionPath:owner.path,
        underlyingPath:context,boundaryBasis:opening.test(trim)?'quotation-mark':'replacement-instruction'});
      quote={owner,ownerLevel:level,root:scope,last:scope,container:scope,paragraph:null,points:[],underlyingPath:context,marks:[],implicit:!opening.test(trim)};
    }
    if(quote) {
      const q=quote,number=leadingNumber(trim,language,style,p.properties?.numbering,q.points);let target;
      if(number?.kind==='point'&&number.level===0&&/^\d/.test(number.value)&&(q.container.kind==='article'||q.container.kind==='quotation'&&q.owner.instruction?.underlyingTargets.some(target=>target.kind==='paragraph'&&target.value===number.value)))number.kind='paragraph';
      if(headed&&['article','annex','chapter','section','title'].includes(headed.kind)) {
        target=make(q.root,headed.kind,i,{segment:headed,scope:'quoted',instructionPath:q.owner.path,underlyingPath:[headed]});q.container=target;q.paragraph=null;q.points=[];q.underlyingPath=[headed];
      } else if(number?.kind==='paragraph') {
        target=make(q.container,'paragraph',i,{segment:number,scope:'quoted',instructionPath:q.owner.path,underlyingPath:underlyingProvision(q.underlyingPath,number)});q.paragraph=target;q.points=[];
      } else if(number?.kind==='point') {
        while(q.points.length&&q.points.at(-1).level>=number.level)q.points.pop();
        const parent=q.points.at(-1)?.unit??q.paragraph??q.container;
        target=make(parent,'point',i,{segment:number,scope:'quoted',instructionPath:q.owner.path,underlyingPath:underlyingProvision(parent.underlyingPath??q.underlyingPath,number)});q.points.push({unit:target,level:number.level,style});
      } else if(number?.kind==='indent') {
        const parent=q.points.at(-1)?.unit??q.paragraph??q.container;
        target=make(parent,'indent',i,{segment:label('indent',String(parent.children.filter(child=>child.kind==='indent').length+1),language),scope:'quoted',instructionPath:q.owner.path,underlyingPath:parent.underlyingPath??q.underlyingPath});
      } else if(articleTitle(i,q.container))target=make(q.container,'title',i,{scope:'quoted',instructionPath:q.owner.path,underlyingPath:q.container.underlyingPath});
      else {
        continuation(q.points,i);
        target=make(q.points.at(-1)?.unit??q.paragraph??q.container,'subparagraph',i,{scope:'quoted',instructionPath:q.owner.path,underlyingPath:(q.paragraph??q.container).underlyingPath??q.underlyingPath});
      }
      retain(target,i);q.last=target;
      if(observedQuotation(text,q,i))closeQuote();
      continue;
    }
    if(headed) {
      if(headed.unavailable)gaps.push({code:'unlabelled-article',paragraph:i,message:'The source article heading has no number; its extent is retained without inventing a target label.'});
      if(headed.kind==='article'||headed.kind==='annex') {
        if(area.kind!=='body')region('body',i,true);
        const parent=headed.kind==='article'?(sectionStack.at(-1)?.unit??area):area;
        container=make(parent,headed.kind,i,{segment:headed,normative:true});paragraph=null;points=[];last=container;
        if(headed.kind==='annex')sectionStack=[];
      } else {
        if(area.kind!=='body')region('body',i,true);
        const level={title:0,chapter:1,section:2}[headed.kind];
        while(sectionStack.length&&sectionStack.at(-1).level>=level)sectionStack.pop();
        const parent=sectionStack.at(-1)?.unit??(item==='annex'&&container?.kind==='annex'?container:area);
        const unit=make(parent,headed.kind,i,{segment:headed,normative:true});sectionStack.push({unit,level});last=unit;paragraph=null;points=[];
        if(item==='act')container=null;
      }
      retain(last,i);
      // Annex II of the AI proposal places Section A in the same Word paragraph
      // as its annex heading. Keep a separate address and exact source slices.
      if(headed.kind==='annex'&&trim.includes('\n')) {
        let offset=text.indexOf('\n')+1;
        for(const line of text.slice(offset).split('\n')) {
          const nested=heading(line,language,'');
          if(nested?.kind==='section') {const section=make(container,'section',i,{segment:nested,normative:true});retain(section,i);section.spans=[{paragraph:i,start:offset,end:text.length}];last.spans.at(-1).end=offset;sectionStack=[{unit:section,level:2}];last=section;break;}
          offset+=line.length+1;
        }
      }
      continue;
    }
    const number=leadingNumber(trim,language,style,p.properties?.numbering,points);
    if((/Considrant/i.test(style)||area.kind!=='body'&&/^\(?\d+\)/u.test(trim))&&number?.kind==='point') {
      if(area.kind!=='preamble')region('preamble',i,false);
      last=make(area,'recital',i,{segment:{...number,kind:'recital'}});retain(last,i);continue;
    }
    if(area.kind!=='body') {
      if(['Typedudocument','Titreobjet','IntrtEEE','Statut','Rfrenceinterinstitutionnelle'].includes(style))last=make(area,'title',i);
      else last=make(area,'citation',i);
      retain(last,i);continue;
    }
    if(articleTitle(i,container)&&!paragraph){last=make(container,'title',i);retain(last,i);continue;}
    const operation=instruction(lead,language);
    if(number?.kind==='paragraph'&&paragraph?.implicit&&(paragraph.instruction?.operation==='amend'||/^(?:Manual)?NumPar1$/i.test(style))){number.kind='point';number.level=0;}
    if(number?.kind==='point'&&number.level===0&&/^\d/.test(number.value)&&container?.kind==='article'&&(!paragraph||!paragraph.implicit)&&!operation)number.kind='paragraph';
    if(number?.kind==='paragraph') {
      // In annexes Commission NumPar lists are addressed as numbered points.
      if(item==='annex'&&/NumPar/i.test(style)){number.kind='point';number.level=0;}
      else {paragraph=make(baseContainer(),'paragraph',i,{segment:number,...(operation?{instruction:operation}:{})});points=[];last=paragraph;retain(last,i);inlineQuotation(last,i);continue;}
    }
    if(number?.kind==='point') {
      const numberedParent=implicit(i);
      while(points.length&&points.at(-1).level>=number.level)points.pop();
      const parent=points.at(-1)?.unit??numberedParent;
      last=make(parent,'point',i,{segment:number,...(operation?{instruction:operation}:{})});points.push({unit:last,level:number.level,style});retain(last,i);inlineQuotation(last,i);continue;
    }
    if(number?.kind==='indent') {
      const parent=points.at(-1)?.unit??implicit(i);
      last=make(parent,'indent',i,{segment:label('indent',String(parent.children.filter(child=>child.kind==='indent').length+1),language)});retain(last,i);continue;
    }
    continuation(points,i);
    const parent=points.at(-1)?.unit??implicit(i);
    if(operation&&!points.length&&!paragraph.instruction)paragraph.instruction=operation;
    last=make(parent,'subparagraph',i,{...(operation?{instruction:operation}:{})});retain(last,i);inlineQuotation(last,i);
  }
  for(const table of emptyTables.get(paragraphs.length)??[])make(quote?.last??points.at(-1)?.unit??paragraph??container??area,'table',paragraphs.length,{table});
  if(quote)gaps.push({code:'unclosed-quotation',paragraph:quote.root.extent.start,path:quote.root.path,message:'Replacement quotation has no observed closing boundary.'});
  function finish(unit,inheritedConflict=false) {
    if(inheritedConflict)unit.pathConflict=true;
    for(const child of unit.children)finish(child,!!unit.pathConflict);
    unit.complete=unit.content.every(index=>paragraphs[index].complete)&&unit.children.every(child=>child.complete)&&!unit.pathConflict&&!unit.boundaryAmbiguous;
    if(unit.kind==='table')unit.complete&&=unit.table.complete;
  }
  finish(root);
  const structureComplete=sourceStructured&&!gaps.length;
  return {parserVersion:PROPOSAL_PARSER_VERSION,language,item,identity,sourceUrl,sourceHash,sourceKind:content.sourceKind??'extracted-text',
    complete:root.complete&&structureComplete,contentComplete:paragraphs.every(paragraph=>paragraph.complete)&&notes.every(note=>note.complete),structureComplete,
    paragraphs,notes,anchors:content.anchors??[],links:content.links??[],units:root.children,gaps,numberingMode:content.numberingMode??'supplied-text',
    objects:[...paragraphs.flatMap(paragraph=>paragraph.objects),...notes.flatMap(note=>note.objects)]};
}

function freezeTree(value) {
  const pending=[value],seen=new WeakSet();
  while(pending.length){const current=pending.pop();if(!current||typeof current!=='object'||seen.has(current))continue;seen.add(current);pending.push(...Object.values(current).filter(value=>value&&typeof value==='object'));Object.freeze(current);}
  return value;
}

/** Bounded process-local LRU. Exact content, parser version and context form the
 * key; immutable results prevent a consumer from corrupting a later cache hit. */
export function parseProposal(input,options={}) {
  const language=proposalLanguage(options.language??'en'),item=options.item??'act';
  const binary=Buffer.isBuffer(input)||input instanceof Uint8Array;
  if(binary&&input.length>MAX_TEXT)throw new RangeError('DOCX exceeds 8 MiB.');
  const serialized=binary?input:typeof input==='string'?input:JSON.stringify(input);
  if(serialized===undefined)throw new TypeError('Expected proposal input.');
  const digest=createHash('sha256').update(serialized).digest('hex');
  const projection=binary||typeof input==='string'?null:input;
  const sourceUrl=officialDocumentUrl(options.sourceUrl??projection?.sourceUrl??projection?.resolvedSourceUrl);
  const cacheKey=JSON.stringify([PROPOSAL_PARSER_VERSION,digest,language,item,sourceUrl,options.identity??null]);
  const cached=parseCache.get(cacheKey);
  if(cached){parseCache.delete(cacheKey);parseCache.set(cacheKey,cached);return cached.result;}
  // Clone supplied projections before freezing, leaving the caller's data intact.
  const prepared=binary||typeof input==='string'?input:structuredClone(input);
  const result=freezeTree(parseProposalUncached(prepared,{...options,language,item,sourceUrl,identity:structuredClone(options.identity??null)}));
  const bytes=Buffer.byteLength(typeof serialized==='string'?serialized:Buffer.from(serialized))+result.paragraphs.length*1024+
    result.objects.reduce((sum,object)=>sum+(object.math?JSON.stringify(object.math).length*2:512),0);
  if(bytes<=MAX_CACHE_BYTES){parseCache.set(cacheKey,{result,bytes});cacheBytes+=bytes;while(cacheBytes>MAX_CACHE_BYTES||parseCache.size>MAX_CACHE_ENTRIES){const [oldest,entry]=parseCache.entries().next().value;parseCache.delete(oldest);cacheBytes-=entry.bytes;}}
  return result;
}

/** All exact candidates, including repeated labels. This helper does not choose
 * by wording, fill missing levels, translate labels or invent numbering aliases. */
export function proposalCandidates(proposal,target,{language=proposal.language,scope='proposal'}={}) {
  const parsed=typeof target==='string'?parseTargetLabel(target,language):Array.isArray(target)?{complete:true,segments:target}:target;
  if(!parsed?.complete||!Array.isArray(parsed.segments))return [];
  if(parsed.segments.at(-1)?.kind==='title'&&parsed.segments.at(-1).value===''){
    const parents=proposalCandidates(proposal,parsed.segments.slice(0,-1),{language,scope});
    return parents.filter(parent=>parent.kind==='article').flatMap(parent=>parent.children.filter(child=>child.kind==='title'&&child.scope===scope));
  }
  let index=candidateIndexes.get(proposal);
  const canonical=segments=>segments.map(segment=>`${segment.kind}:${segment.value}`).join('/');
  if(!index){index=new Map();const pending=[...proposal.units];while(pending.length){const unit=pending.pop();pending.push(...unit.children);if(!unit.label)continue;
      const addresses=[unit.path],at=unit.path.findIndex(segment=>['article','annex','recital'].includes(segment.kind));if(at>0)addresses.push(unit.path.slice(at));
      for(const address of addresses){const key=unit.scope+'|'+canonical(address);const matches=index.get(key)??[];matches.push(unit);index.set(key,matches);}
    }for(const [key,units] of index)index.set(key,Object.freeze(units.sort((a,b)=>a.extent.start-b.extent.start)));candidateIndexes.set(proposal,index);}
  return index.get(scope+'|'+canonical(parsed.segments))??[];
}
