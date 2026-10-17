import catalogue from './pocSpeakerTerms.json' with {type:'json'};
import {speakerIsChair,speakerNameIsSpecific,nameScript} from './speakerNames.mjs';

export function speakerTerm(key,requested='en') {
  const language=String(requested).toLowerCase().split('-')[0];
  const used=Object.hasOwn(catalogue.labels,language)?language:'en',index=catalogue.keys.indexOf(key);
  if(index<0)throw new RangeError('Unknown speaker term');
  return {text:catalogue.labels[used][index],language:used};
}
const roleCodes=new Map([['member of the commission','commissioner'],['commissioner','commissioner'],['president of the commission','president-commission'],['vice-president of the commission','vice-president-commission'],['president-in-office of the council','council-presidency']]);
function hasStructuredGroupCapacity(person,intervention) {
  const english=person?.roleLabels?.en;
  return Boolean(person?.id&&person.id===intervention?.speaker?.id&&
    intervention?.onBehalfOf?.some(group=>group.politicalGroup&&group.source==='participation_in_name_of')&&
    english?.language==='en'&&english.text.trim().toLowerCase()==='on behalf of the group');
}
export function speakerPresentation(person,language='en',{chair=false,intervention}={}) {
  chair=chair||person?.sittingRole==='chair'||person?.role==='Chairing the sitting'||speakerIsChair(person?.name);
  let script='Latn';try{script=new Intl.Locale(language).maximize().script||script;}catch { /* Unknown UI language uses the Latin fallback. */ }
  const variants=(person?.nameVariants||[]).filter(variant=>speakerNameIsSpecific(variant.value));
  const selected=variants.find(variant=>variant.script===script&&variant.language===language)||variants.find(variant=>variant.script===script)||variants.find(variant=>variant.script==='Latn');
  const specific=selected?.value||(speakerNameIsSpecific(person?.name)?person.name:'');
  const name=specific?{text:specific,language:''}:speakerTerm(chair?'chair':'name-unavailable',language);
  const roles=[];
  if(chair&&person?.office?.code)roles.push(speakerTerm(person.office.code,language));
  else {
    const supplied=person?.roleLabels?.[language]||person?.roleLabels?.en||Object.values(person?.roleLabels||{})[0]||(person?.role&&person.role!=='Chairing the sitting'?{text:person.role,language:person.roleLanguage||''}:null);
    // The exact structured badge already supplies this capacity. Translated headers can invent a different group name.
    if(supplied&&!hasStructuredGroupCapacity(person,intervention)) {
      const code=supplied.language==='en'?roleCodes.get(supplied.text.toLowerCase().trim()):null;
      roles.push(code?speakerTerm(code,language):supplied);
    }
  }
  if(chair&&specific)roles.push(speakerTerm('chair',language));
  if(!specific&&chair)roles.push(speakerTerm('name-unavailable',language));
  return {name,roles,nameUnavailable:!specific};
}
