import {XMLParser} from 'fast-xml-parser';
import {formatNumber} from './docx-numbering.mjs';
const child=(nodes,key)=>nodes?.find(node=>Object.hasOwn(node,key));
const children=(nodes,key)=>child(nodes,key)?.[key];
const attribute=(node,key)=>node?.[':@']?.['@_w:'+key];
const property=(nodes,key)=>attribute(child(nodes,key),'val');

// Section properties end their section. The final section's properties sit directly in the body.
function sectionsOf(nodes,result=[]) {
  for(const node of nodes||[])for(const [key,value] of Object.entries(node)) {
    if(key==='w:p'){const section=children(children(value,'w:pPr'),'w:sectPr');if(section)result.push(section);}
    else if(key==='w:sectPr')result.push(value);
    else if(key!==':@'&&!key.endsWith('Change')&&Array.isArray(value))sectionsOf(value,result);
  }
  return result;
}
export function noteNumbering(document,settingsXml,warnings) {
  const settings=children(settingsXml?new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false}).parse(settingsXml):[],'w:settings');
  const sections=sectionsOf(document),counters=new Map();
  return (kind,section,custom)=>{
    if(custom){warnings.add('A custom note reference has no readable label.');return '?';}
    const key=kind==='w:endnoteReference'?'w:endnotePr':'w:footnotePr';
    const local=children(sections[section],key),global=children(settings,key);
    const setting=name=>property(local,name) ?? property(global,name);
    const format=setting('w:numFmt') ?? 'decimal',start=Number(setting('w:numStart') ?? 1),restart=setting('w:numRestart') ?? 'continuous';
    if(!['continuous','eachSect'].includes(restart)||!Number.isSafeInteger(start)||start<0||attribute(child(local,'w:numFmt')||child(global,'w:numFmt'),'format')) {
      warnings.add('Some note numbering requires unsupported formatting or page layout.');return '?';
    }
    const previous=counters.get(key),value=!previous||restart==='eachSect'&&previous.section!==section?start:previous.value+1;
    counters.set(key,{section,value});return formatNumber(value,format,warnings)||'?';
  };
}
