import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {freshLoader} from './test-support/viteRunner.mjs';

test('shared trail link hides the unfinished catalogue from document and dossier readers',async t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{value:{location:{pathname:'/explore'}},configurable:true,writable:true});
  let loadModule;
  t.after(async()=>{
    original?Object.defineProperty(globalThis,'window',original):delete globalThis.window;
  });
  loadModule=await freshLoader(t,{configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {AmendmentTrailLink}=await loadModule('/src/AmendmentTrailLink.tsx');
  for(const document of ['JURI-AL-788004','TA-10-2026-0254','P10_TA(2026)0254','A-9-2023-0001','B-11-2030-0001']){
    assert.equal(renderToStaticMarkup(createElement(AmendmentTrailLink,{document},'Unsupported document')),'',document);
  }
  const documents=['A-10-2026-0254','B-10-2026-0424','RC-10-2026-0441'];
  const html=renderToStaticMarkup(createElement(Fragment,null,
    ...documents.map(document=>createElement(AmendmentTrailLink,{key:document,document},document)),
    createElement(AmendmentTrailLink,{procedure:'2025/0407(COD)'},'Dossier amendments'),
  ));
  assert.equal(html,'','supported documents and dossiers must not expose the unfinished catalogue');
});
