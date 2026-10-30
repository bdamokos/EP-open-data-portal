import {validDay} from './source-availability.mjs';
import {personId} from './insights-model.mjs';

const array=value=>Array.isArray(value)?value:value==null?[]:[value];
const relative=value=>{const ref=typeof value==='string'?value:value?.id;return typeof ref==='string'?ref.replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''):null;};
const childId=value=>relative(value)?.match(/^eli\/dl\/event\/(MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+)$/)?.[1]||null;
const activityType=value=>relative(value)?.match(/^def\/ep-activities\/([A-Z][A-Z0-9_]+)$/)?.[1]||null;
export const speechActivityType=kind=>['PLENARY_DEBATE_SPEECH','PLENARY_DEBATE_WRITTEN_STATEMENT'].includes(kind);

// Reconcile every node claiming either exact identity field. A contradictory
// graph node must not disappear before its other declarations are checked.
export function declaredSpeechEvidence({children,parentId,parentDate,nodes}) {
  const expected=new Set(children),observations=new Map(),speeches=new Map(),conflicted=new Set();
  for(const node of nodes) {
    if(!node||typeof node!=='object')continue;
    for(const id of new Set([childId(node.id),typeof node.activity_id==='string'?node.activity_id:null])) {
      if(expected.has(id))observations.set(id,[...(observations.get(id)||[]),node]);
    }
  }
  for(const [id,records] of observations) {
    const kinds=new Set(),dates=new Set(),people=new Set(),idDay=id.slice(7,17);let invalid=!validDay(idDay)||Boolean(parentDate&&idDay!==parentDate);
    for(const node of records) {
      if(childId(node.id)!==id||node.activity_id!==undefined&&node.activity_id!==id)invalid=true;
      if(node.had_activity_type!==undefined) {
        const values=array(node.had_activity_type);if(!values.length)invalid=true;
        for(const value of values){const kind=activityType(value);if(!kind)invalid=true;else kinds.add(kind);}
      }
      if(node.activity_date!==undefined){if(!validDay(node.activity_date)||node.activity_date!==idDay)invalid=true;else dates.add(node.activity_date);}
      if(node.inverse_consists_of!==undefined){const parents=array(node.inverse_consists_of);if(!parents.length||parents.some(value=>relative(value)!=='eli/dl/event/'+parentId))invalid=true;}
      for(const participation of array(node.had_participation))for(const value of array(participation?.had_participant_person)){const person=personId(value);if(person)people.add(person);}
    }
    if(dates.size>1||parentDate&&dates.size&&[...dates][0]!==parentDate||kinds.size>1)invalid=true;
    if(invalid){conflicted.add(id);continue;}
    const kind=[...kinds][0];
    if(speechActivityType(kind))speeches.set(id,{kind,people:[...people],date:[...dates][0]||null});
  }
  return {speeches,conflicted};
}
