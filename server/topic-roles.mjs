import {countryIdentity} from './topic-country-identity.mjs';
import matches from './topic-country-matches.json' with {type:'json'};
import countries from './insights-country-labels.json' with {type:'json'};
export function countryMatches(rows){
 const forward=new Map(),reverse=new Map();
 for(const {concept,country} of rows){if(!forward.has(concept))forward.set(concept,new Set());forward.get(concept).add(country);if(!reverse.has(country))reverse.set(country,new Set());reverse.get(country).add(concept);}
 return new Map([...forward].filter(([,v])=>v.size===1).flatMap(([c,v])=>{const m=[...v][0];return reverse.get(m).size===1?[[c,m.split('/').at(-1)]]:[];}));
}
export const countryConcepts=new Set(matches.matches.map(r=>r.concept));
export const eurovocCountries=countryMatches([...countryMatches(matches.matches)].map(([concept,id])=>({concept,country:'http://publications.europa.eu/resource/authority/country/'+(countryIdentity(id)?.id||id)})));
export const countryLabels=new Map(countries.labels.map(c=>[c.id,c.label]));
export const assignmentRole=key=>key.startsWith('oeil:')?'topic':key.startsWith('place:')?'place':key.startsWith('subject-matter:')?'hidden':'keyword';
