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
    version:3,
    member:{id:String(MEMBER),uri:'https://data.europarl.europa.eu/person/'+MEMBER},
    period:{from:'2024-07-16',to:'2026-10-07'},
    coverage:{sittings:2,included:2,missing:0,status:'complete'},
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

async function mount(t,{data=response(),status=200,memberId=MEMBER,scope='all',offset=0,tag=null,matches=false}={}) {
  const window=new Window({url:'http://localhost/?member='+MEMBER+'&module=votes'});
  window.matchMedia=query=>({matches:matches&&query.includes('max-width'),media:query,addEventListener(){},removeEventListener(){}});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let load,root;const calls=[],offsets=[],scopes=[],opened=[];
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async url=>{
    calls.push(String(url));
    if(status!==200)return new Response('',{status});
    const url_=new URL(String(url),'http://localhost');
    return Response.json(typeof data==='function'?data(url_):data);
  });
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {MemberVoteRecord}=await load('/src/MemberVoteRecord.tsx');
  const {createRoot}=await import('react-dom/client');const container=window.document.createElement('div');window.document.body.append(container);installRetryClock(t);root=createRoot(container);
  const tags=[];
  const props={memberId,language:'en',scope,offset,tag,onTagChange:value=>tags.push(value),onScopeChange:value=>scopes.push(value),onOffset:value=>offsets.push(value),onOpenDecision:value=>opened.push(value)};
  await act(async()=>root.render(createElement(MemberVoteRecord,props)));
  return {container,calls,offsets,scopes,tags,opened,window,
    async render(next){await act(async()=>root.render(createElement(MemberVoteRecord,{...props,...next})));}};
}
const button=(container,text)=>[...container.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
const links=container=>[...container.querySelectorAll('.member-vote-record-departures a')];

test('an active member record leads with the votes against the group and links its departures',async t=>{
  const view=await mount(t);
  const text=view.container.textContent;
  assert.match(text,/Voting record/);
  assert.match(text,/Current term · 16 Jul 2024 – 7 Oct 2026/);
  const figures=[...view.container.querySelectorAll('.member-vote-record-figures dt')].map(item=>item.textContent);
  assert.deepEqual(figures,['Against their group','With their group'],'the lead figure is the count against the group');
  assert.match(view.container.querySelector('.member-vote-record-figures').textContent,/Against their group1With their group75%Group median 62.5%/);
  assert.equal(/ of \d| votes held|Recorded votes|Parliament median/.test(text.replace(/Show more|1–5 of 6/,'')),false,'no X of Y lines, recorded figure or Parliament median');
  assert.equal(view.container.querySelector('svg'),null,'there is no trend chart');
  assert.equal(text.includes('Partial'),false);
  assert.equal(links(view.container).length,5,'the first page keeps five departures');
  assert.match(links(view.container)[0].getAttribute('href'),/mv-decision=MTG-PL-2026-10-07-DEC-10/);
  assert.equal(links(view.container)[0].hasAttribute('lang'),false,'text in the interface language needs no language mark');
  assert.match(view.container.querySelector('.member-vote-record-departures small').textContent,/7 Oct 2026 · Against · group For/);
  assert.equal(new URL(links(view.container)[0].href).searchParams.get('module'),'votes');
  await act(async()=>links(view.container)[0].click());
  assert.equal(view.opened.length,1);
  assert.equal(view.opened[0].decisionId,B+'-DEC-10');
  assert.equal(view.window.location.href.includes('mv-decision'),false,'the click keeps in-page navigation');
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
  assert.match(view.container.querySelector('.member-vote-record-figures').textContent,/Against their group0With their group100%Group median 100%/);
  assert.equal(view.container.querySelectorAll('.member-vote-record-departures a').length,1);
  assert.equal(button(view.container,'Show more'),undefined);
});

test('a non-attached member sees one short label, never group figures',async t=>{
  const view=await mount(t,{data:response({group:{code:'NI',status:'non-attached'},alignment:null,comparison:null,departures:{...response().departures,total:0,items:[],nextOffset:null}})});
  assert.match(view.container.textContent,/Non-attached/);
  assert.equal(button(view.container,'Final votes'),undefined);
  assert.equal(view.container.textContent.includes('With their group'),false);
  assert.equal(view.container.textContent.includes('Against'),false);
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
  const view=await mount(t,{data:response({coverage:{sittings:3,included:2,missing:1,status:'partial'}})});
  assert.match(view.container.textContent,/Partial · missing sittings: 1/);
});

test('a chairing member with no comparable vote shows the chaired count and nothing to compare',async t=>{
  const view=await mount(t,{data:response({alignment:{all:counts(0,0,0,0),wholeText:counts(0,0,0,0)},comparison:null,ballots:{chaired:598}})});
  assert.match(view.container.textContent,/Chaired: 598/);
  assert.equal(view.container.textContent.includes('Against their group'),false,'unknown is not shown as zero');
  assert.equal(view.container.textContent.includes('With their group'),false);
  assert.equal(view.container.textContent.includes('Group unavailable'),false);
  assert.equal(view.container.querySelector('.member-vote-record-departures'),null);
});

test('departure wording in another language is marked, and language-neutral wording is not',async t=>{
  const items=[{...departures[1],text:'Après le considérant 27',language:'fr'},{...departures[2],text:'RC-B10-0371/2025 - § 2 - Am 3',language:'mul'}];
  const view=await mount(t,{data:response({departures:{scope:'all',tag:null,offset:0,limit:5,total:2,items,nextOffset:null}})});
  assert.equal(links(view.container)[0].getAttribute('lang'),'fr');
  assert.equal(links(view.container)[1].hasAttribute('lang'),false);
});

test('before the first projection the panel shows a short pending state without figures',async t=>{
  const pending=response({coverage:{sittings:3,included:0,missing:3,status:'partial'},alignment:{all:counts(0,0),wholeText:counts(0,0)},ballots:{chaired:0},departures:{scope:'all',tag:null,offset:0,limit:5,total:0,items:[],nextOffset:null},comparison:null});
  const view=await mount(t,{data:pending});
  assert.match(view.container.textContent,/Voting record not available yet\./);
  assert.equal(/Against their group|0 of 0/.test(view.container.textContent),false);
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
  const rows=[...view.container.querySelectorAll('.member-vote-record-departures li')];
  assert.equal(rows[0].querySelector('a').textContent,'Energy efficiency of buildings');
  assert.equal(rows[0].querySelector('.member-vote-record-label').textContent,'A10-1/2026 – Rapporteur – § 4 – Am 4');
  assert.equal(rows[1].querySelector('a').textContent,'B10-2/2026 – § 9');
  assert.equal(rows[1].querySelector('.member-vote-record-label'),null);
});

test('the All/Final control is hidden when it would do nothing',async t=>{
  const view=await mount(t,{data:response({group:{code:'NI',status:'non-attached'},alignment:null,comparison:null})});
  assert.equal(button(view.container,'Final votes'),undefined);
});

test('the All/Final control stays for a member with a group line',async t=>{
  const view=await mount(t);
  assert.notEqual(button(view.container,'Final votes'),undefined);
});

test('on a narrow screen the departures sit behind a disclosure, closed by default',async t=>{
  const view=await mount(t,{matches:true});
  const details=[...view.container.querySelectorAll('details.member-vote-record-disclosure')];
  assert.equal(details.length,1);
  assert.equal(details.every(item=>item.open===false),true);
  assert.match(details[0].querySelector('summary').textContent,/Votes against their group · 6/);
  assert.equal(view.container.querySelectorAll('.member-vote-record-figures > div').length,2,'the figures stay in view');
});

test('on a wide screen the departures stay open',async t=>{
  const view=await mount(t);
  assert.equal(view.container.querySelector('details'),null);
  assert.equal(links(view.container).length,5);
});

const breakdownRow=(key,label,share,comparable,language='en')=>({key,label,language,comparable,withGroup:Math.round(share*comparable),share});
const breakdown=(topics,countries,eligible={topics:topics.length,countries:countries.length})=>({overall:0.9,topics:{eligible:eligible.topics,rows:topics},countries:{eligible:eligible.countries,rows:countries}});
const topicRows=[breakdownRow('topic:2006','trade policy',0.58,145),breakdownRow('topic:7211','regions of EU Member States',0.75,1234)];
const countryRows=[breakdownRow('country:MEX','Mexico',0.394,33),breakdownRow('country:CHN','China',0.883,162)];
const section=container=>container.querySelector('.member-vote-record-breakdown');
const rowsOf=list=>[...list.querySelectorAll('li button')];

test('the breakdown sits between the figures and the departures with two lists of rows',async t=>{
  const view=await mount(t,{data:response({breakdown:breakdown(topicRows,countryRows)})});
  const root=view.container.querySelector('.member-vote-record'),parts=[...root.children].map(item=>item.className||item.tagName.toLowerCase());
  const index=name=>parts.findIndex(item=>String(item).includes(name));
  assert.equal(index('figures')<index('breakdown')&&index('breakdown')<index('departures'),true,parts.join(' | '));
  assert.equal(section(view.container).querySelector('h3').textContent,'Where they differ most from their group');
  const lists=[...section(view.container).querySelectorAll('.member-vote-record-list')];
  assert.deepEqual(lists.map(list=>list.querySelector('h4').textContent),['By topic','By country discussed']);
  assert.deepEqual(rowsOf(lists[0]).map(row=>row.textContent),['trade policy58%145 votes','regions of EU Member States75%1,234 votes']);
  assert.deepEqual(rowsOf(lists[1]).map(row=>row.textContent),['Mexico39%33 votes','China88%162 votes']);
  assert.equal(section(view.container).querySelector('svg'),null,'no bars or charts');
});

test('every row has the same three cells so label, share and count keep one edge, in both lists',async t=>{
  const view=await mount(t,{data:response({breakdown:breakdown(topicRows,countryRows)})});
  for(const row of rowsOf(section(view.container)))
    assert.deepEqual([...row.children].map(cell=>cell.className),['member-vote-record-row-label','member-vote-record-row-share','member-vote-record-row-count']);
  const css=readFileSync(new URL('./MemberVoteRecord.css',import.meta.url),'utf8');
  const rule=name=>css.match(new RegExp(name.replace(/[.[\]]/g,'\\$&')+'[^{]*\\{([^}]*)\\}'))?.[1]||'';
  const grid=rule('.member-vote-record .member-vote-record-list button');
  assert.match(grid,/grid-template-columns:minmax\(0,1fr\) 3\.25rem 6rem/,'one column template for every row of both lists');
  assert.match(rule('.member-vote-record-row-share,.member-vote-record-row-count'),/text-align:right;font-variant-numeric:tabular-nums/);
  assert.equal(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(css),false,'tokens only');
});

test('a row is a button that sets the exact tag, and the pressed row clears it',async t=>{
  const view=await mount(t,{data:response({breakdown:breakdown(topicRows,countryRows)})});
  await act(async()=>rowsOf(section(view.container))[0].click());
  assert.deepEqual(view.tags,['topic:2006']);
});

test('the pressed row clears its tag when pressed again',async t=>{
  const filtered=await mount(t,{tag:'country:MEX',data:response({breakdown:breakdown(topicRows,countryRows),departures:{...response().departures,tag:{key:'country:MEX',label:'Mexico',language:'en'}}})});
  const pressed=rowsOf(section(filtered.container)).filter(row=>row.getAttribute('aria-pressed')==='true');
  assert.deepEqual(pressed.map(row=>row.textContent),['Mexico39%33 votes']);
  await act(async()=>pressed[0].click());
  assert.deepEqual(filtered.tags,[null]);
});

test('a tag filters the departures with a way back, and the requests carry it',async t=>{
  const tagged=response({breakdown:breakdown(topicRows,countryRows),departures:{...response().departures,tag:{key:'topic:2006',label:'trade policy',language:'en'},total:12,items:departures.slice(0,5),nextOffset:5}});
  const view=await mount(t,{tag:'topic:2006',data:tagged});
  assert.equal(view.calls.every(call=>new URL(call,'http://localhost').searchParams.get('tag')==='topic:2006'),true);
  const line=view.container.querySelector('.member-vote-record-filterline');
  assert.equal(line.querySelector('span').textContent,'Votes on trade policy');
  await act(async()=>[...line.querySelectorAll('button')].find(item=>item.textContent==='Show all').click());
  assert.deepEqual(view.tags,[null]);
  assert.equal(view.container.querySelectorAll('.member-vote-record-departures li').length,5);
  assert.match(view.container.textContent,/1–5 of 12/,'pagination works on the filtered list');
  await act(async()=>button(view.container,'Show more').click());
  assert.deepEqual(view.offsets,[5]);
  await view.render({offset:5});
  assert.equal(view.calls.some(call=>call.includes('offset=5')&&call.includes('tag=topic%3A2006')),true);
});

test('without a tag there is no filter line',async t=>{
  const plain=await mount(t);
  assert.equal(plain.container.querySelector('.member-vote-record-filterline'),null);
});

test('only lists with rows are shown, a single list takes the width, and eligible rows with none below read as one line',async t=>{
  const one=await mount(t,{data:response({breakdown:breakdown([],countryRows,{topics:2,countries:2})})});
  assert.equal(one.container.querySelectorAll('.member-vote-record-list').length,1);
  assert.equal(one.container.querySelector('.member-vote-record-lists').className.includes('single'),true);
  assert.match(section(one.container).textContent,/By country discussed/);
  assert.equal(section(one.container).textContent.includes('By topic'),false);
});

test('eligible rows with none clearly below the overall share read as one short line',async t=>{
  const view=await mount(t,{data:response({breakdown:breakdown([],[],{topics:12,countries:3})})});
  assert.equal(view.container.querySelectorAll('.member-vote-record-list').length,0);
  assert.match(section(view.container).textContent,/Votes with their group across all topics and countries with enough votes\./);
});

test('without eligible rows, or without a group line, there is no breakdown section and no zero in its place',async t=>{
  const none=await mount(t,{data:response({breakdown:null})});
  assert.equal(section(none.container),null);
  assert.equal(none.container.querySelector('.member-vote-record-departures')!==null,true);
});

test('a non-attached member has no breakdown section',async t=>{
  const view=await mount(t,{data:response({group:{code:'NI',status:'non-attached'},alignment:null,comparison:null,breakdown:null,departures:{...response().departures,total:0,items:[],nextOffset:null}})});
  assert.equal(section(view.container),null);
});

test('labels in another language than the interface carry their language',async t=>{
  const view=await mount(t,{data:response({breakdown:breakdown([breakdownRow('topic:2006','handelspolitik',0.5,40,'de'),breakdownRow('topic:7211','regions',0.5,40,'en')],[])})});
  const labels=[...section(view.container).querySelectorAll('.member-vote-record-row-label')];
  assert.equal(labels[0].getAttribute('lang'),'de');assert.equal(labels[1].hasAttribute('lang'),false);
});
