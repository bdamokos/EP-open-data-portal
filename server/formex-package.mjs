import {createHash} from 'node:crypto';
import {inflateRawSync,crc32} from 'node:zlib';
import path from 'node:path';
import {XMLParser,XMLValidator} from 'fast-xml-parser';

export const FORMEX_PACKAGE_VERSION=1;
export const FORMEX_PACKAGE_LIMITS=Object.freeze({archive:8*1024*1024,entries:256,entry:8*1024*1024,inflated:24*1024*1024,elements:100000,depth:64,parts:64,blocks:30000});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(new Error('Unsupported Formex package: '+code),{code});};
const safeName=name=>typeof name==='string'&&name.length<=256&&name.split('/').every(bit=>/^[\w.-]+$/.test(bit)&&bit!=='.'&&bit!=='..');

// This reader intentionally does not reuse or broaden the DOCX part allowlist.
// No ZIP member is written to disk. Every member is size/CRC checked in memory.
function archive(bytes) {
  const L=FORMEX_PACKAGE_LIMITS;
  if(!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array))fail('package-bytes-required');
  const b=Buffer.from(bytes);
  if(b.length<22||b.length>L.archive)fail('archive-size');
  let end=-1;
  for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50&&i+22+b.readUInt16LE(i+20)===b.length){end=i;break;}
  if(end<0)fail('zip-directory');
  const count=b.readUInt16LE(end+10),start=b.readUInt32LE(end+16),length=b.readUInt32LE(end+12);
  if(b.readUInt16LE(end+4)||b.readUInt16LE(end+6)||b.readUInt16LE(end+8)!==count||count===65535||count>L.entries||start+length!==end)fail('zip-directory');
  const entries=new Map(),ranges=[];let at=start,total=0;
  for(let i=0;i<count;i++) {
    if(at+46>end||b.readUInt32LE(at)!==0x02014b50)fail('zip-directory');
    const flags=b.readUInt16LE(at+8),method=b.readUInt16LE(at+10),crc=b.readUInt32LE(at+16),packed=b.readUInt32LE(at+20),size=b.readUInt32LE(at+24);
    const nl=b.readUInt16LE(at+28),el=b.readUInt16LE(at+30),cl=b.readUInt16LE(at+32),offset=b.readUInt32LE(at+42);
    if(at+46+nl+el+cl>end)fail('zip-directory');
    const name=new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(at+46,at+46+nl));
    if(!safeName(name)||entries.has(name)||flags&~0x0808||![0,8].includes(method)||b.readUInt16LE(at+34)||((b.readUInt32LE(at+38)>>>16)&0xf000)===0xa000)fail('zip-entry');
    total+=size;
    if(size>L.entry||total>L.inflated||packed>L.archive||offset+30>start||b.readUInt32LE(offset)!==0x04034b50)fail('zip-entry-budget');
    const localName=b.readUInt16LE(offset+26),localExtra=b.readUInt16LE(offset+28),body=offset+30+localName+localExtra;
    if(body+packed>start||b.readUInt16LE(offset+6)!==flags||b.readUInt16LE(offset+8)!==method||!b.subarray(offset+30,offset+30+localName).equals(b.subarray(at+46,at+46+nl)))fail('zip-local-entry');
    if(!(flags&8)&&(b.readUInt32LE(offset+14)!==crc||b.readUInt32LE(offset+18)!==packed||b.readUInt32LE(offset+22)!==size))fail('zip-local-entry');
    ranges.push([offset,body+packed]);
    let data;try{data=method===0?b.subarray(body,body+packed):inflateRawSync(b.subarray(body,body+packed),{maxOutputLength:Math.max(1,size)});}catch{fail('zip-inflation');}
    if(data.length!==size||crc32(data)!==crc)fail('zip-integrity');
    entries.set(name,{name,bytes:data,size,compressedSize:packed,hash:hash(data)});at+=46+nl+el+cl;
  }
  if(at!==end||ranges.sort((a,b)=>a[0]-b[0]).some((r,i)=>i&&r[0]<ranges[i-1][1]))fail('zip-directory');
  return entries;
}

function xmlTree(bytes,part,budget) {
  let xml;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('xml-encoding');}
  if(/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)||/<\?xml[^>]*encoding\s*=\s*['"](?!utf-8['"])/i.test(xml)||/&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);)/.test(xml)||XMLValidator.validate(xml)!==true)fail('unsafe-xml');
  for(const m of xml.matchAll(/&#(x[\da-fA-F]+|\d+);/g)) {
    const n=m[1][0]==='x'?parseInt(m[1].slice(1),16):Number(m[1]);
    if(![9,10,13].includes(n)&&!(n>=32&&n<=0xd7ff||n>=0xe000&&n<=0xfffd||n>=0x10000&&n<=0x10ffff))fail('xml-character');
  }
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]/u.test(xml))fail('xml-character');
  let rows;try{rows=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,maxNestedTags:FORMEX_PACKAGE_LIMITS.depth}).parse(xml);}catch{fail('xml-depth');}
  function build(rows,parent='',depth=0) {
    const counts=new Map();
    return rows.filter(row=>Object.keys(row)[0]!=='?xml'&&!(Object.hasOwn(row,'#text')&&String(row['#text'])==='')).map(row=>{
      const tag=Object.keys(row).find(k=>k!==':@');
      if(tag==='#text')return {text:String(row[tag])};
      if(++budget.elements>FORMEX_PACKAGE_LIMITS.elements||depth>FORMEX_PACKAGE_LIMITS.depth)fail('xml-budget');
      if(!/^\??[A-Z][A-Z0-9.]*$/.test(tag))fail('xml-vocabulary');
      const n=(counts.get(tag)??0)+1;counts.set(tag,n);
      const source={part,path:parent+'/'+tag+'['+n+']'};
      return {tag,source,attributes:Object.fromEntries(Object.entries(row[':@']??{}).map(([k,v])=>[k.slice(2),String(v)])),children:build(row[tag]??[],source.path,depth+1)};
    });
  }
  const roots=build(rows);
  if(roots.filter(n=>n.tag).length!==1||roots.some(n=>!n.tag&&n.text.trim()))fail('xml-root');
  return roots.find(n=>n.tag);
}
const children=(node,tag)=>node.children.filter(n=>n.tag===tag);
const descendants=node=>[node,...node.children.filter(n=>n.tag).flatMap(descendants)];
const literal=node=>node.children.map(n=>n.tag?literal(n):n.text).join('');
const INLINE=new Set(['HT','FT','DATE','LINK','REF.DOC','REF.DOC.OJ','NOTE','QUOT.START','QUOT.END','INCL.ELEMENT','FORMULA','BR','?PAGE','?CLG.MDFO','?CLG.MDFC']);
const STRUCTURE=new Set(['ACT','ANNEX','CONS.ACT','CONS.DOC','CONS.ANNEX','TITLE','TI','STI','PREAMBLE','PREAMBLE.INIT','GR.VISA','VISA','GR.CONSID','GR.CONSID.INIT','CONSID','PREAMBLE.FINAL','ENACTING.TERMS','FINAL','SIGNATURE','SIGNATORY','PL.DATE','DIVISION','ARTICLE','TI.ART','STI.ART','PARAG','NO.PARAG','ALINEA','LIST','ITEM','NP','NO.P','TXT','P','CONTENTS','GR.SEQ','QUOT.S','TBL','CORPUS','ROW','CELL','DLIST','DLIST.ITEM','TERM','DEFINITION','NO.DOC.C','EEA']);
const META=new Set(['BIB.INSTANCE','BIB.DATA','INFO.CONSLEG','INFO.PROD','FAM.COMP','GR.MOD.ACT']);
const KINDS={ACT:'act','CONS.ACT':'consolidated-act',ANNEX:'annex','CONS.ANNEX':'annex',ARTICLE:'article',PARAG:'paragraph',CONSID:'recital',DIVISION:'division','GR.SEQ':'sequence',LIST:'list',ITEM:'item',NP:'numbered-paragraph','QUOT.S':'quotation',TBL:'table',ROW:'row',CELL:'cell',TITLE:'title'};
const FORMATS={BOLD:'bold',ITALIC:'italic',SUB:'subscript',SUP:'superscript',UC:'uppercase',EXPANDED:'expanded'};

/** Read retained bytes only. Caller bindings are preserved, not source selection proof.
 * Parts remain separate; inclusion blocks point into the graph rather than flattening it.
 */
export function readFormexPackage(bytes,{source,coverage}={}) {
  if(!source||!['url','workId','expressionId','manifestationId','itemId','celex','language','retrievedAt'].every(k=>typeof source[k]==='string'&&source[k].length&&source[k].length<1000)||!Number.isFinite(Date.parse(source.retrievedAt))||!/^[a-z]{2}$/.test(source.language))fail('source-binding');
  let url;try{url=new URL(source.url);}catch{fail('source-binding');}
  if(url.protocol!=='https:'||url.hostname!=='publications.europa.eu'||url.port||url.username||url.password||url.search||url.hash||!/^\/resource\/cellar\/[\da-f-]{36}\.\d{4}\.\d{2}\/[^/]+$/.test(url.pathname)||source.itemId!==source.url||source.manifestationId!==source.url.slice(0,source.url.lastIndexOf('/'))||source.expressionId!==source.manifestationId.slice(0,-3)||source.workId!==source.expressionId.slice(0,-5))fail('source-binding');
  const entries=archive(bytes),budget={elements:0},trees=new Map(),gaps=[],edges=[],parts=[],blocks=[],notes=[],objects=[],links=[],containers=[];
  const gap=(code,source,extra={})=>gaps.push({code,source,...extra});
  const tree=name=>{
    if(!entries.has(name))return null;
    if(!trees.has(name))trees.set(name,xmlTree(entries.get(name).bytes,name,budget));
    return trees.get(name);
  };
  const manifests=[...entries.keys()].filter(n=>/\.doc(?:\.fmx)?\.xml$/.test(n));
  if(manifests.length!==1)fail('manifest-required');
  const manifest=tree(manifests[0]);if(manifest.tag!=='DOC')fail('manifest-root');
  const resolve=(from,ref)=>{
    if(!safeName(ref))fail('unsafe-part-reference');
    const to=path.posix.join(path.posix.dirname(from),ref);
    if(!safeName(to))fail('unsafe-part-reference');return to;
  };
  function edge(node,ref,kind,from=node.source.part) {
    const to=resolve(from,ref),row={source:node.source,reference:ref,target:to,kind,status:entries.has(to)?'present':'missing'};
    edges.push(row);if(row.status==='missing')gap('missing-package-entry',node.source,{target:to});return row;
  }
  const fmx=children(manifest,'FMX');if(fmx.length!==1)fail('manifest-structure');
  const seeds=[],publications=[];
  for(const declaration of fmx[0].children.filter(n=>n.tag)) {
    if(!['DOC.MAIN.PUB','DOC.SUB.PUB'].includes(declaration.tag)){gap('unsupported-manifest-declaration',declaration.source);continue;}
    const refs=children(declaration,'REF.PHYS');
    if(refs.length!==1||refs[0].attributes.TYPE!=='DOC.XML'){gap('unsupported-manifest-part',declaration.source);continue;}
    seeds.push({edge:edge(refs[0],refs[0].attributes.FILE,'manifest-part'),role:declaration.tag,sequence:declaration.attributes['NO.SEQ']??null});
  }
  if(seeds.filter(s=>s.role==='DOC.MAIN.PUB').length!==1)fail('manifest-main');
  for(const n of children(manifest,'PUBLICATION.REF'))if(n.attributes.FILE!=='NA') {
    const e=edge(n,n.attributes.FILE,'publication-metadata');
    if(e.status==='present'){const root=tree(e.target);publications.push({name:e.target,tree:root});if(root.tag!=='PUBLICATION')gap('unsupported-publication-root',root.source);}
  }
  if(new Set(seeds.map(s=>s.sequence)).size!==seeds.length||seeds.some(s=>!s.sequence))gap('manifest-sequence-conflict',fmx[0].source);
  const manifestLanguages=descendants(fmx[0]).filter(n=>n.tag==='LG.DOC').map(literal);
  if(manifestLanguages.length!==1||manifestLanguages[0].toLowerCase()!==source.language)fail('native-language-mismatch');
  const partMap=new Map(),visiting=new Set();
  function load(name,role='inclusion',sequence=null,depth=0) {
    if(visiting.has(name)){gap('inclusion-cycle',{part:name,path:'/'});return;}
    if(partMap.has(name)||!entries.has(name))return;
    if(depth>16||parts.length>=FORMEX_PACKAGE_LIMITS.parts)fail('inclusion-budget');
    const root=tree(name);
    if(!['ACT','ANNEX','CONS.ACT'].includes(root.tag)){gap('unsupported-part-root',root.source);return;}
    if(role==='DOC.MAIN.PUB'&&root.tag==='ANNEX'||role==='DOC.SUB.PUB'&&root.tag!=='ANNEX')gap('manifest-role-conflict',root.source);
    const langs=descendants(root).filter(n=>n.tag==='LG.DOC').map(literal);
    if(!langs.length||langs.some(l=>l.toLowerCase()!==source.language))fail('native-language-mismatch');
    const part={name,root:root.tag,role,sequence,hash:entries.get(name).hash,nativeLanguages:langs,tree:root,includes:[]};parts.push(part);partMap.set(name,part);visiting.add(name);
    for(const n of descendants(root)) {
      if(n.tag==='DOCUMENT.REF') {
        edge(n,n.attributes.FILE,'manifest-metadata');
        if(n.attributes.FILE!==manifest.source.part)gap('manifest-back-reference-conflict',n.source);
      }
      if(n.tag==='INCL.ELEMENT') {
        const e=edge(n,n.attributes.FILEREF,n.attributes.TYPE==='FORMEX.DOC'?'formex-document':'resource');part.includes.push(e);
        if(n.attributes.TYPE==='FORMEX.DOC')load(e.target,'inclusion',null,depth+1);
      }
    }
    const nodes=descendants(root),refs=nodes.filter(n=>n.tag==='DOCUMENT.REF'),ids=new Map();
    for(const n of nodes)if(n.attributes.ID){const rows=ids.get(n.attributes.ID)??[];rows.push(n);ids.set(n.attributes.ID,rows);}
    if(refs.length!==1)gap('native-manifest-binding-unverified',root.source);
    for(const n of nodes.filter(n=>['QUOT.START','QUOT.END'].includes(n.tag))) {
      const opening=n.tag==='QUOT.START',id=n.attributes.ID,target=n.attributes[opening?'REF.END':'REF.START'];
      const matches=(ids.get(target)??[]).filter(other=>other.tag===(opening?'QUOT.END':'QUOT.START'));
      if(!id||matches.length!==1||matches[0].attributes[opening?'REF.START':'REF.END']!==id||ids.get(id)?.length!==1)gap('quotation-reference-conflict',n.source);
    }
    visiting.delete(name);
  }
  for(const seed of seeds)load(seed.edge.target,seed.role,seed.sequence);
  const represented=new Set([manifest.source.part,...parts.map(p=>p.name),...edges.filter(e=>e.status==='present').map(e=>e.target)]);
  for(const name of entries.keys())if(!represented.has(name))gap('unreferenced-package-entry',{part:name,path:'/'});

  const addBlock=block=>{if(blocks.length>=FORMEX_PACKAGE_LIMITS.blocks)fail('block-budget');block.ordinal=blocks.length;blocks.push(block);return block;};
  function project(part) {
    let noteOrdinal=0;
    function inline(nodes) {
      const out={text:'',marks:[],anchors:[],objects:[],links:[],quotes:[],instructions:[],complete:true};
      const bad=(code,node,extra={})=>{out.complete=false;gap(code,node.source,extra);};
      function object(node,kind='unsupported',extra={}) {
        const o={kind,status:'unresolved',offset:out.text.length,source:node.source,...extra};out.objects.push(o);out.text+='\uFFFC';bad('unresolved-object',node,{kind});
      }
      function append(text,formats){const start=out.text.length;out.text+=text;for(const [kind,source] of formats)if(text.length)out.marks.push({start,end:out.text.length,kind,source});}
      function visit(node,formats=new Map()) {
        if(!node.tag){append(node.text,formats);return;}
        const start=out.text.length;
        if(node.tag.startsWith('?')) {
          out.instructions.push({offset:start,element:node.tag,attributes:node.attributes,source:node.source});
          if(node.tag.startsWith('?CLG.'))bad('uninterpreted-consolidation-change',node);
          return;
        }
        if(node.tag==='NOTE') {
          const n={id:part.name+'#'+(node.attributes['NOTE.ID']??node.source.path)+'@'+noteOrdinal++,source:node.source,nativeId:node.attributes['NOTE.ID']??null,numbering:{...node.attributes},label:null,blocks:[],complete:true};
          notes.push(n);
          for(const child of node.children) {
            if(!child.tag&&!child.text.trim())continue;
            const content=child.tag==='P'?inline(child.children):inline([child]);
            n.blocks.push({source:child.source??node.source,...content});n.complete&&=content.complete;
          }
          out.anchors.push({offset:start,note:n.id,source:node.source});if(!n.complete)bad('incomplete-note',node);return;
        }
        if(node.tag==='QUOT.START'||node.tag==='QUOT.END') {
          const code=node.attributes.CODE,n=/^[\da-f]{4,6}$/i.test(code??'')?parseInt(code,16):0;
          if(!n||n>0x10ffff||n>=0xd800&&n<=0xdfff){object(node,'quotation-code');return;}
          out.quotes.push({offset:start,element:node.tag,attributes:node.attributes,source:node.source});append(String.fromCodePoint(n),formats);return;
        }
        if(node.tag==='INCL.ELEMENT') {
          const e=edges.find(e=>e.source.part===node.source.part&&e.source.path===node.source.path);
          if(node.attributes.TYPE==='FORMEX.DOC') {
            out.objects.push({kind:'included-document',status:partMap.has(e?.target)?'linked':'unresolved',offset:start,source:node.source,target:e?.target??null});out.text+='\uFFFC';
            if(!partMap.has(e?.target))bad('unresolved-inclusion',node);return;
          }
          object(node,node.attributes.CONTENT==='FORMULA'?'formula':'image',{target:e?.target??null,resourceType:node.attributes.TYPE??null});return;
        }
        if(node.tag==='FORMULA'){object(node,'formula');return;}
        if(node.tag==='BR'){out.text+='\n';return;}
        if(!['HT','FT','DATE','LINK','REF.DOC','REF.DOC.OJ'].includes(node.tag)){object(node);return;}
        const active=new Map(formats);
        if(node.tag==='HT') {
          const kind=FORMATS[node.attributes.TYPE];
          if(kind)active.set(kind,node.source);
          else if(node.attributes.TYPE==='NORMAL')active.clear();
          else bad('unsupported-emphasis',node,{type:node.attributes.TYPE??null});
        }
        for(const child of node.children)visit(child,active);
        if(['LINK','REF.DOC'].includes(node.tag)) {
          const target=node.attributes.URI;
          let url;try{url=new URL(target);}catch{/* Retain the exact attribute in the native tree. */}
          if(url&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)out.links.push({start,end:out.text.length,url:target,source:node.source});
          else if(target!==undefined)bad('unsupported-link',node);
        }
      }
      for(const n of nodes)visit(n);
      return out;
    }
    function walk(node,parent=null,quoted=false) {
      if(META.has(node.tag))return null;
      const start=blocks.length,id=part.name+':'+node.source.path;
      const row={id,source:node.source,element:node.tag,kind:KINDS[node.tag]??'native-container',attributes:node.attributes,parent:parent?.id??null,children:[],content:[],extent:null,quoted:quoted||node.tag==='QUOT.S',label:null,complete:true};
      containers.push(row);parent?.children.push(id);
      if(!STRUCTURE.has(node.tag)){gap('unsupported-structure',node.source);row.complete=false;}
      let pending=[],segment=0;
      function flush() {
        if(!pending.length)return;
        if(pending.some(n=>n.tag||n.text.trim())) {
          const content=inline(pending),block=addBlock({source:{...node.source,segment:segment++},container:id,element:node.tag,...content});
          row.content.push(block.ordinal);row.complete&&=content.complete;
          
          for(const link of block.links)links.push({...link,block:block.ordinal});
        }
        pending=[];
      }
      if(!STRUCTURE.has(node.tag)) {
        const content={text:'\uFFFC',marks:[],anchors:[],objects:[{kind:'unsupported',status:'unresolved',offset:0,source:node.source}],links:[],quotes:[],complete:false};
        const block=addBlock({source:{...node.source,segment:0},container:id,element:node.tag,...content});row.content.push(block.ordinal);
      }else for(const child of node.children) {
        if(!child.tag||INLINE.has(child.tag))pending.push(child);
        else {flush();const r=walk(child,row,row.quoted);if(r)row.complete&&=r.complete;}
      }
      flush();row.extent={start,end:blocks.length};
      const labelTag={ARTICLE:'TI.ART',PARAG:'NO.PARAG',NP:'NO.P'}[node.tag];
      if(labelTag){const label=children(node,labelTag);if(label.length===1)row.label={text:literal(label[0]),source:label[0].source};}
      return row;
    }
    part.extent={start:blocks.length,end:null};part.container=walk(part.tree);part.extent.end=blocks.length;
  }
  parts.forEach(project);
  // Gaps in metadata/graphs also taint their containing native regions. Included
  // parts are never silently concatenated into the caller's legal coordinates.
  const byId=new Map(containers.map(c=>[c.id,c]));
  for(const g of gaps) {
    if(g.source.path==='/'){for(const c of containers)if(c.source.part===g.source.part)c.complete=false;continue;}
    for(let p=g.source.path;p;p=p.slice(0,p.lastIndexOf('/'))) {const c=byId.get(g.source.part+':'+p);if(c)c.complete=false;}
  }
  for(let pass=0;pass<=parts.length;pass++) {
    for(const row of [...containers].reverse())if(row.content.some(i=>!blocks[i].complete)||row.children.some(id=>!byId.get(id).complete))row.complete=false;
    let changed=false;
    for(const b of blocks)for(const o of b.objects)if(o.kind==='included-document') {
      o.complete=partMap.get(o.target)?.container?.complete??false;
      if(!o.complete&&b.complete){b.complete=false;gap('incomplete-included-part',o.source,{target:o.target});changed=true;}
    }
    if(!changed)break;
  }
  for(const p of parts)p.complete=p.container.complete;
  for(const b of blocks)for(const o of b.objects)objects.push({...o,block:b.ordinal});
  for(const n of notes)for(const [noteBlock,b] of n.blocks.entries())for(const o of b.objects)objects.push({...o,note:n.id,noteBlock});
  if(coverage?.complete===false)gap('excerpted-source',{part:manifest.source.part,path:'/'});
  return {parserVersion:FORMEX_PACKAGE_VERSION,sourceKind:'formex-package',preference:'held',source:{...source,contentHash:hash(bytes),byteSize:bytes.byteLength,binding:'caller-supplied'},
    coverage:coverage?.complete===false?{...coverage}:{complete:true},
    manifest:{name:manifest.source.part,tree:manifest,publications,seeds:seeds.map(s=>({...s,target:s.edge.target}))},
    entries:[...entries.values()].map(({name,size,compressedSize,hash})=>({name,size,compressedSize,hash})),edges,parts,containers,blocks,notes,objects,links,gaps,
    packageComplete:!gaps.some(g=>['missing-package-entry','inclusion-cycle','unsupported-manifest-declaration','unsupported-manifest-part','unsupported-part-root','unreferenced-package-entry','manifest-back-reference-conflict','manifest-sequence-conflict','manifest-role-conflict','native-manifest-binding-unverified','unsupported-publication-root'].includes(g.code)),
    complete:gaps.length===0,fidelityGaps:[...(notes.length?[{code:'note-labels-unverified'}]:[]),{code:'cross-format-equivalence-unverified'},{code:'legal-projection-unverified'}]};
}
