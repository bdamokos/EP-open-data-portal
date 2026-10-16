import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {findReferences,referenceSegments,referenceKey,referenceKeys,documentCelexCandidates,questionCandidates,cellarProcedureReference,linkedSegments,noteReferenceKeys,referenceFromUrl} from './legal-reference-text.mjs';
import {LegalReferences,parseCelex,parseCellar,referencesQuery,celexQuery,cellarQuery} from './legal-references.mjs';
import {parseSummaryPage} from './official-context.mjs';

const keys=text=>findReferences(text).map(ref=>[ref.key,ref.text]);
// Citation forms observed in 2026 written questions and Commission answers.
test('official reference numbers map to exact lookup keys',()=>{
  assert.deepEqual(keys('Regulation (EU) 2016/679 and Directive (EU) 2019/1937.'),[['celex:32016R0679','Regulation (EU) 2016/679'],['celex:32019L1937','Directive (EU) 2019/1937']]);
  assert.deepEqual(keys('Regulation (EC) No 139/2004, Regulation 1013/2006 and Council Regulation (EEC) No 2913/92'),[['celex:32004R0139','Regulation (EC) No 139/2004'],['celex:32006R1013','Regulation 1013/2006'],['celex:31992R2913','Regulation (EEC) No 2913/92']]);
  assert.deepEqual(keys('Regulation (EU) No 1093/2010'),[['celex:32010R1093','Regulation (EU) No 1093/2010']]);
  assert.deepEqual(keys('Directive 2002/49/EC, Directive 85/374/EEC, Decision No 1082/2013/EU, Council Decision (CFSP) 2023/123'),[['celex:32002L0049','Directive 2002/49/EC'],['celex:31985L0374','Directive 85/374/EEC'],['celex:32013D1082','Decision No 1082/2013/EU'],['celex:32023D0123','Decision (CFSP) 2023/123']]);
  assert.deepEqual(keys('ELI: http://data.europa.eu/eli/reg/2004/139/oj. See https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex:52024DC0225.'),[['celex:32004R0139','http://data.europa.eu/eli/reg/2004/139/oj'],['celex:52024DC0225','https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex:52024DC0225']]);
  assert.deepEqual(keys('COM(2023) 139 final, SWD(2025)12 and JOIN(2023) 8'),[['com:2023/139','COM(2023) 139 final'],['swd:2025/12','SWD(2025)12'],['join:2023/8','JOIN(2023) 8']]);
  assert.deepEqual(keys('procedure 2025/0407(COD) and question E-002215/2025, see https://www.europarl.europa.eu/doceo/document/E-10-2025-002215-ASW_EN.html'),[['procedure:2025/0407(COD)','2025/0407(COD)'],['question:E-2025-002215','E-002215/2025'],['question:E-2025-002215','https://www.europarl.europa.eu/doceo/document/E-10-2025-002215-ASW_EN.html']]);
});
test('glued footnote numbers, treaty CELEX numbers and unsupported years are not guessed',()=>{
  // Text saved before footnote extraction can read 139/2004 followed by marker 2.
  assert.deepEqual(keys('Regulation 139/20042 and Regulation (EU) 2021/21162'),[]);
  assert.deepEqual(keys('https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A41976X1008%2801%29'),[]);
  assert.deepEqual(keys('Regulation (EU) 2010/123'),[]);
  assert.deepEqual(keys('E-001234/2008'),[]);
  assert.equal(referenceKey('celex:32016R0679'),'celex:32016R0679');
  for(const value of ['celex:12012E','question:E-2008-000001','com:2025/0','procedure:2025/407(COD)','other:1'])assert.equal(referenceKey(value),null);
});
test('segments preserve every character and duplicate keys are requested once',()=>{
  const text='See Directive 2002/49/EC; the END (Directive 2002/49/EC).';
  assert.equal(referenceSegments(text).map(part=>part.text).join(''),text);
  assert.deepEqual(referenceKeys([text,'COM(2025) 773']),['celex:32002L0049','com:2025/773']);
  assert.deepEqual(documentCelexCandidates('com:2025/773'),['52025PC0773','52025DC0773']);
  assert.deepEqual(questionCandidates('question:E-2024-001234'),['E-9-2024-001234','E-10-2024-001234']);
  assert.deepEqual(questionCandidates('question:E-2025-000002'),['E-10-2025-000002']);
  assert.equal(cellarProcedureReference('2012/0011/COD'),'2012/0011(COD)');
  assert.equal(cellarProcedureReference('2012/0011(COD)'),'2012/0011(COD)');
});
// Links observed in footnotes of Commission answers E-10-2026-000012, -000013 and -000022 (DOCX and PDF carry the same targets).
test('document hyperlinks identify their own text span and take precedence over text patterns',()=>{
  const cellar='https://eur-lex.europa.eu/resource.html?uri=cellar:2bf140bf-a3f8-4ab2-b506-fd71826e6da6.0023.02/DOC_1&format=PDF';
  assert.deepEqual(referenceFromUrl(cellar),{key:'cellar:2bf140bf-a3f8-4ab2-b506-fd71826e6da6',kind:'cellar'});
  assert.deepEqual(referenceFromUrl('https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1767349209985&uri=CELEX%3A32024R1348'),{key:'celex:32024R1348',kind:'celex'});
  assert.deepEqual(referenceFromUrl('https://eur-lex.europa.eu/eli/reg/2021/2116/oj/eng'),{key:'celex:32021R2116',kind:'eli'});
  for(const url of ['https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=uriserv%3AOJ.LI.2020.433.01.0011.01.ENG','https://www.who.int/europe/publications/i/item/9789289053563','file:///C:/template.dotm'])assert.equal(referenceFromUrl(url),null);
  const text='Communication on Regulation (EU) 2021/2116, see here.';
  const parts=linkedSegments(text,[{start:0,end:42,url:'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex:52024DC0225'},{start:48,end:52,url:'https://example.org/page'},{start:40,end:50,url:'https://overlap.example'},{start:3,end:99,url:'https://outside.example'}]);
  assert.equal(parts.map(part=>part.text).join(''),text);
  assert.deepEqual(parts.map(part=>[part.text,part.ref?.key||null,part.ref?.via||null,part.href||null]),[
    ['Communication on Regulation (EU) 2021/2116','celex:52024DC0225','hyperlink','https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex:52024DC0225'],[', see ',null,null,null],['here',null,null,'https://example.org/page'],['.',null,null,null]]);
  assert.equal(linkedSegments('Click',[{start:0,end:5,url:'javascript:alert(1)'}])[0].href,null);
  assert.deepEqual(linkedSegments('Regulation (EU) 2021/2116.').map(part=>[part.text,part.ref?.via||null]),[['Regulation (EU) 2021/2116','text'],['.',null]]);
  assert.deepEqual(noteReferenceKeys({text:'Directive 2002/49/EC of 25 June 2002; see Regulation (EU) 2021/2116.',links:['https://eur-lex.europa.eu/eli/reg/2021/2116/oj/eng'],linkSpans:[{start:0,end:5,url:'https://eur-lex.europa.eu/eli/reg/2021/2116/oj/eng'}]}),['celex:32021R2116','celex:32002L0049']);
});
test('reference queries are bounded and validated',()=>{
  assert.deepEqual(referencesQuery(new URLSearchParams({keys:'celex:32016R0679,celex:32016R0679',lang:'hu'})),{keys:['celex:32016R0679'],language:'hu'});
  assert.throws(()=>referencesQuery(new URLSearchParams({keys:'celex:32016R0679,drop table'})),/not recognised/);
  assert.throws(()=>referencesQuery(new URLSearchParams({keys:Array.from({length:41},(_,i)=>'com:2025/'+(i+1)).join(',')})),/between 1 and 40/);
  assert.throws(()=>referencesQuery(new URLSearchParams('keys=celex:32016R0679&keys=celex:32016R0679')),/repeated/);
  assert.throws(()=>celexQuery(['32016R0679"}'],'en'),/Invalid CELEX/);
  assert.match(celexQuery(['32016R0679'],'hu'),/language\/HUN/);
  assert.throws(()=>cellarQuery(['2bf140bf> } DROP'],'en'),/Invalid Cellar/);
  assert.match(cellarQuery(['2bf140bf-a3f8-4ab2-b506-fd71826e6da6'],'en'),/\?work a cdm:work/);
  assert.equal(referenceKey('cellar:2bf140bf-a3f8-4ab2-b506-fd71826e6da6'),'cellar:2bf140bf-a3f8-4ab2-b506-fd71826e6da6');
});
const work='http://publications.europa.eu/resource/cellar/3e485e15-11bd-11e6-ba9a-01aa75ed71a1';
const uri=value=>({type:'uri',value}),literal=value=>({type:'literal',value});
const row=(celex,extra={})=>({celex:literal(celex),work:uri(work),date:literal('2016-04-27'),...extra});
test('catalogue rows resolve one work, keep unknown status null and prefer the requested language',()=>{
  const data={results:{bindings:[
    row('32016R0679',{force:literal('1'),proc:literal('2012/0011/COD'),lang:uri('http://publications.europa.eu/resource/authority/language/ENG'),title:literal('Regulation (EU) 2016/679 of the European Parliament')}),
    row('32016R0679',{force:literal('1'),proc:literal('2012/0011/COD'),lang:uri('http://publications.europa.eu/resource/authority/language/HUN'),title:literal('Az Európai Parlament (EU) 2016/679 rendelete')}),
    row('52023DC0139',{work:uri('http://publications.europa.eu/resource/cellar/3b081741-c715-11ed-a05c-01aa75ed71a1')}),
    row('32020R0001'),row('32020R0001',{work:uri('http://publications.europa.eu/resource/cellar/00000000-0000-0000-0000-000000000000')}),
    row('32021R0002',{work:literal('not a work')}),
  ]}};
  const parsed=parseCelex(data,['32016R0679','52023DC0139','32020R0001','32021R0002'],'hu');
  assert.deepEqual({...parsed.get('32016R0679'),work:undefined},{status:'found',celex:'32016R0679',work:undefined,title:'Az Európai Parlament (EU) 2016/679 rendelete',titleLanguage:'hu',date:'2016-04-27',inForce:true,procedure:'2012/0011(COD)',eurLexUrl:'https://eur-lex.europa.eu/legal-content/HU/TXT/?uri=CELEX:32016R0679'});
  assert.equal(parsed.get('52023DC0139').inForce,null);assert.equal(parsed.get('52023DC0139').title,null);assert.equal(parsed.get('52023DC0139').procedure,null);
  assert.equal(parsed.get('32020R0001').status,'ambiguous');
  assert.equal(parsed.get('32021R0002').status,'not-found');
  assert.throws(()=>parseCelex({results:{}},['32016R0679'],'en'),/could not be read/);
});
test('a Cellar link resolves only to an existing work and reads its CELEX number from the catalogue',()=>{
  const treaty='http://publications.europa.eu/resource/cellar/2bf140bf-a3f8-4ab2-b506-fd71826e6da6';
  const parsed=parseCellar({results:{bindings:[{work:uri(treaty),celex:literal('12012M/TXT'),lang:uri('http://publications.europa.eu/resource/authority/language/ENG'),title:literal('Consolidated version of the Treaty on European Union')}]}},['2bf140bf-a3f8-4ab2-b506-fd71826e6da6','00000000-0000-0000-0000-000000000001'],'en');
  assert.equal(parsed.get('2bf140bf-a3f8-4ab2-b506-fd71826e6da6').celex,'12012M/TXT');
  assert.equal(parsed.get('2bf140bf-a3f8-4ab2-b506-fd71826e6da6').eurLexUrl,'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:12012M/TXT');
  assert.equal(parsed.get('00000000-0000-0000-0000-000000000001').status,'not-found');
});
test('lookups use exact candidates, verify term-boundary questions and do not cache unavailable results',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'legal-references-'));
  try {
    let sparql=0,requests=[];
    const sources={get:async url=>{sparql++;const query=new URL(url).searchParams.get('query');assert.match(query,/"52025PC0773"/);assert.match(query,/"52025DC0773"/);
      return {url,fetchedAt:'2026-10-15T00:00:00.000Z',data:{results:{bindings:[row('52025PC0773',{proc:literal('2025/0407/COD'),lang:uri('http://publications.europa.eu/resource/authority/language/ENG'),title:literal('Proposal for a decision')})]}}};}};
    const request=async endpoint=>{requests.push(endpoint);const id=endpoint.split('/').pop();
      if(id==='E-10-2024-001234')throw new Error('Parliament data is unavailable (404). Please try again.');
      if(id==='E-9-2023-000001')throw new Error('Parliament data is unavailable (503). Please try again.');
      return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.parse('2026-10-15T00:00:00Z'),payload:{data:[{identifier:id,title_dcterms:{en:'Question '+id},document_date:'2024-04-24',inverse_answers_to:[{identifier:id+'-ASW'}]}]}};};
    const references=new LegalReferences(sources,{request,directory,clock:()=>Date.parse('2026-10-15T00:00:00Z')});
    const result=await references.query({keys:['com:2025/773','question:E-2024-001234','question:E-2023-000001','procedure:2025/0407(COD)'],language:'en'});
    const [proposal,question,unavailable,procedure]=result.references;
    assert.equal(proposal.status,'found');assert.equal(proposal.celex,'52025PC0773');assert.equal(proposal.kind,'document');assert.equal(proposal.procedure,'2025/0407(COD)');
    assert.equal(question.status,'found');assert.equal(question.id,'E-9-2024-001234');assert.deepEqual(question.answerIds,['E-9-2024-001234-ASW']);
    assert.equal(unavailable.status,'unavailable');
    assert.deepEqual(procedure,{key:'procedure:2025/0407(COD)',kind:'procedure',status:'found',procedure:'2025/0407(COD)'});
    assert.deepEqual(requests.sort(),['/parliamentary-questions/E-10-2024-001234','/parliamentary-questions/E-9-2023-000001','/parliamentary-questions/E-9-2024-001234']);
    requests=[];
    const again=await new LegalReferences({get:async()=>{throw new Error('must use saved lookups');}},{request,directory,clock:()=>Date.parse('2026-10-16T00:00:00Z')}).query({keys:['com:2025/773','question:E-2024-001234','question:E-2023-000001'],language:'en'});
    assert.equal(again.references[0].title,'Proposal for a decision');assert.equal(again.references[1].id,'E-9-2024-001234');assert.equal(again.references[2].status,'unavailable');
    assert.deepEqual(requests,['/parliamentary-questions/E-9-2023-000001']);assert.equal(sparql,1);
    // Two existing records for one printed number stay unresolved.
    const both=await new LegalReferences(sources,{request:async endpoint=>({url:'x',fetchedAt:0,payload:{data:[{identifier:endpoint.split('/').pop()}]}}),directory:null}).query({keys:['question:E-2019-000001'],language:'en'});
    assert.equal(both.references[0].status,'ambiguous');
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('older Legislative Observatory summaries keep hard-wrapped division text as paragraphs',()=>{
  const html=`<html><body><main><div class="small es_product-subtitle"><span>2000/0194(COD)</span> <span class="date"><time datetime="2018-07-01T20:00:00">25/06/2002</time></span></div>
<div class="es_product-content mb-3"><div>PURPOSE : to establish a common EU framework for the assessment and
 management of exposure to environmental noise.
 CONTENT : the aim of this Directive shall be to define a common approach.
 To that end the following actions shall be implemented progressively:
 - the determination of exposure to environmental noise, through noise
 mapping;
 - ensuring that information is made available to the public.</div></div></main></body></html>`;
  const summary=parseSummaryPage(html,'2000/0194(COD)');
  assert.equal(summary.date,'2002-06-25');
  assert.deepEqual(summary.blocks.map(block=>block.text),['PURPOSE : to establish a common EU framework for the assessment and management of exposure to environmental noise.','CONTENT : the aim of this Directive shall be to define a common approach.','To that end the following actions shall be implemented progressively:','- the determination of exposure to environmental noise, through noise mapping;','- ensuring that information is made available to the public.']);
});
