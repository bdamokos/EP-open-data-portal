// Visible objects, final-revision visibility and source boundaries.
export const DOCX_EXTRACTION_VERSION=11;

// Paths describe the original XML, including elements whose text is omitted.
// Paragraph ordinals therefore do not imply adjacency after extraction.
export function sourceIndex(nodes) {
  const index=new WeakMap();let ordinal=0;
  function visit(nodes,parent) {
    const counts=new Map();
    for(const node of nodes||[])for(const [key,value] of Object.entries(node)) {
      if(key===':@'||key==='#text'||key.startsWith('?'))continue;
      const count=(counts.get(key)||0)+1;counts.set(key,count);
      const path=`${parent}/${key}[${count}]`;
      index.set(node,{path,...(key==='w:p'?{ordinal:ordinal++}:{})});
      if(Array.isArray(value))visit(value,path);
    }
  }
  visit(nodes,'');return index;
}

// U+FFFC is Unicode's object replacement character, not a guessed glyph.
export const OBJECT_REPLACEMENT='\uFFFC';

// Adobe Symbol encoding 0x2D maps to U+2212, not ASCII hyphen or an en dash:
// https://www.unicode.org/Public/MAPPINGS/VENDORS/ADOBE/symbol.txt
// Microsoft documents the legacy F000 offset for non-Unicode symbol fonts:
// https://learn.microsoft.com/en-us/typography/opentype/spec/recom#non-standard-symbol-fonts
// w:sym selects its own font; rFonts must not determine this conversion.
export function symbolText(font,code) {
  return font==='Symbol'&&/^(?:F0|00)2D$/i.test(code??'')?'\u2212':null;
}

// Skipped paragraphs may consume style-derived list items; references may
// consume automatic note labels. An imported chunk has no observed contents.
export function skippedCounterRisk(nodes) {
  const risk={lists:false,notes:false};
  function visit(nodes) {
    for(const node of nodes||[])for(const [key,value] of Object.entries(node)) {
      if(key==='w:altChunk'){risk.lists=true;risk.notes=true;}
      if(key==='w:p')risk.lists=true;
      if(['w:footnoteReference','w:endnoteReference'].includes(key))risk.notes=true;
      if(key!==':@'&&Array.isArray(value))visit(value);
    }
  }
  visit(nodes);return risk;
}

const containers=new Set(['body','table-cell','other']);
const objectKinds=new Set(['symbol','drawing','object','math','unsupported']);
export function documentStructure(record) {
  const unknown={structureStatus:'not-extracted',paragraphSources:[],documentObjects:[]};
  if(record?.extractionVersion!==DOCX_EXTRACTION_VERSION||record.structureStatus!=='extracted'||!Array.isArray(record.paragraphs)
    ||!Array.isArray(record.paragraphSources)||record.paragraphSources.length!==record.paragraphs.length||!Array.isArray(record.documentObjects))return unknown;
  const path=value=>typeof value==='string'&&value.startsWith('/')&&value.length<=10000;
  let previous=-1;
  for(const source of record.paragraphSources) {
    if(!path(source?.path)||!path(source.containerPath)||!containers.has(source.container)||!Number.isSafeInteger(source.ordinal)||source.ordinal<=previous
      ||!Number.isSafeInteger(source.segment)||source.segment<0||typeof source.complete!=='boolean'
      ||source.previousParagraph!==undefined&&!path(source.previousParagraph))return unknown;
    previous=source.ordinal;
  }
  for(const object of record.documentObjects) {
    if(!Number.isInteger(object?.paragraph)||object.paragraph<0||object.paragraph>=record.paragraphs.length||!path(object.path)||!objectKinds.has(object.kind)
      ||!['mapped','unresolved'].includes(object.status)||!['leading-marker','content'].includes(object.role)||!Number.isInteger(object.offset)||object.offset<0
      ||typeof object.replacement!=='string'||!object.replacement||!record.paragraphs[object.paragraph].startsWith(object.replacement,object.offset)
      ||['font','code'].some(key=>object[key]!==undefined&&typeof object[key]!=='string'))return unknown;
    if(object.status==='unresolved'&&record.paragraphSources[object.paragraph].complete)return unknown;
  }
  return {structureStatus:'extracted',paragraphSources:record.paragraphSources,documentObjects:record.documentObjects};
}
