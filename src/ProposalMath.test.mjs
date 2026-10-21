import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

test('MathML renderer creates allowlisted React elements, safe accent attributes and escaped text',async t=>{
  const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>vite.close());
  const {ProposalMath}=await vite.ssrLoadModule('/src/ProposalMath.tsx');
  const sourceUrl='https://publications.europa.eu/resource/cellar/example';
  const base={kind:'math',status:'converted',complete:true,sourceUrl};
  const render=object=>renderToStaticMarkup(createElement(ProposalMath,{object}));
  const html=render({...base,math:{tag:'math',children:[{tag:'mover',attributes:{accent:'true'},children:[{tag:'mi',children:['Q']},{tag:'mo',children:['\u0305']} ]},{tag:'mtext',children:['<script>alert(1)</script>']} ]}});
  assert(html.startsWith('<math>'));assert(html.includes('<mover accent="true">'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));
  for(const math of [{tag:'math',children:[{tag:'script',children:['alert(1)']}]},{tag:'math',children:[],attributes:{onload:'alert(1)'}},{tag:'math',children:[{tag:'mover',attributes:{href:'javascript:alert(1)'},children:[]}]}]) {
    const out=render({...base,math});assert(out.includes('Equation unavailable'));assert(!out.includes('<math>'));assert(out.includes('View official document'));
  }
  assert(!render({...base,complete:false,math:null,sourceUrl:'javascript:alert(1)'}).includes('<a'));
});
