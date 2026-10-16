import { XMLParser } from 'fast-xml-parser';
import { docxParts } from './document-text.mjs';
import { numberingLabels } from './docx-numbering.mjs';

export const AMENDMENT_EXTRACTION_VERSION='6';

const TEXT_LOSS_CODES=new Set(['comparison-header','comparison-columns','comparison-structure','nested-table','non-text-content','symbol-text-loss','vertical-text-loss','text-unavailable','numbering-warning']);
const alternateBranch=key=>/(?:^|:)(?:AlternateContent|Choice|Fallback)$/.test(key);
const nonTextContent=key=>/(?:^|:)(?:oMath|oMathPara)$/.test(key)||['w:drawing','w:pict','w:object','w:altChunk','w:contentPart','w:subDoc'].includes(key);
const CONTENT_LOSSES={
  'non-text-content':'Visible mathematical, drawing or embedded content cannot be represented reliably as plain wording; its wording is withheld.',
  'vertical-text-loss':'Visible text uses superscript, subscript or a shifted baseline that cannot be represented reliably as plain wording; its wording is withheld.',
};
const TABLE_MARKERS=new Set(['w:bookmarkStart','w:bookmarkEnd','w:commentRangeStart','w:commentRangeEnd','w:permStart','w:permEnd','w:proofErr','w:moveFromRangeStart','w:moveFromRangeEnd','w:moveToRangeStart','w:moveToRangeEnd']);
function unsupportedChildren(nodes,allowed) {
  return (nodes||[]).some(node=>Object.entries(node).some(([key,value])=>key!==':@'&&!TABLE_MARKERS.has(key)&&!allowed.has(key)&&(key!=='#text'||String(value).trim())));
}
const TABLE_CHILDREN=new Set(['w:tblPr','w:tblGrid','w:tr']);
const ROW_CHILDREN=new Set(['w:tblPrEx','w:trPr','w:tc']);
const CELL_CHILDREN=new Set(['w:tcPr','w:p','w:tbl']);

const child=(nodes,key)=>nodes?.find(node=>Object.hasOwn(node,key));
const children=(nodes,key)=>child(nodes,key)?.[key];
const attribute=(node,key)=>node?.[':@']?.['@_w:'+key];
const property=(nodes,key)=>attribute(child(nodes,key),'val');
const parser=()=>new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false});
const clean=value=>String(value??'').replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').trim();
const enabled=node=>node?!['0','false','off'].includes(String(attribute(node,'val')).toLowerCase()):undefined;

// Translation-template tags are literal text in hidden runs. Read those for
// metadata, but apply Word visibility when extracting the comparison columns.
function visibility(xml) {
  const styles=children(xml?parser().parse(xml):[],'w:styles')||[];
  const byId=new Map(styles.filter(n=>n['w:style']).map(n=>{const props=children(n['w:style'],'w:rPr');return [attribute(n,'styleId'),{parent:property(n['w:style'],'w:basedOn'),toggle:enabled(child(props,'w:vanish'))===true,vertical:property(props,'w:vertAlign'),position:property(props,'w:position')}];}));
  const defaultProps=children(children(children(styles,'w:docDefaults'),'w:rPrDefault'),'w:rPr');
  const defaults=enabled(child(defaultProps,'w:vanish'))??false;
  const defaultId=type=>attribute(styles.find(n=>n['w:style']&&attribute(n,'type')===type&&['1','true','on'].includes(String(attribute(n,'default')))),'styleId');
  const cache=new Map();
  const hidden=(id,inherited)=>{
    const chain=[],seen=new Set();
    while(byId.has(id)&&!cache.has(id)) {
      if(seen.has(id))throw new Error('Cyclic DOCX style inheritance is unsupported.');
      seen.add(id);chain.push(id);id=byId.get(id).parent;
    }
    let toggle=cache.get(id)??false;
    for(const key of chain.reverse()){toggle=toggle!==byId.get(key).toggle;cache.set(key,toggle);}
    return inherited!==toggle;
  };
  const propertyCaches=new Map();
  const inheritedProperty=(id,key,inherited)=>{
    if(!propertyCaches.has(key))propertyCaches.set(key,new Map());
    const cache=propertyCaches.get(key),chain=[],seen=new Set();
    while(byId.has(id)&&!cache.has(id)) {
      if(seen.has(id))throw new Error('Cyclic DOCX style inheritance is unsupported.');
      seen.add(id);chain.push(id);id=byId.get(id).parent;
    }
    let value=cache.get(id);
    for(const styleId of chain.reverse()){value=byId.get(styleId)[key]??value;cache.set(styleId,value);}
    return value??inherited;
  };
  return {defaults,hidden,inheritedProperty,defaultVertical:property(defaultProps,'w:vertAlign')??'baseline',defaultPosition:property(defaultProps,'w:position')??'0',paragraph:defaultId('paragraph'),character:defaultId('character')};
}
function inline(nodes,style,hidden,raw=false,losses=new Set(),format={vertical:'baseline',position:'0'}) {
  let out='';
  for(const node of nodes||[])for(const [key,value] of Object.entries(node)) {
    if(key==='w:r') {
      const props=children(value,'w:rPr');
      const omit=enabled(child(props,'w:vanish'))??style.hidden(property(props,'w:rStyle')||style.character,hidden);
      if(raw||!omit) {
        const id=property(props,'w:rStyle')||style.character;
        const vertical=property(props,'w:vertAlign')??style.inheritedProperty(id,'vertical',format.vertical);
        const position=property(props,'w:position')??style.inheritedProperty(id,'position',format.position);
        const text=inline(value,style,false,raw,losses,{vertical,position});
        if(!raw&&text.trim()&&(vertical!=='baseline'||!Number.isFinite(Number(position))||Number(position)!==0))losses.add('vertical-text-loss');
        out+=text;
      }
    } else if(alternateBranch(key)) {
      if(!raw)losses.add('comparison-structure');
      // Choice and fallback are mutually exclusive; the extractor does not
      // implement the compatibility feature negotiation needed to select one.
    } else if(key==='w:sym') {
      // A legacy font character (e.g. Symbol/F061) is not a Unicode code point.
      // Omitting it would change the legal text; no font mapping is guessed.
      if(!raw)losses.add('symbol-text-loss');
    } else if(nonTextContent(key)) {
      if(!raw)losses.add('non-text-content');
    } else if(key==='#text')out+=String(value);
    else if(key==='w:tab')out+='\t';
    else if(key==='w:br'||key==='w:cr')out+='\n';
    else if(key==='w:noBreakHyphen')out+='‑';
    else if(key==='w:softHyphen')out+='­';
    else if(![':@','w:pPr','w:rPr','w:del','w:moveFrom','w:instrText'].includes(key)&&Array.isArray(value))out+=inline(value,style,hidden,raw,losses,format);
  }
  return out;
}
function documentBlocks(parts,warnings) {
  const style=visibility(parts.get('word/styles.xml'));
  const label=numberingLabels(parts.get('word/numbering.xml'),parts.get('word/styles.xml'),warnings);
  let count=0,size=0;
  const paragraph=nodes=>{
    const props=children(nodes,'w:pPr'),hidden=style.hidden(property(props,'w:pStyle')||style.paragraph,style.defaults);
    const id=property(props,'w:pStyle')||style.paragraph;
    const format={vertical:style.inheritedProperty(id,'vertical',style.defaultVertical),position:style.inheritedProperty(id,'position',style.defaultPosition)};
    const raw=clean(inline(nodes,style,hidden,true,new Set(),format));
    const losses=new Set();let text=clean(inline(nodes,style,hidden,false,losses,format));
    const prefix=label(props);if(prefix&&text)text=prefix+'\t'+text;
    size+=raw.length+text.length;
    if(++count>20000||size>4*1024*1024)throw new Error('Amendment document text exceeds the supported size.');
    const structure=JSON.stringify(nodes);
    return {raw,text,paragraphStyle:id||null,hasNotes:/"w:(?:footnote|endnote)Reference"/.test(structure),losses:[...losses],symbolLoss:losses.has('symbol-text-loss'),unsupportedBody:losses.has('comparison-structure')};
  };
  const blocks=[];
  const paragraphs=nodes=>{
    const result=[];
    for(const node of nodes||[])for(const [key,value] of Object.entries(node)) {
      if(key==='w:p')result.push(paragraph(value));
      else if(key!=='w:tbl'&&key!==':@'&&Array.isArray(value))result.push(...paragraphs(value));
    }
    return result;
  };
  const walk=nodes=>{
    for(const node of nodes||[])for(const [key,value] of Object.entries(node)) {
      if(['w:del','w:moveFrom','w:instrText','w:rPr','w:pPr'].includes(key))continue;
      if(alternateBranch(key))blocks.push({kind:'unsupported',code:'comparison-structure',message:'Alternative document branches cannot be selected reliably; their content and any amendment identities inside them are unavailable.'});
      else if(nonTextContent(key))blocks.push({kind:'unsupported',code:'non-text-content',message:CONTENT_LOSSES['non-text-content']});
      else if(key==='w:p')blocks.push({kind:'paragraph',...paragraph(value)});
      else if(key==='w:tbl') {
        // Only direct rows/cells have a supported comparison layout. Content
        // controls, custom XML and alternate branches may wrap legal content;
        // report those structures instead of silently dropping or flattening
        // them into the surrounding row (including nested-table descendants).
        let unsupported=unsupportedChildren(value,TABLE_CHILDREN);
        const rows=value.filter(n=>n['w:tr']).map(row=>{
          unsupported ||= unsupportedChildren(row['w:tr'],ROW_CHILDREN);
          return row['w:tr'].filter(n=>n['w:tc']).map(cell=>{
            const content=paragraphs(cell['w:tc']);
            unsupported ||= unsupportedChildren(cell['w:tc'],CELL_CHILDREN)||content.some(p=>p.unsupportedBody);
            return {text:content.map(p=>p.text).filter(Boolean).join('\n'),raw:content.map(p=>p.raw).join('\n'),hasNotes:content.some(p=>p.hasNotes),losses:[...new Set(content.flatMap(p=>p.losses))],symbolLoss:content.some(p=>p.symbolLoss),nested:JSON.stringify(cell['w:tc']).includes('"w:tbl"')};
          });
        });
        blocks.push({kind:'table',rows,unsupported});
      } else if(key!==':@'&&Array.isArray(value))walk(value);
    }
  };
  walk(parser().parse(parts.get('word/document.xml')));
  return blocks;
}
const field=(raw,tag)=>[...raw.matchAll(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>','g'))].map(m=>clean(m[1]));
const metadata=value=>clean(value).replace(/^\{[^{}]*\}/,'').trim();
function documentDate(raw) {
  const dates=new Set();
  for(const source of field(raw,'Date'))for(const match of source.matchAll(/(?:\{)?(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\})?/g)) {
    const [,day,month,year]=match,date=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
    if(!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return null;
    dates.add(date);
  }
  return dates.size===1?[...dates][0]:null;
}
const numberIn=(raw,paragraphStyle)=>{
  const match=raw.match(/<NumAm>\s*([1-9]\d*)\s*<\/NumAm>/)||raw.match(/^\s*Amendment\s*([1-9]\d*)\b/iu)||(/^AmNumberTabs\d*$/i.test(paragraphStyle||'')&&raw.match(/^[^\d<>]+?\s*([1-9]\d*)\s*$/u));
  const number=match&&Number(match[1]);return Number.isSafeInteger(number)?number:null;
};
const heading=text=>/^(?:Amendment|Amendement|Änderungsantrag|Ændringsforslag|Módosítás|Enmienda|Emendamento|Alteração|Amendament|Poprawka|Wijziging|Τροπολογία|Pozmeňujúci návrh|Pozměňovací návrh)$/iu.test(text);
const groupNumber=group=>group?.filter(b=>b.kind==='paragraph').map(b=>numberIn(b.raw,b.paragraphStyle)).find(Boolean)||null;

/** Extract individual amendments without flattening the original/proposed columns. */
export function extractAmendments(buffer,{listId,targetDocumentId,language=null,sourceUrl=null,fetchedAt=null}={}) {
  const warnings=new Set(),blocks=documentBlocks(docxParts(buffer),warnings),groups=[],gaps=[];
  const gap=(code,number,message,details={})=>gaps.push({code,...(number==null?{}:{number}),message,sourceUrl,...details});
  let active=null,tagged=false;const cover=[];
  const finish=()=>{if(active?.length)groups.push(active);active=null;tagged=false;};
  for(const block of blocks) {
    if(block.kind==='paragraph') {
      const explicit=/<Amend>/.test(block.raw),number=numberIn(block.raw,block.paragraphStyle);
      const existing=groupNumber(active);
      if(explicit||(!tagged&&number&&existing&&number!==existing))finish();
      if(explicit||(!active&&number)){active=[];tagged=explicit;}
      if(active)active.push(block);
      else {
        if(!groups.length)cover.push(block);
        for(const code of block.losses||[])if(CONTENT_LOSSES[code])gap(code,null,CONTENT_LOSSES[code],{scope:'document'});
      }
      if(/<\/Amend>/.test(block.raw))finish();
    } else if(active)active.push(block);
    else if(block.kind==='unsupported')gap(block.code,null,block.message,{scope:'document'});
  }
  finish();
  const coverRaw=cover.map(b=>b.raw).join('\n');
  // This separately published committee-list format identifies the proposer
  // institution on its cover; Chairman/Rapporteur names are never authors.
  const committee=field(coverRaw,'Committee').map(metadata).filter(Boolean).join('; ')||null;
  const coverDate=documentDate(coverRaw);
  const byNumber=new Map();
  for(const group of groups) {
    const raw=group.filter(b=>b.kind==='paragraph').map(b=>b.raw).join('\n');
    const number=groupNumber(group);
    if(!number){gap('number-unavailable',null,'An amendment block has no supported individual amendment number.');continue;}
    const numbers=new Set([...raw.matchAll(/<NumAm>\s*([1-9]\d*)\s*<\/NumAm>/g)].map(match=>Number(match[1])));
    if(numbers.size>1){gap('number-conflict',number,'The amendment block contains conflicting individual amendment numbers; its content is withheld.');continue;}
    for(const unsupported of group.filter(block=>block.kind==='unsupported'))gap(unsupported.code,number,unsupported.message);
    for(const block of group.filter(block=>block.kind==='paragraph'))for(const code of block.losses||[])if(CONTENT_LOSSES[code])gap(code,number,CONTENT_LOSSES[code]);
    const authors=[...new Set(field(raw,'Members').flatMap(names=>names.split(/[,;\n]+/).map(clean).filter(Boolean)))];
    const onBehalfOf=field(raw,'AuNomDe').map(metadata).filter(Boolean).join('; ')||null;
    const targetParts=field(raw,'Article');
    for(let i=2;i<=4;i++)for(const article of field(raw,'Article'+i))targetParts.push([field(raw,'DocAmend'+i)[0],article].filter(Boolean).join(' — '));
    if(!targetParts.length&&committee) {
      const procedure=field(coverRaw,'Procedure').map(metadata);
      for(const block of group) {
        if(block.kind==='table')break;
        if(block.kind==='paragraph'&&/^NormalBold(?:\d+b?)?$/i.test(block.paragraphStyle||'')&&block.text&&!procedure.includes(block.text))targetParts.push(block.text);
      }
    }
    const targetLabel=targetParts.map(metadata).filter(Boolean).join('\n')||null;
    const before=[],after=[];let comparableRows=0,hasTable=false;
    for(const table of group.filter(b=>b.kind==='table')) {
      hasTable=true;
      if(table.unsupported)gap('comparison-structure',number,'The comparison contains unsupported wrapped or embedded row/cell content; its wording is withheld.');
      let headerConfirmed=false;
      for(const cells of table.rows) {
        if(cells.some(c=>c.nested)){gap('nested-table',number,'A nested comparison table is unsupported.');continue;}
        if(cells.some(c=>c.symbolLoss))gap('symbol-text-loss',number,'A visible font-encoded symbol cannot be decoded reliably; comparison wording is withheld.');
        for(const code of Object.keys(CONTENT_LOSSES))if(cells.some(cell=>cell.losses.includes(code)))gap(code,number,CONTENT_LOSSES[code]);
        if(cells.every(c=>!c.text))continue;
        if(!headerConfirmed) {
          if(cells.length===2&&heading(cells[1].text)){headerConfirmed=true;continue;}
          gap('comparison-header',number,'The comparison column headings could not be identified.');break;
        }
        if(cells.length!==2){gap('comparison-columns',number,'A comparison row does not contain exactly two columns.');continue;}
        if(cells.some(c=>c.hasNotes))gap('notes-unavailable',number,'The comparison contains footnote or endnote references whose note text is not included in this extraction.');
        comparableRows++;before.push(cells[0].text);after.push(cells[1].text);
      }
    }
    const ownDate=documentDate(raw),date=ownDate||(!field(raw,'Date').length&&committee?coverDate:null);
    const dateBasis=ownDate?'individual-amendment-document':date?'amendment-list-document':null;
    let justification=null,inJustification=false;const justificationParts=[];
    for(const block of group)if(block.kind==='paragraph') {
      const title=/^Justification\s*$/iu.test(block.text)||/<TitreJust>/.test(block.raw)||block.paragraphStyle==='AmJustTitle';
      if(title||/<Justification>/.test(block.raw))inJustification=true;
      if(inJustification&&!title&&!/^Or\.\s/iu.test(block.text))justificationParts.push(metadata(block.text).replace(/<\/?Justification>/g,''));
      if(/<\/Justification>|<\/Amend>|<Original>/.test(block.raw))inJustification=false;
    }
    if(justificationParts.some(Boolean))justification=justificationParts.filter(Boolean).join('\n');
    const record={number,listId:listId??null,targetDocumentId:targetDocumentId??null,date,documentDate:date,dateBasis,authors,committeeProposer:committee,onBehalfOf,targetLabel,originalText:comparableRows?before.join('\n').trim():null,proposedText:comparableRows?after.join('\n').trim():null,justification,language,sources:[{url:sourceUrl,fetchedAt,date,dateBasis,language,format:'DOCX'}]};
    if(!authors.length)gap('authors-unavailable',number,'No explicit amendment proposer names were found in this document block.');
    if(!date)gap('date-unavailable',number,'The amendment document does not supply a supported document date.');
    if(!targetLabel)gap('target-unavailable',number,'The amendment target location was not recorded.');
    if(!hasTable||!comparableRows)gap('text-unavailable',number,'No supported original/proposed comparison rows were found.');
    if(byNumber.has(number)) {
      byNumber.set(number,null);gap('duplicate-amendment',number,'The list repeats this amendment number; its extracted content is withheld.');
    } else byNumber.set(number,record);
  }
  let amendments=[...byNumber.values()].filter(Boolean).sort((a,b)=>a.number-b.number);
  const range=String(listId||'').match(/-AM-(\d+)-(\d+)$/);
  if(range&&Number(range[2])-Number(range[1])<1000) {
    const missing=[];
    for(let n=Number(range[1]);n<=Number(range[2]);n++)if(!byNumber.get(n))missing.push(n);
    if(missing.length)gap('list-coverage',null,'Individual amendment text is unavailable for numbers '+missing.join(', ')+'.');
    amendments=amendments.filter(record=>{
      if(record.number>=Number(range[1])&&record.number<=Number(range[2]))return true;
      gap('number-outside-list',record.number,'The amendment number falls outside the source list identifier range; its content is withheld.');return false;
    });
  }
  if(!groups.length)gap('amendments-unavailable',null,'No supported individual amendment blocks were found.');
  for(const message of warnings)gap('numbering-warning',null,message);
  for(const amendment of amendments) {
    amendment.gaps=gaps.filter(item=>item.number===amendment.number||item.code==='numbering-warning').map(item=>item.number==null?{...item,number:amendment.number,scope:'document'}:{...item});
    // Losing even one comparison row leaves both legal columns incomplete.
    // Keep the exact identity and its missing-evidence labels, never a shortened
    // body that could be mistaken for the whole amendment. Empty supported
    // cells remain valid; notes and missing author/date metadata are separate.
    if(amendment.gaps.some(item=>TEXT_LOSS_CODES.has(item.code))) {
      amendment.originalText=null;
      amendment.proposedText=null;
    }
  }
  return {amendments,gaps};
}
