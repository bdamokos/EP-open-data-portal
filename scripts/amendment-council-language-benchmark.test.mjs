import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {options,assessPlacement,compare} from './amendment-council-language-benchmark.mjs';

const p=(index,text,path,complete=true)=>({index,text,source:{path,complete},complete,objects:[]});
const predecessor=[{numericPath:'/1/2/4/1',text:'(d) the complete provision'},{numericPath:'/1/2/4/2',text:'(i) first condition'},{numericPath:'/1/2/4/3',text:'(ii) second condition'}];
const boundary={operation:'insert',state:'native-boundary-verified',predecessor:{numericPath:'/1/2/4'},predecessorRows:predecessor,followingRows:[{numericPath:'/1/2/5/1',text:'(e) next provision'}]};
const projection={paragraphs:[p(40,predecessor[0].text,predecessor[0].numericPath),p(41,predecessor[1].text,predecessor[1].numericPath),p(42,predecessor[2].text,predecessor[2].numericPath),p(43,'(e) next provision','/1/2/5/1')]};
const insertion={operation:'insert',status:'placed',itemIndex:0,insertAfter:42,insertBefore:43};

test('offline CLI requires an explicit fixed runtime and zero request cap',()=>{
  const valid=['--snapshot','/external/snapshot.json','--runtime-root','/checkout','--output-dir','/external/results','--request-cap','0'];
  assert.equal(options(valid).cap,'0');
  for(const args of [[],valid.slice(0,-2),[...valid.slice(0,-1),'1'],[...valid,'--fetch'],[...valid,'--api-base','https://example.org'],[...valid,'--record-language-baseline']])assert.throws(()=>options(args));
});

test('an insertion must follow the complete predecessor including every Roman child',()=>{
  assert.equal(assessPlacement(insertion,boundary,projection).outcome,'legal-correct');
  assert.equal(assessPlacement({...insertion,insertAfter:40,insertBefore:41},boundary,projection).outcome,'false-placement');
  const missing=structuredClone(projection);missing.paragraphs.splice(2,1);
  assert.equal(assessPlacement(insertion,boundary,missing).outcome,'false-placement');
  const incomplete=structuredClone(projection);incomplete.paragraphs[1].complete=false;
  assert.equal(assessPlacement(insertion,boundary,incomplete).outcome,'false-placement');
  const wrongOwner=structuredClone(projection);wrongOwner.paragraphs[1].source.path='/1/9/4/2';
  assert.equal(assessPlacement(insertion,boundary,wrongOwner).outcome,'false-placement');
});

test('an article inserted at a chapter end stays before both following heading rows',()=>{
  const assertion={operation:'insert',state:'native-boundary-verified',predecessor:{numericPath:'/1/3/1/5'},predecessorRows:[{numericPath:'/1/3/1/5/1',text:'Article 4'},{numericPath:'/1/3/1/5/2',text:'Complete final paragraph.'}],followingRows:[{numericPath:'/1/3/2/1',text:'CHAPTER II'},{numericPath:'/1/3/2/2',text:'Requirements'}]};
  const proposal={paragraphs:[p(130,'Article 4','/1/3/1/5/1'),p(131,'Complete final paragraph.','/1/3/1/5/2'),p(132,'CHAPTER II','/1/3/2/1'),p(133,'Requirements','/1/3/2/2')]};
  const placed={operation:'insert',status:'placed',itemIndex:0,insertAfter:131,insertBefore:132};
  assert.equal(assessPlacement(placed,assertion,proposal).outcome,'legal-correct');
  assert.equal(assessPlacement({...placed,insertAfter:133,insertBefore:134},assertion,proposal).outcome,'false-placement');
  proposal.paragraphs[3].text='Another heading';
  assert.equal(assessPlacement(placed,assertion,proposal).outcome,'false-placement');
});

test('Irish spelling conflicts and typed-note application cannot receive legal placement credit',()=>{
  const placed={operation:'replace',status:'placed',itemIndex:0};
  assert.equal(assessPlacement(placed,{operation:'replace',state:'source-orthography-conflict'},{}).outcome,'false-placement');
  const held=assessPlacement(placed,{operation:'replace',state:'typed-note-equivalence-held'},{});
  assert.equal(held.outcome,'placed-unverified');assert.equal(held.gateFailure,true);
  assert.equal(assessPlacement({operation:'replace',status:'unresolved',reason:'conflicting_target_evidence'},{operation:'replace',state:'typed-note-equivalence-held'},{}).outcome,'withheld');
});

test('complete replacement assertions reject partial spans and changed characters',()=>{
  const assertion={operation:'replace',state:'native-correspondence-verified',native:{numericPath:'/1/2/7'},contentRows:[{numericPath:'/1/2/7/1',text:'(34) Exact legal wording.'}]};
  const proposal={paragraphs:[p(45,'(34) Exact legal wording.','/1/2/7/1')]};
  const placed={operation:'replace',status:'placed',itemIndex:0,span:{start:45,end:45},splice:{start:{paragraph:45,offset:0},end:{paragraph:45,offset:25}}};
  assert.equal(assessPlacement(placed,assertion,proposal).outcome,'legal-correct');
  assert.equal(assessPlacement({...placed,splice:{start:{paragraph:45,offset:5},end:{paragraph:45,offset:25}}},assertion,proposal).outcome,'false-placement');
  proposal.paragraphs[0].text='(34) Exact legal wording!';
  assert.equal(assessPlacement(placed,assertion,proposal).outcome,'false-placement');
});

const wrap=rows=>({snapshotSha256:'same-inputs',expectedAssertionsSha256:'same-native-assertions',canonicalOracleFingerprint:'unchanged',harness:{native:'fixed'},runtime:{head:'exact'},rows});
const row={key:'list:6:en',identity:{language:'en',sourceHash:'original'},outcome:'placed-unverified',placement:insertion};
test('comparison protects every previous placement, including unverified boundaries and source identities',()=>{
  const base=wrap([row]);assert.equal(compare(structuredClone(base),base).failed,false);
  for(const change of [r=>r.placement.insertBefore++,r=>r.placement.operation='replace',r=>r.identity.sourceHash='different',r=>r.identity.language='fr']){
    const next=structuredClone(base);change(next.rows[0]);assert.equal(compare(next,base).failed,true);
  }
  assert.equal(compare(wrap([]),base).failed,true);
  assert.equal(compare(wrap([{...row,key:'other'}]),base).failed,true);
  assert.equal(compare(wrap([{...row,gateFailure:true}]),base).failed,true);
  assert.throws(()=>compare({...base,expectedAssertionsSha256:'changed'},base));
  assert.throws(()=>compare({...base,harness:{native:'changed'}},base));
  assert.throws(()=>compare(wrap([row,row]),base));
  const correct=wrap([{...row,outcome:'legal-correct'}]);
  assert.equal(compare(wrap([row]),correct).failed,true);
});

test('native verifier preserves exact Word characters without importing runtime parsers',async()=>{
  const source=await readFile(new URL('./amendment-council-language-native.py',import.meta.url),'utf8');
  assert.doesNotMatch(source,/proposal.structure|parseTarget|normaliseForMatching|amendment.language.oracle/);
  const program=`import importlib.util,json,sys\nsys.dont_write_bytecode=True\ns=importlib.util.spec_from_file_location('native',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nassert m.fold('n\\u2011áireofaí') != m.fold('n áireofaí')\nassert m.fold('l’édition') != m.fold(\"l'édition\")\nfor value in [b'<!ENTITY x SYSTEM \\\"file:///invalid\\\"><a/>',b'<!DOCTYPE a SYSTEM \\\"https://example.org/\\\"><a/>']:\n try:m.parse_xml(value)\n except ValueError:pass\n else:raise AssertionError('external declaration accepted')\nprint('native character and declaration checks passed')`;
  assert.match(execFileSync('python3',['-c',program,new URL('./amendment-council-language-native.py',import.meta.url).pathname],{encoding:'utf8'}),/passed/);
});
