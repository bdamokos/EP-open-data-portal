import {XMLParser, XMLValidator} from 'fast-xml-parser';
import {speechSpeakerDetails,speakerIsChair} from './speech-speakers.mjs';
import {speechAgendaMembership,speechParentEvidence} from './speech-agenda.mjs';

const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,trimValues:false});
const text=value=>typeof value==='string'?value:Array.isArray(value)?value.map(text).join(' '):value&&typeof value==='object'?Object.entries(value).filter(([key])=>!key.startsWith('@_')).map(([,v])=>text(v)).join(' '):'';
const normalize=value=>text(value).normalize('NFKC').toLowerCase().replace(/[\p{Pd}]/gu,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const speechId=value=>String(value?.id||value||'').match(/^(?:(?:https?:\/\/data\.europarl\.europa\.eu\/)?eli\/dl\/event\/)?(MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]+)$/)?.[1]||null;
export const speechPeople=activity=>[...new Set(array(activity.had_participation).flatMap(p=>array(p.had_participant_person)).map(p=>String(p?.id||p||'').match(/^(?:https?:\/\/data\.europarl\.europa\.eu\/)?person\/([1-9]\d*)$/)?.[1]).filter(Boolean))];
const groupLabels={PPE:'PPE',S_D:'S&D',PFE:'PfE',ECR:'ECR',RENEW:'Renew',VERTS_ALE:'Verts/ALE',THE_LEFT:'The Left',ESN:'ESN',NI:'NI'};
const chairLabels=new Set(['president','the president','le president','la presidente','presidente','el presidente','la presidenta','der prasident','die prasidentin','priekssedetajs','przewodniczacy','przewodniczaca','predsedajuci','predsedajuca','predsedajici','predsednik','predsednica','presedinte','προεδρος','elnok','pirmininkas','puhemies','talman','talmannen','voorzitter','o presidente','a presidente']);

export function interventionMetadata(activity) {
  const docs=array(activity.recorded_in_a_realization_of).filter(d=>d&&typeof d==='object');
  const fragments=Object.assign({},...docs.map(d=>d['api:xmlFragment']||{}));
  // Classification uses one supplied English fragment, including Parliament's translations.
  const xml=fragments.en;
  let root=null;
  if(typeof xml==='string'&&xml.length<=2*1024*1024&&!/<!DOCTYPE|<!ENTITY/i.test(xml)&&XMLValidator.validate(xml)===true) {
    try {root=parser.parse(xml);}catch{ /* Retain missing metadata as such. */ }
  }
  const [statementKind,statement]=Object.entries(root?.oralStatements||root?.writtenStatements||{}).flatMap(([kind,nodes])=>array(nodes).map(node=>[kind,node])).find(([,node])=>node?.from)||[];
  const from=statement?.from;
  const people=speechPeople(activity);
  const speaker=array(from?.person).find(p=>people.includes(String(p?.['@_refersTo']||'').match(/^(?:epdata:)?person\/(\d+)$/)?.[1]));
  const kind=String(activity.had_activity_type).split('/').at(-1);
  const communication=root?.communication;
  const chairPerson=kind==='MEETING_NAME_CHAIR'?array(communication?.heading).flatMap(heading=>array(heading?.person)).find(p=>people.includes(String(p?.['@_refersTo']||'').match(/^(?:epdata:)?person\/(\d+)$/)?.[1])):null;
  const chair=chairPerson?{id:String(chairPerson['@_refersTo']).split('/').at(-1),name:text(chairPerson).trim(),role:text(communication?.subheading).trim()||null}:null;
  const process=array(from?.process).map(text).join(' ').trim();
  // Chair identities are exposed only through the ID-checked structured field.
  const normalized=normalize(process),narrative=kind==='MEETING_NAME_CHAIR'?'':text(communication?.narrative).trim(),marker=normalize(narrative);
  const catchMarker=/^(?:end of )?(?:catch the eye(?: procedure)?|on demand interventions)$/.test(marker)?(marker.startsWith('end of ')?'end':'start'):null;
  const groupUris=[...new Set(array(activity.had_participation).flatMap(p=>array(p.participation_in_name_of)).map(v=>String(v?.id||v||'')).filter(v=>/^(?:https?:\/\/data\.europarl\.europa\.eu\/)?org\/[A-Z0-9_]+$/.test(v)))];
  const onBehalfOf=groupUris.map(uri=>{const id=uri.split('/').at(-1);return {id,uri,label:groupLabels[id]||id,politicalGroup:id!=='NI'&&Object.hasOwn(groupLabels,id),source:'participation_in_name_of'};});
  let type='unclassified';
  if(String(activity.had_activity_type).endsWith('/PLENARY_DEBATE_WRITTEN_STATEMENT'))type='written';
  else if(catchMarker||['PROCEEDING_ACTIVITY','MEETING_NAME_CHAIR'].includes(kind))type='procedure';
  else if(from&&speaker) {
    // Machine translation can collapse both Dutch answers and reactions to "Blue Card Response".
    // The published XML retains <answer> for answers and <speech> for these reactions.
    if(normalized==='blue card response'&&statementKind==='speech'&&/-t-en-.*\bmtec\b/i.test(String(statement['@_xml:lang']||from['@_xml:lang']||'')))type='blue-card-reaction';
    else if(/blue card/.test(normalized))type=/\b(?:reaction|counter ?reply)\b/.test(normalized)?'blue-card-reaction':/\b(?:answer|reply|response)\b/.test(normalized)?'blue-card-answer':/\bquestion\b/.test(normalized)?'blue-card-question':/\b(?:speech|intervention)\b/.test(normalized)?'blue-card-intervention':'blue-card';
    else if(/blau(?:e|en) karte/.test(normalized))type=/\b(?:antwort|erwiderung)\b/.test(normalized)?'blue-card-answer':/\breaktion\b/.test(normalized)?'blue-card-reaction':/\bfrage\b/.test(normalized)?'blue-card-question':'blue-card';
    else if(/catch the eye/.test(normalized))type='catch-the-eye';
    else if(!from.organization&&!from.role&&!process&&speaker&&(speakerIsChair(text(speaker))||chairLabels.has(normalize(text(speaker).normalize('NFD').replace(/\p{M}/gu,'')))))type='chair';
    else type=process?'unclassified':'speech';
  }
  const speakerDetail=speaker?speechSpeakerDetails(activity).find(person=>person.id===String(speaker['@_refersTo']).split('/').at(-1)):null;
  const reportedParents=[...new Set(array(activity.inverse_consists_of).map(speechId).filter(Boolean))];
  const documentEvidence=speechParentEvidence(activity);
  const term=Number(String(docs[0]?.identifier || docs[0]?.id || '').match(/CRE-(\d+)-/)?.[1]);
  const membership=kind==='PLENARY_DEBATE_SPEECH'?speechAgendaMembership({parentIds:reportedParents,...documentEvidence,date:activity.activity_date,term}):{parentIds:reportedParents};
  return {type,process:process||null,speaker: speaker?{id:String(speaker['@_refersTo']).split('/').at(-1),name:text(speaker).trim(),...speakerDetail,...(type==='chair'?{sittingRole:'chair'}:{})}:null,onBehalfOf,
    headerAvailable:Boolean(from&&speaker),catchMarker,narrative:narrative||null,
    procedureKind:type==='procedure'?(kind==='MEETING_NAME_CHAIR'?'chair-change':'note'):null,chair,
    numbering:docs.find(d=>Number.isSafeInteger(d.numbering))?.numbering??null,
    parentIds:membership.parentIds,...(membership.reportedParentIds?{reportedParentIds:membership.reportedParentIds}:{}),
    evidence:type==='unclassified'?null:type==='procedure'?(chair?'api:xmlFragment/communication/heading/person':narrative?'api:xmlFragment/communication/narrative':'had_activity_type'):type==='written'?'had_activity_type':'api:xmlFragment/from'};
}

// Exact debate membership and document numbering establish the sequence. Never bridge a missing row.
export function buildInterventionSequence(activities,{parentId,expectedIds=[]}={}) {
  const expected=new Set(array(expectedIds).map(speechId).filter(Boolean));
  const hasExpected=expected.size>0;
  const candidates=[...new Map(activities.filter(a=>expected.has(a.activity_id)).map(a=>[a.activity_id,a])).values()]
    .map(activity=>({activity,id:activity.activity_id,intervention:interventionMetadata(activity),exchangeId:null,replyTo:null}));
  // Event consists_of can repeat the same contradictory links as the speeches.
  // Only a fetched row with complete transcript evidence can leave the
  // expected set; unavailable rows and unrelated parent mismatches stay gaps.
  const reassignedIds=candidates.filter(row=>row.intervention.reportedParentIds?.includes(parentId)&&!row.intervention.parentIds.includes(parentId)).map(row=>row.id);
  for(const id of reassignedIds)expected.delete(id);
  const records=candidates.filter(row=>row.intervention.parentIds.includes(parentId));
  records.sort((a,b)=>(a.intervention.numbering??Infinity)-(b.intervention.numbering??Infinity)||a.id.localeCompare(b.id));
  const numbers=records.map(r=>r.intervention.numbering),complete=hasExpected&&records.length===expected.size&&numbers.every(Number.isSafeInteger)&&new Set(numbers).size===numbers.length;
  // Catch-the-eye is commonly a section, not an individual speech flag. Require both published boundaries.
  let opening=null;
  for(let i=0;i<records.length;i++) {
    const meta=records[i].intervention;
    if(meta.catchMarker==='start')opening=i;
    else if(meta.catchMarker==='end'&&opening!==null) {
      const section=records.slice(opening,i+1);
      if(section.every((r,index)=>Number.isSafeInteger(r.intervention.numbering)&&(!index||r.intervention.numbering===section[index-1].intervention.numbering+1)))for(let j=opening+1;j<i;j++)if(records[j].intervention.type==='speech')records[j].intervention={...records[j].intervention,type:'catch-the-eye',evidence:'between exact catch-the-eye section markers'};
      opening=null;
    }
  }
  const exchanges=[];
  if(numbers.every(Number.isSafeInteger)&&new Set(numbers).size===numbers.length) {
    let original=null,question=null,exchange=null;
    let previous=null;
    for(const record of records) {
      if(previous!==null&&record.intervention.numbering!==previous+1){original=null;question=null;exchange=null;}
      previous=record.intervention.numbering;
      const {type,speaker}=record.intervention;
      if(type==='chair')continue;
      if(type==='speech'||type==='catch-the-eye'){original=record;question=null;exchange=null;continue;}
      if(['blue-card-question','blue-card-intervention'].includes(type)&&original&&!question&&speaker&&speaker.id!==original.intervention.speaker?.id) {question=record;continue;}
      if(type==='blue-card-answer'&&original&&question&&speaker&&speaker.id===original.intervention.speaker?.id) {
        if(!exchange){exchange={id:original.id,originalId:original.id,ids:[original.id],pairs:[],basis:'debate order and exact speaker IDs'};exchanges.push(exchange);original.exchangeId=exchange.id;}
        question.replyTo=original.id;record.replyTo=question.id;
        for(const row of [question,record]){row.exchangeId=exchange.id;exchange.ids.push(row.id);}
        exchange.pairs.push({questionId:question.id,answerId:record.id,questionerId:question.intervention.speaker.id,respondentId:speaker.id});question=null;continue;
      }
      if(type==='blue-card-reaction'&&exchange&&speaker&&exchange.pairs.at(-1)&&[exchange.pairs.at(-1).questionerId,exchange.pairs.at(-1).respondentId].includes(speaker.id)) {
        record.replyTo=exchange.ids.at(-1);record.exchangeId=exchange.id;exchange.ids.push(record.id);continue;
      }
      original=null;question=null;exchange=null;
    }
  }
  return {records,exchanges,coverage:{complete,expected:expected.size,available:records.length,missingIds:[...expected].filter(id=>!records.some(r=>r.id===id)),reassignedIds}};
}
