import {languagePreference} from './language-order.mjs';
import {speechWebsite} from './ep-links.mjs';

export const SOURCE_LANGUAGES='bg es cs da de et el en fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv'.split(' ');
const languages=new Set(SOURCE_LANGUAGES);
const documentId=/^(?:[EPOAB]-\d+-\d{4}-\d+(?:-ASW)?|(?:RC|TA)-\d+-\d{4}-\d+|[A-Z]{3,5}-(?:AD|AL|AM|PA|PR)-\d+(?:-\d+)*)$/;
const familyId={procedures:/^\d{4}-\d{4}[A-Z]?$/,meps:/^[1-9]\d{0,8}$/,speeches:/^MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]{1,80}$/,events:/^[A-Z0-9-]{1,150}$/,meetings:/^MTG-PL-\d{4}-\d{2}-\d{2}$/,
  'plenary-documents':/^(?:A|B|RC)-\d+-\d{4}-\d+$/,'parliamentary-questions':/^[EPO]-\d+-\d{4}-\d+(?:-ASW)?$/,'committee-documents':/^[A-Z]{3,5}-(?:AD|AL|AM|PA|PR)-\d+(?:-\d+)*$/,'adopted-texts':/^TA-\d+-\d{4}-\d+$/};
const filters=new Set(['format','language','language-filter','search-language','title','include-output','parliamentary-term','person-id','sitting-date','sitting-date-end','activity-type','sort-by','limit','offset','mandate-date','year','vote-method']);

// This is a record reader, not an arbitrary URL proxy. Preserve the original
// query for provenance; the server separately bounds collection reads.
export function sourceTarget(value) {
  if(typeof value!=='string'||value.length>3000)return null;
  let url;try{url=new URL(value);}catch{return null;}
  if(url.protocol!=='https:'||url.hostname!=='data.europarl.europa.eu'||url.port||url.username||url.password||url.hash||/[\\%]|\/\.\.?(?:\/|$)/.test(value.split(/[?#]/)[0]))return null;
  const originalUrl=value,persistent=url.pathname.match(/^\/(?:eli\/dl\/(proc|doc|event)\/([A-Z0-9a-z-]+)|person\/([1-9]\d{0,8}))(?:\.rdf)?$/);
  if(persistent){
    const [,kind,id,person]=persistent;
    const family=person?'meps':kind==='proc'?'procedures':kind==='event'?id.includes('-OTH-')?'speeches':'events':Object.keys(familyId).find(family=>family.endsWith('documents')||family==='parliamentary-questions'||family==='adopted-texts'?familyId[family].test(id):false);
    if(!family)return null;
    url.pathname='/api/v2/'+family+'/'+(person||id);
  }
  const parts=url.pathname.match(/^\/api\/v2\/([a-z-]+)(?:\/([A-Za-z0-9-]+))?(?:\/(foreseen-activities|activities|vote-results|decisions))?$/);
  if(!parts||!Object.hasOwn(familyId,parts[1]))return null;
  const [,family,id,relation]=parts;
  if(id&&!(family==='meps'&&id==='show-current')&&!familyId[family].test(id))return null;
  if(relation&&(family!=='meetings'||!id))return null;
  if(!id&&!['speeches','meetings','meps'].includes(family))return null;
  for(const [key,val] of url.searchParams){
    if(!filters.has(key)||url.searchParams.getAll(key).length!==1||val.length>300||/[\x00-\x1f]/.test(val))return null;
    if(key==='format'&&!['application/ld+json','application/rdf+xml','text/turtle'].includes(val))return null;
    if(['language-filter','search-language'].includes(key)&&!languages.has(val))return null;
    if(key==='title'&&!val.trim())return null;
    if(['limit','offset'].includes(key)&&(!/^(0|[1-9]\d{0,5})$/.test(val)||key==='limit'&&Number(val)<1||key==='offset'&&Number(val)>10000))return null;
  }
  return {url:originalUrl,endpoint:url.pathname.slice('/api/v2'.length),family,id:id||null,collection:!id||id==='show-current'||Boolean(relation),params:Object.fromEntries(url.searchParams)};
}

function documentWebsite(id,language) {
  return documentId.test(id)?`https://www.europarl.europa.eu/doceo/document/${id}_${language.toUpperCase()}.html`:null;
}
function procedureWebsite(id,reference,language) {
  const match=String(reference||'').match(/^(\d{4})\/(\d{4}[A-Z]?)\(([A-Z]{2,8})\)$/);
  return match&&match[1]+'-'+match[2]===id?'https://oeil.europarl.europa.eu/oeil/'+(language==='fr'?'fr':'en')+'/procedure-file?'+new URLSearchParams({reference}):null;
}
export function humanSourceUrl(value,{language='en',reference,record}={}) {
  language=languages.has(language)?language:'en';
  let url;try{url=new URL(value);}catch{return null;}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port)return null;
  // EuroVoc's persistent URI returns XML; EU Vocabularies is its exact concept page.
  const eurovoc=url.hostname==='eurovoc.europa.eu'&&url.pathname.match(/^\/([1-9]\d{0,7})$/);
  const authority=url.hostname==='publications.europa.eu'&&url.pathname.match(/^\/resource\/authority\/eurovoc\/([1-9]\d{0,7})$/);
  if((eurovoc||authority)&&!url.search&&!url.hash)return 'https://op.europa.eu/en/web/eu-vocabularies/concept/-/resource?'+new URLSearchParams({uri:'http://eurovoc.europa.eu/'+(eurovoc||authority)[1]});
  const target=sourceTarget(value);
  if(target){
    if(target.collection)return null; // A website listing cannot stand in for an exact filtered result or dated roster.
    const {family,id}=target;
    if(languages.has(target.params.language))language=target.params.language;
    if(family==='procedures'){
      const type=String(record?.process_type||'').split('/').at(-1);
      const supplied=reference||record?.label||(/^[A-Z]{2,8}$/.test(type)?id.replace('-','/')+'('+type+')':null);
      return procedureWebsite(id,supplied,language);
    }
    if(family==='meps')return 'https://www.europarl.europa.eu/meps/'+language+'/'+id;
    if(['plenary-documents','parliamentary-questions','committee-documents','adopted-texts'].includes(family))return documentWebsite(id,language);
    if(family==='speeches'&&record){
      const doc=(Array.isArray(record.recorded_in_a_realization_of)?record.recorded_in_a_realization_of:[]).find(doc=>doc&&typeof doc==='object');
      return doc?speechWebsite(doc).websiteUrl:null;
    }
    return null;
  }
  if(url.hostname==='data.europarl.europa.eu'&&!url.search&&!url.hash){
    const person=url.pathname.match(/^\/person\/([1-9]\d{0,8})$/);if(person)return 'https://www.europarl.europa.eu/meps/'+language+'/'+person[1];
    const doc=url.pathname.match(/^\/eli\/dl\/doc\/([A-Z0-9-]+)$/);if(doc)return documentWebsite(doc[1],language);
  }
  return null;
}

export function recordTitle(record,language='en') {
  const title=record.process_title||record.title_dcterms||record.activity_label;
  return [typeof title==='string'?title:title?.[languagePreference(Object.keys(title||{}).filter(code=>typeof title[code]==='string'&&title[code].trim()),language)[0]],record.label,record.identifier,record.activity_id,record.process_id,record.id].find(value=>typeof value==='string'&&value.trim())||'Source record';
}
export function recordMatches(target,record) {
  if(target.collection)return true;
  const canonical=String(record?.id||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
  const prefix=target.family==='procedures'?'eli/dl/proc/':target.family==='meps'?'person/':['speeches','events','meetings'].includes(target.family)?'eli/dl/event/':'eli/dl/doc/';
  return canonical===prefix+target.id;
}

export function sourceLanguages(value) {
  const found=new Set(),pending=[{value,depth:0}];
  while(pending.length){
    const {value,depth}=pending.pop();if(!value||typeof value!=='object'||depth>=7)continue;
    const entries=Object.entries(value);
    if(entries.length&&entries.every(([key,child])=>languages.has(key)&&typeof child==='string'))for(const [key] of entries)found.add(key);
    else for(const [,child] of entries)if(child&&typeof child==='object')pending.push({value:child,depth:depth+1});
  }
  return [...found].sort();
}
