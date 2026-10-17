import {HttpError} from './http-utils.mjs';
import {odpLanguage} from './odp.mjs';
import {array,documentFiles} from './activity-index-model.mjs';
import {documentAuthorIdentities} from './document-authors.mjs';
import {amendmentOutcome,amendmentProposerDate,canonicalEPReference,resolvedAmendmentAuthorId} from './amendments.mjs';
import {amendmentAuthorMatch,amendmentGeneration,amendmentsPage} from './amendments-store.mjs';
import {motionReference} from './motion-outcomes.mjs';

const motionId=value=>/^(?:B|RC)-10-\d{4}-\d{4,6}$/.test(value || '');
const API='https://data.europarl.europa.eu/api/v2';
const RELATED_LIMIT=5;

export function motionAmendmentsQuery(document,params) {
  if(!motionId(document))throw new HttpError(400,'invalid_motion','Use an exact term-10 original or joint motion identifier.');
  const allowed=['member','scope','lang','offset','limit'];
  for(const key of params.keys())if(!allowed.includes(key)||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated motion amendment query parameter.');
  const member=params.get('member');
  if(member!==null&&(!/^[1-9]\d*$/.test(member)||!Number.isSafeInteger(Number(member))))throw new HttpError(400,'invalid_member','Use a positive MEP identifier.');
  const scope=params.get('scope') ?? 'all';
  if(!['all','member'].includes(scope)||scope==='member'&&!member)throw new HttpError(400,'invalid_scope','Choose all, or member with a selected MEP identifier.');
  const integer=(key,fallback,max,min=0)=>{
    const raw=params.get(key)??String(fallback),number=Number(raw);
    if(!/^(0|[1-9]\d*)$/.test(raw)||!Number.isSafeInteger(number)||number<min||number>max)throw new HttpError(400,'invalid_query',`Invalid ${key}.`);
    return number;
  };
  return {document,member,scope,language:odpLanguage(params.get('lang') || 'en'),limit:integer('limit',20,50,1),offset:integer('offset',0,1000000)};
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
function textMetadata(id,source,language,member) {
  const work=source?.work,sources=source?[metadataSource(id,source.fetchedAt)]:[];
  const titles=work?.title_dcterms || Object.assign({},...array(work?.is_realized_by).map(expression=>expression.title || {}));
  const titleLanguage=[language,'en',...Object.keys(titles)].find(code=>typeof titles[code]==='string'&&titles[code]);
  const files=work?documentFiles(work).filter(file=>['PDF','DOCX'].includes(file.format)):[];
  const availableLanguages=[...new Set(files.map(file=>file.language).filter(Boolean))].sort();
  const preferred=code=>files.find(file=>file.language===code&&file.format==='PDF') || files.find(file=>file.language===code);
  const preferredFile=preferred(language)||preferred('en')||files[0]||null;
  const authors=work?documentAuthorIdentities(work):[];
  const selected=authors.find(author=>String(author.id)===member);
  const observedAuthors=Boolean(work&&(work.creator!=null||work.workHadParticipation!=null));
  return {id,reference:motionReference(id),status:source?'indexed':'unavailable',kind:source?id.startsWith('RC-')?'joint':'original':null,
    title:titleLanguage?titles[titleLanguage]:id,titleLanguage:titleLanguage || null,date:work?.document_date || null,
    files,availableLanguages,preferredFile,languageFallback:preferredFile?.language?preferredFile.language!==language:null,
    authors,memberAuthorship:{memberId:member,status:!member?'not-requested':selected?'recorded':observedAuthors?'not-recorded':'unavailable',relationships:selected?.relationships || [],sources},
    sources,generation:source?.generation ?? null};
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
  const {document,member,scope,language,limit,offset}=query;
  const generation=amendmentGeneration(store);
  const generations=[...new Set([generation,store.get('active'),store.get('working')?.generation].filter(value=>value!=null))];
  const source=indexedMotion(store,document,generations);
  const text=textMetadata(document,source,language,member);
  const page=amendmentsPage(store,{document,member:scope==='member'?member:null,language,limit,offset});
  const other=member?amendmentsPage(store,{document,member:scope==='member'?null:member,language,limit:1,offset:0}):null;
  const allIndexed=scope==='member'?other.total:page.total,memberMatched=member?scope==='member'?page.total:other.total:null;
  const originalIds=source&&document.startsWith('RC-')?[...new Set(array(source.work.is_derivative_of).map(canonicalEPReference)
    .filter(ref=>/^eli\/dl\/doc\/B-10-\d{4}-\d{4,6}$/.test(ref || '')).map(ref=>ref.slice('eli/dl/doc/'.length)))]:[];
  const joints=source&&!document.startsWith('RC-')?store.relatedJointMotions(source.generation,document)
    .filter(candidate=>motionId(candidate.work.identifier)&&candidate.work.identifier.startsWith('RC-')&&checkedMotion(candidate,candidate.work.identifier)&&
      array(candidate.work.is_derivative_of).some(ref=>canonicalEPReference(ref)==='eli/dl/doc/'+document)):[];
  const relations={originalMotions:originalIds.slice(0,RELATED_LIMIT).map(id=>({...textMetadata(id,indexedMotion(store,id,generations),language,member),relationship:{type:'is_derivative_of',from:document,to:id,sources:text.sources}})),
    jointMotions:joints.slice(0,RELATED_LIMIT).map(candidate=>({...textMetadata(candidate.work.identifier,{...candidate,generation:source.generation},language,member),relationship:{type:'is_derivative_of',from:candidate.work.identifier,to:document,sources:[metadataSource(candidate.work.identifier,candidate.fetchedAt)]}})),
    complete:false,limit:RELATED_LIMIT};
  const indexed=page.coverage.indexed||allIndexed>0;
  const resultState=page.total>0?'records':!indexed?'not-indexed':scope==='member'&&allIndexed>0?'no-indexed-member-matches':page.coverage.observationComplete?'observed-empty':'unavailable';
  const {pending,...coverage}=page.coverage;
  return {schemaVersion:1,text,relations,scope:{documentId:document,memberId:member,results:scope,requestedLanguage:language},
    items:page.items.map(row=>contextualAmendment(row,member,language)),total:page.total,totals:{allIndexed,memberMatched},offset,limit,
    coverage:{...coverage,indexStatus:indexed?'indexed':'not-indexed',resultState,backgroundPending:pending,backgroundPendingScope:'index',targetProcessing:'unknown',observationScope:'indexed-plenary-amendment-sources',
      gaps:[...coverage.gaps,...(!source?['Verified motion metadata is not indexed for this text.']:[])]},
    snapshots:{amendments:generation,text:source?.generation ?? null}};
}
