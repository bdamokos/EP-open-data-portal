// Read native XML independently of proposal selection, text extraction or placement.
import {XMLParser} from 'fast-xml-parser';
const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false});
function paragraphs(xml) {
 const output=[];
 const text=nodes=>nodes.map(node=>Object.entries(node).map(([key,value])=>key==='w:t'?value.map(x=>x['#text']??'').join(''):key==='w:tab'?'\t':['w:br','w:cr'].includes(key)?'\n':key==='w:noBreakHyphen'?'\u2011':key==='w:softHyphen'?'\u00ad':Array.isArray(value)?text(value):'').join('')).join('');
 const walk=nodes=>{for(const node of nodes)for(const [key,value] of Object.entries(node))if(key==='w:p')output.push(text(value));else if(Array.isArray(value))walk(value);};
 walk(parser.parse(xml));return output;
}
export function nativeEditionText(parts) {
 if(!parts?.get('word/document.xml'))return null;
 return ['word/document.xml','word/footnotes.xml','word/endnotes.xml'].map(part=>parts.has(part)?paragraphs(parts.get(part)):[]);
}
export function identicalNativeEditionText(editions) {
 if(editions.length<2)return false;
 const texts=editions.map(nativeEditionText);return texts.every(Boolean)&&texts[0][0].some(t=>t.trim())&&texts.every(t=>JSON.stringify(t)===JSON.stringify(texts[0]));
}
