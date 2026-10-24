import {readFileSync,readdirSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {extractAmendments} from '../../server/amendment-documents.mjs';
import {buildExamples} from './model.mjs';
import {renderPage} from './view.mjs';
import {contextualData,renderContext} from './context-view.mjs';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node prototypes/person-dossier/build.mjs INPUT_DIR OUTPUT_DIR');
const directory=resolve(input),destination=resolve(output);
if(destination.startsWith(resolve('.')+'/'))throw new Error('Keep generated observations and HTML outside the repository.');
const read=file=>JSON.parse(readFileSync(join(directory,file),'utf8'));
const files=readdirSync(directory);
const data=buildExamples({
  procedures:['2025-0176','2025-0407','2025-0233'].map(id=>read(id+'.json')),
  reports:files.filter(f=>/^A-\d+-\d+-\d+\.json$/.test(f)).map(read),
  results:files.filter(f=>/^MTG-.*-VOT-ITM-\d+\.json$/.test(f)).map(read),
  decisions:files.filter(f=>/^MTG-.*-DEC-\d+\.json$/.test(f)).map(read),
  catalogues:files.filter(f=>/^speeches-.*\.json$/.test(f)).map(read),
  speechDetails:files.filter(f=>/^MTG-.*-OTH-\d+\.json$/.test(f)).map(read),
  profiles:files.filter(f=>/^person-\d+\.json$/.test(f)).map(read),
  roster:read('roster-2026-09-11.json'),
  extractions:files.filter(f=>f.endsWith('.docx')).map(f=>{const meta=read(f+'.meta.json');return {meta,extraction:extractAmendments(readFileSync(join(directory,f)),{...meta,sourceUrl:meta.url})};}),
  examplePairs:[['2025-0176','257727'],['2025-0176','124984'],['2025-0407','125065'],['2025-0407','257073'],['2025-0233','256981'],['2025-0233','257073']],
});
mkdirSync(destination,{recursive:true});
writeFileSync(join(destination,'examples.json'),JSON.stringify(data,null,2));
const theme=readFileSync(new URL('../../src/theme.css',import.meta.url),'utf8');
const reference=renderPage(data,theme);
writeFileSync(join(destination,'reference.html'),reference);
const headerPath=join(directory,'header-legislation.html');
if(existsSync(headerPath)){
  const context=contextualData(data,{profiles:files.filter(f=>/^person-\d+\.json$/.test(f)).map(read),roster:read('roster-2026-09-11.json'),procedures:['2025-0176','2025-0407','2025-0233'].map(id=>read(id+'.json'))});
  writeFileSync(join(destination,'context-examples.json'),JSON.stringify(context,null,2));
  writeFileSync(join(destination,'index.html'),renderContext(context,{theme,header:readFileSync(headerPath,'utf8'),headerCss:readFileSync(new URL('../../src/ParliamentHeader.css',import.meta.url),'utf8')}));
}else writeFileSync(join(destination,'index.html'),reference);
console.log(JSON.stringify({output:join(destination,'index.html'),coverage:data.dossiers.map(d=>({reference:d.reference,...d.coverage})),examples:data.examples.map(e=>({id:e.id,name:e.person.name,events:e.events.map(x=>[x.kind,x.title])}))},null,2));
