import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {freshLoader} from './test-support/viteRunner.mjs';

test('date ranges omit missing dates and read an open end as ongoing only for current members',async t=>{
  const loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>loadModule.close());
  const {Period}=await loadModule('/src/Period.tsx');
  const text=(props,lang='en')=>{const node=Period({lang,date:value=>value,...props});return node===null?null:renderToStaticMarkup(createElement(Fragment,null,node)).replace(/<[^>]+>/g,'');};
  assert.equal(text({start:'2024-07-16',end:'2025-01-01',ongoing:true}),'2024-07-16 — 2025-01-01');
  assert.equal(text({start:'2024-07-16',end:null,ongoing:true}),'2024-07-16 — Present');
  assert.equal(text({start:'2024-07-16',end:null,ongoing:true},'hu'),'2024-07-16 — jelenleg');
  assert.equal(text({start:'2024-07-16',end:null,ongoing:false}),'From 2024-07-16','a former member’s open period is not presented as ongoing');
  assert.equal(text({start:null,end:'2025-01-01',ongoing:false}),'Until 2025-01-01');
  assert.equal(text({start:'2024-02-30',end:{raw:'unknown'},ongoing:false}),null,'invalid dates render nothing');
  assert.equal(text({start:null,end:null,ongoing:false}),null);
});
