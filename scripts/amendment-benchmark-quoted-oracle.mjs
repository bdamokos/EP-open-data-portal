import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';

// Independent Word assertions. No production parser, units, normalizer,
// declared extents, anchor IDs or placement evidence enter this reader.
const unknown=reason=>({status:'unverified',reason});
const failed=reason=>({status:'failed',reason});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const children=(nodes,name)=>nodes.flatMap(node=>node[name]?[node[name]]:[]);
const descendants=(nodes,name)=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>key===name?[value]:Array.isArray(value)?descendants(value,name):[]));
const attributes=(nodes,name)=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>key===name?[node[':@']||{}]:Array.isArray(value)?attributes(value,name):[]));
const text=nodes=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>key==='w:t'?value.map(v=>v['#text']??''):key==='w:tab'?['\t']:['w:br','w:cr'].includes(key)?['\n']:key==='w:noBreakHyphen'?['\u2011']:key==='w:softHyphen'?['\u00ad']:Array.isArray(value)?[text(value)]:[])).join('');
const unsafe=nodes=>descendants(nodes,'w:pPr').some(p=>descendants(p,'w:numPr').length)||['w:del','w:moveFrom','w:vanish','w:webHidden','w:instrText','w:fldChar','w:drawing','w:pict','w:object','m:oMath','w:footnoteReference','w:endnoteReference'].some(name=>descendants(nodes,name).length);

// Read the central directory and the actual main XML, independently of the
// application's ZIP/Word reader. Nothing is extracted to disk.
export function quotedWordBody(bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length>8*1024*1024)throw new Error('Word package unavailable');
  let end=bytes.length-22;
  for(;end>=Math.max(0,bytes.length-65557)&&bytes.readUInt32LE(end)!==0x06054b50;end--);
  if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))throw new Error('Unsupported ZIP');
  let cursor=bytes.readUInt32LE(end+16);const parts=new Map();
  for(let i=0;i<bytes.readUInt16LE(end+10);i++) {
    if(cursor+46>bytes.length||bytes.readUInt32LE(cursor)!==0x02014b50)throw new Error('Invalid ZIP directory');
    const size=bytes.readUInt32LE(cursor+20),full=bytes.readUInt32LE(cursor+24),nameLength=bytes.readUInt16LE(cursor+28),name=bytes.subarray(cursor+46,cursor+46+nameLength).toString();
    if(['word/document.xml','word/styles.xml','word/numbering.xml'].includes(name)) {
      if(parts.has(name)||full>12*1024*1024||bytes.readUInt16LE(cursor+8)&1)throw new Error('Unsupported main XML');
      const local=bytes.readUInt32LE(cursor+42),method=bytes.readUInt16LE(cursor+10);
      if(bytes.readUInt32LE(local)!==0x04034b50)throw new Error('Invalid local ZIP entry');
      const offset=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28),packed=bytes.subarray(offset,offset+size);
      const raw=method===0?packed:method===8?inflateRawSync(packed,{maxOutputLength:12*1024*1024}):null;
      if(!raw||raw.length!==full)throw new Error('Incomplete main XML');
      parts.set(name,raw.toString('utf8'));
    }
    cursor+=46+nameLength+bytes.readUInt16LE(cursor+30)+bytes.readUInt16LE(cursor+32);
  }
  const parse=xml=>{if(!xml||/<!DOCTYPE|<!ENTITY/u.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('Word XML unavailable');return new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml);};
  const tree=parse(parts.get('word/document.xml'));
  if(attributes(tree,'w:document').length!==1||attributes(tree,'w:document')[0]['@_xmlns:w']!=='http://schemas.openxmlformats.org/wordprocessingml/2006/main')throw new Error('Word namespace unavailable');
  const styles=parts.has('word/styles.xml')?parse(parts.get('word/styles.xml')):[],definitions=new Map();
  const hidden=nodes=>['w:vanish','w:webHidden'].some(name=>attributes(nodes,name).some(attr=>!['0','false','off'].includes(attr['@_w:val'])));
  const collect=nodes=>{for(const node of nodes){if(node['w:style'])definitions.set(node[':@']?.['@_w:styleId'],node['w:style']);else for(const value of Object.values(node))if(Array.isArray(value))collect(value);}};collect(styles);
  const inherited=(id,seen=new Set())=>{if(seen.has(id))return true;seen.add(id);const style=definitions.get(id);if(!style)return false;const parent=attributes(style,'w:basedOn')[0]?.['@_w:val'];return hidden(style)||Boolean(parent&&inherited(parent,seen));};
  const defaults=descendants(styles,'w:docDefaults').some(hidden);
  const hiddenUse=nodes=>defaults||hidden(nodes)||['w:pStyle','w:rStyle'].some(name=>attributes(nodes,name).some(attr=>inherited(attr['@_w:val'])));
  const numbered=(id,seen=new Set())=>{if(seen.has(id))return true;seen.add(id);const style=definitions.get(id);if(!style)return false;const parent=attributes(style,'w:basedOn')[0]?.['@_w:val'];return descendants(style,'w:numPr').length>0||Boolean(parent&&numbered(parent,seen));};
  const numberedUse=nodes=>descendants(nodes,'w:numPr').length>0||attributes(nodes,'w:pStyle').some(attr=>numbered(attr['@_w:val']));
  const bodies=descendants(tree,'w:body');if(bodies.length!==1)throw new Error('Word body unavailable');
  // Deliberately small independent numbering grammar: explicit level-zero
  // decimal/upper-letter lists, without overrides, restarts or style numbering.
  const numbering=parts.has('word/numbering.xml')?parse(parts.get('word/numbering.xml')):[],lists=new Map(),counters=new Map();
  for(const node of descendants(numbering,'w:num')) {
    const id=attributes(numbering,'w:num')[descendants(numbering,'w:num').indexOf(node)]?.['@_w:numId'];
    const abstract=attributes(node,'w:abstractNumId')[0]?.['@_w:val'];
    const definitions=descendants(numbering,'w:abstractNum'),attrs=attributes(numbering,'w:abstractNum');
    const definition=definitions.find((_,i)=>attrs[i]?.['@_w:abstractNumId']===abstract);
    const level=definition&&children(definition,'w:lvl').find((_,i)=>attributes(definition,'w:lvl')[i]?.['@_w:ilvl']==='0');
    const fmt=level&&attributes(level,'w:numFmt')[0]?.['@_w:val'],start=Number(level&&attributes(level,'w:start')[0]?.['@_w:val']);
    if(id&&level&&!descendants(node,'w:lvlOverride').length&&['decimal','upperLetter'].includes(fmt)&&start===1
      &&attributes(level,'w:lvlText')[0]?.['@_w:val']==='%1.'&&[undefined,'tab'].includes(attributes(level,'w:suff')[0]?.['@_w:val']))lists.set(id,fmt);
  }
  let ordinal=0,numberingBlocked=false;
  return bodies[0].map(node=>{

    const p=node['w:p'];let numberingLabel=null;
    if(!p){if(numberedUse([node]))numberingBlocked=true;}
    else if(numberedUse(p)) {
      const props=children(p,'w:pPr'),nums=props.flatMap(prop=>children(prop,'w:numPr'));
      const id=nums.length===1&&attributes(nums[0],'w:numId')[0]?.['@_w:val'];
      const level=nums.length===1&&attributes(nums[0],'w:ilvl')[0]?.['@_w:val'];
      if(!id||level!=='0'||hiddenUse(p)||descendants(p,'w:del').length||descendants(p,'w:moveFrom').length)numberingBlocked=true;
      if(!numberingBlocked&&lists.has(id)) {
        const value=(counters.get(id)||0)+1;counters.set(id,value);
        if(lists.get(id)==='decimal')numberingLabel=value+'.';
        else if(value<=26)numberingLabel=String.fromCharCode(64+value)+'.';
      }
    }
    return p?{kind:'paragraph',nodes:p,text:text(p),numberingLabel,path:`/w:document[1]/w:body[1]/w:p[${++ordinal}]`,unsafe:unsafe(p),numbered:numberedUse(p),hidden:hiddenUse(p)}:{hidden:hiddenUse([node]),kind:'other',nodes:node};
  });
}
const field=(rows,name)=>{
  const matches=rows.flatMap(row=>[...row.text.matchAll(new RegExp('<'+name+'>([\\s\\S]*?)</'+name+'>','gu'))].map(m=>m[1]));
  return matches.length===1?matches[0]:null;
};
function comparison(body,number) {
  const starts=body.flatMap((row,index)=>row.kind==='paragraph'&&row.text.includes('<Amend>')&&new RegExp('<NumAm>'+number+'</NumAm>','u').test(row.text)?[index]:[]);
  if(starts.length!==1)return null;
  const start=starts[0],relativeEnd=body.slice(start+1).findIndex(row=>row.kind==='paragraph'&&row.text.includes('</Amend>'));
  if(relativeEnd<0)return null;
  const rows=body.slice(start,start+relativeEnd+2),paragraphs=rows.filter(row=>row.kind==='paragraph');
  if(paragraphs.some(row=>row.unsafe)||paragraphs.slice(1).some(row=>row.text.includes('<Amend>')))return null;
  const tables=rows.filter(row=>row.kind==='other');if(tables.length!==1||!tables[0].nodes['w:tbl'])return null;
  const table=tables[0].nodes['w:tbl'];
  if(descendants(table,'w:tbl').length||['w:vMerge','w:hMerge'].some(name=>descendants(table,name).length)||unsafe(table)||tables[0].hidden)return null;
  const tableRows=children(table,'w:tr');
  // The published template has one empty full-width layout row before the
  // comparison headings. It carries no legal text or column ownership.
  if(tableRows.length&&children(tableRows[0],'w:tc').length===1&&text(tableRows[0]).trim()===''&&attributes(tableRows[0],'w:gridSpan').length===1&&attributes(tableRows[0],'w:gridSpan')[0]['@_w:val']==='2')tableRows.shift();
  if(tableRows.some(row=>descendants(row,'w:gridSpan').length))return null;
  const grid=tableRows.map(row=>children(row,'w:tc').map(cell=>children(cell,'w:p').map(text).join('\n').trim()));
  if(grid.length<2||grid.some(row=>row.length!==2)||grid[0][0]!=='Text proposed by the Commission'||grid[0][1]!=='Amendment')return null;
  return {outer:field(paragraphs,'Article'),act:field(paragraphs,'DocAmend2'),inner:field(paragraphs,'Article2'),language:field(paragraphs,'Original'),original:grid.slice(1).map(row=>row[0]).join('\n').trim(),proposed:grid.slice(1).map(row=>row[1]).join('\n').trim()};
}

export function rawQuotedProposalAssertion({proposal,wording,placement,nativeQuoted}) {
  if(!Array.isArray(proposal?.paragraphs)||wording?.language!=='en'||wording.baseline!=='commission-proposal'||placement?.status!=='placed'||placement.operation!=='insert'||!nativeQuoted)return unknown('oracle-quoted-input-unavailable');
  if(!Number.isSafeInteger(nativeQuoted.number)||nativeQuoted.number<1)return unknown('oracle-quoted-input-unavailable');
  let source,amendment;
  try{amendment=comparison(quotedWordBody(nativeQuoted.amendmentBuffer),nativeQuoted.number);}catch{return unknown('oracle-quoted-native-unavailable');}
  if(!amendment||amendment.language!=='{EN}en'||amendment.outer+'\n'+amendment.act+' — '+amendment.inner!==wording.targetLabel||amendment.original!==wording.originalText||amendment.proposed!==wording.proposedText)return unknown('oracle-quoted-comparison-unavailable');
  // Literal English fields only. The one optional space is a published nested
  // suffix spelling, never a global whitespace/suffix normalization.
  const outer=/^Article ([1-9]\d*) – paragraph 1 – point ([1-9]\d*)$/u.exec(amendment.outer||'');
  const inner=/^Article ([1-9]\d*[a-z]?) – paragraph ([1-9]\d*)([a-y]) ?a \(new\)$/u.exec(amendment.inner||'');
  const act=/^(?:Directive|Regulation) (?:\(EU\) )?\d{4}\/\d+(?:\/(?:EC|EU|EEC))?$/u.test(amendment.act||'');
  if(!outer||!inner||!act||amendment.original!=='')return unknown('oracle-quoted-address-unavailable');
  const predecessor=inner[2]+inner[3],inserted=predecessor+'a',following=inner[2]+String.fromCharCode(inner[3].charCodeAt(0)+1);
  if(!amendment.proposed.startsWith(inserted+'.\t')||/\b(?:is amended as follows|are inserted after|is replaced by the following)\b/u.test(amendment.proposed))return unknown('oracle-quoted-wording-conflict');
  try{source=quotedWordBody(nativeQuoted.proposalBuffer);}catch{return unknown('oracle-quoted-native-unavailable');}
  const rows=source.filter(row=>row.kind==='paragraph');
  const headings=rows.filter(row=>row.text.trim()==='Article '+outer[1]);
  if(headings.length!==1)return unknown('oracle-quoted-owner-ambiguous');
  const heading=headings[0],nextHeading=rows.find(row=>source.indexOf(row)>source.indexOf(heading)&&/^Article [1-9]\d*$/u.test(row.text.trim()));
  if(!nextHeading)return unknown('oracle-quoted-owner-incomplete');
  const article=source.slice(source.indexOf(heading)+1,source.indexOf(nextHeading));
  const leads=article.filter(row=>row.kind==='paragraph'&&row.text.trim()===amendment.act+' is amended as follows:');
  if(leads.length!==1)return unknown('oracle-quoted-act-unavailable');
  const lead=leads[0],prefix=article.slice(0,article.indexOf(lead));
  // An unnumbered paragraph 1 must be the article's first legal paragraph.
  // Only the literal named-act title may precede its amending lead.
  if(prefix.length>1||prefix.some(row=>row.kind!=='paragraph'||row.text.trim()!=='Amendments to '+amendment.act))return unknown('oracle-quoted-outer-paragraph-unavailable');
  const owners=article.filter(row=>row.kind==='paragraph'&&row.text.trim()===`(${outer[2]})\tin Article ${inner[1]}, the following paragraphs ${predecessor} and ${following} are inserted after paragraph ${inner[2]}:`);
  if(owners.length!==1||article.indexOf(lead)+1!==article.indexOf(owners[0]))return unknown('oracle-quoted-owner-ambiguous');
  const owner=owners[0],after=article.slice(article.indexOf(owner)+1),nextInstruction=after.findIndex(row=>row.kind==='paragraph'&&/^\([1-9]\d*\)\s/u.test(row.text));
  const quote=nextInstruction<0?after:after.slice(0,nextInstruction);
  if(!quote.length||quote.some(row=>row.kind!=='paragraph'||row.unsafe||row.hidden)||owner.unsafe||owner.hidden||lead.unsafe||lead.hidden||heading.unsafe||heading.hidden||!quote[0].text.startsWith('‘'+predecessor+'. ')||!/[.]’[;.]?\s*$/u.test(quote.at(-1).text))return unknown('oracle-quoted-owner-incomplete');
  if(quote.map(row=>row.text).join('\n').split('‘').length!==2||quote.map(row=>row.text).join('\n').split('’').length!==2)return unknown('oracle-quoted-owner-incomplete');
  const labelled=quote.filter(row=>/^‘?\d+[a-z]*[.]\s/u.test(row.text));
  if(labelled.length!==2||labelled[0]!==quote[0]||!labelled[1].text.startsWith(following+'. '))return unknown('oracle-quoted-sibling-unavailable');
  const next=labelled[1],previousRows=quote.slice(0,quote.indexOf(next));
  if(previousRows.some(row=>/^(?:[_*]|[‘’]|\(?[a-z0-9]+[)])|\uFFFC/u.test(row.text.replace(/^‘(?=\d)/u,'')))||previousRows.some(row=>!/[.;:]\s*$/u.test(row.text)))return unknown('oracle-quoted-predecessor-incomplete');
  // Source ownership and the full native gap are established above. Projection
  // rows now supply coordinates only, with an exact path/text bijection for
  // every row from the named act through the quote's final close.
  const nativeRows=[lead,owner,...quote],mapped=[];
  for(const raw of nativeRows) {
    const matches=proposal.paragraphs.filter(row=>row.source?.path===raw.path&&row.text===raw.text.trim());
    if(matches.length!==1||proposal.paragraphs.indexOf(matches[0])!==matches[0].index)return failed('oracle-quoted-native-row-mismatch');
    mapped.push(matches[0]);
  }
  if(mapped.some((row,i)=>i&&row.index!==mapped[i-1].index+1))return failed('oracle-quoted-native-row-mismatch');
  const before=mapped[nativeRows.indexOf(next)].index,anchor=mapped[nativeRows.indexOf(quote[0])].index;
  const assertion={rawOuterTarget:amendment.outer,rawInnerTarget:amendment.inner,rawProposedPrefix:inserted+'.\t',namedAct:amendment.act,nativeOwner:owner.path,nativePredecessor:previousRows.map(row=>row.path),nativeFollowing:next.path,nativeQuoteClose:quote.at(-1).path,predecessorExtent:{start:anchor,end:before},expectedBefore:before,proposalSha256:hash(nativeQuoted.proposalBuffer),amendmentSha256:hash(nativeQuoted.amendmentBuffer)};
  if(placement.insertBefore!==before||placement.insertAfter!==before-1)return {...failed('oracle-quoted-insertion-boundary-mismatch'),assertion};
  return {status:'verified',reason:'oracle-raw-quoted-interior-boundary',assertion};
}
