import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export const canonical=v=>String(v?.id??v??'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
export function xmlDeclaration(work) {
  const expressions=(work.is_realized_by??[]).filter(e=>canonical(e.language).endsWith('/ENG'));
  const urls=[...new Set(expressions.flatMap(e=>e.is_embodied_by??[]).filter(m=>canonical(m.format).endsWith('/XML')).map(m=>new URL(m.is_exemplified_by,'https://data.europarl.europa.eu/').href))];
  return urls.length===1&&/^https:\/\/data\.europarl\.europa\.eu\/distribution\/doc\/TA-10-\d{4}-\d{4,6}_en\.xml$/.test(urls[0])?urls[0]:null;
}
// Explicit acquisition only; calibration never calls fetch. Exclusive creation
// prevents a later run from silently refreshing a sealed observation.
export async function acquireAdoptedSnapshot({directory,documents,years,fetcher=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms))}) {
  await mkdir(directory,{recursive:false});const inputs=[];let requests=0;
  async function get(url,file) {
    if(requests)await pause(2100);
    requests++;const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
    if(response.status===429){await pause(180000);throw new Error('HTTP 429; acquisition stopped after the required pause');}
    if(!response.ok)throw new Error('TA acquisition HTTP '+response.status);
    const body=Buffer.from(await response.arrayBuffer()),fetchedAt=new Date().toISOString();
    await writeFile(path.join(directory,file),body,{flag:'wx'});inputs.push({url,file,sha256:hash(body),bytes:body.length,fetchedAt,language:file.endsWith('.xml')?'en':null});return body;
  }
  const works=[];
  for(const year of [...new Set(years)].sort()) {
    const url=`https://data.europarl.europa.eu/api/v2/adopted-texts?year=${year}&format=application/ld+json&limit=500`;
    const listing=JSON.parse(await get(url,`listing-${year}.json`));
    if(!Array.isArray(listing.data)||listing.data.length>=500)throw new Error('Incomplete TA listing');
    works.push(...listing.data.filter(w=>(w.adopts??[]).some(id=>documents.includes(canonical(id).replace('eli/dl/doc/','')))));
  }
  for(const work of works) {
    const url=xmlDeclaration(work);if(!url)continue;
    await get(url,canonical(work.id).replace('eli/dl/doc/','')+'_en.xml');
  }
  const snapshot={schemaVersion:1,documents:[...documents].sort(),inputs,requests};snapshot.snapshotId=hash(JSON.stringify(snapshot));
  await writeFile(path.join(directory,'snapshot.json'),JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});return snapshot;
}
export async function loadAdoptedSnapshot(directory) {
  const snapshot=JSON.parse(await readFile(path.join(directory,'snapshot.json'))),{snapshotId,...sealed}=snapshot;
  if(snapshot.schemaVersion!==1||hash(JSON.stringify(sealed))!==snapshotId)throw new Error('TA manifest mismatch');
  const bodies=new Map();
  for(const input of snapshot.inputs) {
    if(path.basename(input.file)!==input.file)throw new Error('Invalid TA input path');
    const bytes=await readFile(path.join(directory,input.file));
    if(bytes.length!==input.bytes||hash(bytes)!==input.sha256)throw new Error('TA input hash mismatch: '+input.file);
    bodies.set(input.file,bytes);
  }
  return {snapshot,bodies,works:snapshot.inputs.filter(i=>i.file.startsWith('listing-')).flatMap(i=>JSON.parse(bodies.get(i.file)).data)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [report,directory]=process.argv.slice(2);if(!report||!directory)throw new Error('Usage: node scripts/amendment-adopted-snapshot.mjs BENCHMARK.json NEW_DIRECTORY');
  const b=JSON.parse(await readFile(report)),documents=[...new Set(b.rows.map(r=>r.documentId))];
  const snapshot=await acquireAdoptedSnapshot({directory,documents,years:documents.map(d=>d.split('-')[2])});
  process.stdout.write(JSON.stringify({snapshotId:snapshot.snapshotId,requests:snapshot.requests})+'\n');
}
