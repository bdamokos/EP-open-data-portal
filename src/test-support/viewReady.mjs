import {act} from 'react';
import assert from 'node:assert/strict';

// SSR module transforms resolve independently of React's act queue. Wait only
// for a view's code to mount; request fixtures keep their own explicit gates.
export async function viewReady(container) {
  for(let attempt=0;attempt<200&&container.querySelector('[data-view-loading]');attempt++) {
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
  }
  assert.equal(container.querySelector('[data-view-loading]'),null,'View module did not settle');
}
