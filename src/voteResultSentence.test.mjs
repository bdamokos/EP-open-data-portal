import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {freshLoader} from './test-support/viteRunner.mjs';

let load;after(async()=>{if(load)await load.close();});
async function render(props) {
  load??=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {VoteResult}=await load('/src/VoteResult.tsx');
  return renderToStaticMarkup(createElement(VoteResult,{groups:[],rows:[],...props}));
}
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const outcome=html=>text(html.match(/<p class="vote-result-outcome[^>]*>.*?<\/p>/)[0]);
const totals={for:432,against:52,abstaining:88};

test('the result is one sentence when all three totals are published',async()=>{
  assert.equal(outcome(await render({outcome:'ADOPTED',kind:'text',aggregate:totals})),'Parliament adopted this text by 432 to 52, with 88 abstaining.');
  assert.equal(outcome(await render({outcome:'ADOPTED',kind:'amendment',aggregate:totals})),'Parliament adopted this amendment by 432 to 52, with 88 abstaining.');
  assert.equal(outcome(await render({outcome:'ADOPTED',kind:'part',aggregate:totals})),'Parliament adopted this part by 432 to 52, with 88 abstaining.');
  assert.equal(outcome(await render({outcome:'REJECTED',kind:'text',aggregate:{for:216,against:325,abstaining:34}})),'Parliament rejected this text by 325 to 216, with 34 abstaining.');
  assert.equal(outcome(await render({outcome:'LAPSED',kind:'text',aggregate:{for:1,against:0,abstaining:0}})),'This text lapsed, with 1 for, 0 against and 0 abstaining.');
  assert.match(await render({outcome:'ADOPTED',kind:'text',aggregate:totals}),/vote-result-totals/,'the three cards stay');
});
test('without all three published totals the outcome word and the method stay, and unknown is never a zero',async()=>{
  assert.equal(outcome(await render({outcome:'ADOPTED',method:'VOTE_HAND',aggregate:{for:null,against:null,abstaining:null}})),'Adopted · Show of hands');
  const partial=await render({outcome:'ADOPTED',kind:'text',aggregate:{for:556,against:null,abstaining:10}});
  assert.equal(outcome(partial),'Adopted');
  assert.match(text(partial),/Against —/);
});
