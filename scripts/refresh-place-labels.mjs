import {EU_PROTOCOL_ORDER} from '../server/language-order.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const file=new URL('../server/topic-country-labels.json',import.meta.url);
const held=JSON.parse(await readFile(file,'utf8'));
async function query(query){const url=new URL(held.sourceUrl);url.search=new URLSearchParams({query,format:'application/sparql-results+json'});const response=await fetch(url,{signal:AbortSignal.timeout(60_000)});if(!response.ok)throw Error(`Authority read failed: ${response.status}`);return (await response.json()).results.bindings;}
const versions=await query(`SELECT ?version WHERE { <${held.scheme}> <http://www.w3.org/2002/07/owl#versionInfo> ?version }`);
if(versions.length!==1)throw Error('Expected one authority version');
const version=versions[0].version.value;
if(version===held.version){console.log(`Country labels ${version} already held; no label download.`);}else{
 const labels={};
 for(const row of await query(held.query)){const id=row.c.value.split('/').at(-1),language=row.label['xml:lang'];if(!language)throw Error('Untagged authority label');if(!EU_PROTOCOL_ORDER.includes(language))continue;const names=labels[id]||={};if(names[language]&&names[language]!==row.label.value)throw Error('Conflicting preferred labels');names[language]=row.label.value;}
 if(Object.keys(held.labels).some(id=>!labels[id]))throw Error('Authority refresh omitted held places');
 await writeFile(file,JSON.stringify({...held,version,fetchedAt:new Date().toISOString(),labels},null,2)+'\n');
 console.log(`Updated country labels to ${version}; labels apply at read time; no projection rebuild required.`);
}
