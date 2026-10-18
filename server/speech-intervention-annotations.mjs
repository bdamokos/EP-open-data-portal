import {readFileSync} from 'node:fs';

// Public-source classifications for records whose API transcript is absent.
// Every annotation is tied to the exact event, speaking participant, times and
// supplied agenda parent. It never supplies missing API text or relationships.
const records=new Map(JSON.parse(readFileSync(new URL('./speech-intervention-annotations.json',import.meta.url))).map(row=>[row.id,row]));
const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const person=value=>String(value?.id||value||'').match(/^(?:https?:\/\/data\.europarl\.europa\.eu\/)?person\/([1-9]\d*)$/)?.[1]||null;
const parent=value=>String(value?.id||value||'').match(/^(?:https?:\/\/data\.europarl\.europa\.eu\/)?eli\/dl\/event\/(MTG-PL-\d{4}-\d{2}-\d{2}-PVCRE-ITM-\d+(?:-\d+)*)$/)?.[1]||null;
export function verifiedIntervention(activity) {
  const row=records.get(activity?.activity_id);
  if(!row||!["eli/dl/event/"+row.id,"https://data.europarl.europa.eu/eli/dl/event/"+row.id].includes(activity.id)||
    activity.activity_date!==row.id.slice(7,17)||!String(activity.had_activity_type||'').endsWith('/PLENARY_DEBATE_SPEECH')||
    activity.activity_start_date!==row.start||activity.activity_end_date!==row.end)return null;
  const participants=[...new Set(array(activity.had_participation).flatMap(p=>array(p.had_participant_person)).map(person))];
  const parents=[...new Set(array(activity.inverse_consists_of).map(parent))];
  if(participants.length!==1||participants[0]!==row.personId||parents.length!==1||parents[0]!==row.parentId)return null;
  return {type:row.type,sources:structuredClone(row.sources)};
}
