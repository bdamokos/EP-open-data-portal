import authority from './topic-country-authority.json' with {type:'json'};
const data=new Map();
for(const row of authority.rows){const id=row.c.value.split('/').at(-1);if(!data.has(id))data.set(id,{id,deprecated:false,replacements:new Set(),iso3:new Set()});const c=data.get(id),p=row.p.value,o=row.o;
 if(p==='http://www.w3.org/2002/07/owl#deprecated'&&['1','true'].includes(o.value))c.deprecated=true;
 if(p==='http://purl.org/dc/terms/isReplacedBy'&&o.type==='uri'&&o.value.startsWith('http://publications.europa.eu/resource/authority/country/'))c.replacements.add(o.value.split('/').at(-1));
 if(p==='http://www.w3.org/2004/02/skos/core#notation'&&o.datatype==='http://publications.europa.eu/ontology/euvoc#ISO_3166_1_ALPHA_3')c.iso3.add(o.value);
}
export function countryIdentity(id){const seen=new Set();let current=id;while(data.get(current)?.deprecated){if(seen.has(current))return null;seen.add(current);const replacements=data.get(current).replacements;if(replacements.size!==1)return {id:current,iso3:null,deprecated:true};current=[...replacements][0];}const c=data.get(current);return {id:current,iso3:c?.iso3.size===1?[...c.iso3][0]:null};}
