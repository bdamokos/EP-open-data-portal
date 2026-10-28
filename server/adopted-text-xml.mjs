import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {array,tail} from './activity-index-model.mjs';
import {languageCode} from './ep-links.mjs';

export const ADOPTED_TEXT_XML_VERSION=1;
export const ADOPTED_TEXT_XML_LIMITS=Object.freeze({bytes:2*1024*1024,elements:50000,depth:64,blocks:20000,text:2*1024*1024});
const XSI='http://www.w3.org/2001/XMLSchema-instance';
const canonical=value=>String(value?.id??value??'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

// These are declarations on the exact work, never URLs inferred from DOCX names.
// Native XML fidelity and equivalence to a different publication are separate gates.
export function adoptedTextXmlSources(work,language) {
  const id=work?.identifier;
  if(!/^TA-10-\d{4}-\d{4,6}$/.test(id??''))return null;
  const base={documentId:id,language,preference:'held',status:'unavailable',reason:'xml-not-declared',sources:[],gaps:[]};
  if(canonical(work.id)!=='eli/dl/doc/'+id||canonical(work.work_type)!=='def/ep-document-types/TEXT_ADOPTED')return {...base,reason:'adopted-identity-unverified'};
  for(const expression of array(work.is_realized_by)) {
    if(!language||languageCode(expression.language)!==language)continue;
    for(const manifestation of array(expression.is_embodied_by)) {
      if(tail(manifestation.format)!=='XML')continue;
      let url;try{url=new URL(manifestation.is_exemplified_by,'https://data.europarl.europa.eu/');}catch{base.gaps.push('xml-source-unavailable');continue;}
      if(typeof manifestation.is_exemplified_by!=='string'){base.gaps.push('xml-source-unavailable');continue;}
      if(url.protocol!=='https:'||url.hostname!=='data.europarl.europa.eu'||url.port||url.username||url.password||url.search||url.hash||!url.pathname.startsWith('/distribution/')){base.gaps.push('xml-source-unapproved');continue;}
      const size=manifestation.byteSize;
      base.sources.push({url:url.href,language,expressionId:expression.id??null,manifestationId:manifestation.id??null,
        byteSize:size!=null&&size!==''&&Number.isSafeInteger(Number(size))&&Number(size)>=0?Number(size):null,
        issued:typeof manifestation.issued==='string'?manifestation.issued:null,mediaType:manifestation.media_type??null});
    }
  }
  // Repeated identical declarations are harmless; competing versions remain observations.
  base.sources=[...new Map(base.sources.map(source=>[JSON.stringify(source),source])).values()];
  if(base.gaps.length)return {...base,reason:'xml-distribution-unusable'};
  return {...base,...(base.sources.length?{status:base.sources.length===1?'declared':'ambiguous',reason:base.sources.length===1?'fidelity-verification-required':'conflicting-xml-distributions'}:{})};
}

const LEAVES=new Set(['IDENT','TI','NOTE','PRINIT','P','ACTINIT','GRCINIT','DINIT','TI.ART','PARAG','TI.AMD','STI.AMD','HEAD.OLD','HEAD.NEW']);
const CHILDREN={
  SDOCTA:['IDENT','TI','HIDDEN','TXTLST'],TXTLST:['IDENT','RESOL','DECISION','TCONSOLID'],
  RESOL:['TI','NOTE','TEXT'],DECISION:['TI','NOTE','TEXT'],TCONSOLID:['TI','NOTE','TEXT'],
  TEXT:['PREAMBLE','DISPOSITIF','AMDLST'],PREAMBLE:['PRINIT','GRVISA','GRCONS'],GRVISA:['VISA'],VISA:['P'],
  GRCONS:['GRCINIT','CONS'],CONS:['P'],DISPOSITIF:['DINIT','ACTLST','GR.ART','SIGNATURE'],
  ACTLST:['ACTINIT','ACTION','SEPARATION'],ACTION:['P'],SEPARATION:['P'],
  'GR.ART':['ARTICLE'],ARTICLE:['TI.ART','PARAG'],SIGNATURE:['P'],AMDLST:['HD','AMEND'],HD:['HEAD.OLD','HEAD.NEW'],
  AMEND:['TI.AMD','STI.AMD','OLD','NEW'],OLD:['P'],NEW:['P'],
};
const COMPONENTS={RESOL:'resolution',DECISION:'decision',TCONSOLID:'legislative-position',AMDLST:'adopted-amendments'};
const INLINE=new Set(['STRING','BRK','FOOTNOTE','NO.P']);
const FORMATS={BOLD:'bold',ITALIC:'italic',SUPERSCRIPT:'superscript'};
const CONTAINERS=new Set(['TXTLST',...Object.keys(COMPONENTS),'AMEND','OLD','NEW','SEPARATION','ARTICLE','ACTLST']);
const fail=code=>{throw Object.assign(new Error('Unsupported adopted-text XML: '+code),{code});};

function xmlTree(bytes) {
  if(!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array))fail('xml-bytes-required');
  if(!bytes.length||bytes.byteLength>ADOPTED_TEXT_XML_LIMITS.bytes)fail('xml-size');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('xml-encoding');}
  if(/<!DOCTYPE|<!ENTITY/i.test(text)||/<\?xml[^>]*encoding\s*=\s*['"](?!utf-8['"])/i.test(text))fail('xml-declarations');
  if(/&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);)/.test(text)||XMLValidator.validate(text)!==true)fail('invalid-xml');
  for(const match of text.matchAll(/&#(x[\da-fA-F]+|\d+);/g)) {
    const n=match[1][0]==='x'?parseInt(match[1].slice(1),16):Number(match[1]);
    if(![9,10,13].includes(n)&&!(n>=32&&n<=0xD7FF||n>=0xE000&&n<=0xFFFD||n>=0x10000&&n<=0x10FFFF))fail('invalid-xml-character');
  }
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]/u.test(text))fail('invalid-xml-character');
  // Parser-enforced depth handles quoted '>' characters correctly. No entity,
  // schema or network resolution runs. Bound the resulting tree as well.
  const ordered=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,maxNestedTags:ADOPTED_TEXT_XML_LIMITS.depth}).parse(text);
  let count=0;
  const build=nodes=>nodes.filter(node=>!Object.keys(node)[0].startsWith('?')).map(node=>{
    if(Object.hasOwn(node,'#text'))return {text:String(node['#text'])};
    if(++count>ADOPTED_TEXT_XML_LIMITS.elements)fail('xml-structure-budget');
    const tag=Object.keys(node).find(key=>key!==':@');
    return {tag,attrs:Object.fromEntries(Object.entries(node[':@']??{}).map(([key,value])=>[key.slice(2),String(value)])),children:build(node[tag]??[])};
  });
  const roots=build(ordered).filter(node=>node.tag);
  if(roots.length!==1||roots[0].tag!=='SDOCTA')fail('sdocta-root');
  return roots[0];
}

function marksFor(runs) {
  const marks=[];
  for(const kind of Object.values(FORMATS)) {
    let last;
    for(const run of runs)if(run.kinds.has(kind)&&run.end>run.start){
      if(last&&last.end===run.start)last.end=run.end;
      else {last={start:run.start,end:run.end,kind};marks.push(last);}
    }
  }
  return marks.sort((a,b)=>a.start-b.start||a.kind.localeCompare(b.kind));
}

// A native, source-addressed contract, deliberately distinct from DOCX paragraphs.
// It is not an amendment-list parser, an adoption decision, or a placement input.
export function readAdoptedTextXml(bytes,{work,language,sourceUrl,fetchedAt=null}={}) {
  const observation=adoptedTextXmlSources(work,language);
  if(observation?.status!=='declared')fail(observation?.reason??'adopted-identity-unverified');
  const declared=observation.sources[0];
  if(sourceUrl!==declared.url)fail('undeclared-xml-source');
  if(fetchedAt!==null&&(typeof fetchedAt!=='string'||!Number.isFinite(Date.parse(fetchedAt))))fail('invalid-retrieval-date');
  const root=xmlTree(bytes),elements=[],index=new WeakMap(),blocks=[],notes=[],objects=[],gaps=[],containers=[],components=[],textLists=[],hidden=[];
  const paths=new Map();let textSize=0;
  const gap=(code,node,extra={})=>gaps.push({code,path:index.get(node).path,...extra});
  function indexTree(node,parent=null,depth=0,invisible=false,namespaces={}) {
    if(!node.tag)return;
    if(depth>ADOPTED_TEXT_XML_LIMITS.depth||elements.length>=ADOPTED_TEXT_XML_LIMITS.elements)fail('xml-structure-budget');
    const parentPath=parent?.path??'',key=parentPath+'/'+node.tag,n=(paths.get(key)??0)+1;paths.set(key,n);
    const ns={...namespaces};for(const [key,value] of Object.entries(node.attrs))if(key.startsWith('xmlns:'))ns[key.slice(6)]=value;
    const attrs=Object.fromEntries(Object.entries(node.attrs).filter(([key])=>!key.startsWith('xmlns')).map(([key,value])=>{
      const [prefix,name]=key.split(':');return [name&&ns[prefix]?`{${ns[prefix]}}${name}`:key,value];
    }));
    const suppressed=invisible||node.tag==='HIDDEN'||node.attrs.HIDDEN==='on';
    const row={element:node.tag,path:`${key}[${n}]`,parent:parentPath||null,ordinal:elements.length,attributes:attrs,hidden:suppressed};
    elements.push(row);index.set(node,row);if(suppressed&&!invisible)hidden.push(row.path);
    for(const child of node.children)if(child.tag)indexTree(child,row,depth+1,suppressed,ns);
  }
  indexTree(root);
  const direct=(node,tag)=>node.children.filter(child=>child.tag===tag);
  const identity=direct(root,'IDENT');
  const idText=node=>node.children.map(child=>child.tag?idText(child):child.text??'').join('');
  const match=work.identifier.match(/^TA-10-(\d{4})-(\d{4,6})$/),expected=`P10_TA(${match[1]})${match[2]}`;
  if(identity.length!==1||idText(identity[0]).trim()!==expected||work.notation_publicRegister!=null&&work.notation_publicRegister!==expected)fail('native-identity-mismatch');
  for(const node of elements) {
    const permitted=node.element==='SDOCTA'?new Set(['STATUS',`{${XSI}}noNamespaceSchemaLocation`]):node.element==='STRING'?new Set(['BOLD','ITALIC','SUPERSCRIPT','HIDDEN']):new Set();
    for(const [attribute,value] of Object.entries(node.attributes))if(!permitted.has(attribute)||node.element==='STRING'&&!['on','off'].includes(value))gaps.push({code:'unsupported-attribute',path:node.path,attribute,value});
  }
  function inline(node,{note=false}={}) {
    const out={text:'',runs:[],notes:[],objects:[],breaks:[],label:null};
    const append=(text,kinds)=>{const start=out.text.length;out.text+=text;out.runs.push({start,end:out.text.length,kinds});textSize+=text.length;if(textSize>ADOPTED_TEXT_XML_LIMITS.text)fail('xml-text-budget');};
    function visit(node,inherited=new Set(),self=false) {
      if(!node.tag){append(node.text??'',inherited);return;}
      if(index.get(node).hidden)return;
      const kinds=new Set(inherited);
      if(node.tag==='STRING')for(const [attr,kind] of Object.entries(FORMATS)){if(node.attrs[attr]==='on')kinds.add(kind);else if(node.attrs[attr]==='off')kinds.delete(kind);}
      if(node.tag==='NO.P'&&!self&&!note) {
        if(out.label||out.text.length)gap('unsupported-label-position',node);
        const value=inline(node,{note:true});out.label={text:value.text,marks:value.marks,path:index.get(node).path};return;
      }
      if(node.tag==='FOOTNOTE'&&!self&&!note) {
        const fields=direct(node,'FIELD');
        if(fields.length!==1||node.children.some(child=>child.tag&&child.tag!=='FIELD'||!child.tag&&child.text.trim()))gap('unsupported-footnote',node);
        const value=fields.length===1?inline(fields[0],{note:true}):{text:'',marks:[],objects:[]};
        const path=index.get(node).path,n={path,id:path,ordinal:notes.length,text:value.text,marks:value.marks,label:null,links:[],objects:value.objects};notes.push(n);
        out.notes.push({offset:out.text.length,path});return;
      }
      if(node.tag==='BRK'){out.breaks.push(out.text.length);append('\n',kinds);return;}
      if(!self&&!['STRING'].includes(node.tag)) {
        const object={path:index.get(node).path,element:node.tag,offset:out.text.length,replacement:'\uFFFC',status:'unresolved'};
        out.objects.push(object);append(object.replacement,kinds);gap('unsupported-object',node);return;
      }
      for(const child of node.children)visit(child,kinds);
    }
    visit(node,new Set(),true);
    return {text:out.text,marks:marksFor(out.runs),notes:out.notes,label:out.label,breaks:out.breaks,objects:out.objects};
  }
  const ranges=new WeakMap();
  function visit(node,component=null,textList=null) {
    if(!node.tag||index.get(node).hidden)return;
    const info=index.get(node),start=blocks.length;
    if(node.tag==='TXTLST'){textList={ordinal:textLists.length,path:info.path,components:[],identifiers:[],extent:null};textLists.push(textList);}
    if(COMPONENTS[node.tag]) {
      const parent=component?.path??null;component={kind:COMPONENTS[node.tag],path:info.path,parent,textList:textList?.ordinal??null,extent:null,content:[]};
      components.push(component);textList?.components.push(info.path);
    }
    if(LEAVES.has(node.tag)) {
      // A leaf may have only source-attested inline material. Other tags become objects.
      for(const child of node.children)if(child.tag&&!INLINE.has(child.tag))gap('unsupported-inline-structure',child);
      const content=inline(node),block={path:info.path,element:node.tag,ordinal:blocks.length,component:component?.path??null,textList:textList?.ordinal??null,...content};
      blocks.push(block);component?.content.push(block.ordinal);
      for(const object of content.objects)objects.push({block:block.ordinal,...object});
      if(node.tag==='IDENT'&&textList)textList.identifiers.push({text:content.text,path:info.path});
      if(blocks.length>ADOPTED_TEXT_XML_LIMITS.blocks)fail('xml-block-budget');
    }else if(CHILDREN[node.tag]) {
      for(const child of node.children) {
        if(!child.tag){if(child.text.trim())gap('unsupported-container-text',node);continue;}
        if(child.tag==='HIDDEN')continue;
        if(!CHILDREN[node.tag].includes(child.tag)) {
          gap('unsupported-structure',child);
          const at=blocks.length,object={block:at,path:index.get(child).path,element:child.tag,offset:0,replacement:'\uFFFC',status:'unresolved'};
          objects.push(object);blocks.push({path:object.path,element:child.tag,ordinal:at,component:component?.path??null,textList:textList?.ordinal??null,text:'\uFFFC',label:null,marks:[],notes:[],breaks:[],objects:[object]});component?.content.push(at);
        }else visit(child,component,textList);
      }
    }
    const extent={start,end:blocks.length};ranges.set(node,extent);
    if(CONTAINERS.has(node.tag))containers.push({element:node.tag,path:info.path,children:node.children.filter(child=>child.tag).map(child=>child.tag),extent,empty:!node.children.length});
    if(COMPONENTS[node.tag])component.extent=extent;
    if(node.tag==='TXTLST')textList.extent=extent;
  }
  visit(root);
  if(!textLists.length||!components.length)gap('document-components-missing',root);
  const amendments=[];
  function comparisons(node) {
    if(node.tag==='AMEND') {
      const item={path:index.get(node).path,ordinal:amendments.length,title:[],headings:[],pairs:[]};let old=null;
      for(const child of node.children.filter(child=>child.tag)) {
        const extent=ranges.get(child);
        if(child.tag==='TI.AMD')item.title.push(extent?.start);
        else if(child.tag==='STI.AMD')item.headings.push(extent?.start);
        else if(child.tag==='OLD') {if(old)gap('unpaired-comparison-column',child);old=child;}
        else if(child.tag==='NEW') {
          if(!old){gap('unpaired-comparison-column',child);continue;}
          const column=node=>({path:index.get(node).path,extent:ranges.get(node),empty:!node.children.length});
          item.pairs.push({ordinal:item.pairs.length,old:column(old),new:column(child)});old=null;
        }
      }
      if(old||!item.pairs.length)gap('unpaired-comparison-column',node);
      amendments.push(item);
    }
    for(const child of node.children)if(child.tag&&!index.get(child).hidden)comparisons(child);
  }
  comparisons(root);
  if(declared.byteSize!==null&&declared.byteSize!==bytes.byteLength)gap('source-size-conflict',root,{declared:declared.byteSize,observed:bytes.byteLength});
  const ordinals=new Map(elements.map(element=>[element.path,element.ordinal]));
  return {version:ADOPTED_TEXT_XML_VERSION,sourceKind:'ep-adopted-text-xml',nativeComplete:gaps.length===0,preference:'held',
    source:{documentId:work.identifier,nativeIdentifier:expected,language,url:declared.url,fetchedAt,contentHash:sha(bytes),retrievedByteSize:bytes.byteLength,
      expressionId:declared.expressionId,manifestationId:declared.manifestationId,version:{issued:declared.issued,byteSize:declared.byteSize,status:root.attrs.STATUS??null}},
    textLists,components,blocks,notes,objects,links:[],hidden,elements,containers:containers.sort((a,b)=>ordinals.get(a.path)-ordinals.get(b.path)),amendments,gaps,
    fidelityGaps:[{code:'docx-equivalence-unverified'},...(notes.length?[{code:'note-labels-not-declared'}]:[])]};
}
