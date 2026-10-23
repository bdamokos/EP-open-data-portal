import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {freshLoader} from './test-support/viteRunner.mjs';

test('proposal notes render positioned equations while retaining note anchors, linked text and ordinary notes',async t=>{
  const loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>loadModule.close());
  const {ProposalNotes}=await loadModule('/src/ProposalNotes.tsx');
  const {DocumentNotes,ReferenceText,ReferenceScope}=await loadModule('/src/References.tsx');
  const text='Before \uFFFC linked source after.',url='https://example.org/source';
  const object={kind:'math',status:'converted',complete:true,offset:7,replacement:'\uFFFC',sourceUrl:'https://publications.europa.eu/resource/cellar/example',
    math:{tag:'math',children:[{tag:'msub',children:[{tag:'mi',children:['E']},{tag:'mi',children:['j']}]}]}};
  const note={id:'1',label:'1',text,links:[url],linkSpans:[{start:9,end:22,url}],objects:[object],complete:true};
  const render=(component,notes=[note])=>renderToStaticMarkup(createElement(ReferenceScope,{texts:[],language:'en',notes,notePrefix:'proposal'},
    createElement(ReferenceText,{text:'Provision.',anchors:[{paragraph:0,offset:10,note:'1',label:'1'}],notePrefix:'proposal'}),
    createElement(component,{notes,prefix:'proposal'})));
  const html=render(ProposalNotes);
  assert(html.includes('href="#proposal-note-1"'));assert(html.includes('id="proposal-note-1"'));
  assert(html.includes('Before <math>'));assert(html.includes('<msub><mi>E</mi><mi>j</mi></msub>'));
  assert(html.includes('href="https://example.org/source"'));assert(html.includes('linked source'));assert(html.includes(' after.'));assert(!html.includes('\uFFFC'));
  const unsupported=render(ProposalNotes,[{...note,complete:false,objects:[{...object,complete:false,status:'unresolved',math:null}]}]);
  assert(unsupported.includes('Equation unavailable'));assert(unsupported.includes('View official document'));assert(!unsupported.includes('<math>'));assert(!unsupported.includes('\uFFFC'));
  const plain={id:'1',label:'1',text:'Ordinary note https://example.org/source',links:[url],objects:[],complete:true};
  assert.equal(render(ProposalNotes,[plain]),render(DocumentNotes,[plain]));
  assert(render(DocumentNotes).includes('\uFFFC'));assert(!render(DocumentNotes).includes('<math>'));
  const crossing={...note,linkSpans:[{start:0,end:text.length,url}]};const cross=render(ProposalNotes,[crossing]);
  assert(cross.includes('Before '));assert(cross.includes('linked source after.'));assert.equal((cross.match(/href="https:\/\/example.org\/source"/g)??[]).length,3);
  const equationOnly=render(ProposalNotes,[{...note,linkSpans:[{start:7,end:8,url}]}]);
  assert.match(equationOnly,/<a [^>]*href="https:\/\/example.org\/source"[^>]*><span[^>]*><math>/);
  const adjacent=render(ProposalNotes,[{...note,linkSpans:[{start:0,end:7,url},{start:7,end:8,url:'https://example.org/equation'},{start:8,end:text.length,url}]}]);
  assert(adjacent.includes('href="https://example.org/equation"'));assert.equal((adjacent.match(/href="https:\/\/example.org\/source"/g)??[]).length,2);
  const linkedUnsupported=render(ProposalNotes,[{...note,complete:false,linkSpans:[{start:7,end:8,url}],objects:[{...object,complete:false,status:'unresolved',math:null}]}]);
  assert(linkedUnsupported.includes('href="https://example.org/source"'));assert(linkedUnsupported.includes('View official document'));
  assert(!/<a\b[^>]*>(?:(?!<\/a>).)*<a\b/s.test(linkedUnsupported));
  const unsafe=render(ProposalNotes,[{...note,linkSpans:[{start:7,end:8,url}],objects:[{...object,math:{tag:'script',children:[]}}]}]);
  assert(unsafe.includes('Equation unavailable'));assert(!/<a\b[^>]*>(?:(?!<\/a>).)*<a\b/s.test(unsafe));
  const linkedSymbol=render(ProposalNotes,[{...note,text:'Before • after.',linkSpans:[{start:7,end:8,url}],objects:[{...object,kind:'symbol',status:'mapped',replacement:'•',math:null}]}]);
  assert.match(linkedSymbol,/<a [^>]*href="https:\/\/example.org\/source"[^>]*><span[^>]*>•<\/span><\/a>/);
  const symbol=render(ProposalNotes,[{...note,text:'Before • after.',links:[],linkSpans:[],objects:[{...object,kind:'symbol',status:'mapped',replacement:'•',math:null}]}]);assert(symbol.includes('Before • after.'));assert(!symbol.includes('Equation unavailable'));
  const invalid=render(ProposalNotes,[{...note,objects:[{...object,offset:-1},{...object,offset:999}]}]);assert(!invalid.includes('<math>'));assert(invalid.includes('\uFFFC'));
});
