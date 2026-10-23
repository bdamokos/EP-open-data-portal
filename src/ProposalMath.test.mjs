import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {freshLoader} from './test-support/viteRunner.mjs';

test('MathML renderer creates allowlisted React elements, safe accent attributes and escaped text',async t=>{
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>load.close());
  const {ProposalMath}=await load('/src/ProposalMath.tsx');
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


test('MathML renderer accepts Core upright semantics and rejects malformed attributes and oversized trees',async t=>{
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>load.close());
  const {ProposalMath}=await load('/src/ProposalMath.tsx');
  const {MATHML_VARIANTS,isSafeMathML}=await import('../server/proposal-math.mjs');
  const render=math=>renderToStaticMarkup(createElement(ProposalMath,{object:{kind:'math',complete:true,status:'converted',math,sourceUrl:null}}));
  for(const variant of MATHML_VARIANTS){const tree={tag:'math',children:[{tag:'mi',attributes:{mathvariant:variant},children:['R']}]};assert(isSafeMathML(tree));assert(render(tree).includes(`mathvariant="${variant}"`));}
  for(const variant of ['bold','italic','bold-italic','script','bold-script','fraktur','bold-fraktur','double-struck','sans-serif','bold-sans-serif','sans-serif-italic','sans-serif-bold-italic','monospace']){const tree={tag:'math',children:[{tag:'mi',attributes:{mathvariant:variant},children:['R']}]};assert.equal(isSafeMathML(tree),false);assert(render(tree).includes('Equation unavailable'));}
  let deep={tag:'mi',children:['R']};for(let i=0;i<66;i++)deep={tag:'mrow',children:[deep]};
  for(const tree of [
    {tag:'math',children:[{tag:'mi',attributes:{mathvariant:'double-struck',onclick:'x'},children:['R']}]},
    {tag:'math',children:[{tag:'mi',attributes:{mathvariant:'" onload="x'},children:['R']}]},
    {tag:'math',attributes:{mathvariant:'double-struck'},children:['R']},
    {tag:'math',children:['x'.repeat(100001)]},{tag:'math',children:[deep]},
    {tag:'math',children:Array.from({length:20001},()=>({tag:'mi',children:['x']}))},
  ]){assert.equal(isSafeMathML(tree),false);const html=render(tree);assert(html.includes('Equation unavailable'));assert(!html.includes('<math>'));assert(!html.includes('onload='));}
});
