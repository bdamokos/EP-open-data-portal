import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

test('shared trail link hides unsupported document links while keeping valid plenary and dossier entry points',async t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'location');
  Object.defineProperty(globalThis,'location',{value:{pathname:'/explore'},configurable:true,writable:true});
  let vite;
  t.after(async()=>{
    if(vite)await vite.close();
    original?Object.defineProperty(globalThis,'location',original):delete globalThis.location;
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {AmendmentTrailLink}=await vite.ssrLoadModule('/src/AmendmentTrailLink.tsx');
  for(const document of ['JURI-AL-788004','TA-10-2026-0254','P10_TA(2026)0254','A-9-2023-0001','B-11-2030-0001']){
    assert.equal(renderToStaticMarkup(createElement(AmendmentTrailLink,{document},'Unsupported document')),'',document);
  }
  const documents=['A-10-2026-0254','B-10-2026-0424','RC-10-2026-0441'];
  const html=renderToStaticMarkup(createElement(Fragment,null,
    ...documents.map(document=>createElement(AmendmentTrailLink,{key:document,document},document)),
    createElement(AmendmentTrailLink,{procedure:'2025/0407(COD)'},'Dossier amendments'),
  ));
  assert.equal((html.match(/class="poc-amendment-trail-link"/g)||[]).length,4);
  for(const document of documents)assert(html.includes('am-document='+document),document);
  assert(html.includes('am-procedure=2025%2F0407%28COD%29'));
  assert(html.includes('view=amendments'));
});
