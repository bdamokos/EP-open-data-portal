import test from 'node:test';
import assert from 'node:assert/strict';
import {changeMotionText,createMotionJourney,motionJourneyKey,motionJourneyParams,motionJourneyUrl,motionTextChoices,normalizeMotionJourney,readMotionJourney} from './motionJourney.mjs';

const original='B-10-2026-0441',joint='RC-10-2026-0441',ta='TA-10-2026-0339';
const activity={id:'motions:'+original,sourceId:original,title:'Original title',titleLanguage:'en',relatedJointMotions:[{sourceId:joint,title:'Joint title',memberAuthorship:'not-recorded'}]};
const binding={memberId:101,sourceId:original,ownerId:activity.id,choices:motionTextChoices(activity)};
const href='http://localhost/?member=101&module=activities&role=both&mv-offset=20&mep-activity-fts-page=2#saved';
const initial=createMotionJourney(binding);
const share=(state=initial)=>motionJourneyUrl(href,binding,state);
const read=url=>readMotionJourney(url.searchParams,binding);

test('only exact own original and joint activity links become choices, without authorship inheritance',()=>{
  assert.deepEqual(binding.choices,[{id:original,kind:'original',title:'Original title',titleLanguage:'en'},{id:joint,kind:'joint',title:'Joint title',titleLanguage:null}]);
  assert.deepEqual(motionTextChoices({sourceId:'A-10-2026-0123',relatedJointMotions:[{sourceId:'TA-10-2026-0339'},{sourceId:joint},{sourceId:joint},{sourceId:'B-10-2026-9999'}]}).map(choice=>choice.id),[joint]);
  assert.deepEqual(motionTextChoices(Object.create(activity)),[],'inherited source and relationships are not options');
  const inherited=Object.create({sourceId:joint,title:'Inherited option'});
  assert.deepEqual(motionTextChoices({...activity,relatedJointMotions:[inherited]}).map(choice=>choice.id),[original]);
  const forged={...binding,choices:[Object.create({id:joint})]};
  assert.equal(normalizeMotionJourney({documentId:joint},forged).status,'unavailable');
});

test('original to joint resets the complete reader while preserving the member and unrelated URL state',()=>{
  const selected={...initial,amendments:{...initial.amendments,open:true,scope:'all',offset:20,amendmentId:original+'-AM-013',variantListId:original+'-AM-013-014',view:'context',contextView:'adopted',contextTarget:'amendment'},selectedTA:ta};
  const next=changeMotionText(joint,binding),url=motionJourneyUrl(share(selected).href,binding,next);
  assert.deepEqual(next.amendments,initial.amendments);assert.equal(next.selectedTA,null);assert.equal(next.documentId,joint);
  assert.deepEqual(['member','module','role','mv-offset','mep-activity-fts-page'].map(key=>url.searchParams.get(key)),['101','activities','both','20','2']);assert.equal(url.hash,'#saved');
  assert.equal(url.searchParams.get('ma-amendment'),null);assert.equal(url.searchParams.get('ma-list'),null);
});

test('a closed RC share preserves every exact selected identity and context target',()=>{
  const state={...changeMotionText(joint,binding),amendments:{...initial.amendments,scope:'all',offset:40,amendmentId:joint+'-AM-00013',variantListId:joint+'-AM-013-014',contextView:'adopted',contextTarget:'amendment'},selectedTA:ta};
  const restored=read(share(state));
  assert.deepEqual(restored,{...state,requested:true});assert.equal(restored.amendments.open,false);
  assert.equal(motionJourneyUrl(share(state).href,binding,restored).href,share(state).href);
});

test('omitted state fields use the supplied module factory defaults without opening a reader',()=>{
  const query=new URLSearchParams({member:'101','ma-member':'101','ma-source':original,'ma-text':joint});
  const factory={...initial.amendments,contextTarget:'amendment'};
  const state=readMotionJourney(query,binding,factory);
  assert.equal(state.documentId,joint);assert.deepEqual(state.amendments,factory);assert.equal(state.status,'available');
});

test('member, activity, and optional owner bindings never transfer the previous selection',()=>{
  const selected={...initial,amendments:{...initial.amendments,open:true,amendmentId:original+'-AM-13'}};
  for(const [key,value] of [['member','102'],['ma-member','102'],['ma-source','B-10-2026-9999'],['ma-owner','another-activity']]){
    const url=share(selected);url.searchParams.set(key,value);const result=read(url);
    assert.equal(result.status,'inactive',key);assert.deepEqual(result.amendments,initial.amendments,key);assert.equal(result.selectedTA,null);
  }
  const noOwner=share(selected);noOwner.searchParams.delete('ma-owner');assert.equal(read(noOwner).amendments.amendmentId,original+'-AM-13');
  const foreign=new URL(href);foreign.searchParams.set('member','102');assert.equal(motionJourneyUrl(foreign.href,binding,selected).href,foreign.href);
});

test('unsupported text and malformed outer links stay explicitly unavailable',()=>{
  const invalid=[['ma-member','constructor'],['ma-source','__proto__'],['ma-owner',''],['ma-text','A-10-2026-0123'],['ma-text','TA-10-2026-0339'],['ma-text','B-10-2026-9999'],['ma-text','constructor'],['ma-text','__proto__'],['ma-text','<img src=x>'],
    ['ma-ta','B-10-2026-0441'],['ma-ta','constructor'],
    ['ma-open','yes'],['ma-scope','constructor'],['ma-offset','1000001'],['ma-offset','-1'],['ma-offset','1e3'],['ma-offset','20.0'],['ma-view','__proto__'],['ma-context-target','constructor'],['ma-context-view','toString']];
  for(const [key,value] of invalid){
    const url=share({...initial,amendments:{...initial.amendments,amendmentId:original+'-AM-13'}});url.searchParams.set(key,value);
    const result=read(url);assert.equal(result.status,'unavailable',key+'='+value);assert(result.reason);
    if(key==='ma-text')assert.equal(result.documentId,value,'never select a replacement text');
  }
  for(const alter of [url=>url.searchParams.append('ma-text',joint),url=>url.searchParams.set('ma-text','B'.repeat(513)),url=>url.searchParams.set('ma-unknown','1'),url=>url.searchParams.delete('ma-source'),url=>url.searchParams.delete('ma-member')]){
    const url=share();alter(url);assert.equal(read(url).status,'unavailable');
  }
  assert.equal(readMotionJourney(new URLSearchParams(),binding).requested,false);
});

test('invalid exact AM/list remain unchanged and selection-unavailable while whole motion stays available',()=>{
  for(const [key,value] of [['ma-amendment',joint+'-AM-13'],['ma-amendment',original+'-AM-0'],['ma-amendment','constructor'],['ma-amendment',original+'-AM-100000'],
    ['ma-list',joint+'-AM-001-020'],['ma-list',original+'-AM-014-013'],['ma-list','toString']]){
    const url=share({...initial,amendments:{...initial.amendments,amendmentId:original+'-AM-13'}});url.searchParams.set(key,value);
    const result=read(url);assert.equal(result.status,'available');assert.match(result.reason,/unavailable/);
    assert.equal(result.amendments[key==='ma-amendment'?'amendmentId':'variantListId'],value);
    assert.equal(motionJourneyParams(binding,result).get(key),value,'writing retains the exact unavailable identity');
  }
});

test('nested context retains exact list, page, selected TA and text-level target independently',()=>{
  const selected={...initial,amendments:{...initial.amendments,open:true,scope:'all',offset:1_000_000,amendmentId:original+'-AM-013',variantListId:original+'-AM-001-020',view:'context',contextView:'adopted',contextTarget:'text'},selectedTA:ta};
  const restored=read(share(selected));assert.deepEqual(restored.amendments,selected.amendments);assert.equal(restored.selectedTA,ta);
  const back={...restored,amendments:{...restored.amendments,view:'amendments'}};
  assert.deepEqual(read(share(back)).amendments,back.amendments);assert.equal(read(share(back)).selectedTA,ta);
  assert.equal(read(share({...initial,amendments:{...initial.amendments,view:'context'}})).status,'available','invalid writes leave the existing URL alone');
  const invalid=share();invalid.searchParams.set('ma-view','context');assert.equal(read(invalid).status,'unavailable','closed context cannot silently open');
});

test('wording language keeps known, unknown and legacy absence distinct through close and Back',()=>{
  const context={...initial,amendments:{...initial.amendments,open:true,view:'context',contextTarget:'amendment',amendmentId:original+'-AM-00013',variantListId:original+'-AM-001-020'}};
  const absent=read(share(context)),unknown=read(share({...context,amendments:{...context.amendments,wordingLanguage:null}})),known=read(share({...context,amendments:{...context.amendments,wordingLanguage:'fr'}}));
  assert.equal(Object.hasOwn(absent.amendments,'wordingLanguage'),false);assert.equal(unknown.amendments.wordingLanguage,null);assert.equal(known.amendments.wordingLanguage,'fr');
  assert.equal(share(absent).searchParams.has('ma-wording-lang'),false);assert.equal(share(unknown).searchParams.get('ma-wording-lang'),'unknown');assert.equal(share(known).searchParams.get('ma-wording-lang'),'fr');
  assert.equal(new Set([absent,unknown,known].map(motionJourneyKey)).size,3);
  for(const value of [known,unknown]){
    const closed={...value,amendments:{...value.amendments,open:false,view:'amendments'}};
    assert.deepEqual(read(share(closed)).amendments,closed.amendments);assert.equal(read(share(closed)).reason,null);
    const reset=changeMotionText(joint,binding);assert.equal(Object.hasOwn(reset.amendments,'wordingLanguage'),false);
  }
});

test('language pins require exact document, AM/list and amendment context; invalid pins cannot be written',()=>{
  const context={...initial,amendments:{...initial.amendments,open:true,view:'context',contextTarget:'amendment',amendmentId:original+'-AM-13',variantListId:original+'-AM-001-020',wordingLanguage:'en'}};
  for(const patch of [{wordingLanguage:'unknown'},{wordingLanguage:'EN'},{wordingLanguage:'constructor'},{wordingLanguage:''},{wordingLanguage:42},{amendmentId:joint+'-AM-13'},{variantListId:null},{contextTarget:'text'},{contextView:'adopted'}]){
    const value={...context,amendments:{...context.amendments,...patch}},result=normalizeMotionJourney(value,binding);
    assert.equal(result.status,'available');assert.match(result.reason,/wording language is unavailable/);assert.equal(motionJourneyParams(binding,result).size,0);
  }
  const url=share(context);url.searchParams.set('ma-wording-lang','constructor');const readInvalid=read(url);
  assert.equal(readInvalid.amendments.wordingLanguage,'constructor');assert.match(readInvalid.reason,/unavailable/);
});

test('semantic keys and params use fixed fields instead of object insertion order',()=>{
  const normal={...initial,amendments:{...initial.amendments,open:true,scope:'all',offset:20,amendmentId:original+'-AM-13',variantListId:original+'-AM-001-020',contextTarget:'amendment',wordingLanguage:null},selectedTA:ta};
  const reverse={...normal,amendments:Object.fromEntries(Object.entries(normal.amendments).reverse())};
  assert.equal(motionJourneyKey(normal),motionJourneyKey(reverse));assert.equal(motionJourneyParams(binding,normal).toString(),motionJourneyParams(binding,reverse).toString());
  assert.notEqual(motionJourneyKey(normal),motionJourneyKey({...normal,amendments:{...normal.amendments,contextTarget:'text'}}));
  assert.notEqual(motionJourneyKey(normal),motionJourneyKey({...normal,selectedTA:null}));
  const inherited={...initial,amendments:Object.assign(Object.create({wordingLanguage:'fr'}),initial.amendments)};
  assert.equal(motionJourneyKey(initial),motionJourneyKey(inherited),'inherited optional fields are not selected pins');
});

test('invalid duplicate links cannot be canonicalized into a replacement text by URL helpers',()=>{
  const url=share();url.searchParams.append('ma-text',joint);const invalid=read(url);
  assert.equal(invalid.status,'unavailable');assert.equal(motionJourneyParams(binding,invalid).size,0);assert.equal(motionJourneyUrl(url.href,binding,invalid).href,url.href);
  const valid=read(share());assert.notEqual(motionJourneyKey(valid),motionJourneyKey(invalid),'invalid shells have separate restoration identities');
});
