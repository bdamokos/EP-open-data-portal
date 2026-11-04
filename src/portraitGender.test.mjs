import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {freshLoader} from './test-support/viteRunner.mjs';

test('portrait placeholders remain neutral for explicit other and unavailable gender',async t=>{
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 t.after(()=>load.close());const {Portrait}=await load('/src/components/Portrait.tsx');
 const member={id:42,firstName:'Example',lastName:'Member',sortName:'Member',countryCode:null,imageUrl:'/api/portrait/42'};
 const render=gender=>renderToStaticMarkup(createElement(Portrait,{member:{...member,gender},labelled:true}));
 const neutral=render(null);
 assert.match(neutral,/portrait__silhouette/);
 for(const gender of ['other','m','f'])assert.equal(render(gender),neutral);
});
