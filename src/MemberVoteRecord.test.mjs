import {exhaustAutomaticRetries,installRetryClock} from './test-support/automaticRecovery.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {readFileSync} from 'node:fs';
import {freshLoader} from './test-support/viteRunner.mjs';

const MEMBER=197591,A='MTG-PL-2026-09-16',B='MTG-PL-2026-10-07';
const counts=(withGroup,against,abstained=0,notComparable=0)=>({with:withGroup,against,abstained,notComparable});
const departures=Array.from({length:6},(_,index)=>({
  decisionId:B+'-DEC-'+(10+index),sittingId:B,date:'2026-10-07',scope:index===0?'final':'all',wholeText:index===0,
  position:'against',line:'for',text:'Departure '+(index+1),language:'en',
}));
function response(patch={}) {
  return {
    version:5,
    member:{id:String(MEMBER),uri:'https://data.europarl.europa.eu/person/'+MEMBER},
    period:{from:'2024-07-16',to:'2026-10-07'},
    coverage:{sittings:2,included:2,missing:0,unprojectedDecisions:0,status:'complete'},
    group:{code:'S&D',status:'attached'},
    alignment:{all:counts(3,1,1,0),wholeText:counts(2,0,0,0)},
    ballots:{chaired:0},
    breakdown:null,
    departures:{scope:'all',tag:null,offset:0,limit:5,total:6,items:departures.slice(0,5),nextOffset:5},
    comparison:{all:{group:{median:0.625,members:2}},final:{group:{median:1,members:2}}},
    attribution:'European Parliament Open Data API v2, CC BY 4.0',
    ...patch,
  };
}

async function mount(t,{data=response(),status=200,memberId=MEMBER,scope='all',offset=0,tag=null,matches=false,failWhen=null,hold=null}={}) {
  const window=new Window({url:'http://localhost/?member='+MEMBER+'&module=votes'});
  window.matchMedia=query=>({matches:matches&&query.includes('max-width'),media:query,addEventListener(){},removeEventListener(){}});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let load,root;const calls=[],offsets=[],scopes=[];
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async url=>{
    calls.push(String(url));
    const url_=new URL(String(url),'http://localhost');
    if(status!==200)return new Response('',{status});
    if(failWhen?.(url_))return new Response('',{status:503});
    await hold?.(url_);
    return Response.json(typeof data==='function'?data(url_):data);
  });
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {MemberVoteRecord}=await load('/src/MemberVoteRecord.tsx');
  const {createRoot}=await import('react-dom/client');const container=window.document.createElement('div');window.document.body.append(container);installRetryClock(t);root=createRoot(container);
  const tags=[];
  const props={memberId,language:'en',scope,offset,tag,onTagChange:value=>tags.push(value),onScopeChange:value=>scopes.push(value),onOffset:value=>offsets.push(value)};
  await act(async()=>root.render(createElement(MemberVoteRecord,props)));
  return {container,calls,offsets,scopes,tags,window,
    async render(next){await act(async()=>root.render(createElement(MemberVoteRecord,{...props,...next})));},
    async remount(){await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(createElement(MemberVoteRecord,props)));}};
}
const button=(container,text)=>[...container.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
const links=container=>[...container.querySelectorAll('.mvr-rows .row a.t')];
const sentence=/against (their|the|own) group|rebel|defect|loyal|names on record|not put to a vote/i;

test('an active member record leads with the votes against the group and links its departures',async t=>{
  const view=await mount(t);
  const text=view.container.textContent;
  assert.match(text,/Voting record/);
  assert.match(text,/Current term · 16 Jul 2024 – 7 Oct 2026/);
  const figures=[...view.container.querySelectorAll('.mvr-figs dt')].map(item=>item.textContent);
  assert.deepEqual(figures,['Differs from group','With their group'],'the lead figure is the count that differs from the group');
  assert.match(view.container.querySelector('.mvr-figs').textContent,/Differs from group1With their group75%Group median 62.5%/);
  assert.equal(/ of \d| votes held|Recorded votes|Parliament median/.test(text.replace(/Show more|1–5 of 6/,'')),false,'no X of Y lines, recorded figure or Parliament median');
  assert.equal([...view.container.querySelectorAll('svg')].every(item=>item.closest('.sub')),true,'only the vote marks are drawn, each beside a word');
  assert.equal(text.includes('Partial'),false);
  assert.equal(sentence.test(text),false,'no banned wording');
  assert.equal(links(view.container).length,5,'the first page keeps five departures');
  assert.equal(links(view.container)[0].hasAttribute('lang'),false,'text in the interface language needs no language mark');
  assert.match(view.container.querySelector('.mvr-rows .sub').textContent,/7 Oct 2026 · Against · group For/);
});

test('scope and departure page actions report their own values',async t=>{
  const view=await mount(t);
  await act(async()=>button(view.container,'Final votes').click());
  assert.deepEqual(view.scopes,['final']);
  await act(async()=>button(view.container,'Show more').click());
  assert.deepEqual(view.offsets,[5]);
  await act(async()=>view.render({scope:'final',offset:5}));
  assert.equal(view.calls.at(-1).includes('scope=final'),true);
  assert.equal(view.calls.at(-1).includes('offset=5'),true);
});

test('final votes use whole-text counts and label their departures separately',async t=>{
  const view=await mount(t,{scope:'final',data:response({departures:{...response().departures,scope:'final',items:departures.slice(0,1),total:1,nextOffset:null}})});
  assert.match(view.container.querySelector('.mvr-figs').textContent,/Differs from group0With their group100%Group median 100%/);
  assert.equal(links(view.container).length,1);
  assert.equal(button(view.container,'Show more'),undefined);
});

test('a non-attached member sees one short label, never group figures',async t=>{
  const view=await mount(t,{data:response({group:{code:'NI',status:'non-attached'},alignment:null,comparison:null,departures:{...response().departures,total:0,items:[],nextOffset:null}})});
  assert.match(view.container.textContent,/Non-attached/);
  assert.equal(button(view.container,'Final votes'),undefined);
  assert.equal(view.container.textContent.includes('With their group'),false);
  assert.equal(view.container.querySelector('.mvr-figs'),null);
});

test('a chairing member gets a separate chaired count',async t=>{
  const view=await mount(t,{data:response({ballots:{chaired:2}})});
  assert.match(view.container.textContent,/Chaired: 2/);
});

test('a failed record read shows a few words and leaves the rest of the page to the Votes tab',async t=>{
  const view=await mount(t,{status:503});
  await exhaustAutomaticRetries(t);
  assert.equal(view.container.textContent.trim(),'Voting record unavailable.');
  assert.equal(view.container.querySelector('svg'),null);
});

test('a partial record states the missing sittings instead of zeroes',async t=>{
  const view=await mount(t,{data:response({coverage:{sittings:3,included:2,missing:1,unprojectedDecisions:0,status:'partial'}})});
  assert.match(view.container.textContent,/Partial · missing sittings: 1/);
  assert.equal(view.container.textContent.includes('missing votes'),false,'no zero for what is not missing');
});

test('a partial record states the votes it could not read',async t=>{
  const view=await mount(t,{data:response({coverage:{sittings:3,included:3,missing:0,unprojectedDecisions:31,status:'partial'}})});
  assert.match(view.container.textContent,/Partial · missing votes: 31/);
  assert.equal(view.container.textContent.includes('missing sittings'),false,'no zero for what is not missing');
});

test('a record missing both says both',async t=>{
  const view=await mount(t,{data:response({coverage:{sittings:3,included:2,missing:1,unprojectedDecisions:31,status:'partial'}})});
  assert.match(view.container.textContent,/Partial · missing sittings: 1, votes: 31/);
  assert.equal(view.container.textContent.match(/Partial/g).length,1,'one line, not two');
});

test('a chairing member with no comparable vote shows the chaired count and nothing to compare',async t=>{
  const view=await mount(t,{data:response({alignment:{all:counts(0,0,0,0),wholeText:counts(0,0,0,0)},comparison:null,ballots:{chaired:598},departures:{...response().departures,total:0,items:[],nextOffset:null}})});
  assert.match(view.container.textContent,/Chaired: 598/);
  assert.equal(view.container.textContent.includes('Differs from group'),false,'unknown is not shown as zero');
  assert.equal(view.container.textContent.includes('With their group'),false);
  assert.equal(view.container.textContent.includes('Group unavailable'),false);
  assert.equal(view.container.querySelector('.mvr-rows'),null);
  assert.equal(view.container.textContent.includes('Voted differently'),false);
});

test('departure wording in another language is marked, and language-neutral wording is not',async t=>{
  const items=[{...departures[1],text:'Après le considérant 27',language:'fr'},{...departures[2],text:'RC-B10-0371/2025 - § 2 - Am 3',language:'mul'}];
  const view=await mount(t,{data:response({departures:{scope:'all',tag:null,offset:0,limit:5,total:2,items,nextOffset:null}})});
  assert.equal(links(view.container)[0].getAttribute('lang'),'fr');
  assert.equal(links(view.container)[1].hasAttribute('lang'),false);
});

test('before the first projection the panel shows a short pending state without figures',async t=>{
  const pending=response({coverage:{sittings:3,included:0,missing:3,unprojectedDecisions:0,status:'partial'},alignment:{all:counts(0,0),wholeText:counts(0,0)},ballots:{chaired:0},departures:{scope:'all',tag:null,offset:0,limit:5,total:0,items:[],nextOffset:null},comparison:null});
  const view=await mount(t,{data:pending});
  assert.match(view.container.textContent,/Voting record not available yet\./);
  assert.equal(/Differs from group|0 of 0/.test(view.container.textContent),false);
});

const pagesOf=total=>url=>{
  const offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));
  const all=Array.from({length:total},(_,index)=>({...departures[0],decisionId:B+'-DEC-'+(100+index),scope:'all',wholeText:false,text:'Departure '+(index+1)}));
  const items=all.slice(offset,offset+limit),next=offset+items.length<total?offset+items.length:null;
  return response({departures:{scope:'all',tag:null,offset,limit,total,items,nextOffset:next}});
};

test('Show more appends the next page, and the offset in the URL restores every page shown',async t=>{
  const view=await mount(t,{data:pagesOf(12)});
  assert.equal(links(view.container).length,5);
  assert.match(view.container.textContent,/1–5 of 12/);
  await act(async()=>button(view.container,'Show more').click());
  assert.deepEqual(view.offsets,[5]);
  // The page that owns the URL offset renders every page up to it, in order.
  await view.render({offset:5});
  assert.deepEqual(links(view.container).map(link=>link.textContent),Array.from({length:10},(_,index)=>'Departure '+(index+1)));
  assert.match(view.container.textContent,/1–10 of 12/);
  assert.equal(view.calls.some(call=>call.includes('offset=5')),true);
  await view.render({offset:10});
  assert.equal(links(view.container).length,12);
  assert.equal(/ of 12/.test(view.container.textContent),false,'the range label goes when everything is shown');
  assert.equal(button(view.container,'Show more'),undefined);
  assert.equal(button(view.container,'Show first'),undefined);
});

test('a departure shows the result title with the vote label beneath, or the label alone without an exact link',async t=>{
  const items=[{...departures[1],text:'A10-1/2026 – Rapporteur – § 4 – Am 4',language:'en',subject:{text:'Energy efficiency of buildings',language:'en'}},{...departures[2],text:'B10-2/2026 – § 9',language:'en',subject:null}];
  const view=await mount(t,{data:response({departures:{scope:'all',tag:null,offset:0,limit:5,total:2,items,nextOffset:null}})});
  const rows=[...view.container.querySelectorAll('.mvr-rows .row')];
  assert.equal(rows[0].querySelector('a').textContent,'Energy efficiency of buildings');
  assert.equal(rows[0].querySelector('.blk').textContent,'A10-1/2026 – Rapporteur – § 4 – Am 4');
  assert.equal(rows[1].querySelector('a').textContent,'B10-2/2026 – § 9');
  assert.equal(rows[1].querySelector('.blk'),null);
});

test('the All/Final control is hidden when it would do nothing',async t=>{
  const view=await mount(t,{data:response({group:{code:'NI',status:'non-attached'},alignment:null,comparison:null})});
  assert.equal(button(view.container,'Final votes'),undefined);
});

test('the All/Final control stays for a member with a group line',async t=>{
  const view=await mount(t);
  assert.notEqual(button(view.container,'Final votes'),undefined);
});

test('on a phone the departures sit in a fold, closed by default',async t=>{
  const view=await mount(t,{matches:true});
  const details=[...view.container.querySelectorAll('details.frow')];
  assert.equal(details.length,1);
  assert.equal(details.every(item=>item.open===false),true);
  assert.equal(details[0].querySelector('summary .t').textContent,'Voted differently from their group');
  assert.equal(details[0].querySelector('summary .val').textContent,'6');
  assert.equal(view.container.querySelectorAll('.mvr-figs > div').length,2,'the figures stay in view');
});

test('on a wide screen the departures stay open under their heading',async t=>{
  const view=await mount(t);
  assert.equal(view.container.querySelector('details'),null);
  assert.equal(view.container.querySelector('.mvr-section h3').textContent,'Voted differently from their group');
  assert.equal(links(view.container).length,5);
});

const breakdownRow=(key,label,share,comparable,language='en')=>({key,label,language,comparable,withGroup:Math.round(share*comparable),share});
const breakdown=(topics,countries,eligible={topics:topics.length,countries:countries.length})=>({overall:0.9,topics:{eligible:eligible.topics,rows:topics},countries:{eligible:eligible.countries,rows:countries}});
const topicRows=[breakdownRow('topic:2006','trade policy',0.58,145),breakdownRow('topic:7211','regions of EU Member States',0.75,1234)];
const countryRows=[breakdownRow('country:MEX','Mexico',0.394,33),breakdownRow('country:CHN','China',0.883,162)];
const section=container=>container.querySelector('.mvr-breakdown');
const rowsOf=list=>[...list.querySelectorAll('li.row')];
const pick=row=>row.querySelector('button');

test('the breakdown sits between the figures and the departures with two lists of rows',async t=>{
  const view=await mount(t,{data:response({breakdown:breakdown(topicRows,countryRows)})});
  const root=view.container.querySelector('.mvr'),parts=[...root.children].map(item=>item.className||item.tagName.toLowerCase());
  const index=name=>parts.findIndex(item=>String(item).includes(name));
  assert.equal(index('mvr-figs')<index('mvr-breakdown')&&index('mvr-breakdown')<parts.length-1,true,parts.join(' | '));
  assert.equal(section(view.container).querySelector('h3').textContent,'Where they differ most from their group');
  const lists=[...section(view.container).querySelectorAll('.mvr-list')];
  assert.deepEqual(lists.map(list=>list.querySelector('h4').textContent),['By topic','By country discussed']);
  // The columns are named on the heading row, in the same grid as the rows.
  assert.deepEqual(lists.map(list=>[...list.querySelector('.heads').children].map(cell=>cell.textContent)),[['By topic','Differs','Votes'],['By country discussed','Differs','Votes']]);
  assert.deepEqual(rowsOf(lists[0]).map(row=>row.textContent),['Trade policy42%145','Regions of EU Member States25%1,234'],'EuroVoc labels are capitalised for display');
  assert.deepEqual(rowsOf(lists[1]).map(row=>row.textContent),['Mexico61%33','China12%162']);
  assert.equal(pick(rowsOf(lists[0])[0]).getAttribute('aria-label'),'Trade policy: differs 42%, 145 votes');
  assert.equal(section(view.container).querySelector('svg'),null,'no bars or charts');
});

test('a row shows the share of its votes that differ, from the counts, in its existing order',async t=>{
  const rows=[{key:'topic:100235',label:'personnel management',language:'en',comparable:101,withGroup:81,share:81/101},{key:'topic:100208',label:'family',language:'en',comparable:79,withGroup:64,share:64/79},{key:'topic:100189',label:'accounts',language:'en',comparable:200,withGroup:171,share:171/200}];
  const view=await mount(t,{data:response({breakdown:breakdown(rows,[])})});
  assert.deepEqual(rowsOf(section(view.container)).map(row=>row.textContent),['Personnel management20%101','Family19%79','Accounts15%200'],'29 of 200 is exactly 14.5%, no floating-point rounding down');
  assert.equal(section(view.container).textContent.includes('With group'),false);
});

test('every row has the same cells on the system row grid, in both lists',async t=>{
  const view=await mount(t,{data:response({breakdown:breakdown(topicRows,countryRows)})});
  for(const row of rowsOf(section(view.container)))
    assert.deepEqual([...row.children].map(cell=>cell.className),['main','n sh','n ct']);
  for(const list of view.container.querySelectorAll('.mvr-list'))
    assert.deepEqual([...list.querySelector('.heads').children].map(cell=>cell.className.replace(' hd','')),['main','n sh','n ct']);
  const css=readFileSync(new URL('./MemberVoteRecord.css',import.meta.url),'utf8');
  assert.match(css,/\.mvr-list \{ display:grid; grid-template-columns:minmax\(0,1fr\) repeat\(2,minmax\(var\(--num\),max-content\)\);/,'number columns start at the system width and grow to their head');
  assert.match(css,/\.mvr-list ul,\.vs\.mvr \.mvr-list \.heads,\.vs\.mvr \.mvr-list \.row \{ display:grid; grid-column:1 \/ -1; grid-template-columns:subgrid; \}/,'the heading row and every row share one template');
  assert.match(css,/button\.pick\[aria-pressed=true\] \{ font-weight:700; \}/,'the pressed row is bold, with no fill');
  assert.equal(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(css),false,'tokens only');
  assert.equal(/--[a-z-]+\s*:/.test(css),false,'no new tokens');
});

test('a row is a button that sets the exact tag, and the pressed row clears it',async t=>{
  const view=await mount(t,{data:response({breakdown:breakdown(topicRows,countryRows)})});
  await act(async()=>pick(rowsOf(section(view.container))[0]).click());
  assert.deepEqual(view.tags,['topic:2006']);
});

test('the pressed row clears its tag when pressed again',async t=>{
  const filtered=await mount(t,{tag:'country:MEX',data:response({breakdown:breakdown(topicRows,countryRows),departures:{...response().departures,tag:{key:'country:MEX',label:'Mexico',language:'en'}}})});
  const pressed=rowsOf(section(filtered.container)).filter(row=>pick(row).getAttribute('aria-pressed')==='true');
  assert.deepEqual(pressed.map(row=>row.textContent),['Mexico61%33']);
  await act(async()=>pick(pressed[0]).click());
  assert.deepEqual(filtered.tags,[null]);
});

test('a tag filters the departures with a way back, and the requests carry it',async t=>{
  const tagged=response({breakdown:breakdown(topicRows,countryRows),departures:{...response().departures,tag:{key:'topic:2006',label:'trade policy',language:'en'},total:12,items:departures.slice(0,5),nextOffset:5}});
  const view=await mount(t,{tag:'topic:2006',data:tagged});
  assert.equal(view.calls.every(call=>new URL(call,'http://localhost').searchParams.get('tag')==='topic:2006'),true);
  const line=view.container.querySelector('.mvr-filter');
  assert.equal(line.querySelector('span').textContent,'Votes on trade policy');
  await act(async()=>[...line.querySelectorAll('button')].find(item=>item.textContent==='Show all').click());
  assert.deepEqual(view.tags,[null]);
  assert.equal(links(view.container).length,5);
  assert.match(view.container.textContent,/1–5 of 12/,'pagination works on the filtered list');
  await act(async()=>button(view.container,'Show more').click());
  assert.deepEqual(view.offsets,[5]);
  await view.render({offset:5});
  assert.equal(view.calls.some(call=>call.includes('offset=5')&&call.includes('tag=topic%3A2006')),true);
});

test('without a tag there is no filter line',async t=>{
  const plain=await mount(t);
  assert.equal(plain.container.querySelector('.mvr-filter'),null);
});

test('only lists with rows are shown, a single list takes the width, and eligible rows with none below read as one line',async t=>{
  const one=await mount(t,{data:response({breakdown:breakdown([],countryRows,{topics:2,countries:2})})});
  assert.equal(one.container.querySelectorAll('.mvr-list').length,1);
  assert.equal(one.container.querySelector('.mvr-lists').className.includes('single'),true);
  assert.match(section(one.container).textContent,/By country discussed/);
  assert.equal(section(one.container).textContent.includes('By topic'),false);
});

test('eligible rows with none clearly below the overall share read as one short line',async t=>{
  const view=await mount(t,{data:response({breakdown:breakdown([],[],{topics:12,countries:3})})});
  assert.equal(view.container.querySelectorAll('.mvr-list').length,0);
  assert.match(section(view.container).textContent,/Votes with their group across all topics and countries with enough votes\./);
});

test('without eligible rows, or without a group line, there is no breakdown section and no zero in its place',async t=>{
  const none=await mount(t,{data:response({breakdown:null})});
  assert.equal(section(none.container),null);
  assert.equal(none.container.querySelector('.mvr-section h3')?.textContent,'Voted differently from their group');
});

test('a non-attached member has no breakdown section',async t=>{
  const view=await mount(t,{data:response({group:{code:'NI',status:'non-attached'},alignment:null,comparison:null,breakdown:null,departures:{...response().departures,total:0,items:[],nextOffset:null}})});
  assert.equal(section(view.container),null);
});

test('labels in another language than the interface carry their language',async t=>{
  const view=await mount(t,{data:response({breakdown:breakdown([breakdownRow('topic:2006','handelspolitik',0.5,40,'de'),breakdownRow('topic:7211','regions',0.5,40,'en')],[])})});
  const labels=[...section(view.container).querySelectorAll('button.pick')];
  assert.equal(labels[0].getAttribute('lang'),'de');assert.equal(labels[1].hasAttribute('lang'),false);
});

test('on a narrow screen a tag opens the departures so the way back to all is in view',async t=>{
  const tagged=response({departures:{...response().departures,tag:{key:'topic:2006',label:'trade policy',language:'en'}}});
  const view=await mount(t,{matches:true,tag:'topic:2006',data:tagged});
  assert.equal(view.container.querySelector('details.frow').open,true);
  assert.notEqual(view.container.querySelector('.mvr-filter'),null);
});

test('a former member keeps historical figures without a group median',async t=>{
  const view=await mount(t,{data:response({group:{code:null,status:'not-serving'},comparison:null})});
  assert.match(view.container.querySelector('.mvr-figs').textContent,/Differs from group1With their group75%$/);
  assert.equal(view.container.textContent.includes('Group median'),false);
  assert.equal(view.container.textContent.includes('Group unavailable'),false);
  assert.equal(links(view.container).length,5);
});

test('a current non-attached member shows no figures but keeps the votes that differed from an earlier group',async t=>{
  const view=await mount(t,{data:response({group:{code:'NI',status:'non-attached'},alignment:null,comparison:null,breakdown:null})});
  assert.match(view.container.textContent,/Non-attached/);
  assert.equal(view.container.querySelector('.mvr-figs'),null);
  assert.equal(button(view.container,'Final votes'),undefined);
  assert.equal(view.container.querySelector('.mvr-section h3').textContent,'Voted differently from their group');
  assert.equal(links(view.container).length,5);
  assert.equal(sentence.test(view.container.textContent),false);
});

test('an unknown member id answers with an unavailable group and nothing else',async t=>{
  const view=await mount(t,{data:response({group:{code:null,status:'unavailable'},alignment:null,comparison:null,breakdown:null,departures:{...response().departures,total:0,items:[],nextOffset:null}})});
  assert.match(view.container.textContent,/Group unavailable/);
  assert.equal(view.container.querySelector('.mvr-figs'),null);
  assert.equal(view.container.querySelector('.mvr-rows'),null);
});

test('a title opens the vote page in the page itself, and a modified click is left to the browser',async t=>{
  const view=await mount(t);
  assert.deepEqual(links(view.container).map(link=>link.getAttribute('href')),departures.slice(0,5).map(item=>'?view=legislation&pl-mode=vote&pl-vote='+item.decisionId+'&lang=en'));
  const click=init=>{const event=new view.window.MouseEvent('click',{bubbles:true,cancelable:true,button:0,...init});links(view.container)[0].dispatchEvent(event);return event.defaultPrevented;};
  const pushed=[];
  Object.defineProperty(globalThis,'history',{value:{state:null,pushState:(state,title,url)=>pushed.push({state,url:String(url)})},configurable:true});
  const nodeEvent=globalThis.Event;globalThis.Event=view.window.Event;
  t.after(()=>{delete globalThis.history;globalThis.Event=nodeEvent;});
  await act(async()=>{assert.equal(click({}),true);});
  assert.equal(new URL(pushed[0].url).searchParams.get('pl-vote'),B+'-DEC-10');
  assert.equal(new URL(pushed[0].state.dossierOrigin).searchParams.get('module'),'votes','Back returns to the record');
  await act(async()=>{assert.equal(click({ctrlKey:true}),false);});
  assert.equal(pushed.length,1);
});

test('a saved offset never mounts pages past the last one, and pages load one after the other',async t=>{
  const view=await mount(t,{offset:10000,data:pagesOf(6)});
  const offsets=view.calls.map(call=>Number(new URL(call,'http://localhost').searchParams.get('offset')));
  assert.deepEqual([...new Set(offsets)].sort((a,b)=>a-b),[0,5],'six departures need two pages, no more');
  assert.equal(links(view.container).length,6);
});

test('the record holds the journey back until its first read and every restored page are in',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const seen=[];
  const pending=view=>view.container.querySelector('[data-record-pending="true"]');
  const view=await mount(t,{offset:5,data:pagesOf(12),hold:url=>url.searchParams.get('offset')==='5'?gate:null});
  seen.push(Boolean(pending(view)),links(view.container).length);
  await act(async()=>{release();await gate;});
  seen.push(Boolean(pending(view)),links(view.container).length);
  assert.deepEqual(seen,[true,5,false,10]);
});

test('a page that fails ends the hold, so the journey back does not wait on it',async t=>{
  const view=await mount(t,{offset:5,data:pagesOf(6),failWhen:url=>url.searchParams.get('offset')==='5'});
  await exhaustAutomaticRetries(t);
  assert.equal(links(view.container).length,5);
  assert.equal(view.container.querySelector('[data-record-pending="true"]'),null);
});

test('a page that settles with an unusable body ends the hold too',async t=>{
  const pages=pagesOf(6);
  const view=await mount(t,{offset:5,data:url=>url.searchParams.get('offset')==='5'?response({version:0}):pages(url)});
  assert.equal(links(view.container).length,5);
  assert.equal(view.container.querySelector('[data-record-pending="true"]'),null);
});

test('a row with no comparable votes shows a dash, not a percentage',async t=>{
  const view=await mount(t,{data:response({breakdown:breakdown([{key:'topic:2006',label:'trade policy',language:'en',comparable:0,withGroup:0,share:0}],[])})});
  assert.deepEqual(rowsOf(section(view.container)).map(row=>row.textContent),['Trade policy–0']);
});

test('on a phone the opened list is still open on the way back from a vote page',async t=>{
  const view=await mount(t,{matches:true});
  const fold=()=>view.container.querySelector('details.frow');
  await act(async()=>{fold().open=true;fold().dispatchEvent(new view.window.Event('toggle'));});
  Object.defineProperty(globalThis,'history',{value:{state:null,pushState(){}},configurable:true});
  const nodeEvent=globalThis.Event;globalThis.Event=view.window.Event;
  t.after(()=>{delete globalThis.history;globalThis.Event=nodeEvent;});
  await act(async()=>links(view.container)[0].dispatchEvent(new view.window.MouseEvent('click',{bubbles:true,cancelable:true,button:0})));
  await view.remount();
  assert.equal(fold().open,true);
  assert.equal(links(view.container).length,5);
});

test('the first read holds the journey back as well',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const view=await mount(t,{hold:()=>gate});
  assert.equal(view.container.querySelector('section.mvr').getAttribute('data-record-pending'),'true');
  await act(async()=>{release();await gate;});
  assert.equal(view.container.querySelector('[data-record-pending="true"]'),null);
});

test('a page that fails says so and offers a retry instead of looking complete',async t=>{
  let broken=true;
  const view=await mount(t,{offset:5,data:pagesOf(6),failWhen:url=>broken&&url.searchParams.get('offset')==='5'});
  await exhaustAutomaticRetries(t);
  assert.equal(links(view.container).length,5);
  assert.match(view.container.querySelector('.mvr-section').textContent,/Voting record unavailable\./);
  assert.equal(button(view.container,'Show more'),undefined,'no claim that the list is whole');
  assert.equal(/ of 6/.test(view.container.textContent),false);
  broken=false;
  await act(async()=>button(view.container,'Try again').click());
  assert.equal(links(view.container).length,6);
});

test('going back to an earlier offset keeps the range and Show more',async t=>{
  const view=await mount(t,{data:pagesOf(12)});
  await view.render({offset:5});
  assert.equal(links(view.container).length,10);
  await view.render({offset:0});
  assert.equal(links(view.container).length,5);
  assert.match(view.container.textContent,/1–5 of 12/);
  assert.notEqual(button(view.container,'Show more'),undefined);
});

test('after a filter loads, focus returns to the row that was pressed',async t=>{
  const tagged=tag=>response({breakdown:breakdown(topicRows,countryRows),departures:{...response().departures,tag:tag?{key:tag,label:'trade policy',language:'en'}:null}});
  const view=await mount(t,{data:url=>tagged(url.searchParams.get('tag'))});
  const row=rowsOf(section(view.container))[0];
  pick(row).focus();
  await act(async()=>pick(row).click());
  assert.deepEqual(view.tags,['topic:2006']);
  await view.render({tag:'topic:2006'});
  const active=view.window.document.activeElement;
  assert.equal(active?.getAttribute('data-pick'),'topic:2006');
  assert.equal(active?.getAttribute('aria-pressed'),'true');
});

test('after Show more, focus moves to the first appended row',async t=>{
  const view=await mount(t,{data:pagesOf(12)});
  await act(async()=>button(view.container,'Show more').click());
  await view.render({offset:5});
  assert.equal(view.window.document.activeElement,links(view.container)[5]);
});

test('a delayed page does not take focus after the reader has moved on',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const view=await mount(t,{data:pagesOf(12),hold:url=>url.searchParams.get('offset')==='5'?gate:null});
  const other=view.window.document.createElement('input');view.window.document.body.append(other);
  await act(async()=>button(view.container,'Show more').click());
  await view.render({offset:5});
  other.focus();
  await act(async()=>{release();await gate;});
  assert.equal(links(view.container).length,10);
  assert.equal(view.window.document.activeElement,other,'focus stays where the reader put it');
});

test('a delayed page does not take focus after the record changes',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const view=await mount(t,{data:pagesOf(12),hold:url=>url.searchParams.get('offset')==='5'?gate:null});
  await act(async()=>button(view.container,'Show more').click());
  await view.render({offset:5});
  await view.render({scope:'final',offset:0});
  await act(async()=>{release();await gate;});
  assert.notEqual(links(view.container).includes(view.window.document.activeElement),true);
});
