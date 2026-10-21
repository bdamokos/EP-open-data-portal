import {XMLParser} from 'fast-xml-parser';
import {formatNumber} from './docx-numbering.mjs';
const child=(nodes,key)=>nodes?.find(node=>Object.hasOwn(node,key));
const children=(nodes,key)=>child(nodes,key)?.[key];
const attribute=(node,key)=>node?.[':@']?.['@_w:'+key];
const property=(nodes,key)=>attribute(child(nodes,key),'val');

// Commission templates switch between an explicitly restarted w:num and the
// paragraph style's w:num for the same abstract list. Word continues that list;
// a first use of startOverride resets it. Keep this resolver proposal-scoped.
export function proposalNumberingLabels(numberingXml,stylesXml,warnings) {
  const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false});
  const styles=children(stylesXml?parser.parse(stylesXml):[],'w:styles')??[];
  const byId=new Map(styles.filter(node=>node['w:style']).map(node=>[attribute(node,'styleId'),{parent:property(node['w:style'],'w:basedOn'),numbering:children(children(node['w:style'],'w:pPr'),'w:numPr')}]));
  const defaultStyle=attribute(styles.find(node=>node['w:style']&&attribute(node,'type')==='paragraph'&&['1','true','on'].includes(String(attribute(node,'default')))),'styleId');
  const numbering=children(numberingXml?parser.parse(numberingXml):[],'w:numbering')??[];
  const abstracts=new Map(numbering.filter(node=>node['w:abstractNum']).map(node=>[attribute(node,'abstractNumId'),node['w:abstractNum']]));
  const instances=new Map(numbering.filter(node=>node['w:num']).map(node=>[attribute(node,'numId'),node['w:num']]));
  const counters=new Map(),started=new Map();
  return properties=>{
    const direct=children(properties,'w:numPr');let numberId=property(direct,'w:numId'),levelId=property(direct,'w:ilvl');
    let styleId=property(properties,'w:pStyle')??defaultStyle;const visited=new Set();
    while(byId.has(styleId)) {
      if(visited.has(styleId))throw new Error('Cyclic DOCX style inheritance is unsupported.');
      visited.add(styleId);const style=byId.get(styleId);numberId??=property(style.numbering,'w:numId');levelId??=property(style.numbering,'w:ilvl');styleId=style.parent;
    }
    if(numberId===undefined||numberId==='0')return '';
    const list=instances.get(numberId),abstractId=property(list,'w:abstractNumId'),abstract=abstracts.get(abstractId),level=Number(levelId??0);
    function definition(index) {
      const override=list?.find(node=>node['w:lvlOverride']&&attribute(node,'ilvl')===String(index))?.['w:lvlOverride'];
      const base=children(override,'w:lvl')??abstract?.find(node=>node['w:lvl']&&attribute(node,'ilvl')===String(index))?.['w:lvl'];
      const startOverride=property(override,'w:startOverride');
      return base?{format:property(base,'w:numFmt'),pattern:property(base,'w:lvlText'),start:Number(startOverride??property(base,'w:start')??1),startOverride,restart:property(base,'w:lvlRestart')}:null;
    }
    const def=definition(level);
    if(!Number.isInteger(level)||level<0||level>8||!def||!Number.isSafeInteger(def.start)||def.start<0){warnings.add('Some automatic paragraph numbering could not be read.');return '';}
    const state=counters.get(abstractId)??[],used=started.get(numberId)??new Set();
    if(!used.has(level)&&def.startOverride!==undefined)state[level]=def.start-1;
    used.add(level);started.set(numberId,used);state[level]=(state[level]??def.start-1)+1;
    for(let index=level+1;index<state.length;index++)if(definition(index)?.restart!=='0')state[index]=undefined;
    counters.set(abstractId,state);
    if(def.format==='bullet')return '•';
    if(typeof def.pattern!=='string'){warnings.add('Some automatic paragraph numbering could not be read.');return '';}
    return def.pattern.replace(/%([1-9])/g,(_,digit)=>{
      const index=Number(digit)-1,definitionAt=definition(index);
      if(!definitionAt){warnings.add('Some automatic paragraph numbering could not be read.');return '';}
      return formatNumber(state[index]??definitionAt.start,definitionAt.format,warnings);
    });
  };
}
