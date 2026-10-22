import {speakerRoleLabel} from '../src/speakerRoles.mjs';
import {speechPeople} from './speech-interventions.mjs';

const normalized=text=>text.normalize('NFC').trim().replace(/\s+/gu,' ');
const capacity=metadata=>JSON.stringify({type:metadata.summary.intervention?.type,
  groups:(metadata.summary.intervention?.onBehalfOf||[]).map(group=>group.uri).sort()});
const term=metadata=>metadata.activity.recorded_in_a_realization_of?.map(doc=>String(doc.identifier||doc.id||'').match(/CRE-(\d+)-/)?.[1]).find(Boolean);

// A bilingual pair is evidence only for this ID, capacity and earlier speech.
// Never chain reused labels or search past a changed/unknown nearest role.
export function reuseSpeechRole(current,person,previous,language='en') {
  if(!/^[1-9]\d*$/.test(person.id)||!speechPeople(current.activity).includes(person.id)||!speechPeople(previous.activity).includes(person.id))return null;
  const earlier=previous.speakers.find(value=>value.id===person.id);
  if(!earlier||earlier.sittingRole==='chair'||person.sittingRole==='chair'||earlier.role==='Chairing the sitting'||person.role==='Chairing the sitting')return null;
  const label=speakerRoleLabel(earlier,language);
  if(!label||label.reuse||speakerRoleLabel(person,language))return null;
  const day=current.summary.date,oldDay=previous.summary.date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{4}-\d{2}-\d{2}$/.test(oldDay)||oldDay>day||current.summary.id===previous.summary.id)return null;
  // Different terms and undated same-day ordering cannot establish continuity.
  if(!term(current)||term(current)!==term(previous)||capacity(current)!==capacity(previous))return null;
  if(oldDay===day&&!(Number.isFinite(Date.parse(previous.summary.start))&&Date.parse(previous.summary.start)<Date.parse(current.summary.start)))return null;
  const comparisons=Object.entries(person.roleLabels||{}).filter(([lang,value])=>lang!==language&&value.language===lang&&value.text?.trim()&&!value.reuse);
  if(!comparisons.length)return null;
  const compared=[];
  for(const [lang,value] of comparisons) {
    const counterpart=speakerRoleLabel(earlier,lang);
    if(!counterpart||counterpart.reuse)continue;
    if(normalized(value.text)!==normalized(counterpart.text))return null;
    compared.push({language:lang,current:value.text,previous:counterpart.text});
  }
  if(!compared.length||!current.sourceUrl||!current.fetchedAt||!previous.sourceUrl||!previous.fetchedAt)return null;
  return {...label,reuse:{personId:person.id,currentSpeechId:current.summary.id,currentDate:day,currentSource:{url:current.sourceUrl,fetchedAt:current.fetchedAt},
    speechId:previous.summary.id,date:oldDay,source:{url:previous.sourceUrl,fetchedAt:previous.fetchedAt},compared}};
}
