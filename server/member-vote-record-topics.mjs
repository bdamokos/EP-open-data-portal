import {readFileSync} from 'node:fs';
import {readableRecordTopicState} from './topic-projection-state.mjs';

// Exact identifiers only: a decision's result documents give EuroVoc concepts and
// place keys through the retained topic records, a concept gives its
// microthesaurus through the catalogue snapshot, and a place key is already an
// authority country. No title or text is read.
const read=name=>JSON.parse(readFileSync(new URL('./'+name,import.meta.url),'utf8'));
let concepts,labels,countries;
// Only each concept's microthesauri are used here. The full catalogue (6 MB of
// JSON, about 21 MiB once parsed) is dropped after this projection is built.
const conceptIndex=()=>concepts??=new Map(Object.entries(read('topic-eurovoc-metadata.json').concepts).map(([uri,concept])=>[uri,Array.isArray(concept?.microthesauri)?concept.microthesauri.map(String):[]]));
const labelIndex=()=>labels??=read('topic-eurovoc-labels.json').labels;
const countryIndex=()=>countries??=read('topic-country-labels.json').labels;
const microId=uri=>String(uri).replace(/^http:\/\/eurovoc\.europa\.eu\//,'');

export function topicsGeneration(store) {
  try{return readableRecordTopicState(store)?.generation??null;}catch{return null;}
}

// Tags for one decision from its result documents: microthesaurus IDs, country IDs
// and the procedures behind it (used to count distinct texts).
export function decisionTags(db,generation,documents) {
  const tags={p:new Set(),m:new Set(),c:new Set()};
  if(generation==null||!documents?.length)return {p:[],m:[],c:[]};
  let statement;
  try{statement=db.prepare("SELECT body FROM record_topic_records WHERE generation=? AND id=? AND kind='document'");}catch{return {p:[],m:[],c:[]};}
  for(const id of documents) {
    const row=statement.get(generation,id);if(!row)continue;
    let body;try{body=JSON.parse(row.body);}catch{continue;}
    for(const procedure of body.procedureIds||[])tags.p.add(String(procedure));
    for(const assignment of body.assignments||[]) {
      if(assignment.role==='keyword'&&assignment.key?.startsWith('eurovoc:'))
        for(const micro of conceptIndex().get('http://eurovoc.europa.eu/'+assignment.key.slice(8))||[])tags.m.add(microId(micro));
      else if(assignment.role==='place'&&assignment.key?.startsWith('place:'))tags.c.add(assignment.key.slice(6));
    }
  }
  const sorted=set=>[...set].sort();
  return {p:sorted(tags.p),m:sorted(tags.m),c:sorted(tags.c)};
}

const preferred=(names,language)=>{
  for(const code of [language,'en']) if(typeof names?.[code]==='string'&&names[code].trim())return {text:names[code],language:code};
  const first=Object.entries(names||{}).find(([,text])=>typeof text==='string'&&text.trim());
  return first?{text:first[1],language:first[0]}:null;
};
// Microthesaurus labels carry their notation ("2006 trade policy"); only the words are shown.
export function topicLabel(id,language='en') {
  const text=labelIndex()['http://eurovoc.europa.eu/'+id];
  return typeof text==='string'?{text:text.replace(/^\d{4}\s+/,''),language:'en'}:null;
}
export function countryLabel(id,language='en') {return preferred(countryIndex()[id],language);}
