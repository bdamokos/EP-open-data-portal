import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMemberVotesParam,
  readMemberVotesJourney,
  memberVotesJourneyParams,
  memberVotesHistoryMode,
  memberVotesScrollKey,
  captureMemberJourneyScroll,
  restoreMemberJourneyScroll,
} from './memberVotesJourney.mjs';

const MEMBER=42,WEEK='2026-03-23',SITTING='MTG-PL-2026-03-25';
const DECISION=SITTING+'-DEC-99',SNAPSHOT='a'.repeat(64);
const DOCUMENT='B-10-2026-0001',AMENDMENT=DOCUMENT+'-AM-7-2';
const LIST='B-10-2026-0001-AM-001-050',ADOPTED='TA-10-2026-0007';
const defaults=()=>({week:'latest',sittingId:null,positions:'recorded',offset:0,decisionId:null,snapshotId:null,expandedSubjectIds:[],context:null});
const queryFor=fields=>new URLSearchParams({member:String(MEMBER),...fields});
const read=fields=>readMemberVotesJourney(queryFor(fields),MEMBER);
const saved=journey=>{
  const query=memberVotesJourneyParams(journey);query.set('member',String(journey.memberId));return query;
};

test('an untouched journey has independent defaults and emits no API or browser fields',()=>{
  const first=read({}),second=read({});
  assert.deepEqual(first,{memberId:MEMBER,state:defaults(),adoptedId:null,invalid:false});
  assert.equal(memberVotesJourneyParams(first).toString(),'');
  first.state.expandedSubjectIds.push('exact-subject');
  assert.deepEqual(second.state,defaults(),'defaults must not share mutable arrays');
});

for(const [label,period] of [
  ['explicit week',{week:WEEK,sittingId:null}],
  ['single sitting',{week:'latest',sittingId:SITTING}],
  ['sitting with its remembered week',{week:WEEK,sittingId:SITTING}],
])test(label+' round-trips exact selection, pagination, expanded groups and amendment list context',()=>{
  const journey={memberId:MEMBER,invalid:false,adoptedId:null,state:{...defaults(),...period,positions:'all',offset:50,decisionId:DECISION,snapshotId:SNAPSHOT,expandedSubjectIds:['MTG-PL-2026-03-25-ITM-7','decision:'+DECISION],context:{documentId:DOCUMENT,amendmentId:AMENDMENT,listId:LIST,view:'document'}}};
  const query=saved(journey);
  assert.deepEqual(readMemberVotesJourney(query,MEMBER),journey);
  assert.equal(query.get('mv-decision'),DECISION);
  assert.equal(query.get('mv-list'),LIST);
  for(const key of query.keys())assert(key==='member'||key.startsWith('mv-'),'browser keys must be separate from API keys');
  assert.equal(query.has('decision'),false);assert.equal(query.has('week'),false);
});

test('adopted-text context retains its exact selected TA while the originating motion stays selected',()=>{
  for(const adoptedId of [null,ADOPTED]){
    const journey={memberId:MEMBER,invalid:false,adoptedId,state:{...defaults(),week:WEEK,decisionId:DECISION,snapshotId:SNAPSHOT,context:{documentId:DOCUMENT,view:'adopted'}}};
    assert.deepEqual(readMemberVotesJourney(saved(journey),MEMBER),journey);
  }
});

test('document context without amendment or list remains an exact standalone selection',()=>{
  const journey={memberId:MEMBER,invalid:false,adoptedId:null,state:{...defaults(),decisionId:DECISION,context:{documentId:'A-10-2026-0254',view:'document'}}};
  assert.deepEqual(readMemberVotesJourney(saved(journey),MEMBER),journey);
});

test('malformed period, decision, snapshot and pagination links remain explicitly invalid',()=>{
  const invalidFields=[
    {'mv-week':'2026-03-24'},{'mv-week':'2026-02-30'},{'mv-week':''},
    {'mv-week':'2026-02-30','mv-sitting':SITTING},
    {'mv-sitting':'MTG-PL-2026-02-30'},{'mv-sitting':'other'},
    {'mv-positions':'absent'},{'mv-positions':''},
    ...['-1','1.5','Infinity','10001','99999','100000','00','1e2',' 50',''].map(value=>({'mv-offset':value})),
    {'mv-decision':'MTG-PL-2026-02-30-DEC-99'},{'mv-decision':'unavailable-decision'},{'mv-decision':''},
    {'mv-snapshot':'a'.repeat(63)},{'mv-snapshot':'A'.repeat(64)},{'mv-snapshot':''},
  ];
  for(const fields of invalidFields){
    const parsed=read(fields);
    assert.equal(parsed.invalid,true,JSON.stringify(fields));
    const normalized=readMemberVotesJourney(saved(parsed),MEMBER);
    assert.equal(normalized.invalid,true,'normalization must not make an invalid view look valid');
  }
  const exact=read({'mv-week':'not-a-week','mv-decision':DECISION});
  assert.equal(exact.state.week,'not-a-week');assert.equal(exact.state.decisionId,DECISION,'a bad period must not silently clear a requested decision');
  assert.equal(read({'mv-offset':'10000'}).state.offset,10000);
  assert.equal(read({'mv-offset':'10000'}).invalid,false);
});

test('invalid-link normalization retains exact bounded period, decision and source context selections',()=>{
  const parsed=read({'mv-week':'2026-02-30','mv-decision':DECISION,'mv-snapshot':SNAPSHOT,'mv-document':DOCUMENT,'mv-amendment':AMENDMENT,'mv-list':LIST,'mv-view':'document'});
  assert.equal(parsed.invalid,true);
  const query=saved(parsed),restored=readMemberVotesJourney(query,MEMBER);
  assert.equal(query.get('mv-invalid'),'1');
  for(const [key,value] of [['mv-week','2026-02-30'],['mv-decision',DECISION],['mv-snapshot',SNAPSHOT],['mv-document',DOCUMENT],['mv-amendment',AMENDMENT],['mv-list',LIST],['mv-view','document']])assert.equal(query.get(key),value,key);
  assert.deepEqual(restored,parsed,'invalid views preserve their requested exact identifiers');
  const adopted=read({'mv-week':'broken','mv-decision':DECISION,'mv-document':DOCUMENT,'mv-view':'adopted','mv-adopted':ADOPTED});
  assert.deepEqual(readMemberVotesJourney(saved(adopted),MEMBER),adopted);
});

test('duplicate browser fields are invalid even when values agree',()=>{
  for(const [key,value] of [['mv-week',WEEK],['mv-decision',DECISION],['mv-offset','50'],['mv-expanded','[]']]){
    for(const duplicate of [value,'different']){
      const query=queryFor({[key]:value});query.append(key,duplicate);
      assert.equal(readMemberVotesJourney(query,MEMBER).invalid,true,key+' must have one owner value');
    }
  }
});

test('only explicitly owned browser keys are recognized, including prototype-shaped inputs',()=>{
  for(const suffix of ['week','sitting','positions','offset','decision','snapshot','expanded','document','amendment','list','view','adopted','invalid'])assert.equal(isMemberVotesParam('mv-'+suffix),true,suffix);
  for(const key of ['mv-__proto__','mv-constructor','mv-toString','mv-hasOwnProperty','mv-prototype','mv-unknown','mv-','week','mv-week-extra']){
    assert.equal(isMemberVotesParam(key),false,key);
    if(key.startsWith('mv-'))assert.equal(read({[key]:'anything'}).invalid,true,key+' cannot inherit a field mapping');
  }
  assert.equal(read({'constructor':'ignored','__proto__':'ignored','decision':DECISION}).invalid,false,'unrelated query fields are outside this namespace');
  assert.equal(read({'mv-invalid':'0'}).invalid,true,'the invalid marker cannot be reset through its value');
});

test('expanded groups reject malformed, duplicate, non-string, oversized or excessive identifiers',()=>{
  for(const value of ['broken','null','{}','"subject"','[1]','[null]','[{}]','["same","same"]',JSON.stringify(['has spaces']),JSON.stringify(['x'.repeat(161)]),JSON.stringify(Array.from({length:51},(_,index)=>'subject-'+index)),' '.repeat(8193)]){
    assert.equal(read({'mv-expanded':value}).invalid,true,value.slice(0,80));
  }
  const ids=Array.from({length:50},(_,index)=>String(index).padStart(2,'0')+'x'.repeat(158));
  const parsed=read({'mv-expanded':JSON.stringify(ids)});
  assert.equal(parsed.invalid,false,'50 bounded exact identifiers remain usable');
  assert.deepEqual(parsed.state.expandedSubjectIds,ids);
  assert.equal(read({'mv-decision':'x'.repeat(513)}).invalid,true,'scalar query values are bounded');
});

test('context parameters require a decision and exact compatible document, amendment, list and view',()=>{
  const context={'mv-decision':DECISION,'mv-document':DOCUMENT,'mv-view':'document'};
  const bad=[
    {'mv-document':DOCUMENT,'mv-view':'document'},
    {'mv-decision':DECISION,'mv-view':'document'},
    {'mv-decision':DECISION,'mv-document':DOCUMENT},
    {...context,'mv-view':'other'},
    {...context,'mv-document':ADOPTED},
    {...context,'mv-amendment':'B-10-2026-0002-AM-7'},
    {...context,'mv-amendment':AMENDMENT,'mv-view':'adopted'},
    {...context,'mv-list':LIST},
    {...context,'mv-amendment':AMENDMENT,'mv-list':'contains spaces'},
    {...context,'mv-adopted':ADOPTED},
    {...context,'mv-view':'adopted','mv-adopted':DOCUMENT},
    {...context,'mv-view':'adopted','mv-adopted':''},
  ];
  for(const fields of bad)assert.equal(read(fields).invalid,true,JSON.stringify(fields));
  const valid=read({...context,'mv-amendment':AMENDMENT,'mv-list':LIST});
  assert.equal(valid.invalid,false);assert.equal(valid.state.decisionId,DECISION);assert.equal(valid.state.context.listId,LIST);
});

test('malformed document syntax cannot throw while validating an amendment deep link',()=>{
  for(const documentId of ['[','(','\\','A-10-2026-0001[']){
    let parsed;
    assert.doesNotThrow(()=>{parsed=read({'mv-decision':DECISION,'mv-document':documentId,'mv-amendment':AMENDMENT,'mv-view':'document'});},documentId);
    assert.equal(parsed.invalid,true);assert.equal(parsed.state.decisionId,DECISION);
  }
});

test('another member or the wall receives fresh defaults rather than foreign state or invalidity',()=>{
  const query=queryFor({'mv-week':WEEK,'mv-positions':'all','mv-offset':'50','mv-decision':DECISION,'mv-snapshot':SNAPSHOT,'mv-expanded':'["exact-subject"]','mv-document':DOCUMENT,'mv-amendment':AMENDMENT,'mv-list':LIST,'mv-view':'document'});
  assert.equal(readMemberVotesJourney(query,MEMBER).invalid,false);
  for(const memberId of [43,null]){
    assert.deepEqual(readMemberVotesJourney(query,memberId),{memberId,state:defaults(),adoptedId:null,invalid:false});
    const malformed=new URLSearchParams(query);malformed.set('mv-offset','broken');malformed.set('mv-unknown','value');
    assert.deepEqual(readMemberVotesJourney(malformed,memberId),{memberId,state:defaults(),adoptedId:null,invalid:false});
  }
  const missingOwner=new URLSearchParams(query);missingOwner.delete('member');
  assert.deepEqual(readMemberVotesJourney(missingOwner,MEMBER),{memberId:MEMBER,state:defaults(),adoptedId:null,invalid:false});
});

test('canonical week and snapshot updates replace only when explicitly requested',()=>{
  const initial=defaults(),canonical={...initial,week:WEEK,snapshotId:SNAPSHOT};
  assert.equal(memberVotesHistoryMode(initial,canonical,true),'replace');
  assert.equal(memberVotesHistoryMode(initial,canonical),'push');
  assert.equal(memberVotesHistoryMode({...initial,week:WEEK},{...canonical},true),'replace');
  assert.equal(memberVotesHistoryMode(canonical,{...canonical,snapshotId:null}),'push','explicit refresh is a user step');
  assert.equal(memberVotesHistoryMode(canonical,{...canonical,week:'2026-03-30'},true),'push','another explicit period is not canonical resolution of latest');
});

test('canonical replacement recognizes the same exact context reconstructed from its URL',()=>{
  const journey={memberId:MEMBER,invalid:false,adoptedId:null,state:{...defaults(),week:WEEK,decisionId:DECISION,snapshotId:SNAPSHOT,context:{documentId:DOCUMENT,amendmentId:AMENDMENT,listId:LIST,view:'document'}}};
  const restored=readMemberVotesJourney(saved(journey),MEMBER);
  const canonical={...restored.state,snapshotId:'b'.repeat(64)};
  assert.deepEqual(restored,journey);
  assert.equal(memberVotesHistoryMode(journey.state,canonical,true),'replace','property insertion order cannot turn a canonical pin update into user navigation');
  assert.equal(memberVotesHistoryMode(journey.state,canonical,false),'push','an explicit refresh remains a user step');
});

test('every user selection pushes despite an expansion or other replacement hint',()=>{
  const previous={...defaults(),week:WEEK,snapshotId:SNAPSHOT};
  for(const patch of [
    {positions:'all'},{offset:50},{sittingId:SITTING},{decisionId:DECISION},
    {expandedSubjectIds:['exact-subject']},
    {decisionId:DECISION,context:{documentId:DOCUMENT,view:'document'}},
  ])for(const requestedReplace of [false,true])assert.equal(memberVotesHistoryMode(previous,{...previous,...patch},requestedReplace),'push',JSON.stringify(patch));
  const detail={...previous,decisionId:DECISION};
  assert.equal(memberVotesHistoryMode(detail,{...detail,context:{documentId:DOCUMENT,amendmentId:AMENDMENT,listId:LIST,view:'document'}},true),'push');
  assert.equal(memberVotesHistoryMode(detail,{...detail,decisionId:null},true),'push','returning to the list is navigation');
});

test('scroll identity survives canonical pinning and expansion but changes for each member and selected context',()=>{
  const journey=read({'mv-week':WEEK,'mv-offset':'50'}),key=memberVotesScrollKey(journey);
  assert.equal(memberVotesScrollKey({...journey,state:{...journey.state,snapshotId:SNAPSHOT,expandedSubjectIds:['exact-subject']}}),key);
  for(const next of [
    {...journey,memberId:43},
    {...journey,state:{...journey.state,offset:100}},
    {...journey,state:{...journey.state,decisionId:DECISION}},
    {...journey,state:{...journey.state,decisionId:DECISION,context:{documentId:DOCUMENT,view:'adopted'}},adoptedId:ADOPTED},
  ])assert.notEqual(memberVotesScrollKey(next),key);
});

test('exact amendment context keeps its scroll identity through URL reconstruction',()=>{
  const journey={memberId:MEMBER,invalid:false,adoptedId:null,state:{...defaults(),week:WEEK,positions:'all',offset:50,decisionId:DECISION,snapshotId:SNAPSHOT,expandedSubjectIds:['exact-subject'],context:{documentId:DOCUMENT,amendmentId:AMENDMENT,listId:LIST,view:'document'}}};
  const restored=readMemberVotesJourney(saved(journey),MEMBER),key=memberVotesScrollKey(journey);
  assert.deepEqual(restored,journey);
  assert.equal(memberVotesScrollKey(restored),key,'URL field order cannot create another saved scroll location');
  const reordered={context:{view:'document',listId:LIST,amendmentId:AMENDMENT,documentId:DOCUMENT},expandedSubjectIds:['exact-subject'],snapshotId:SNAPSHOT,decisionId:DECISION,offset:50,positions:'all',sittingId:null,week:WEEK};
  assert.equal(memberVotesScrollKey({...journey,state:reordered}),key,'state construction order does not change the selected view');
  for(const context of [
    {...journey.state.context,documentId:'B-10-2026-0002'},
    {...journey.state.context,amendmentId:DOCUMENT+'-AM-8'},
    {...journey.state.context,listId:DOCUMENT+'-AM-051-100'},
    {documentId:DOCUMENT,view:'adopted'},
  ])assert.notEqual(memberVotesScrollKey({...journey,state:{...journey.state,context}}),key,'another exact context has its own position');
});

test('scroll restoration preserves independent desktop and mobile scrollers and rejects invalid saved positions',()=>{
  const selectors=['main.explorer','.explorer-profile-body','.member-votes','.member-votes-pane:not([hidden])'];
  const nodes=new Map(selectors.map((selector,index)=>[selector,{scrollTop:100*(index+1)}]));
  const root={querySelector:selector=>nodes.get(selector)||null},positions=captureMemberJourneyScroll(root);
  assert.deepEqual(positions,[100,200,300,400]);
  for(const node of nodes.values())node.scrollTop=0;
  restoreMemberJourneyScroll(root,positions);assert.deepEqual(captureMemberJourneyScroll(root),positions);
  for(const invalid of [null,[],[1,2,3],[1,2,3,-1],[1,2,3,Infinity],[1,2,3,NaN],[1,2,3,10000001],[1,2,3,'4']]){
    restoreMemberJourneyScroll(root,invalid);assert.deepEqual(captureMemberJourneyScroll(root),positions);
  }
});
