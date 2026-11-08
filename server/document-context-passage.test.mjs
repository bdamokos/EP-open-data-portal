import test from 'node:test';
import assert from 'node:assert/strict';
import {partOfProvision,documentPassageQuery,documentPassageReply,documentProvisionQuery,documentProvisionReply,wantsDocumentPassage,wantsDocumentProvision} from './document-context-passage.mjs';
import {DOCUMENT_CONTEXT_VERSION} from './document-context.mjs';

const documentId='A-10-2026-0257',amendment=documentId+'-AM-4';
const params=value=>new URLSearchParams(value);
const unit=(kind,value,start)=>({kind,extent:{start,end:start+1},content:[start],children:[],label:{kind,value,prefix:'('+value+')\t'}});
const proposal={paragraphs:['(1)\tOne','(2)\tTwo','(3)\tThree'].map((text,index)=>({index,text})),units:[{kind:'preamble',extent:{start:0,end:3},content:[],children:[unit('recital','1',0),unit('recital','2',1),unit('recital','3',2)]}]};
const context=fields=>({version:DOCUMENT_CONTEXT_VERSION,documentId,requestedLanguage:'en',amendment:{id:amendment,variants:[{proposedText:'x'.repeat(5000)}]},document:{selectedText:undefined},related:{items:[]},sources:[],target:{},baseline:{kind:'commission-proposal',language:'en',status:'available',evidence:['y'.repeat(5000)]},proposal:{items:[{proposal}]},placement:{operation:'replace',status:'placed',itemIndex:0,span:{start:1,end:1},originalText:'(2)\tTwo',evidence:[]},...fields});

test('body=passage is the reader\'s own query for an exact amendment, and nothing else',()=>{
  assert.equal(wantsDocumentPassage(params('body=passage')),true);
  assert.equal(wantsDocumentPassage(params('body=0')),false);
  const query=documentPassageQuery(documentId,params(`amendment=${amendment}&lang=fr&body=passage`));
  assert.equal(query.amendmentId,amendment);assert.equal(query.language,'fr');assert.equal(query.includeBody,true,'placement needs the body');
  for(const value of ['body=passage',`amendment=${amendment}&body=passage&body=0`,`amendment=${amendment}&body=passage&adopted=1`,`amendment=${amendment}&body=passage&final-text=1`])
    assert.throws(()=>documentPassageQuery(documentId,params(value)),error=>error.status===400,value);
  assert.throws(()=>documentPassageQuery(documentId,params(`amendment=A-10-2026-0001-AM-4&body=passage`)),error=>error.status===400,'another document\'s amendment');
});
test('the reply carries the placement and three rows, without any body',()=>{
  const reply=documentPassageReply(context({placement:{operation:'replace',status:'placed',itemIndex:0,span:{start:1,end:1},originalText:'(2)\tTwo',evidence:[],finalPlacementCheck:{adoptedTextUrl:'x'}}}));
  assert.deepEqual(Object.keys(reply),['version','documentId','requestedLanguage','baseline','placement','passage']);
  assert.equal(reply.version,DOCUMENT_CONTEXT_VERSION);
  assert.deepEqual(reply.baseline,{kind:'commission-proposal',language:'en'});
  assert.equal(reply.placement.finalPlacementCheck,undefined);
  assert.deepEqual(reply.passage.before,{label:{kind:'recital',value:'1',prefix:'(1)'},text:'One'});
  assert.deepEqual(reply.passage.original,{label:{kind:'recital',value:'2',prefix:'(2)'},text:'Two'});
  assert.deepEqual(reply.passage.after,{label:{kind:'recital',value:'3',prefix:'(3)'},text:'Three'});
  assert(Buffer.byteLength(JSON.stringify(reply))<8*1024);
});
test('anything but a placed amendment has no rows',()=>{
  assert.equal(documentPassageReply(context({placement:{operation:'replace',status:'unresolved',reason:'x',evidence:[]},proposal:null})).passage,null);
  assert.equal(documentPassageReply(context({placement:{operation:'replace',status:'document-operation',scope:'whole-document',evidence:[]}})).passage,null);
  assert.equal(documentPassageReply(context({placement:null,proposal:null})).placement,null);
  assert.equal(documentPassageReply(context({proposal:null,document:null})).passage,null,'a placed span with no text held');
});
test('a report\'s own text gives paragraph rows',()=>{
  const reply=documentPassageReply(context({baseline:null,proposal:null,document:{selectedText:{paragraphs:['1.\tOne','2.\tTwo','3.\tThree'],tables:[]}}}));
  assert.equal(reply.baseline,null);
  assert.deepEqual(reply.passage.after,{label:{kind:null,value:null,prefix:'3.'},text:'Three'});
});

const motionText=paragraphs=>({status:'available',textLanguage:'en',structureStatus:'extracted',paragraphs,paragraphSources:paragraphs.map((_,index)=>({path:'p'+index,ordinal:index,container:'body',containerPath:'/body',segment:0,complete:true})),paragraphFormats:paragraphs.map(()=>({}))});
const motion=['The European Parliament,','– having regard to the Treaty,','A. whereas one;','B. whereas two;','1. Calls on the Commission;','2. Stresses the following:','(a) the first point;','(b) the second point;','3. Instructs its President to forward this resolution;'];
const provisionContext=text=>({version:DOCUMENT_CONTEXT_VERSION,documentId,requestedLanguage:'en',document:{selectedText:text}});
test('provision asks for one exact provision of a report or motion, and nothing else',()=>{
  assert.equal(wantsDocumentProvision(params('provision=paragraph:10')),true);
  assert.equal(wantsDocumentProvision(params('body=0')),false);
  const query=documentProvisionQuery(documentId,params('provision=paragraph:10&lang=fr'));
  assert.equal(query.provision,'paragraph:10');assert.equal(query.language,'fr');assert.equal(query.heldMetadata,true);
  for(const value of ['provision=paragraph:10','provision=point:10:a','provision=recital:AB','provision=citation:3','provision=paragraph:10a'])assert.equal(documentProvisionQuery(documentId,params(value)).provision,value.slice(10));
  for(const value of ['provision=','provision=paragraph:','provision=paragraph:0','provision=paragraph:1&provision=paragraph:2','provision=article:3','provision=paragraph:10&amendment='+amendment,'provision=paragraph:10&body=0','provision=paragraph:10&adopted=1'])assert.throws(()=>documentProvisionQuery(documentId,params(value)),error=>error.status===400,value);
  assert.throws(()=>documentProvisionQuery('TA-10-2026-0342',params('provision=paragraph:1')),error=>error.status===400,'adopted texts are read elsewhere');
  assert.throws(()=>documentProvisionQuery(documentId+'-AM-4-1',params('provision=paragraph:1')),error=>error.status===400,'an amendment list is not a report or motion');
});
test('the provision reply holds its exact wording only, without the number',()=>{
  const reply=provision=>documentProvisionReply(provisionContext(motionText(motion)),provision);
  assert.deepEqual(Object.keys(reply('paragraph:1')),['version','documentId','requestedLanguage','provision','text','language']);
  assert.equal(reply('paragraph:1').text,'Calls on the Commission;');assert.equal(reply('paragraph:1').language,'en');
  assert.equal(reply('paragraph:2').text,'Stresses the following:\n(a) the first point;\n(b) the second point;','a paragraph holds its points');
  assert.equal(reply('point:2:b').text,'the second point;');
  assert.equal(reply('recital:B').text,'whereas two;');
  assert.equal(reply('paragraph:99').text,null);assert.equal(reply('paragraph:99').language,null);
  assert.equal(reply('point:1:a').text,null);
  assert.equal(documentProvisionReply(provisionContext(null),'paragraph:1').text,null,'no body read');
  assert.equal(documentProvisionReply(provisionContext(motionText(['The European Parliament,','1. One;','1. The same number again;','2. Two;'])),'paragraph:1').text,null,'a repeated number has no single text');
  const broken=motionText(motion);broken.paragraphSources[4]={...broken.paragraphSources[4],complete:false};
  assert.equal(documentProvisionReply(provisionContext(broken),'paragraph:1').text,null,'an incomplete row has no text');
});
test('a report whose texts restart at 1 has no text for a bare number',()=>{
  const reply=paragraphs=>documentProvisionReply(provisionContext(motionText(paragraphs)),'paragraph:1').text;
  // The shape of public discharge reports A-10-2026-0050 and 0085: decisions, then the resolution.
  const decision=['PROPOSAL FOR A EUROPEAN PARLIAMENT DECISION','The European Parliament,','– having regard to the accounts,','1. Grants discharge;'];
  const resolution=['MOTION FOR A EUROPEAN PARLIAMENT RESOLUTION','The European Parliament,','– having regard to its decision,','1. Notes the accounts;'];
  assert.equal(reply(resolution),'Notes the accounts;','one text says which');
  assert.equal(reply([...decision,...resolution]),null);
  assert.equal(reply([...resolution,...decision]),null);
});
test('a citation counts from the opening, so any doubt before it means no text',()=>{
  const citations=['The European Parliament,','– having regard to the first,','– having regard to the second,','– having regard to the third,','A. whereas one;','1. Calls on the Commission;','2. Stresses;'];
  const reply=(text,provision)=>documentProvisionReply(provisionContext(text),provision).text;
  assert.equal(reply(motionText(citations),'citation:1'),'having regard to the first,');
  assert.equal(reply(motionText(citations),'citation:3'),'having regard to the third,');
  const incomplete=(index,paragraphs=citations)=>{const text=motionText(paragraphs);text.paragraphSources[index]={...text.paragraphSources[index],complete:false};return text;};
  assert.equal(reply(incomplete(1),'citation:1'),null,'an incomplete first citation would shift the second into its number');
  assert.equal(reply(incomplete(2),'citation:2'),null);
  assert.equal(reply(incomplete(3),'citation:1'),'having regard to the first,','a later break casts no doubt on what came well before');
  assert.equal(reply(incomplete(3),'citation:2'),null,'the row just before a break has no certain end');
  const undashed=['The European Parliament,','– having regard to the first,','Having regard to an undashed one,','– having regard to the third,','A. whereas one;','1. Calls;'];
  assert.equal(reply(motionText(undashed),'citation:2'),null,'a row the count skips shifts what follows');
  assert.equal(reply(incomplete(5),'citation:1'),'having regard to the first,','an incomplete paragraph 1 does not hide citation 1');
  assert.equal(reply(incomplete(5),'paragraph:1'),null);
});
test('a splice inside a paragraph is part of the provision; one from its number to its end is all of it',()=>{
  const texts=['21.\tStresses that unanimity remains a principle; calls for reform.  '];
  const splice=(start,end)=>({start:{paragraph:0,offset:start},end:{paragraph:0,offset:end}});
  assert.equal(partOfProvision({operation:'replace',splice:splice(0,texts[0].length)},texts),false);
  assert.equal(partOfProvision({operation:'replace',splice:splice(4,texts[0].trimEnd().length)},texts),false,'after the number is still the whole text');
  assert.equal(partOfProvision({operation:'replace',splice:splice(4,40)},texts),true);
  assert.equal(partOfProvision({operation:'delete',splice:splice(20,texts[0].length)},texts),true);
  assert.equal(partOfProvision({operation:'insert',splice:splice(20,20)},texts),false);
  assert.equal(partOfProvision({operation:'replace'},texts),false,'no splice: the placement covers whole paragraphs');
  const reply=documentPassageReply(context({placement:{operation:'replace',status:'placed',itemIndex:0,span:{start:1,end:1},splice:{start:{paragraph:1,offset:6},end:{paragraph:1,offset:7}},originalText:'(2)\tTwo',evidence:[]}}));
  assert.equal(reply.passage.part,true);
});

