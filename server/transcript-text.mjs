import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {SPEECH_XML_BYTES} from './transcript-language.mjs';

const text=node=>typeof node==='string'?node:typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?Object.entries(node).filter(([key])=>!key.startsWith('@_')).map(([,value])=>text(value)).join(' '):'';
// Match the existing retained-transcript bound. Raw timing markup is temporary;
// cloud selection budgets apply to the paragraph text kept for analysis.
export function speechParagraphText(xml) {
  if(typeof xml!=='string'||Buffer.byteLength(xml)>SPEECH_XML_BYTES||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)return '';
  const tree=new XMLParser({ignoreAttributes:true,removeNSPrefix:true}).parse(xml),paragraphs=[];
  function visit(node){if(!node||typeof node!=='object')return;for(const [key,value] of Object.entries(node)){if(key==='p'){for(const paragraph of Array.isArray(value)?value:[value])paragraphs.push(text(paragraph?.time??paragraph));}else if(!key.startsWith('@_')){for(const child of Array.isArray(value)?value:[value])visit(child);}}}visit(tree);return paragraphs.join(' ');
}
