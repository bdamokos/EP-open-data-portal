import {XMLParser} from 'fast-xml-parser';
import {array} from './activity-index-model.mjs';
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,trimValues:false});
const text=value=>typeof value==='string'?value:value?.['#text']||'';
const officialPerson=value=>String(value?.id||value||'').match(/^(?:person\/|https?:\/\/data\.europarl\.europa\.eu\/person\/)([1-9]\d*)$/)?.[1];
export const speakerNameIsSpecific=name=>typeof name==='string'&&Boolean(name.trim())&&!/^(?:(?:the|le|la)\s+)?(?:speaker|president|presiding|chair|chairman|chairperson)$/i.test(name.trim());
export function speechSpeakers(activity,xml) {
  if(typeof xml!=='string'||xml.length>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))return [];
  const ids=new Set(array(activity.had_participation).flatMap(p=>array(p.had_participant_person)).map(officialPerson).filter(Boolean));
  try {
    const statements=parser.parse(xml).oralStatements;const from=Object.values(statements||{}).flatMap(array).find(node=>node&&typeof node==='object'&&node.from)?.from;if(!from)return [];
    return array(from.person).flatMap(person=>{const id=String(person?.['@_refersTo']||'').match(/^(?:epdata:)?person\/(\d+)$/)?.[1],name=text(person).trim();return id&&ids.has(id)&&name?[{id,name,role:array(from.role).map(text).join(' ').trim()||null,nameSource:'api:xmlFragment/from/person'}]:[];});
  }catch{return [];}
}
