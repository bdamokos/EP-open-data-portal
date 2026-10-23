import {XMLParser} from 'fast-xml-parser';
import {numberingLabels} from './docx-numbering.mjs';
const child=(nodes,key)=>nodes?.find(node=>Object.hasOwn(node,key));
const children=(nodes,key)=>child(nodes,key)?.[key];
const attribute=(node,key)=>node?.[':@']?.['@_w:'+key];
const property=(nodes,key)=>attribute(child(nodes,key),'val');

// Use the shared Word label resolver and attach proposal hierarchy metadata.
export function proposalNumberingLabels(numberingXml,stylesXml,warnings) {
  const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false});
  const styles=children(stylesXml?parser.parse(stylesXml):[],'w:styles')??[];
  const byId=new Map(styles.filter(node=>node['w:style']).map(node=>[attribute(node,'styleId'),{parent:property(node['w:style'],'w:basedOn'),numbering:children(children(node['w:style'],'w:pPr'),'w:numPr')}]));
  const defaultStyle=attribute(styles.find(node=>node['w:style']&&attribute(node,'type')==='paragraph'&&['1','true','on'].includes(String(attribute(node,'default')))),'styleId');
  const numbering=children(numberingXml?parser.parse(numberingXml):[],'w:numbering')??[];
  const abstracts=new Map(numbering.filter(node=>node['w:abstractNum']).map(node=>[attribute(node,'abstractNumId'),node['w:abstractNum']]));
  const instances=new Map(numbering.filter(node=>node['w:num']).map(node=>[attribute(node,'numId'),node['w:num']]));
  const labels=numberingLabels(numberingXml,stylesXml,warnings);
  function resolve(properties){
    const direct=children(properties,'w:numPr');let numberId=property(direct,'w:numId'),levelId=property(direct,'w:ilvl');
    let styleId=property(properties,'w:pStyle')??defaultStyle;const visited=new Set();
    while(byId.has(styleId)) {
      if(visited.has(styleId))throw new Error('Cyclic DOCX style inheritance is unsupported.');
      visited.add(styleId);const style=byId.get(styleId);numberId??=property(style.numbering,'w:numId');levelId??=property(style.numbering,'w:ilvl');styleId=style.parent;
    }
    if(numberId===undefined||numberId==='0')return null;
    const list=instances.get(numberId),abstractId=property(list,'w:abstractNumId'),abstract=abstracts.get(abstractId),level=Number(levelId??0);
    if(!Number.isInteger(level)||level<0||level>8)return null;
    const override=list?.find(node=>node['w:lvlOverride']&&attribute(node,'ilvl')===String(level))?.['w:lvlOverride'];
    const definition=children(override,'w:lvl')??abstract?.find(node=>node['w:lvl']&&attribute(node,'ilvl')===String(level))?.['w:lvl'];
    return definition?{id:numberId,abstractId,level,format:property(definition,'w:numFmt')}:null;
  }
  function metadata(properties){return resolve(properties);}
  labels.metadata=metadata;
  return labels;
}
