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
 t.mock.method(globalThis,'fetch',async input=>{const result=respond(new URL(input,location.href));return result instanceof Response?result:Response.json(result);});
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
 const select=node.querySelector('.insight-agenda-select select');assert.equal(select.value,scheduled[0]||id);assert([...select.options].some(o=>o.value===select.value));for(const id of scheduled)assert([...select.options].some(o=>o.value===id),'every joint agenda item remains selectable');
 const active=[...node.querySelectorAll('.insight-agenda button[aria-pressed=true]')];assert.equal(active.length,scheduled.length);assert.deepEqual(active.map(b=>b.textContent),topics.filter(r=>scheduled.includes(r.id)).map(r=>(r.kind==='PLENARY_VOTE'?'Vote':'Debate')+r.title));
});
test('voting-time group links require a supplied exact scheduled vote target',async t=>{
 const scheduled='MTG-PL-2026-07-09-OJ-ITM-V-94',groups=[{key:'MTG-PL-2026-07-09-PVCRE-ITM-9-6',agendaId:scheduled,title:'Resolved vote'},{key:'MTG-PL-2026-07-09-PVCRE-ITM-9-7',title:'Unresolved vote'},{key:'MTG-PL-2026-07-09-PVCRE-ITM-9-8',title:'Legacy debate without a target',kind:'debate'}].map(g=>({kind:'record',...g,date:'2026-07-09',items:[{id:g.key,kind:'vote',title:g.title,members:[],date:'2026-07-09'}],speechCount:2,speakers:[]}));
 const node=await harness(t,'Topics','?view=geopolitics&place=NGA',u=>u.pathname==='/api/topics/detail'?{ready:true,concept:{key:'place:NGA',id:'NGA',iso3:'NGA',label:'Nigeria'},periods:['2026-Q3'],partial:{},series:[{period:'2026-Q3',question:0,document:0,speech:4,vote:2,debate:0,groups:2}],total:2,groupsTotal:2,groups,peaks:{question:[],document:[]},facets:{keywords:[],places:[],topics:[]},nextOffset:null}:{ready:false});
 const rows=node.querySelectorAll('.topic-record-group');assert.equal(rows.length,3);for(const a of rows[0].querySelectorAll('a'))assert.equal(new URL(a.href).searchParams.get('agenda-topic'),scheduled);assert.equal(rows[1].querySelectorAll('a').length,0);assert.equal(rows[2].querySelectorAll('a').length,0);assert(!rows[1].querySelector('small').textContent.includes('Debate'));
});

for(const status of [404,503])test('agenda topic '+status+' '+(status===404?'keeps the unavailable line without retry':'keeps a working transient retry'),async t=>{
 let attempts=0;
 const node=await harness(t,'Legislation','?view=legislation&agenda-period=sitting:'+sitting+'&agenda-topic='+sitting+'-PVCRE-ITM-99',u=>{
  if(!u.pathname.endsWith('/insights/legislation'))return {ready:false};
  if(u.searchParams.has('topic')){attempts++;return Response.json({error:{code:status===404?'topic_not_found':'odp_unavailable'}},{status});}
  return {sitting:{id:sitting,date,phase:'past'},sittings:[{id:sitting,date,phase:'past'}],topics,coverage:{agendaError:null},detail:null};
 });
 const panel=node.querySelector('.insight-topic-detail');assert.equal(panel.querySelector('h2').textContent,'Agenda item unavailable');
 const reload=[...panel.querySelectorAll('button')].find(b=>b.textContent==='Reload');
 if(status===404){assert(!reload);assert(!panel.querySelector('[role=alert]'));}else{assert(reload);const before=attempts;await act(async()=>reload.click());assert.equal(attempts,before+1);}
});
