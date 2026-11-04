import test from 'node:test';
import assert from 'node:assert/strict';
import {ProvisionalAgreement,provisionalAgreementQuery,PROVISIONAL_AGREEMENT_VERSION} from './provisional-agreement.mjs';
import {documentContextQuery} from './document-context.mjs';
import {HttpError} from './http-utils.mjs';

const report='A-10-2025-0061',amendmentId=report+'-AM-299',listId=report+'-AM-299-299',ta='TA-10-2026-0171';
const url=`https://data.europarl.europa.eu/distribution/reds_iPlRp_Amd/${listId}/${listId}_en.docx`;
const params=(extra={})=>new URLSearchParams({lang:'en',amendment:amendmentId,list:listId,'wording-lang':'en',...extra});
const stub=['Position of the European Parliament adopted at first reading',"(As an agreement was reached between Parliament and Council, Parliament's position corresponds to the final legislative act, Regulation (EU) 2026/1386.)"];
const full=['Position of the European Parliament adopted at first reading','(1)\tThe Union welcomes foreign investments.','Article 1'];
const adoptedItem=(id,date='2026-05-19',to=report)=>({id,date,kind:'TEXT_ADOPTED',relationship:{from:id,field:'adopts',to}});
function harness({paragraphs=stub,placement,decisions,items,relatedStatus='available',texts=[],proposal,status='available',textLanguage='en',variantReferences=[{field:'DocRef',raw:'(COM(2024)0023 – C9-0011/2024 – 2024/0017(COD))'}]}={}) {
  const calls={context:[],request:[],text:[],proposal:[]};
  const operation=placement===undefined?{status:'document-operation',operation:'replace',scope:'whole-document',reason:'provisional_agreement',evidence:[{basis:'exact-provisional-agreement',reference:amendmentId,sourceUrl:url,language:'en',fetchedAt:'2026-11-04T08:00:00.000Z'}]}:placement;
  const context={query:async query=>{
    calls.context.push(query.adopted?'adopted':'amendment');
    if(query.adopted)return {documentId:report,related:{status:relatedStatus,items:items??[adoptedItem(ta)],gaps:[]},sources:[{url:'https://data.europarl.europa.eu/api/v2/procedures/2024-0017',fetchedAt:'2026-11-04T08:00:00.000Z'}]};
    return {documentId:report,placement:operation,amendment:{id:amendmentId,variants:[{listId,language:'en',source:{url},documentReferences:variantReferences}]},target:{evidence:null}};
  }};
  const taRecord={id:'eli/dl/doc/'+ta,identifier:ta,work_type:'def/ep-document-types/TEXT_ADOPTED',document_date:'2026-05-19',adopts:['eli/dl/doc/'+report],parliamentary_term:['org/ep-10']};
  const request=async endpoint=>{calls.request.push(endpoint);return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.UTC(2026,10,4),payload:{data:[taRecord]}};};
  const readText=async(work,language,options)=>{calls.text.push([work.identifier,language,options]);return {status,textLanguage,paragraphs};};
  const readProposal=async options=>{calls.proposal.push(options);return proposal??{status:'identified',celex:'52024PC0023',workId:'w',evidence:[{kind:'cellar-source',url:'https://publications.europa.eu/resource/celex/52024PC0023',fetchedAt:'2026-11-04T08:00:01.000Z'}]};};
  const findAmendment=()=>({id:amendmentId,targetDocumentId:report,decisions:decisions??[{id:'d1',date:'2026-05-19',reference:'Provisional agreement',amendmentIds:[amendmentId],source:{url:'https://data.europarl.europa.eu/api/v2/x',fetchedAt:'2026-11-04T08:00:00.000Z'}}]});
  return {view:new ProvisionalAgreement({context,request,readText,readProposal,findAmendment}),calls};
}
const ask=(view,extra)=>view.query(provisionalAgreementQuery(report,params(extra)));

test('the query accepts only an exact report, amendment, list and wording language',()=>{
  assert.equal(provisionalAgreementQuery(report,params()).wordingLanguage,'en');
  for(const bad of [new URLSearchParams({lang:'en'}),new URLSearchParams({amendment:amendmentId}),params({extra:'1'}),(()=>{const p=params();p.delete('wording-lang');return p;})()])assert.throws(()=>provisionalAgreementQuery(report,bad),HttpError);
  assert.throws(()=>provisionalAgreementQuery('TA-10-2026-0171',params()),HttpError);
});

test('a stub adopted text shows the agreement file and links the exact final act',async()=>{
  const {view,calls}=harness();
  const result=await ask(view);
  assert.equal(result.version,PROVISIONAL_AGREEMENT_VERSION);assert.equal(result.status,'verified');
  assert.deepEqual(result.agreement,{listId,language:'en',url});
  assert.deepEqual(result.adoptedText,{id:ta,url:`https://www.europarl.europa.eu/doceo/document/${ta}_EN.html`});
  assert.deepEqual(result.text,{documentId:listId,kind:'agreement'});
  assert.deepEqual(result.finalAct,{label:'Regulation (EU) 2026/1386',type:'reg',year:2026,number:1386,url:'https://eur-lex.europa.eu/eli/reg/2026/1386/oj'});
  assert.deepEqual(result.proposal,{reference:'COM(2024)0023',year:'2024',number:'0023',url:'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52024PC0023'});
  assert.deepEqual(calls.context,['amendment','adopted']);assert.deepEqual(calls.request,['/adopted-texts/'+ta]);
  assert.deepEqual(calls.text,[[ta,'en',{enqueue:false}]]);
  assert.deepEqual(calls.proposal,[{reportId:report,language:'en',documentReferences:[{field:'DocRef',raw:'(COM(2024)0023 – C9-0011/2024 – 2024/0017(COD))'}],identityOnly:true}]);
  assert(result.sources.length>=3);
});

test('an adopted text that holds the position is shown, with no final act link',async()=>{
  const result=await ask(harness({paragraphs:full}).view);
  assert.deepEqual(result.text,{documentId:ta,kind:'adopted-text'});assert.equal(result.finalAct,null);assert.equal(result.adoptedText.id,ta);
});

test('a final act statement without an exact number links nothing',async()=>{
  const result=await ask(harness({paragraphs:[stub[0],stub[1].replace('2026/1386','2026/…')]}).view);
  assert.equal(result.finalAct,null);assert.equal(result.text.kind,'agreement');
});

test('an unreadable or non-English adopted text falls back to the agreement file',async()=>{
  for(const options of [{status:'unavailable'},{status:'error'},{textLanguage:'fr'}]) {
    const result=await ask(harness(options).view);
    assert.deepEqual(result.text,{documentId:listId,kind:'agreement'},JSON.stringify(options));assert.equal(result.finalAct,null);assert.equal(result.adoptedText.id,ta);
  }
});

test('before a vote, or when the vote date binds no single adopted text, only the agreement file is shown',async()=>{
  const none=await ask(harness({decisions:[]}).view);
  assert.equal(none.status,'verified');assert.equal(none.adoptedText,null);assert.deepEqual(none.text,{documentId:listId,kind:'agreement'});assert.equal(none.finalAct,null);
  const twoDates=[{id:'d1',date:'2026-05-19'},{id:'d2',date:'2026-05-20'}].map(item=>({...item,reference:'Provisional agreement',amendmentIds:[amendmentId],source:{url:'https://data.europarl.europa.eu/api/v2/x',fetchedAt:'2026-11-04T08:00:00.000Z'}}));
  assert.equal((await ask(harness({decisions:twoDates}).view)).adoptedText,null);
  const wrongDate=await ask(harness({items:[adoptedItem(ta,'2026-05-20')]}).view);
  assert.equal(wrongDate.adoptedText,null);
  const otherReport=await ask(harness({items:[adoptedItem(ta,'2026-05-19','A-10-2025-0062')]}).view);
  assert.equal(otherReport.adoptedText,null);
  const competing=await ask(harness({items:[adoptedItem('TA-10-2026-0170'),adoptedItem(ta)]}).view);
  assert.equal(competing.adoptedText,null);
  const earlier=await ask(harness({items:[adoptedItem('TA-10-2025-0102','2025-05-08'),adoptedItem(ta)]}).view);
  assert.equal(earlier.adoptedText.id,ta);
  const partial=await ask(harness({relatedStatus:'partial'}).view);
  assert.equal(partial.adoptedText,null);assert.deepEqual(partial.text,{documentId:listId,kind:'agreement'});
});

test('the COM number is plain text unless the proposal identity passes',async()=>{
  for(const proposal of [{status:'unresolved',gaps:['ambiguous-com-candidates']},{status:'identified',celex:'52024PC0099'},{status:'unavailable'}]) {
    const result=await ask(harness({proposal}).view);
    assert.deepEqual(result.proposal,{reference:'COM(2024)0023',year:'2024',number:'0023',url:null},JSON.stringify(proposal));
  }
  const view=new ProvisionalAgreement({...harness().view,readProposal:async()=>{throw new Error('Cellar unavailable');}});
  assert.deepEqual((await ask(view)).proposal,{reference:'COM(2024)0023',year:'2024',number:'0023',url:null});
  for(const variantReferences of [[],[{field:'DocRef',raw:'COM(2024)0023 and COM(2024)0024'}],[{field:'Other',raw:'COM(2024)0023'}]]) {
    const {view,calls}=harness({variantReferences});
    assert.equal((await ask(view)).proposal,null);assert.deepEqual(calls.proposal,[]);
  }
});

test('anything but the verified exact provisional placement reveals no links',async()=>{
  const wrong=[null,{status:'unresolved'},{status:'document-operation',operation:'reject',scope:'whole-document',reason:'rejects_proposal',evidence:[]},
    {status:'document-operation',operation:'replace',scope:'whole-document',reason:'provisional_agreement',evidence:[{basis:'exact-provisional-agreement',reference:amendmentId+'0',sourceUrl:url,language:'en'}]},
    {status:'document-operation',operation:'replace',scope:'whole-document',reason:'provisional_agreement',evidence:[{basis:'exact-provisional-agreement',reference:amendmentId,sourceUrl:url,language:'fr'}]},
    {status:'document-operation',operation:'replace',scope:'whole-document',reason:'provisional_agreement',evidence:[{basis:'exact-provisional-agreement',reference:amendmentId,sourceUrl:'https://example.test/x.docx',language:'en'}]},
    {status:'document-operation',operation:'replace',scope:'whole-document',reason:'provisional_agreement',evidence:[{basis:'exact-provisional-agreement',reference:amendmentId,sourceUrl:url.replace(listId+'/'+listId,report+'-AM-300-300/'+report+'-AM-300-300'),language:'en'}]}];
  for(const placement of wrong) {
    const {view,calls}=harness({placement});
    const result=await ask(view);
    assert.equal(result.status,'unavailable');assert.equal(result.agreement,null);assert.equal(result.text,null);
    assert.deepEqual(calls.context,['amendment']);assert.deepEqual(calls.proposal,[]);
  }
});

test('plenary amendment lists are readable only as documents of their own',()=>{
  assert.equal(documentContextQuery(listId,new URLSearchParams({lang:'en'})).id,listId);
  for(const bad of [{amendment:amendmentId},{adopted:'1'},{list:listId}])assert.throws(()=>documentContextQuery(listId,new URLSearchParams(bad)),HttpError);
  assert.throws(()=>documentContextQuery('A-10-2025-0061-AM-x-299',new URLSearchParams()),HttpError);
});
