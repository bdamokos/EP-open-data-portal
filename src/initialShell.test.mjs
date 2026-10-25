import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const script=await readFile(new URL('../public/assets/initial-shell.js',import.meta.url),'utf8');
function page(t,query='') {
  const window=new Window({url:'http://localhost/explorer/'+query,settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  t.after(()=>window.happyDOM.close());
  window.document.write(html);
  return window;
}

test('the initial document has a visible shell and native navigation without loading any scripts or styles',t=>{
  const {document}=page(t,'?view=questions');
  const root=document.getElementById('root'),shell=root.querySelector('main');
  assert.equal(shell.id,'initial-shell');
  assert.equal(shell.lang,'en');
  assert.equal(shell.hidden,false);
  assert.equal(shell.querySelector('h1').textContent,'European Parliament data explorer');
  assert.equal(shell.querySelector('[role="status"]').textContent,'Loading view…');
  assert.equal(shell.querySelector('section').getAttribute('aria-busy'),'true');
  const links=[...shell.querySelectorAll('nav a')];
  assert.deepEqual(links.map(link=>link.textContent),['Members','Plenary agenda','Questions','Outside voices','Group voices','Following']);
  for(const link of links)assert.equal(new URL(link.href).pathname,'/explorer/');
  assert(document.head.querySelector('style').textContent.includes('#initial-shell'));
  assert(document.head.querySelector('script[src="./assets/initial-shell.js"]').defer);
});

test('the small shell enhancement selects only supported headings and keeps the interface language in navigation',async t=>{
  for(const [query,title,view] of [
    ['?lang=hu&view=questions&q-search=climate','Questions','questions'],
    ['?view=groups','Group voices','groups'],
    ['?view=legislation&pl-mode=dossier','Dossiers','legislation'],
    ['?view=legislation&pl-mode=constructor','Plenary agenda','legislation'],
    ['?member=257043&module=votes','MEP 257043','members'],
    ['?view=amendments','Members of the European Parliament','members'],
    ['?view=constructor&member=%3Cscript%3E','Members of the European Parliament','members'],
  ])await t.test(query,t=>{
    const window=page(t,query);
    window.happyDOM.settings.disableJavaScriptEvaluation=false;
    window.eval(script);
    const shell=window.document.getElementById('initial-shell');
    assert.equal(shell.querySelector('h1').textContent,title);
    assert.equal(window.document.title,title+' — European Parliament data explorer');
    assert.equal(shell.querySelector('[aria-current="page"]').dataset.view,view);
    for(const link of shell.querySelectorAll('nav a')) {
      const url=new URL(link.href);
      assert.equal(url.pathname,'/explorer/');
      assert.equal(url.searchParams.get('lang'),new URLSearchParams(query).get('lang')||'en');
      assert.equal(url.searchParams.has('member'),false);
      assert.equal(url.searchParams.has('q-search'),false);
    }
    assert.equal(shell.lang,'en','the initial headings and controls are English');
    shell.remove();
    assert.doesNotThrow(()=>window.eval(script),'a late enhancement must not interfere with the mounted app');
  });
});
