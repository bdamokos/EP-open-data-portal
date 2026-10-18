import {HttpError} from './http-utils.mjs';
import {odpLanguage} from './odp.mjs';
import {array,documentFiles} from './activity-index-model.mjs';
import {documentAuthorIdentities} from './document-authors.mjs';
import {amendmentOutcome,amendmentProposerDate,amendmentReference,canonicalEPReference,resolvedAmendmentAuthorId} from './amendments.mjs';
import {amendmentAuthorMatch,amendmentById,amendmentGeneration,amendmentsPage} from './amendments-store.mjs';
import {motionOutcome,motionReference,motionSourceKey} from './motion-outcomes.mjs';

const motionId=value=>/^(?:B|RC)-10-\d{4}-\d{4,6}$/.test(value || '');
const API='https://data.europarl.europa.eu/api/v2';
const RELATED_LIMIT=5;

export function motionAmendmentsQuery(document,params) {
  if(!motionId(document))throw new HttpError(400,'invalid_motion','Use an exact term-10 original or joint motion identifier.');
  const allowed=['member','scope','lang','offset','limit','amendment'];
  for(const key of params.keys())if(!allowed.includes(key)||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated motion amendment query parameter.');
  const member=params.get('member');
  if(member!==null&&(!/^[1-9]\d*$/.test(member)||!Number.isSafeInteger(Number(member))))throw new HttpError(400,'invalid_member','Use a positive MEP identifier.');
  const scope=params.get('scope') ?? 'all';
  if(!['all','member'].includes(scope)||scope==='member'&&!member)throw new HttpError(400,'invalid_scope','Choose all, or member with a selected MEP identifier.');
  const amendment=params.get('amendment');
  const selected=amendment&&amendmentReference('eli/dl/doc/'+amendment);
  if(amendment!==null&&(!selected||selected.targetDocumentId!==document))throw new HttpError(400,'invalid_amendment','Choose an exact amendment identifier for this motion.');
  const integer=(key,fallback,max,min=0)=>{
    const raw=params.get(key)??String(fallback),number=Number(raw);
    if(!/^(0|[1-9]\d*)$/.test(raw)||!Number.isSafeInteger(number)||number<min||number>max)throw new HttpError(400,'invalid_query',`Invalid ${key}.`);
    return number;
  };
  return {document,member,scope,amendment,language:odpLanguage(params.get('lang') || 'en'),limit:integer('limit',20,50,1),offset:integer('offset',0,1000000)};
}

function metadataSource(id,fetchedAt) {
  return {url:API+'/plenary-documents/'+id+'?format=application%2Fld%2Bjson',fetchedAt,language:null};
}
function checkedMotion(source,id) {
  const expected=id.startsWith('RC-')?'RESOLUTION_MOTION_JOINT':'RESOLUTION_MOTION';
  return source&&canonicalEPReference(source.work.id)==='eli/dl/doc/'+id&&source.work.identifier===id&&
    String(source.work.work_type?.id || source.work.work_type || '').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'')==='def/ep-document-types/'+expected?source:null;
}
function indexedMotion(store,id,generations) {
  for(const generation of generations) {
    const source=checkedMotion(store.source(generation,'/plenary-documents/'+id),id);
    if(source)return {...source,generation};
  }
  return null;
}
const stable=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):Array.isArray(item)&&item.every(value=>typeof value==='string')?[...new Set(item)].sort():item);
const bindingFields=['activity_date','decision_outcome','decision_method','inverse_consists_of','headingLabel','referenceText','activity_label','decided_on_a_realization_of'];
const countFields=['number_of_votes_favor','number_of_votes_against','number_of_votes_abstention'];
function checkedOutcomeSource(record,id) {
  if(!record)return null;
  const decisions=new Map(),results=new Map(),invalidDecisions=new Set(),invalidResults=new Set(),countEvidence=new Map();
  for(const result of record.work.results || []) {
    const key=canonicalEPReference(result.id);
    if(!key)continue;
    const signature=stable(Object.fromEntries(['activity_date','based_on_a_realization_of','executed','consists_of','sittingResultIds'].map(field=>[field,result[field]])));
    if(results.has(key)&&results.get(key).signature!==signature)invalidResults.add(key);
    results.set(key,{signature,result});
  }
  for(const decision of record.work.decisions || []) {
    const key=canonicalEPReference(decision.id);
    if(!key)continue;
    const previous=decisions.get(key);
    if(previous&&bindingFields.some(field=>stable(previous[field])!==stable(decision[field])))invalidDecisions.add(key);
    const direct=array(decision.decided_on_a_realization_of).map(canonicalEPReference).filter(ref=>/^eli\/dl\/doc\/(?:B|RC)-10-\d{4}-\d{4,6}$/.test(ref || ''));
    // A formal heading cannot override a contradictory exact subject URI.
    const subject=decision.referenceText?.en?.trim() || '';
    const whole=/^Motion for a resolution(?: \(as a whole\))?$/i.test(subject);
    const standalone=/^(?:RC-)?B10-\d{4,6}\/\d{4}$/.test(subject);
    const formal=[...(standalone?subject:[decision.headingLabel?.en,decision.activity_label?.en].join('\n')).matchAll(/\b(RC-)?B10-(\d{4,6})\/(\d{4})\b/g)]
      .map(([,joint,number,year])=>`${joint?'RC':'B'}-10-${year}-${number}`);
    if((whole||standalone)&&formal.includes(id)&&direct.length&&(!direct.includes('eli/dl/doc/'+id)||new Set(direct).size!==1))invalidDecisions.add(key);
    if((whole||standalone)&&formal.includes(id)&&array(decision.decided_on_a_realization_of).some(ref=>amendmentReference(ref)))invalidDecisions.add(key);
    // Missing counts cannot erase an earlier observation before a later
    // contradictory tally arrives for the same exact decision.
    const counts=countEvidence.get(key)||new Map();
    let countConflict=false;
    for(const field of countFields) {
      const value=decision[field]!=null?Number(decision[field]):null;
      if(value===null||!Number.isSafeInteger(value)||value<0)continue;
      if(counts.has(field)&&counts.get(field)!==value)countConflict=true;
      else counts.set(field,value);
    }
    countEvidence.set(key,counts);
    decisions.set(key,{...decision,...(countConflict||previous?._countsConflict?Object.fromEntries(countFields.map(field=>[field,null]).concat([['_countsConflict',true]])): {})});
  }
  return {...record,conflicting:invalidDecisions.size>0||invalidResults.size>0,
    countConflicts:[...decisions].filter(([,decision])=>decision._countsConflict).map(([key])=>key.split('/').at(-1)),
    work:{...record.work,results:[...results].filter(([key])=>!invalidResults.has(key)).map(([,value])=>value.result),
      decisions:[...decisions].filter(([key])=>!invalidDecisions.has(key)).map(([,{_countsConflict,...decision}])=>decision)}};
}
function indexedOutcome(store,source,id) {
  const unavailable=reason=>({status:'unavailable',reason,totalsStatus:'unavailable',evidenceGaps:[]});
  if(!source)return unavailable('motion-metadata-unavailable');
  let conflicting=false;const countConflicts=new Set();
  const outcome=motionOutcome(source.work,source.fetchedAt,sitting=>{
    const saved=store.source(source.generation,motionSourceKey(sitting));
    const checked=checkedOutcomeSource(saved,id);
    if(saved&&(!checked||checked.conflicting))conflicting=true;
    for(const decisionId of checked?.countConflicts || [])countConflicts.add(decisionId);
    return checked;
  });
  if(conflicting&&outcome.status==='unavailable')return {...unavailable('conflicting-indexed-source'),evidenceGaps:['Indexed observations disagree about the motion decision.']};
  const totalsConflicting=countConflicts.has(outcome.decisionId);
  return {...outcome,totalsStatus:totalsConflicting?'conflicting':!outcome.totals?'unavailable':Object.values(outcome.totals).every(value=>value!=null)?'available':'partial',
    evidenceGaps:totalsConflicting?['Indexed observations disagree about the vote totals; the announced outcome is retained.']:[]};
}
function textMetadata(store,id,source,language,member,{adopted=false}={}) {
  const work=source?.work,sources=source?[metadataSource(id,source.fetchedAt)]:[];
  const titles=work?.title_dcterms || Object.assign({},...array(work?.is_realized_by).map(expression=>expression.title || {}));
  const titleLanguage=[language,'en',...Object.keys(titles)].find(code=>typeof titles[code]==='string'&&titles[code]);
  const files=work?documentFiles(work).filter(file=>['PDF','DOCX'].includes(file.format)):[];
  const availableLanguages=[...new Set(files.map(file=>file.language).filter(Boolean))].sort();
  const preferred=code=>files.find(file=>file.language===code&&file.format==='PDF') || files.find(file=>file.language===code);
  const preferredFile=preferred(language)||preferred('en')||files[0]||null;
  const authors=work&&!adopted?documentAuthorIdentities(work):[];
  const selected=authors.find(author=>String(author.id)===member);
  const observedAuthors=Boolean(work&&!adopted&&(work.creator!=null||work.workHadParticipation!=null));
  return {id,reference:motionReference(id),status:source?'indexed':'unavailable',kind:source?adopted?'adopted':id.startsWith('RC-')?'joint':'original':null,
    title:titleLanguage?titles[titleLanguage]:id,titleLanguage:titleLanguage || null,date:work?.document_date || null,
    files,availableLanguages,preferredFile,languageFallback:preferredFile?.language?preferredFile.language!==language:null,
    authors,memberAuthorship:{memberId:member,status:!member?'not-requested':selected?'recorded':observedAuthors?'not-recorded':'unavailable',relationships:selected?.relationships || [],sources},
    outcome:adopted?{status:'unavailable',reason:'adopted-text-is-not-a-motion-decision',totalsStatus:'unavailable',evidenceGaps:[]}:indexedOutcome(store,source,id),
    memberPosition:{memberId:member,status:member?'unavailable':'not-requested',position:null,reason:member?'named-member-votes-not-in-motion-sources':null},
    sources,generation:source?.generation ?? null};
}

function indexedAdoptedTexts(store,source,document,language,member) {
  if(!source)return [];
  const reference='eli/dl/doc/'+document;
  const candidates=store.db.prepare(`SELECT key,body,fetched_at FROM sources AS source WHERE generation=? AND kind='document'
    AND key GLOB '/adopted-texts/TA-10-*' AND EXISTS(SELECT 1 FROM json_each(source.body,'$.adopts') AS adoption
      WHERE (CASE WHEN adoption.type='object' THEN json_extract(adoption.value,'$.id') ELSE adoption.value END) IN (?,?,?))
    ORDER BY key LIMIT ?`).all(source.generation,reference,'https://data.europarl.europa.eu/'+reference,'http://data.europarl.europa.eu/'+reference,RELATED_LIMIT+1);
  return candidates.flatMap(candidate=>{
    const work=JSON.parse(candidate.body),id=work.identifier;
    const type=String(work.work_type?.id || work.work_type || '').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
    if(!/^TA-10-\d{4}-\d{4,6}$/.test(id || '')||candidate.key!=='/adopted-texts/'+id||canonicalEPReference(work.id)!=='eli/dl/doc/'+id||type!=='def/ep-document-types/TEXT_ADOPTED'||!array(work.adopts).some(ref=>canonicalEPReference(ref)===reference))return [];
    const metadata={work,fetchedAt:candidate.fetched_at,generation:source.generation};
    const value=textMetadata(store,id,metadata,language,member,{adopted:true});
    value.sources=[{url:API+'/adopted-texts/'+id+'?format=application%2Fld%2Bjson',fetchedAt:candidate.fetched_at,language:null}];
    value.memberAuthorship.sources=value.sources;
    return [{...value,relationship:{type:'adopts',from:id,to:document,sources:value.sources}}];
  }).slice(0,RELATED_LIMIT);
}

function memberMatch(row,member) {
  if(!member)return {memberId:null,matched:false,aggregateMatched:false,basis:null,variantListIds:[],status:'not-requested'};
  const match=amendmentAuthorMatch(row,member);
  const known=value=>!value.conflicted&&Boolean(amendmentProposerDate(value))&&Boolean(value.authors?.length)&&value.authors.every(author=>resolvedAmendmentAuthorId(author));
  const observations=row.conflicted?row.variants || []:[row,...(row.variants || [])];
  return {...match,status:match.matched?'recorded':observations.length&&observations.every(known)?'not-recorded':'unavailable'};
}
function wording(row,language) {
  const status=value=>typeof value==='string'?'available':row.textIntegrity==='incomplete'||row.conflicted?'withheld':'unavailable';
  return {language:row.language || null,requestedLanguage:language,languageFallback:row.language?row.language!==language:null,
    originalStatus:status(row.originalText),proposedStatus:status(row.proposedText)};
}
const decisionScope=vote=>vote.componentBinding==='unresolved-collective'||vote.componentBinding==='unverified'?'unresolved-split':
  vote.partId||vote.partNumber!=null||(vote.componentReferences || []).length?'split-part':'whole-amendment';
function contextualAmendment(row,member,language) {
  const decisions=(row.decisions || []).map(vote=>({...vote,scope:decisionScope(vote)}));
  return {...row,memberMatch:memberMatch(row,member),wording:wording(row,language),decisions,
    wholeAmendmentOutcome:amendmentOutcome(decisions.filter(vote=>vote.scope==='whole-amendment')),
    splitParts:(row.splitParts || []).map(part=>({...part,wordingGrounding:'not-validated'})),
    ...(row.variants?{variants:row.variants.map(variant=>({...variant,memberMatch:memberMatch(variant,member),wording:wording(variant,language)}))}:{})};
}

/** Read the accepted index only. This route never retrieves a source or queues a job. */
export function motionAmendmentsPage(store,query) {
  if(store.db.isTransaction)return readMotionAmendmentsPage(store,query);
  // One index generation must cover the page, exact selection and related text.
  store.db.exec('BEGIN');
  try {
    const result=readMotionAmendmentsPage(store,query);
    store.db.exec('COMMIT');
    return result;
  } catch(error) {
    try {if(store.db.isTransaction)store.db.exec('ROLLBACK');}catch {/* Preserve the read's original failure. */}
    throw error;
  }
}
function readMotionAmendmentsPage(store,query) {
  const {document,member,scope,language,limit,offset,amendment=null}=query;
  const generation=amendmentGeneration(store);
  const generations=[...new Set([generation,store.get('active'),store.get('working')?.generation].filter(value=>value!=null))];
  const source=indexedMotion(store,document,generations);
  const text=textMetadata(store,document,source,language,member);
  const page=amendmentsPage(store,{document,member:scope==='member'?member:null,language,limit,offset});
  const other=member?amendmentsPage(store,{document,member:scope==='member'?null:member,language,limit:1,offset:0}):null;
  const allIndexed=scope==='member'?other.total:page.total,memberMatched=member?scope==='member'?page.total:other.total:null;
  const originalIds=source&&document.startsWith('RC-')?[...new Set(array(source.work.is_derivative_of).map(canonicalEPReference)
    .filter(ref=>/^eli\/dl\/doc\/B-10-\d{4}-\d{4,6}$/.test(ref || '')).map(ref=>ref.slice('eli/dl/doc/'.length)))]:[];
  const joints=source&&!document.startsWith('RC-')?store.relatedJointMotions(source.generation,document)
    .filter(candidate=>motionId(candidate.work.identifier)&&candidate.work.identifier.startsWith('RC-')&&checkedMotion(candidate,candidate.work.identifier)&&
      array(candidate.work.is_derivative_of).some(ref=>canonicalEPReference(ref)==='eli/dl/doc/'+document)):[];
  const adoptedTexts=indexedAdoptedTexts(store,source,document,language,member);
  const relations={originalMotions:originalIds.slice(0,RELATED_LIMIT).map(id=>({...textMetadata(store,id,indexedMotion(store,id,generations),language,member),relationship:{type:'is_derivative_of',from:document,to:id,sources:text.sources}})),
    jointMotions:joints.slice(0,RELATED_LIMIT).map(candidate=>({...textMetadata(store,candidate.work.identifier,{...candidate,generation:source.generation},language,member),relationship:{type:'is_derivative_of',from:candidate.work.identifier,to:document,sources:[metadataSource(candidate.work.identifier,candidate.fetchedAt)]}})),
    adoptedTexts,adoptedCoverage:{status:adoptedTexts.length?'indexed':'unavailable',complete:false,gaps:adoptedTexts.length?[]:['No verified adopted-text relationship is available in the index for this motion.']},
    complete:false,limit:RELATED_LIMIT};
  const indexed=page.coverage.indexed||allIndexed>0;
  const resultState=page.total>0?'records':!indexed?'not-indexed':scope==='member'&&allIndexed>0?'no-indexed-member-matches':page.coverage.observationComplete?'observed-empty':'unavailable';
  const {pending,...coverage}=page.coverage;
  const selectedRow=amendment?amendmentById(store,{document,id:amendment,language}):null;
  const selectedItem=selectedRow?contextualAmendment(selectedRow,member,language):null;
  const selection={requestedId:amendment,status:!amendment?'not-requested':selectedItem?'available':'unavailable',item:selectedItem,
    inRequestedScope:selectedItem?scope==='all'||selectedItem.memberMatch.matched:null,inPage:Boolean(selectedItem&&page.items.some(item=>item.id===selectedItem.id))};
  return {schemaVersion:1,text,relations,scope:{documentId:document,memberId:member,results:scope,requestedLanguage:language},selection,
    items:page.items.map(row=>contextualAmendment(row,member,language)),total:page.total,totals:{allIndexed,memberMatched},offset,limit,
    coverage:{...coverage,indexStatus:indexed?'indexed':'not-indexed',resultState,backgroundPending:pending,backgroundPendingScope:'index',targetProcessing:'unknown',
      gaps:[...coverage.gaps,...(!source?['Verified motion metadata is not indexed for this text.']:[])]},
    snapshots:{amendments:generation,text:source?.generation ?? null}};
}
