import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {array} from './activity-index-model.mjs';
import {speakerIsChair,speakerNameIsSpecific,nameScript} from '../src/speakerNames.mjs';
export {speakerIsChair,speakerNameIsSpecific} from '../src/speakerNames.mjs';
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,trimValues:false});
const text=value=>typeof value==='string'?value:value?.['#text']||'';
const officialPerson=value=>String(value?.id||value||'').match(/^(?:person\/|https?:\/\/data\.europarl\.europa\.eu\/person\/)([1-9]\d*)$/)?.[1];
// Transcript headers retain the original language even in translated fragments.
export function speechSpeakers(activity,xml) {
  if(typeof xml!=='string'||xml.length>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)return [];
  const ids=new Set(array(activity.had_participation).flatMap(p=>array(p.had_participant_person)).map(officialPerson).filter(Boolean));
  try {
    const parsed=parser.parse(xml),statements=parsed.oralStatements||parsed.writtenStatements;const from=Object.values(statements||{}).flatMap(array).find(node=>node&&typeof node==='object'&&node.from)?.from;if(!from)return [];
    return array(from.person).flatMap(person=>{const id=String(person?.['@_refersTo']||'').match(/^(?:epdata:)?person\/(\d+)$/)?.[1],name=text(person).trim(),role=array(from.role).map(text).join(' ').trim()||null,tag=array(from.role).find(value=>value?.['@_xml:lang'])?.['@_xml:lang']||from['@_xml:lang']||'';const roleLanguage=tag.includes('-t-')?tag.split('-t-')[1].split('-')[0]:tag.split('-')[0];return id&&ids.has(id)&&name?[{id,name,role:speakerIsChair(name)?'Chairing the sitting':role,...(role?{roleLanguage:roleLanguage||null}:{}),nameSource:'api:xmlFragment/from/person'}]:[];});
  }catch{return [];}
}

// Name/role variants remain tied to the exact participant ID in each supplied fragment.
export function speechSpeakerDetails(activity) {
  const people=new Map();
  for(const doc of array(activity.recorded_in_a_realization_of))for(const [language,xml] of Object.entries(doc?.['api:xmlFragment']||{})) {
    if(!/^[a-z]{2}$/.test(language))continue;
    for(const speaker of speechSpeakers(activity,xml)) {
      const old=people.get(speaker.id)||{...speaker,nameVariants:[],roleLabels:{}};
      if(speakerNameIsSpecific(speaker.name)) {
        const script=nameScript(speaker.name);
        old.nameVariants.push({value:speaker.name,script,language,source:'api:xmlFragment/from/person'});
        if(language==='en'||!speakerNameIsSpecific(old.name))old.name=speaker.name;
      }
      if(speaker.role==='Chairing the sitting')old.sittingRole='chair';
      else if(speaker.role)old.roleLabels[language]={text:speaker.role,language:speaker.roleLanguage||language};
      people.set(speaker.id,old);
    }
  }
  return [...people.values()];
}
