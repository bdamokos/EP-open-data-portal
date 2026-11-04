import test from 'node:test';import assert from 'node:assert/strict';import {repeatedPageDecoration} from './council-draft-decoration.mjs';
const path=(x=1,marked=[])=>({operation:'constructPath',args:[20,[0,x,2,1,3,4],[x,2,3,4]],matrix:[1,0,0,1,0,0],marked});
test('decoration requires repetition on every page, matching operators, geometry and position',()=>{
 const same=repeatedPageDecoration([{page:1,paint:[path()]},{page:2,paint:[path()]}]);assert.equal(same.paths.length,1);assert.match(same.hash,/^[a-f0-9]{64}$/u);assert(same.pages.every(p=>!p.remaining.length));
 const tolerance=repeatedPageDecoration([{page:1,paint:[path()]},{page:2,paint:[path(1.0005)]}]);assert.equal(tolerance.paths.length,1);
 const changed=repeatedPageDecoration([{page:1,paint:[path()]},{page:2,paint:[path(1.01)]}]);assert(changed.pages.every(p=>p.remaining.length===1));
 const extra=repeatedPageDecoration([{page:1,paint:[path()]},{page:2,paint:[path(),path(8)]}]);assert.equal(extra.pages[0].remaining.length,0);assert.equal(extra.pages[1].remaining.length,1);
 const tagged=repeatedPageDecoration([{page:1,paint:[path(1,[['P',0]])]},{page:2,paint:[path(1,[['P',0]])]}]);assert.equal(tagged.paths.length,0);
 assert.equal(repeatedPageDecoration([{page:1,paint:[path()]}]).paths.length,0);
});
