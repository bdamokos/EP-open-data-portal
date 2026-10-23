import {XMLParser} from 'fast-xml-parser';
const child=(nodes,key)=>nodes?.find(node=>Object.hasOwn(node,key));
const children=(nodes,key)=>child(nodes,key)?.[key];
const attribute=(node,key)=>node?.[':@']?.['@_w:'+key];
const property=(nodes,key)=>attribute(child(nodes,key),'val');

export function formatNumber(value,kind,warnings) {
  if(Number.isSafeInteger(value)&&value>=0) {
    if(kind==='decimal')return String(value);
    if(kind==='decimalZero')return String(value).padStart(2,'0');
    if(['upperLetter','lowerLetter'].includes(kind)&&value>0){let result='';for(let n=value;n>0;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return kind==='lowerLetter'?result.toLowerCase():result;}
    if(['upperRoman','lowerRoman'].includes(kind)&&value>0&&value<4000){let result='',n=value;for(const [size,digits] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']])while(n>=size){result+=digits;n-=size;}return kind==='lowerRoman'?result.toLowerCase():result;}
  }
  warnings.add('Some automatic numbering uses an unsupported format or value.');return '';
}

export function numberingLabels(numberingXml,stylesXml,warnings) {
  const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false});
  const styles=children(stylesXml?parser.parse(stylesXml):[],'w:styles') || [];
  const byId=new Map(styles.filter(n=>n['w:style']).map(n=>[attribute(n,'styleId'),{parent:property(n['w:style'],'w:basedOn'),numbering:children(children(n['w:style'],'w:pPr'),'w:numPr')}]));
  const defaultParagraph=attribute(styles.find(n=>n['w:style'] && attribute(n,'type')==='paragraph' && ['1','true','on'].includes(String(attribute(n,'default')))),'styleId');
  const numbering=children(numberingXml?parser.parse(numberingXml):[],'w:numbering') || [];
  const abstracts=new Map(numbering.filter(n=>n['w:abstractNum']).map(n=>[attribute(n,'abstractNumId'),n['w:abstractNum']]));
  const lists=new Map(numbering.filter(n=>n['w:num']).map(n=>[attribute(n,'numId'),n['w:num']])),counters=new Map(),started=new Map();
  function paragraphNumbering(properties) {
    const direct=children(properties,'w:numPr');let numberId=property(direct,'w:numId'),level=property(direct,'w:ilvl');
    let id=property(properties,'w:pStyle') || defaultParagraph;const seen=new Set();
    while(byId.has(id)) {
      if(seen.has(id))throw new Error('Cyclic DOCX style inheritance is unsupported.');
      seen.add(id);const style=byId.get(id);numberId ??= property(style.numbering,'w:numId');level ??= property(style.numbering,'w:ilvl');id=style.parent;
    }
    return direct || numberId!==undefined || level!==undefined ? {id:numberId,level:level ?? '0'} : null;
  }
  return properties=>{
    const number=paragraphNumbering(properties);if(!number || number.id==='0')return '';
    const list=lists.get(number.id),abstractId=property(list,'w:abstractNumId'),abstract=abstracts.get(abstractId),level=Number(number.level);
    const definition=index=>{
      const override=list?.find(n=>n['w:lvlOverride'] && attribute(n,'ilvl')===String(index))?.['w:lvlOverride'];
      const original=abstract?.find(n=>n['w:lvl'] && attribute(n,'ilvl')===String(index))?.['w:lvl'];
      const replacement=children(override,'w:lvl'),base=replacement || original;
      const startOverride=property(override,'w:startOverride') ?? property(replacement,'w:start');
      // Word ignores lvlRestart in a level override; use the abstract level.
      return base?{format:property(base,'w:numFmt'),pattern:property(base,'w:lvlText'),start:Number(startOverride ?? property(base,'w:start') ?? 1),startOverride,restart:property(original,'w:lvlRestart')}:null;
    };
    const def=definition(level);
    if(!Number.isInteger(level)||level<0||level>8||!def||!Number.isSafeInteger(def.start)||def.start<0){warnings.add('Some automatic paragraph numbering could not be read.');return '';}
    // A concrete instance may restart a level on first use, but unoverridden
    // instances (including style defaults) continue the same abstract list.
    const state=counters.get(abstractId) || [],used=started.get(number.id) || new Set();
    if(!used.has(level) && def.startOverride!==undefined)state[level]=def.start-1;
    used.add(level);started.set(number.id,used);
    state[level]=(state[level] ?? def.start-1)+1;
    // lvlRestart is one-based. Zero never restarts; an absent or out-of-range
    // value uses the preceding level. Word also restarts on any higher level.
    // https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/140a2cd9-2f26-456d-9760-ae6ecef4e8b5
    for(let i=level+1;i<state.length;i++) {
      const restart=Number(definition(i)?.restart ?? i);
      if(restart===0)continue;
      const trigger=Number.isInteger(restart)&&restart>0&&restart<=i ? restart-1 : i-1;
      if(level<=trigger)state[i]=undefined;
    }
    counters.set(abstractId,state);
    if(def.format==='bullet')return '•';
    if(!['decimal','decimalZero','upperLetter','lowerLetter','upperRoman','lowerRoman'].includes(def.format))warnings.add('Some automatic paragraph numbering uses an unsupported format.');
    if(typeof def.pattern!=='string'){warnings.add('Some automatic paragraph numbering could not be read.');return '';}
    return def.pattern.replace(/%([1-9])/g,(_,digit)=>{const i=Number(digit)-1,d=definition(i);if(!d){warnings.add('Some automatic paragraph numbering could not be read.');return '';}return formatNumber(state[i] ?? d.start,d.format,warnings);});
  };
}
