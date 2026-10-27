import assert from 'node:assert/strict';
import {act} from 'react';

export const closedGlobalSearch='global-fts-search=first&global-fts-text-lang=fr&global-fts-closed=1';

// Return to an older closed query while the tab remembers a newer one, then
// navigate through the real reader. Each entry must retain its own search.
export async function checkClosedGlobalSearchHistory(t,h,navigate,blockedStorage=false) {
  const control=label=>h.container.querySelector(`[aria-label="${label}"]`);
  if(blockedStorage)for(const method of ['getItem','setItem','removeItem'])t.mock.method(h.window.sessionStorage,method,()=>{throw Error('Storage blocked');});
  const initialLength=h.window.history.length;
  await h.click(control('Search Parliament'));
  await act(async()=>{
    const input=h.container.querySelector('.explorer-search-panel input');assert(input);
    Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype,'value').set.call(input,'second');
    input.dispatchEvent(new h.window.InputEvent('input',{bubbles:true,inputType:'insertText',data:'second'}));
  });
  await h.click(control('Run text search'));
  await h.click(control('Close search'));
  assert.equal(h.window.history.length,initialLength+3,'reopen, submit and close are separate gestures');
  await h.go(-3);
  assert.equal(h.container.querySelector('.explorer-search-panel'),null);
  assert.equal(new URLSearchParams(h.window.location.search).has('global-fts-search'),false);
  await navigate();
  assert.equal(h.window.history.length,initialLength+1,'reader navigation replaces the forward branch with one entry');
  await h.click(control('Search Parliament'));
  assert.equal(h.container.querySelector('.explorer-search-panel input').value,'first','reader navigation retains the restored entry, independently of tab storage');
  assert.equal(new URLSearchParams(h.window.location.search).get('global-fts-text-lang'),'fr');
}
