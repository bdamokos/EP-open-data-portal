import test from 'node:test';
import assert from 'node:assert/strict';
import {createMotionComparison} from './motion-comparison.mjs';
import {motionBody,compareMotionBodies,wordDiff,DIFF_LIMITS} from './motion-diff.mjs';

const original='B-10-2026-0441',joint='RC-10-2026-0441',adopted='TA-10-2026-0339';
function work(id,type,extra={}) {
  return {id:'eli/dl/doc/'+id,identifier:id,work_type:'def/'+type,document_date:'2026-10-08',
    is_realized_by:['en','fr'].map(lang=>({language:'language/'+(lang==='en'?'ENG':'FRA'),is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:`distribution/example/${id}_${lang}.docx`}]})),...extra};
}
function scenario() {
  const records=new Map([
    ['/plenary-documents/'+original,work(original,'RESOLUTION_MOTION')],
    ['/plenary-documents/'+joint,work(joint,'RESOLUTION_MOTION_JOINT',{is_derivative_of:['eli/dl/doc/'+original],inverse_created_a_realization_of:['eli/dl/proc/2026-2907']})],
    ['/procedures/2026-2907',{id:'eli/dl/proc/2026-2907',created_a_realization_of:['eli/dl/doc/'+adopted]}],
    ['/adopted-texts/'+adopted,work(adopted,'TEXT_ADOPTED',{adopts:['eli/dl/doc/'+joint,'eli/dl/doc/'+original]})],
  ]),calls=[];
  const request=async endpoint=>{calls.push(endpoint);const node=records.get(endpoint);if(node instanceof Error)throw node;return {payload:{data:node?[node]:[]},fetchedAt:Date.parse('2026-10-16T15:00:00Z'),url:'https://data.europarl.europa.eu/api/v2'+endpoint};};
  const readText=async(node,language)=>({status:'available',textLanguage:language,sourceUrl:`https://data.europarl.europa.eu/distribution/example/${node.identifier}_${language}.docx`,fetchedAt:'2026-10-16T15:00:00Z',
    paragraphs:['Cover title','The European Parliament,','A.\tWhereas public elections matter;',node.identifier===original?'1.\tCalls for the immediate release of all election monitors;':'1.\tCalls for the immediate and unconditional release of all election monitors;'],notes:[]});
  return {records,calls,request,readText,compare:createMotionComparison({request,readText})};
}
test('original/joint comparisons require an exact derivative link and fetch no adopted catalogue',async()=>{
  const s=scenario(),result=await s.compare(original,joint);
  assert.equal(result.status,'available');assert.equal(result.summary.changed,1);assert.equal(result.summary.unchanged,1);
  assert.deepEqual(s.calls.sort(),['/plenary-documents/'+original,'/plenary-documents/'+joint].sort());
  s.records.get('/plenary-documents/'+joint).is_derivative_of=['eli/dl/doc/B-10-2026-0449'];
  await assert.rejects(()=>s.compare(original,joint),error=>error.status===422);
  for(const [a,b,options] of [['invalid',joint,{}],[original,joint,{stage:'other'}],[original,joint,{language:'xx'}]])
    await assert.rejects(()=>s.compare(a,b,options),error=>error.status===400);
});
test('adopted texts are selected only by an explicit adopts link, with every candidate checked',async()=>{
  const s=scenario();
  for(const stage of ['original-adopted','joint-adopted']) {
    const result=await s.compare(original,joint,{stage});assert.equal(result.status,'available');
    assert.equal(result.documents[1].id,adopted);assert.equal(result.documents[0].id,stage==='joint-adopted'?joint:original);
    assert(result.sources.some(source=>source.url.includes('/adopted-texts/')));
  }
  s.records.get('/adopted-texts/'+adopted).adopts=['eli/dl/doc/'+original];
  assert.equal((await s.compare(original,joint,{stage:'original-adopted'})).status,'unavailable','an original adoption link alone cannot establish adoption of its joint motion');
  s.records.get('/adopted-texts/'+adopted).adopts=[{id:'https://data.europarl.europa.eu/eli/dl/doc/'+joint}];
  const second='TA-10-2026-0340';s.records.get('/procedures/2026-2907').created_a_realization_of.push('eli/dl/doc/'+second);
  s.records.set('/adopted-texts/'+second,work(second,'TEXT_ADOPTED',{adopts:['eli/dl/doc/'+joint]}));
  assert.match((await s.compare(original,joint,{stage:'joint-adopted'})).reason,/More than one/);
  s.records.set('/adopted-texts/'+second,new Error('Missing candidate'));
  await assert.rejects(()=>s.compare(original,joint,{stage:'joint-adopted'}),/Missing candidate/);
});
test('language selection uses the intersection and reports actual fallback, unavailable text and stale provenance',async()=>{
  const s=scenario();
  const fallback=await s.compare(original,joint,{language:'hu'});assert.equal(fallback.textLanguage,'en');assert.equal(fallback.requestedLanguage,'hu');assert.deepEqual(fallback.availableLanguages,['en','fr']);
  s.records.get('/plenary-documents/'+original).is_realized_by=s.records.get('/plenary-documents/'+original).is_realized_by.slice(1);
  assert.equal((await s.compare(original,joint,{language:'en'})).textLanguage,'fr');
  s.records.get('/plenary-documents/'+joint).is_realized_by=s.records.get('/plenary-documents/'+joint).is_realized_by.slice(0,1);
  assert.match((await s.compare(original,joint)).reason,/no common language/);
  const failing=createMotionComparison({request:s.request,readText:async(node,lang)=>({...await s.readText(node,lang),status:'error'})});
  s.records.get('/plenary-documents/'+original).is_realized_by=work(original,'RESOLUTION_MOTION').is_realized_by;
  assert.equal((await failing(original,joint)).status,'unavailable');
  const stale=createMotionComparison({request:async(...args)=>({...await s.request(...args),stale:true,refreshError:'Failed refresh'}),readText:s.readText});
  const result=await stale(original,joint);assert.equal(result.status,'available');assert(result.sources.every(source=>source.stale && source.refreshError==='Failed refresh'));
  const wrongLanguage=createMotionComparison({request:s.request,readText:async(node,lang)=>({...await s.readText(node,lang),textLanguage:'fr'})});
  assert.match((await wrongLanguage(original,joint)).reason,/common text language/);
});
test('body extraction excludes covers while preserving citations, numbered references and footnotes',()=>{
  const body=motionBody({paragraphs:['European Parliament','Authors on behalf of groups','The European Parliament,','–\thaving regard to public data,','A.\twhereas records matter;','1.\tCalls for action[1];'],notes:[{label:'1',text:'A public citation.'}]},'en');
  assert.equal(body.status,'available');assert.deepEqual(body.blocks.map(b=>b.kind),['citation','recital','paragraph','footnote']);
  assert.equal(body.blocks[2].label,'1');assert(!JSON.stringify(body).includes('Authors'));
  assert.equal(motionBody({paragraphs:['Unknown opening','1. Body']},'en').status,'unavailable');
  assert.equal(motionBody({paragraphs:['The European Parliament,','1. Body'],extractionWarnings:['Numbering unavailable']},'en').status,'unavailable');
  assert.equal(motionBody({paragraphs:['Le Parlement européen,','1.\tTexte public.']},'fr').status,'available');
  const anchored=motionBody({paragraphs:['The European Parliament,','1.\tPublic text.'],notes:[{id:'2',label:'1',text:'Citation.'}],noteAnchors:[{paragraph:1,offset:15,note:'2',label:'1'}]},'en');
  assert.equal(anchored.blocks[0].text,'Public text.[1]');
  assert.equal(motionBody({paragraphs:['The European Parliament,',...Array(DIFF_LIMITS.paragraphs+1).fill('1. Body')]},'en').status,'unavailable');
});
const block=(label,text,kind='paragraph')=>({index:Number(label)-1,kind,label,text});
test('matching translated cover headings are excluded using the following resolution structure',()=>{
  for(const [language,heading] of [['cs','Evropský parlament'],['da','Europa-Parlamentet'],['et','Euroopa Parlament'],['hr','Europski parlament'],['lv','Eiropas Parlaments'],['hu','Az Európai Parlament'],['mt','Il-Parlament Ewropew'],['fi','Euroopan parlamentti'],['sv','Europaparlamentet']]) {
    const body=motionBody({paragraphs:[heading,'2024-2029','B10-0441/2026','6.10.2026','Cover title','Author',heading+',','–\tPublic citation.','A.\tPublic recital.','1.\tPublic paragraph.']},language);
    assert.equal(body.status,'available',language);
    assert.deepEqual(body.blocks.map(b=>[b.kind,b.text]),[['citation','Public citation.'],['recital','Public recital.'],['paragraph','Public paragraph.']],language);
  }
});
test('plain headings require resolution structure and competing body boundaries remain explicit gaps',()=>{
  assert.equal(motionBody({paragraphs:['Evropský parlament','2024-2029','Cover title','Author']},'cs').status,'unavailable');
  assert.equal(motionBody({paragraphs:['Evropský parlament','1. Public paragraph.']},'cs').status,'available');
  assert.equal(motionBody({paragraphs:['Evropský parlament,','– First candidate.','Evropský parlament,','1. Second candidate.']},'cs').status,'unavailable');
});
test('alignment retains renumbered/moved exact passages and leaves ambiguous rewrites separate',()=>{
  const result=compareMotionBodies([block('1','Calls for public access.'),block('2','Supports independent observers.')],[block('1','Supports independent observers.'),block('2','Calls for public access.')]);
  assert.equal(result.summary.unchanged,2);assert.equal(result.summary.referenceChanged,2);assert.equal(result.summary.removed,0);
  assert.deepEqual(result.rows.map(row=>row.before.label),['2','1']);
  const ambiguous=compareMotionBodies([block('1','Calls for the immediate release of all prisoners.')],[block('1','Calls for the immediate release of all detainees.'),block('2','Calls for the immediate release of all activists.')]);
  assert.equal(ambiguous.summary.changed,0);assert.equal(ambiguous.summary.removed,1);assert.equal(ambiguous.summary.added,2);
});
test('word diff preserves decimal separator and punctuation changes without parsing numbers or using locale',()=>{
  for(const [before,after] of [['turnout of 59.58 %','turnout of 59,58 %'],['having regard to the UN Charter','having regard to the UN Charter,'],['Does support this.','Does not support this.'],['Public '.repeat(600),'Public new '.repeat(600)]]) {
    const parts=wordDiff(before,after);
    assert.equal(parts.filter(p=>p.type!=='added').map(p=>p.text).join(''),before);
    assert.equal(parts.filter(p=>p.type!=='removed').map(p=>p.text).join(''),after);
    assert(parts.some(p=>p.type!=='equal'));
  }
  assert.deepEqual(wordDiff('59.58','59,58'),[{type:'equal',text:'59'},{type:'removed',text:'.'},{type:'added',text:','},{type:'equal',text:'58'}]);
});
