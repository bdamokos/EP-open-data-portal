import test from 'node:test';
import {API_VERSION} from '../server/api-version.mjs';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const id='E-10-2026-003031',url='https://www.europarl.europa.eu/doceo/document/'+id+'_EN.docx',link='https://eur-lex.europa.eu/eli/reg/2016/679/oj';
async function render(t,selectedText) {
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,requestAnimationFrame:callback=>setTimeout(callback,0),cancelAnimationFrame:clearTimeout,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async input=>{
    const request=new URL(input,window.location.href);assert.equal(request.searchParams.get('v'),String(API_VERSION));assert.equal(request.origin,'http://localhost');
    if(request.pathname==='/api/references')return Response.json({references:[]});
    assert.equal(request.pathname,'/api/document/'+id);
    return Response.json({id,titles:{en:'Question'},files:[],answers:[],selectedDocumentId:id,selectedText:{status:'available',textLanguage:'en',requestedLanguage:'en',availableTextLanguages:['en'],translationType:'original',sourceFormat:'DOCX',sourceUrl:url,notes:[],noteAnchors:[],documentLinks:[],...selectedText}});
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {InsightQuestionReader}=await vite.ssrLoadModule('/src/InsightReaders.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(InsightQuestionReader,{id,language:'en'})));
  await act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
  return container.querySelector('.insight-reader-text');
}

test('a hyperlink crossing a hanging label keeps both visible parts linked',async t=>{
  const paragraph='A.\tlinked body';
  const text=await render(t,{paragraphs:[paragraph],documentLinks:[{paragraph:0,start:0,end:paragraph.length,url:link}],formatStatus:'extracted',paragraphFormats:[{indent:2,hanging:2}],tables:[]});
  const p=text.querySelector('p.doc-hanging');assert(p);assert.equal(p.textContent,paragraph);
  const links=[...p.querySelectorAll('a')].filter(anchor=>anchor.href===link);
  assert.deepEqual(links.map(anchor=>anchor.textContent),['A.\t','linked body']);
  assert(p.querySelector('.doc-label a'),'the label part stays linked inside the hanging indent');
});

test('omitted grid columns keep later cells under their own columns',async t=>{
  const text=await render(t,{paragraphs:['A','B','C'],formatStatus:'extracted',paragraphFormats:[{},{},{}],tables:[{rows:[[{start:0,end:1},{start:1,end:2}],[{start:2,end:2,gap:true},{start:2,end:3}]],bordered:true}]});
  const rows=[...text.querySelectorAll('table tr')].map(row=>[...row.cells].map(cell=>[cell.textContent,cell.className]));
  assert.deepEqual(rows,[[['A',''],['B','']],[['','doc-table-gap'],['C','']]]);
});
