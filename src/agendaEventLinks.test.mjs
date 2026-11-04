import {automaticRecovery,installRetryClock,exhaustAutomaticRetries} from './test-support/automaticRecovery.mjs';
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
 const Component=(await load('/src/'+component+'.tsx'))[component],{createRoot}=await import('react-dom/client');const node=document.createElement('div');document.body.append(node);installRetryClock(t);root=createRoot(node);
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

for(const [status,terminal] of [[404,true],[503,false],[503,true]])test('agenda topic '+status+' '+(terminal?'settles without a retry control':'recovers automatically'),async t=>{
 let attempts=0,failed=true;const id=sitting+'-PVCRE-ITM-'+(status===404?'98':terminal?'100':'99');
 const node=await harness(t,'Legislation','?view=legislation&agenda-period=sitting:'+sitting+'&agenda-topic='+id,u=>{
  if(!u.pathname.endsWith('/insights/legislation'))return {ready:false};
  const base={sitting:{id:sitting,date,phase:'past'},sittings:[{id:sitting,date,phase:'past'}],topics,coverage:{agendaError:null},detail:null};
  if(u.searchParams.has('topic')){attempts++;if(failed)return Response.json({error:{code:status===404?'topic_not_found':'odp_unavailable'}},{status});return {...base,detail:{...topics[0],id,title:'Recovered exact debate',phase:'past',procedures:[],committeeWork:[],roles:[],speeches:[],people:[],stats:{denominator:0,dimensions:{country:[],group:[],gender:[],age:[]}},votes:[],selectedVote:null,voteCoverage:{truncated:false},coverage:{gaps:[],roleRowsTruncated:false,speechAssociations:{sources:[],truncated:false}}}};}
  return base;
 });
 const panel=node.querySelector('.insight-topic-detail');assert.equal(panel.querySelector('button'),null);
 if(status===404){assert.equal(panel.querySelector('h2 a').textContent,'Open original document ↗');assert.match(panel.querySelector('h2 a').href,/CRE-10-2026-10-07-ITM-\d{3}_EN.html$/);assert.equal(panel.querySelector('[role=alert]'),null);assert.equal(attempts,1);assert.equal(installRetryClock(t).timers.size,0);return;}
 assert.equal(panel.querySelector('h2').textContent,'Loading…');assert.equal(panel.querySelector('[role=alert]'),null);
 if(terminal){await exhaustAutomaticRetries(t);assert.equal(attempts,7);assert.equal(panel.querySelector('h2 a').textContent,'Open original document ↗');assert.match(panel.querySelector('h2 a').href,/CRE-10-2026-10-07-ITM-\d{3}_EN.html$/);assert.equal(panel.querySelector('[role=alert]'),null);assert.equal(installRetryClock(t).timers.size,0);}
 failed=false;const before=attempts;if(terminal)await act(async()=>window.dispatchEvent(new window.Event('online')));else await automaticRecovery(t);
 assert.equal(attempts,before+1);assert.equal(panel.querySelector('h2').textContent,'Recovered exact debate');assert.equal(panel.querySelector('[role=alert]'),null);assert.equal(panel.dataset.agendaTopic,id);
});

for(const index of [0,1,2,3])test('exact speech focus selects guest '+index+' with MEP rows present',async t=>{
 const id=sitting+'-PVCRE-ITM-'+(65+index),ids=[sitting+'-OTH-100',sitting+'-OTH-200',sitting+'-OTH-300',sitting+'-OTH-400'],names=['President','Felipe VI','Marcelo Rebelo de Sousa','President'];
 const node=await harness(t,'Legislation','?view=legislation&agenda-period=sitting:'+sitting+'&agenda-topic='+id+(index?'&agenda-speech='+(index===3?sitting+'-OTH-999':ids[index]):''),u=>{
  if(!u.pathname.endsWith('/insights/legislation'))return {ready:false};
  return {sitting:{id:sitting,date,phase:'past'},sittings:[{id:sitting,date,phase:'past'}],topics,coverage:{agendaError:null},detail:u.searchParams.has('topic')?{...topics[0],id,kind:'PLENARY_ACTIVITY',title:'Formal sitting',phase:'past',procedures:[],committeeWork:[],roles:[],speeches:ids.map((sourceId,i)=>({sourceId,date,title:'Speech',kind:'PLENARY_DEBATE_SPEECH',start:null,people:[{id:String(i),name:names[i],currentMep:i===0||i===3}]})),people:[],stats:{denominator:0,dimensions:{country:[],group:[],gender:[],age:[]}},votes:[],selectedVote:null,voteCoverage:{truncated:false},coverage:{gaps:[],roleRowsTruncated:false,speechAssociations:{sources:[],truncated:false}}}:null};
 });
 assert.match(node.querySelector('.insight-speech-position').textContent,new RegExp('Speech '+(index===3?1:index+1)+' of 4'));assert(node.querySelector('.insight-speech-position').textContent.includes(names[index===3?0:index]));assert(node.querySelector('.insight-eyebrow').textContent.includes('Special event'));if(index===1){const select=node.querySelector('.insight-agenda-select select');await act(async()=>{select.value=topics[1].id;select.dispatchEvent(new window.Event('change',{bubbles:true}));});assert.equal(new URL(location.href).searchParams.get('agenda-speech'),null);}
});

test('failed agenda navigation renders a single external fallback',async t=>{
 const day='MTG-PL-2026-10-08',id=day+'-PVCRE-ITM-180';const node=await harness(t,'Legislation','?view=legislation&agenda-period=sitting:'+day+'&agenda-topic='+id,()=>Response.json({error:{code:'unavailable'}},{status:503}));
 await exhaustAutomaticRetries(t);const links=node.querySelectorAll('a[href*="CRE-10-2026-10-08-ITM-180_EN.html"]');assert.equal(links.length,1);assert.equal(links[0].target,'_blank');assert.equal(links[0].rel,'noreferrer');
});
