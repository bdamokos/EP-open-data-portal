import {XMLParser, XMLValidator} from 'fast-xml-parser';
import {speechSpeakerDetails,speakerIsChair} from './speech-speakers.mjs';
import {speechAgendaMembership,speechParentEvidence} from './speech-agenda.mjs';
import {verifiedIntervention} from './speech-intervention-annotations.mjs';
import {languageCode} from './ep-links.mjs';

export const INTERVENTION_CLASSIFICATION_VERSION=2;

const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,trimValues:false});
const text=value=>typeof value==='string'?value:Array.isArray(value)?value.map(text).join(' '):value&&typeof value==='object'?Object.entries(value).filter(([key])=>!key.startsWith('@_')).map(([,v])=>text(v)).join(' '):'';
const normalize=value=>text(value).normalize('NFKC').toLowerCase().replace(/[\p{Pd}]/gu,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const speechId=value=>String(value?.id||value||'').match(/^(?:(?:https?:\/\/data\.europarl\.europa\.eu\/)?eli\/dl\/event\/)?(MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]+)$/)?.[1]||null;
export const speechPeople=activity=>[...new Set(array(activity.had_participation).flatMap(p=>array(p.had_participant_person)).map(p=>String(p?.id||p||'').match(/^(?:https?:\/\/data\.europarl\.europa\.eu\/)?person\/([1-9]\d*)$/)?.[1]).filter(Boolean))];
const groupLabels={PPE:'PPE',S_D:'S&D',PFE:'PfE',ECR:'ECR',RENEW:'Renew',VERTS_ALE:'Verts/ALE',THE_LEFT:'The Left',ESN:'ESN',NI:'NI'};
const chairLabels=new Set(['president','the president','le president','la presidente','presidente','el presidente','la presidenta','der prasident','die prasidentin','priekssedetajs','przewodniczacy','przewodniczaca','predsedajuci','predsedajuca','predsedajici','predsednik','predsednica','presedinte','προεδρος','elnok','pirmininkas','puhemies','talman','talmannen','voorzitter','o presidente','a presidente']);

// These complete labels were checked against the original-language headers.
// The element is a guard for an ambiguous translation, never evidence of a
// blue card on its own: an ordinary <question> is not a blue-card question.
const blueCardLabels=new Map([
  ['blue carton response',['answer','blue-card-answer']],
  ['reponse carton bleu',['answer','blue-card-answer']],
  ['réponse carton bleu',['answer','blue-card-answer']],
  ['responding to blue card questions',['speech','blue-card-reaction']],
  ['reaktion på blåt kort spørgsmål',['speech','blue-card-reaction']],
  ['blue card responding',['speech','blue-card-reaction']],
  ['kékkártyás viszontválasz',['speech','blue-card-reaction']],
  ['replica under the blue card procedure',['speech','blue-card-reaction']],
  ['replika pagal mėlynosios kortelės procedūrą',['speech','blue-card-reaction']],
  ['blue card issue',['question','blue-card-question']],
  ['sinise kaardi küsimus',['question','blue-card-question']],
]);
function blueCardType(process,statementKind,language='') {
  const label=normalize(process),known=blueCardLabels.get(label);
  if(known)return known[0]===statementKind?known[1]:'unclassified';
  if(label==='blue card response'&&statementKind==='speech'&&/-t-en-.*\bmtec\b/i.test(language))return 'blue-card-reaction';
  if(/blue card/.test(label))return /\b(?:reaction|counter ?reply)\b/.test(label)?'blue-card-reaction':/\b(?:answer|reply|response)\b/.test(label)?'blue-card-answer':/\bquestion\b/.test(label)?'blue-card-question':/\b(?:speech|intervention)\b/.test(label)?'blue-card-intervention':'blue-card';
  if(/blau(?:e|en) karte/.test(label))return /\b(?:antwort|erwiderung)\b/.test(label)?'blue-card-answer':/\breaktion\b/.test(label)?'blue-card-reaction':/\bfrage\b/.test(label)?'blue-card-question':'blue-card';
  return null;
}
function fragmentHeader(xml,people) {
  if(typeof xml!=='string'||Buffer.byteLength(xml)>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)return null;
  try {
    const root=parser.parse(xml);
    const [kind,statement]=Object.entries(root?.oralStatements||root?.writtenStatements||{}).flatMap(([k,nodes])=>array(nodes).map(node=>[k,node])).find(([,node])=>node?.from)||[];
    const from=statement?.from,speaker=array(from?.person).find(p=>people.includes(String(p?.['@_refersTo']||'').match(/^(?:epdata:)?person\/(\d+)$/)?.[1]));
    return speaker?{kind,from,speaker,language:String(statement['@_xml:lang']||from['@_xml:lang']||''),process:array(from.process).map(text).join(' ').trim()}:null;
  }catch{return null;}
}

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
    const blue=blueCardType(process,statementKind,String(statement['@_xml:lang']||from['@_xml:lang']||''));
    if(blue)type=blue;
    else if(/catch the eye/.test(normalized))type='catch-the-eye';
    else if(!from.organization&&!from.role&&!process&&speaker&&(speakerIsChair(text(speaker))||chairLabels.has(normalize(text(speaker).normalize('NFD').replace(/\p{M}/gu,'')))))type='chair';
    else type=process?'unclassified':'speech';
  }
  // Original headers can recover an absent English fragment and prevent an
  // ambiguous machine label from overriding conflicting original evidence.
  const originalLanguages=new Set(docs.flatMap(doc=>array(doc.originalLanguage||doc.originalLanguageURI)).map(languageCode).filter(Boolean));
  const originalTypes=new Set(kind==='PLENARY_DEBATE_SPEECH'?Object.entries(fragments).filter(([key])=>!originalLanguages.size||key==='mul'||originalLanguages.has(key)).map(([,xml])=>fragmentHeader(xml,people)).filter(header=>header&&header.language&&!header.language.includes('-t-')).map(header=>blueCardType(header.process,header.kind,header.language)).filter(value=>value&&!['unclassified','blue-card'].includes(value)):[]);
  if(originalTypes.size>1)type='unclassified';
  else if(originalTypes.size===1){const original=[...originalTypes][0];if(['unclassified','blue-card'].includes(type))type=original;else if(type.startsWith('blue-card')&&type!==original)type='unclassified';}
  const verified=type==='unclassified'&&originalTypes.size===0&&!(from&&speaker)?verifiedIntervention(activity):null;
  if(verified)type=verified.type;
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
    evidence:type==='unclassified'?null:verified?'verified-official-transcript':type==='procedure'?(chair?'api:xmlFragment/communication/heading/person':narrative?'api:xmlFragment/communication/narrative':'had_activity_type'):type==='written'?'had_activity_type':'api:xmlFragment/from',
    ...(verified?{classificationSources:verified.sources}:{})};
}

const docTail=value=>String(value||'').match(/^(?:https?:\/\/data\.europarl\.europa\.eu\/)?eli\/dl\/doc\/([A-Z0-9-]+)$/)?.[1]||null;
// The alias form of a chair change's own transcript fragment. Every document
// field must agree on one CRE-<term>-<date>-OTH-<k> fragment in this sitting.
const transcriptAliases=activity=>{
  const date=String(activity.activity_date||'');
  if(String(activity.had_activity_type).split('/').at(-1)!=='MEETING_NAME_CHAIR'||!activity.activity_id?.startsWith('MTG-PL-'+date+'-'))return [];
  // Every listed document, including bare URI references, must name the same fragment.
  const entries=array(activity.recorded_in_a_realization_of),docs=entries.filter(d=>d&&typeof d==='object');
  const identities=entries.map(d=>{
    if(!d||typeof d!=='object')return typeof d==='string'?docTail(d):null;
    // A present field that cannot be read is conflicting evidence, not absent evidence.
    const ids=[...(d.identifier==null?[]:[String(d.identifier)]),...(d.id==null?[]:[docTail(d.id)])];
    return ids.length&&ids.every(id=>id&&id===ids[0])?ids[0]:null;
  });
  if(!docs.length||identities.some(id=>id===null)||new Set(identities).size!==1)return [];
  const [,term,day,k]=identities[0].match(/^CRE-(\d+)-(\d{4}-\d{2}-\d{2})-OTH-(\d+)$/)||[];
  if(!k||day!==date)return [];
  for(const d of docs) {
    for(const part of array(d.is_part_of)) {
      const chapter=docTail(part?.id||part)?.match(/^CRE-(\d+)-(\d{4}-\d{2}-\d{2})-/);
      if(!chapter||chapter[1]!==term||chapter[2]!==date)return [];
    }
    if(d.notation_speechId!=null&&String(d.notation_speechId)!==k)return [];
  }
  const alias='MTG-PL-'+date+'-OTH-'+k;
  return alias===activity.activity_id?[]:[alias];
};

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
  // consists_of can also name a fetched row a second time by its own transcript
  // fragment (CRE-<term>-<date>-OTH-<k> as MTG-PL-<date>-OTH-<k>). That alias is
  // never served as an activity, so count the row once; other unserved IDs stay gaps.
  const served=new Set(activities.map(a=>a.activity_id));
  for(const {activity} of candidates)for(const alias of transcriptAliases(activity))if(!served.has(alias))expected.delete(alias);
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
