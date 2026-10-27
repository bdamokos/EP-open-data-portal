import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {proposalNumber,proposalLanguage} from './proposal-labels.mjs';

export const PUBLIC_LEGAL_XHTML_VERSION='3';
const hash=value=>createHash('sha256').update(value).digest('hex');
const uniqueLinks=links=>[...new Set(links.map(link=>link.url))];
const clean=value=>value.replace(/\s+/gu,' ').trim();
const all=node=>[node,...node.children.flatMap(all)];
const text=node=>node.name==='#text'?node.value:node.children.map(text).join(node.name==='br'?'\n':'');
const has=(node,name)=>(node.attrs.class||'').split(/\s+/).includes(name);
function documentTree(xml) {
  xml=legalXhtmlXml(xml);
  if(Buffer.byteLength(xml)>8*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('invalid-legal-xhtml');
  let count=0;
  const convert=(rows,path='',depth=0)=>{
    if(depth>100)throw new Error('legal-xhtml-depth');
    return rows.map((row,index)=>{
      if(++count>100000)throw new Error('legal-xhtml-nodes');
      const key=Object.keys(row).find(k=>k!==':@');
      if(key==='#text')return {name:key,value:String(row[key]),children:[],attrs:{},path:path+'/'+index};
      return {name:key.replace(/^.*:/,''),children:convert(row[key]||[],path+'/'+index,depth+1),attrs:Object.fromEntries(Object.entries(row[':@']||{}).map(([k,v])=>[k.replace(/^@_/,''),String(v)])),path:path+'/'+index};
    });
  };
  const roots=convert(new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml));
  const html=roots.find(n=>n.name==='html');
  if(!html)throw new Error('invalid-legal-xhtml');
  return html;
}
export function legalXhtmlXml(xml) {
  // OJ files declare the static XHTML DTD. Do not resolve external resources.
  return xml.replace(/<!DOCTYPE html PUBLIC "-\/\/W3C\/\/DTD XHTML\/\/EN" "xhtml-strict\.dtd">/,'');
}

/** Publications Office OJ XHTML -> the proposal unit contract. No HTML is rendered. */
export function parsePublicLegalXhtml(input,{language='en',sourceUrl=null,identity=null,coverage}={}) {
  language=proposalLanguage(language);
  const xml=Buffer.from(input).toString('utf8'),dom=documentTree(xml),nodes=all(dom),sourceHash=hash(input);
  const consolidated=nodes.some(n=>has(n,'reference')&&/^0\d{4}[RLD]\d{4}\s*—/u.test(clean(text(n))));
  const prefix='legal-xhtml-v'+PUBLIC_LEGAL_XHTML_VERSION+':'+hash(JSON.stringify([sourceHash,language,sourceUrl,identity])).slice(0,24);
  const objectSourceUrl=/^(?:5\d{4}AG\d{4}\(01\)|0\d{4}[RLD]\d{4}-\d{8})$/.test(identity?.celex||'')?`https://eur-lex.europa.eu/legal-content/${language.toUpperCase()}/TXT/?uri=CELEX:${encodeURIComponent(identity.celex)}`:sourceUrl;
  const paragraphs=[],units=[],objects=[],notes=[],anchors=[],links=[],gaps=[];
  const parents=new WeakMap(),noteNodes=new Set(),noteMap=new Map();
  function unit(parent,kind,value=null,extra={}) {
    const segment=value===null?null:{kind,...(proposalNumber(value,language)||{value,number:null,suffix:''}),isNew:false,...extra.label};
    const siblings=parent?.children||units,duplicates=segment?siblings.filter(u=>u.kind===kind&&u.label?.value===segment.value):[];
    const path=[...(parent?.path||[]),...(segment?[segment]:[])];
    const result={id:prefix+'/'+kind+'@'+paragraphs.length+':'+(siblings.length+1),kind,path,scope:parent?.scope||'proposal',...(parent?.scope==='quoted'?{instructionPath:parent.instructionPath,underlyingPath:parent.underlyingPath}:{}),normative:parent?.normative??true,extent:{start:paragraphs.length,end:paragraphs.length},content:[],spans:[],children:[],complete:true,pathConflict:duplicates.length>0,...extra};
    if(segment)result.label=segment;
    for(const other of duplicates)other.pathConflict=true;
    siblings.push(result);if(parent)parents.set(result,parent);return result;
  }
  function inline(node,state) {
    if(node.name==='#text'){state.text+=node.value;return;}
    // Consolidations mark the origin of amendments outside the legal wording.
    if(['a','span'].includes(node.name)&&/^[►◄▼]\s*(?:[BMCR]\d*)?\s*$/u.test(clean(text(node))))return;
    if(node.name==='br'){state.text+='\n';return;}
    if(['img','object','svg','math','iframe'].includes(node.name)) {
      state.objects.push({kind:node.name==='math'?'math':'drawing',status:'unresolved',complete:false,offset:state.text.length,path:node.path,sourcePart:'xhtml',sourceUrl:objectSourceUrl});state.text+='\uFFFC';return;
    }
    const href=node.attrs.href;
    if(node.name==='a'&&href?.startsWith('#E'))state.complete=false;
    if(node.name==='a'&&href?.startsWith('#ntr')) {
      const note=noteMap.get(href.slice(1));
      if(note){state.anchors.push({note:note.id,label:note.label,offset:state.text.length});if(!note.complete)state.complete=false;}
      else {state.text+=text(node);if(/[^\s()]/u.test(text(node)))state.complete=false;}
      return;
    }
    const start=state.text.length;
    for(const child of node.children)inline(child,state);
    if(node.name==='a'&&href&&!href.startsWith('#'))try {
      const url=new URL(href,sourceUrl);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)state.links.push({start,end:state.text.length,url:url.href});
    }catch{/* An invalid link cannot create a destination. */}
  }
  function normalized(state) {
    // XML indentation is outside inline runs except in pretty-printed spans.
    // Keep offsets intact: collapse each whitespace run while mapping annotations.
    const raw=state.text,boundaries=[0];let value='';
    for(let i=0;i<raw.length;){
      if(/[\t\r\n ]/u.test(raw[i])){const start=i;while(i<raw.length&&/[\t\r\n ]/u.test(raw[i]))i++;if(value&&i<raw.length)value+=' ';for(let at=start+1;at<=i;at++)boundaries[at]=value.length;}
      else {value+=raw[i++];boundaries[i]=value.length;}
    }
    const offset=at=>boundaries[at]??value.length;
    return {text:value,objects:state.objects.map(object=>({...object,offset:offset(object.offset)})),anchors:state.anchors.map(anchor=>({...anchor,offset:offset(anchor.offset)})),links:state.links.map(link=>({...link,start:offset(link.start),end:offset(link.end)})),complete:state.complete&&!state.objects.length};
  }
  function paragraph(owner,node,labelPrefix='') {
    const raw={text:labelPrefix,objects:[],anchors:[],links:[],complete:true};inline(node,raw);
    const state=normalized(raw),value=state.text;
    const index=paragraphs.length;
    for(const object of state.objects){object.paragraph=index;objects.push(object);}
    for(const anchor of state.anchors)anchors.push({...anchor,paragraph:index});
    for(const link of state.links)links.push({...link,paragraph:index});
    const complete=state.complete;
    paragraphs.push({index,text:value,source:{part:'xhtml',path:node.path,ordinal:index,container:'body',containerPath:'xhtml',segment:0,complete},properties:null,objects:state.objects,complete});
    owner.content.push(index);owner.spans.push({paragraph:index,start:0,end:value.length});
    for(let current=owner;current;current=parents.get(current))current.extent.end=index+1;
    if(!complete)gaps.push({code:state.objects.length?'unsupported-xhtml-object':'incomplete-note',paragraph:index,sourcePath:node.path,message:'Source content could not be represented completely.'});
  }
  // Note anchors are explicit cross references, never arbitrary digit removal.
  for(const node of nodes.filter(n=>n.name==='p'&&has(n,'oj-note'))) {
    const anchor=all(node).find(n=>n.name==='a'&&n.attrs.id?.startsWith('ntr'));
    if(!anchor)continue;
    noteNodes.add(node);
    const note={id:anchor.attrs.id,label:clean(text(anchor)).replace(/^\(|\)$/g,''),text:'',links:[],linkSpans:[],complete:!all(node).some(n=>['img','object','svg','math','iframe'].includes(n.name)),objects:[],source:{part:'xhtml',path:node.path}};
    notes.push(note);noteMap.set(note.id,note);
  }
  for(const node of noteNodes) {
    const anchor=all(node).find(n=>n.name==='a'&&n.attrs.id?.startsWith('ntr')),note=noteMap.get(anchor.attrs.id),raw={text:'',objects:[],anchors:[],links:[],complete:note.complete};
    for(const child of node.children)if(child!==anchor)inline(child,raw);
    const state=normalized(raw);note.text=state.text.trimStart();const removed=state.text.length-note.text.length;
    note.links=uniqueLinks(state.links);note.linkSpans=state.links.map(link=>({...link,start:Math.max(0,link.start-removed),end:Math.max(0,link.end-removed)}));
    note.objects=state.objects.map(object=>({...object,offset:Math.max(0,object.offset-removed),note:note.id,paragraph:0,paragraphOffset:Math.max(0,object.offset-removed)}));objects.push(...note.objects);note.complete=state.complete;
  }
  function listRows(node) {
    if(has(node,'grid-list')) {
      const left=node.children.find(n=>has(n,'grid-list-column-1')),body=node.children.find(n=>has(n,'grid-list-column-2')),lead=left&&clean(text(left));
      return body&&/^\(?[\p{L}\d]+\)$/u.test(lead)?{lead,body}:null;
    }
    if(node.name!=='table')return null;
    const rows=node.children.flatMap(n=>n.name==='tbody'?n.children:n.name==='tr'?[n]:[]).filter(n=>n.name==='tr');
    if(rows.length!==1)return null;
    const cells=rows[0].children.filter(n=>n.name==='td');
    if(cells.length!==2)return null;
    const lead=clean(text(cells[0]));
    return /^[‘“]?\([\p{L}\d]+\)$/u.test(lead)?{lead,body:cells[1]}:null;
  }
  function walk(node,parent,{inArticle=false}={}) {
    if(node.name==='#text'||noteNodes.has(node))return;
    if(has(node,'modref')||has(node,'arrow'))return;
    const id=node.attrs.id||'';
    if(has(node,'oj-final')||node.name==='div'&&has(node,'oj-signatory')) {
      const signature=has(node,'oj-signatory'),owner=unit(parent,signature?'signature':'body',null,{normative:!signature});
      for(const child of node.children)walk(child,owner);return;
    }
    if(has(node,'eli-main-title')||/^pbl_\d+$/.test(id)) {
      const owner=unit(parent,has(node,'eli-main-title')?'frontmatter':'preamble',null,{normative:false});
      for(const child of node.children)walk(child,owner);return;
    }
    const heading=/^(?:cpt_([\p{L}\d]+)|(?:cpt_[\p{L}\d]+\.)?sct_([\p{L}\d]+))$/u.exec(id);
    if(heading){const owner=unit(parent,heading[1]?'chapter':'section',heading[1]||heading[2]);for(const child of node.children)walk(child,owner);return;}
    const named=/^(art|rct|anx|cit)_([\p{L}\d]+)$/u.exec(id);
    if(named) {
      const kind={art:'article',rct:'recital',anx:'annex',cit:'citation'}[named[1]],owner=unit(parent,kind,named[2],{normative:['article','annex'].includes(kind)});
      let paragraphOwner=null;
      for(const child of node.children) {
        const number=kind==='article'&&child.children.find(n=>has(n,'no-parag')),value=number&&clean(text(number)).replace(/\.$/,'');
        if(value&&/^\d+[\p{L}]*$/u.test(value)) {
          paragraphOwner=unit(owner,'paragraph',value,{label:{prefix:value+'. '}});
          const inlineBody=child.children.find(n=>has(n,'inline-element'));
          if(inlineBody){
            if(inlineBody.children.some(n=>['p','div','table'].includes(n.name))) {
              let first=true;
              for(const part of inlineBody.children) {
                if(part.name==='p'&&has(part,'norm')&&first){paragraph(paragraphOwner,part,value+'. ');first=false;}
                else walk(part,paragraphOwner);
              }
            }else paragraph(paragraphOwner,inlineBody,value+'. ');
            for(const rest of child.children)if(rest!==number&&rest!==inlineBody)walk(rest,paragraphOwner);
          }
          else {paragraph(paragraphOwner,child);}
        } else if(paragraphOwner&&(has(child,'norm')||has(child,'grid-list')||has(child,'modref')||has(child,'arrow')))walk(child,paragraphOwner);
        else walk(child,owner,{inArticle:kind==='article'});
      }
      return;
    }
    if(!parent){for(const child of node.children)walk(child,null);return;}
    if(inArticle&&/^\d{3}\.\d{3}$/.test(id)) {
      const owner=unit(parent,'paragraph',String(Number(id.split('.')[1])),{label:{prefix:String(Number(id.split('.')[1]))+'. '}});
      let first=true;
      for(const child of node.children){if(child.name==='p'&&first){paragraph(owner,child);first=false;}else walk(child,owner);}
      return;
    }
    if(has(node,'eli-title')||has(node,'oj-sti-art')) {
      const owner=unit(parent,'title');for(const p of all(node).filter(n=>n.name==='p'))paragraph(owner,p);return;
    }
    const row=listRows(node);
    if(row) {
      if(parent.kind==='recital'){parent.label.prefix=row.lead+' ';let first=true;for(const child of row.body.children){if(first&&child.name==='p'){paragraph(parent,child,row.lead+' ');first=false;}else walk(child,parent);}return;}
      const quoted=/^[‘“]/u.test(row.lead),value=row.lead.replace(/^[‘“]?\(|\)$/gu,'');
      let ownerParent=parent;
      if(inArticle&&!consolidated){ownerParent=parent.children.find(u=>u.implicit)||unit(parent,'paragraph','1',{implicit:true});}
      if(quoted)ownerParent=unit(ownerParent,'quotation',null,{scope:'quoted',instructionPath:ownerParent.path,underlyingPath:[],boundaryBasis:'quotation-mark'});
      const owner=unit(ownerParent,'point',value,{label:{prefix:row.lead+' '}});
      let first=true;
      for(const child of row.body.children){if(child.name==='p'&&!noteNodes.has(child)&&first){paragraph(owner,child,row.lead+' ');first=false;}else walk(child,owner);}
      return;
    }
    if(has(node,'oj-enumeration-spacing')) {
      const ps=node.children.filter(n=>n.name==='p'),lead=ps[0]&&clean(text(ps[0]));
      if(ps.length===2&&/^\([\p{L}\d]+\)$/u.test(lead)) {const owner=unit(parent,'point',lead.slice(1,-1),{label:{prefix:lead+' '}});paragraph(owner,ps[1],lead+' ');return;}
    }
    if(node.name==='table') {
      // Genuine grids keep their text local and incomplete; they are not list points.
      const owner=unit(parent,'table');owner.table={sourcePath:node.path,paragraphs:[],rows:[],complete:false};
      const rows=node.children.flatMap(n=>['tbody','thead','tfoot'].includes(n.name)?n.children:n.name==='tr'?[n]:[]).filter(n=>n.name==='tr');
      for(const row of rows){const cells=[];for(const cell of row.children.filter(n=>['td','th'].includes(n.name))){
        const indices=[];for(const p of all(cell).filter(n=>n.name==='p'&&!noteNodes.has(n))){paragraph(owner,p);const at=paragraphs.length-1;paragraphs[at].complete=false;paragraphs[at].source.complete=false;paragraphs[at].source.container='table-cell';paragraphs[at].source.containerPath=cell.path;indices.push(at);owner.table.paragraphs.push(at);}
        cells.push({sourcePath:cell.path,paragraphs:indices,colSpan:/^[1-9]\d?$/.test(cell.attrs.colspan||'')?Number(cell.attrs.colspan):1,verticalMerge:null,complete:false});
      }owner.table.rows.push({cells});}
      gaps.push({code:'unsupported-xhtml-table',paragraph:owner.extent.start,sourcePath:node.path,message:'This legal table is retained without verified cell structure.'});return;
    }
    if(node.name==='p') {
      if(has(node,'oj-ti-art')||has(node,'oj-doc-ti')||has(node,'title-article-norm')){paragraph(parent,node);return;}
      let owner=parent;
      if(inArticle&&!consolidated)owner=parent.children.find(u=>u.implicit)||unit(parent,'paragraph','1',{implicit:true});
      if(['article','paragraph','point','annex'].includes(owner.kind))owner=unit(owner,'subparagraph');
      paragraph(owner,node);return;
    }
    for(const child of node.children)walk(child,parent,{inArticle});
  }
  walk(dom,null);
  if(!units.length)throw new Error('legal-xhtml-structure-unavailable');
  function finish(owner,conflict=false){owner.pathConflict ||= conflict;const children=owner.children.map(child=>finish(child,owner.pathConflict));owner.complete=!owner.pathConflict&&owner.table?.complete!==false&&owner.content.every(i=>paragraphs[i].complete)&&children.every(Boolean);return owner.complete;}
  units.forEach(u=>finish(u));
  if(coverage?.complete===false)gaps.push({code:'excerpted-source',message:'Selected public source excerpts.'});
  return {parserVersion:'xhtml-'+PUBLIC_LEGAL_XHTML_VERSION,sourceHash,sourceUrl,identity,language,item:'act',sourceKind:'xhtml',numberingMode:'source',paragraphs,units,objects,notes,anchors,links,gaps,complete:units.every(u=>u.complete)&&!gaps.length,contentComplete:paragraphs.every(p=>p.complete)&&notes.every(n=>n.complete),structureComplete:!gaps.length};
}
