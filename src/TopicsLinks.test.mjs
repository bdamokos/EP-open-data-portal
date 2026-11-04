import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {freshLoader} from './test-support/viteRunner.mjs';
let load;after(async()=>{if(load)await load.close();});
async function links(){if(!load)load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true}});return load('/src/TopicsLinks.ts');}
test('exact CRE fallback retains subitem numbering and requested supported language',async()=>{
 const {agendaSourcePage}=await links();assert.equal(agendaSourcePage('MTG-PL-2026-01-21-PVCRE-ITM-5-2','fr'),'https://www.europarl.europa.eu/doceo/document/CRE-10-2026-01-21-ITM-005-02_FR.html');assert.equal(agendaSourcePage('MTG-PL-2026-01-21-PVCRE-ITM-21','xx'),'https://www.europarl.europa.eu/doceo/document/CRE-10-2026-01-21-ITM-021_EN.html');
});
test('CRE fallback does not turn previous-term or unrelated event IDs into term-ten pages',async()=>{
 const {agendaSourcePage}=await links();for(const id of ['MTG-PL-2024-07-15-PVCRE-ITM-5','MTG-PL-2026-01-21-OTH-123','MTG-PL-2026-01-21-OJ-ITM-D-5','MTG-PL-2026-01-21-PVCRE-ITM-5/other'])assert.equal(agendaSourcePage(id,'en'),null);assert(agendaSourcePage('MTG-PL-2024-07-16-PVCRE-ITM-5','en'));
});
