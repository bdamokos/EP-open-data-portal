import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createElement,act} from 'react';
import {freshLoader} from './test-support/viteRunner.mjs';
let load;after(async()=>{if(load)await load.close();});
const sitting='MTG-PL-2026-10-07',date='2026-10-07',topic=n=>({id:sitting+'-OJ-ITM-'+n,sittingId:sitting,title:'Scheduled '+n,titleLanguage:'en',date,kind:n.startsWith('V')?'PLENARY_VOTE':'PLENARY_DEBATE',documentIds:[],procedureIds:[]});
const topics=[topic('D-1'),topic('D-2'),topic('V-94')];
async function harness(t,component,query,respond){
 const window=new Window({url:'http://localhost/'+query}),old=new Map();
 for(const [k,v]of Object.entries({window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,innerWidth:1280,requestAnimationFrame:fn=>{fn();return 0;},IS_REACT_ACT_ENVIRONMENT:true})){old.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});}
 window.HTMLElement.prototype.scrollIntoView=function(){};let root;
 t.after(async()=>{if(root)await act(async()=>root.unmount());await window.happyDOM.close();for(const[k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 t.mock.method(globalThis,'fetch',async input=>Response.json(respond(new URL(input,location.href))));
 if(!load)load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const Component=(await load('/src/'+component+'.tsx'))[component],{createRoot}=await import('react-dom/client');const node=document.createElement('div');document.body.append(node);root=createRoot(node);
 await act(async()=>root.render(createElement(Component,{language:'en',members:[],onBack(){}})));return node;
}
for(const mode of ['joint','topical','vote'])test('actual '+mode+' topic has a matching agenda selection and exact scheduled highlights',async t=>{
 const id=sitting+'-PVCRE-ITM-'+({joint:'4',topical:'5',vote:'9-6'}[mode]),scheduled=mode==='vote'?[topics[2].id]:mode==='joint'?topics.slice(0,2).map(r=>r.id):[];
 const node=await harness(t,'Legislation','?view=legislation&agenda-period=sitting:'+sitting+'&agenda-topic='+id,u=>{
  if(!u.pathname.endsWith('/insights/legislation'))return {ready:false};
  return {sitting:{id:sitting,date,phase:'past'},sittings:[{id:sitting,date,phase:'past'}],topics,coverage:{agendaError:null},detail:u.searchParams.has('topic')?{...(mode==='vote'?topics[2]:topics[0]),id:mode==='vote'?topics[2].id:id,title:'Actual '+mode+' debate',scheduledAgendaIds:mode==='vote'?undefined:scheduled,phase:'past',procedures:[],committeeWork:[],roles:[],speeches:[],people:[],stats:{denominator:0,dimensions:{country:[],group:[],gender:[],age:[]}},votes:[],selectedVote:null,voteCoverage:{truncated:false},coverage:{gaps:[],roleRowsTruncated:false,speechAssociations:{sources:[],truncated:false}}}:null};
 });
 const select=node.querySelector('.insight-agenda-select select');assert.equal(select.value,scheduled[0]||id);assert([...select.options].some(o=>o.value===select.value));
 const active=[...node.querySelectorAll('.insight-agenda button[aria-pressed=true]')];assert.equal(active.length,scheduled.length);assert.deepEqual(active.map(b=>b.textContent),topics.filter(r=>scheduled.includes(r.id)).map(r=>(r.kind==='PLENARY_VOTE'?'Vote':'Debate')+r.title));
});
test('OTH record headings and speech summaries link only to a supplied supported debate',async t=>{
 const oth='MTG-PL-2026-07-08-OTH-2017087113155',debate='MTG-PL-2026-07-08-PVCRE-ITM-9',groups=[{key:oth,kind:'debate',title:'Proceeding on Nigeria',speechCount:2},{key:oth+'1',kind:'record',title:'Related proceeding',speechCount:1,agendaId:debate},{key:'MTG-PL-2026-07-09-PVCRE-ITM-9-6',kind:'record',title:'Recorded vote',speechCount:0}].map(g=>({...g,date:'2026-07-08',items:[],speakers:[]}));
 const node=await harness(t,'Topics','?view=topics&place=NGA',u=>u.pathname==='/api/topics/detail'?{ready:true,concept:{key:'place:NGA',id:'NGA',iso3:'NGA',label:'Nigeria'},periods:['2026-Q3'],partial:{},series:[{period:'2026-Q3',question:0,document:0,speech:3,vote:0,debate:0,groups:3}],total:3,groupsTotal:3,groups,peaks:{question:[],document:[]},facets:{keywords:[],places:[],topics:[]},nextOffset:null}:{ready:false});
 const rows=node.querySelectorAll('.topic-record-group');assert.equal(rows.length,3);assert.equal(rows[0].querySelector('h3 a'),null);assert.equal(rows[0].querySelector('p a'),null);assert(!rows[0].querySelector('small').textContent.includes('Debate'));assert(rows[0].querySelector('small').textContent.includes('Record'));
 for(const a of rows[1].querySelectorAll('a'))assert.equal(new URL(a.href).searchParams.get('agenda-topic'),debate);
 assert.equal(new URL(rows[2].querySelector('h3 a').href).searchParams.get('agenda-topic'),groups[2].key);
 assert(![...node.querySelectorAll('a')].some(a=>new URL(a.href).searchParams.get('agenda-topic')===oth));
});
