import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {europeStoryIso3} from './storyEurope.mjs';
import {worldMap} from './worldMap.ts';

const server=JSON.parse(await readFile(new URL('../server/story-europe-countries.json',import.meta.url),'utf8'));

test('the map, the story and the server aggregation share one Europe list',async()=>{
 assert.deepEqual(europeStoryIso3,server.ids);
 const aggregate=await readFile(new URL('../server/story-facts-aggregate.mjs',import.meta.url),'utf8');
 assert.match(aggregate,/import europe from '\.\/story-europe-countries\.json'/);
});

test('the Europe list follows the documented rule for the map view, with Russia as a stated inclusion',()=>{
 // Bounding-box centre of the largest ring, or the point, inside the zoom viewport 428 12 236 140.
 const inside=c=>{let best=c.path?null:[0,c.x,c.y];for(const ring of (c.path||'').split('M').slice(1)){const xs=[],ys=[];for(const m of ring.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)){xs.push(+m[1]);ys.push(+m[2]);}const area=(Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys));if(!best||area>best[0])best=[area,(Math.max(...xs)+Math.min(...xs))/2,(Math.max(...ys)+Math.min(...ys))/2];}return best&&best[1]>=428&&best[1]<=664&&best[2]>=12&&best[2]<=152;};
 const expected=new Set([...worldMap.countries.filter(inside).map(c=>c.code==='KOS'?'1A0':c.code),...Object.keys(server.inclusions)]);
 assert.deepEqual([...expected].sort(),server.ids);
 assert(server.ids.includes('RUS')&&server.inclusions.RUS);
 for(const id of ['KAZ','GIB','MLT','ISL','TUR'])assert(server.ids.includes(id),id);
 for(const id of Object.keys(server.exclusions))assert(!server.ids.includes(id),id);
});
