import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
test('profile service line distinguishes continuous service, returning members, future mandates and unavailable data',async t=>{
  const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>vite.close());
  const {ParliamentaryService}=await vite.ssrLoadModule('/src/ParliamentaryService.tsx');
  const render=service=>renderToStaticMarkup(createElement(ParliamentaryService,{profile:{parliamentaryService:service},lang:'hu',date:value=>value}));
  const continuous={day:'2026-10-19',currentSince:'2012-01-04',periods:[{start:'2012-01-04',end:null}],error:null};
  assert.match(render(continuous),/MEP since.*lang="hu">2012-01-04/);assert.doesNotMatch(render(continuous),/Previous service/);
  const returned={...continuous,currentSince:'2024-12-05',periods:[{start:'2019-07-02',end:'2024-07-15'},{start:'2024-12-05',end:null},{start:'2030-01-01',end:'2035-01-01'}]};
  const text=render(returned);assert.match(text,/MEP since.*2024-12-05/);assert.match(text,/Previous service:.*2019-07-02.*2024-07-15/);assert.doesNotMatch(text,/2030/);
  const former=render({day:'2026-10-23',currentSince:null,periods:[{start:'2009-07-14',end:'2014-06-30'},{start:'2019-07-02',end:'2024-07-15'}],error:null});
  assert.match(former,/Parliamentary service/);assert.match(former,/2009-07-14.*2014-06-30.*2019-07-02.*2024-07-15/);assert.doesNotMatch(former,/dates unavailable|MEP since/);
  assert.equal(render(undefined),'');assert.match(render({...continuous,currentSince:null,error:'Some dates are unavailable.'}),/Parliamentary service dates unavailable/);
});
