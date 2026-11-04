import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rawResolutionUnits} from './amendment-benchmark-resolution-oracle.mjs';
import {rawProposalAssertion,assertImplicitParagraphLabel} from './amendment-benchmark-proposal-oracle.mjs';
import {verifyPlacement,parseBenchmarkTarget} from './amendment-benchmark-model.mjs';

const proposal=rows=>({sourceKind:'docx',units:[{poison:'The oracle must not inspect the placer tree'}],paragraphs:rows.map(([text,styleId],index)=>({index,text,properties:{styleId},source:{container:'body',complete:true},complete:true}))});
const amendment=(targetLabel,originalText='')=>({targetLabel,originalText,proposedText:'New wording.',language:'en',baseline:'commission-proposal'});
const replace=row=>({status:'placed',operation:'replace',span:{start:row,end:row}});
const insert=before=>({status:'placed',operation:'insert',insertAfter:before-1,insertBefore:before});
const check=(p,target,placement)=>rawProposalAssertion({proposal:p,wording:amendment(target),placement});

test('raw source addresses verify titles, numbered and unnumbered paragraphs and subparagraphs without a parsed tree',()=>{
  const p=proposal([['Article 3','Titrearticle'],['Programme objectives','Titrearticle'],['1. First subparagraph.','ManualNumPar1'],['Second subparagraph.','Text1'],['2. Lead:','ManualNumPar1'],['(a) First point;','Point2'],['(b) Second point.','Point2'],['Article 4','Titrearticle']]);
  for(const [target,row] of [['Article 3 – title',1],['Article 3 – paragraph 1 – subparagraph 1',2],['Article 3 – paragraph 1 – subparagraph 2',3],['Article 3 – paragraph 2 – subparagraph 1 – point b',6],['Article 3 – paragraph 2 – introductory part',4]])assert.equal(check(p,target,replace(row)).status,'verified',target);
  assert.equal(check(p,'Article 3 – paragraph 1 – subparagraph 1',replace(3)).status,'failed');
  assert.equal(check(p,'Article 3 – paragraph 2 – introductory part',replace(5)).status,'failed');
  const unnumbered=proposal([['Article 1','Titrearticle'],['Suspension of a requirement','Normal'],['First published paragraph.','Normal'],['Second published paragraph.','Normal'],['Article 2','Titrearticle']]);
  assert.equal(check(unnumbered,'Article 1 – paragraph 2',replace(3)).status,'verified');
  const combined=proposal([['Article 6\nMinimum recycled content','Titrearticle'],['1. First.','ManualNumPar1'],['Second.','Text1'],['Article 7 \nDesign requirements','Titrearticle']]);
  assert.equal(check(combined,'Article 6 – paragraph 1 – subparagraph 1',replace(1)).status,'verified');
});

test('literal Normal paragraph numbers count only as one complete run in an article without NumPar rows',()=>{
  // COM(2025)580 Article 28 and Article 26 print their numbers as text in Normal rows.
  const p=proposal([['Article 28','Titrearticle'],['1.\tBy 2032 the Commission shall report.','Normal'],['The report shall examine taxation.','Normal'],['Member States shall submit information.','Normal'],['2.\tThe report shall be based on information.','Normal'],['(a)\tfirst;','Point0'],['(b)\tsecond.','Point0'],['Article 29','Titrearticle']]);
  assert.equal(check(p,'Article 28 – paragraph 1 – subparagraph 2',replace(2)).status,'verified');
  assert.equal(check(p,'Article 28 – paragraph 1 – subparagraph 3',replace(3)).status,'verified');
  assert.equal(check(p,'Article 28 – paragraph 1 – subparagraph 2',replace(3)).status,'failed');
  assert.equal(check(p,'Article 28 – paragraph 2 – point b',replace(6)).status,'verified');
  const gap=proposal([['Article 28','Titrearticle'],['1.\tFirst.','Normal'],['Second.','Normal'],['3.\tThird.','Normal'],['Article 29','Titrearticle']]);
  assert.equal(check(gap,'Article 28 – paragraph 1 – subparagraph 2',replace(2)).status,'unverified');
  const mixed=proposal([['Article 28','Titrearticle'],['1.\tFirst.','Normal'],['Second.','Normal'],['2.\tThird.','ManualNumPar1'],['Article 29','Titrearticle']]);
  assert.equal(check(mixed,'Article 28 – paragraph 1 – subparagraph 2',replace(2)).status,'unverified');
});

test('a mixed-style literal paragraph run counts only from the article\'s first row',()=>{
  // COM(2025)580 Article 2 prints paragraph 2 in Point1 and paragraphs 3-4 in Point0 rows.
  const rows=[['Article 2','Titrearticle'],['1.\tFor the purposes of this Directive, tobacco means:','Normal'],['(a)\tcigarettes;','Point0'],['(b)\tcigars;','Point0'],['(c)\tcigarillos;','Point0'],['2.\tRelated products means:','Point1'],['(a)\tliquids;','Point0'],['(b)\tpouches.','Point0'],['3.\tRaw tobacco means leaves.','Point0'],['Article 3','Titrearticle']];
  const p=proposal(rows);
  assert.equal(check(p,'Article 2 – paragraph 1 – point c',replace(4)).status,'verified');
  assert.equal(check(p,'Article 2 – paragraph 2 – point b',replace(7)).status,'verified');
  assert.equal(check(p,'Article 2 – paragraph 1 – point c',replace(7)).status,'failed');
  const definitions=proposal([['Article 2','Titrearticle'],['For the purposes of this Regulation:','Normal'],['1.\t‘term’ means one thing;','Point0'],['2.\t‘other’ means another.','Point0'],['Article 3','Titrearticle']]);
  assert.notEqual(check(definitions,'Article 2 – paragraph 1',replace(2)).status,'verified','a numbered list after an unnumbered lead stays points');
  const original=amendment('Article 2 – paragraph 1 – point c','(c)\tcigarillos;');
  const repeated=proposal([...rows.slice(0,-1),['4.\tA second (c)\tcigarillos; mention.','Point0'],['(c)\tcigarillos;','Point0'],['Article 3','Titrearticle']]);
  const placed={status:'placed',operation:'delete',itemIndex:0,span:{start:4,end:4},splice:{start:{paragraph:4,offset:0},end:{paragraph:4,offset:repeated.paragraphs[4].text.length}}};
  assert.equal(verifyPlacement({placement:placed,wording:{...original,proposedText:''},items:[{proposal:repeated}]}).reason,'oracle-raw-addressed-source-span','a repeated original is verified by its raw address');
});

test('raw insertion assertions check full styled point subtrees and paragraph/article boundaries',()=>{
  const p=proposal([['Article 1','Titrearticle'],['1. Amendments:','ManualNumPar1'],['(1) Article 2 is amended:','Point0'],['(a) the following paragraph is inserted:','Point1'],['‘A quoted replacement,','Normal'],['continued.’;','Normal'],['(b) Another instruction.','Point1'],['(2) Next instruction.','Point0'],['Article 2','Titrearticle']]);
  const target='Article 1 – paragraph 1 – point 1 – point a a (new)';
  assert.equal(check(p,target,insert(6)).status,'verified');
  assert.equal(check(p,target,insert(4)).reason,'oracle-raw-insertion-boundary-mismatch');
  assert.equal(check(p,target,insert(7)).status,'failed');
  const negative='Article 1 – paragraph 1 – point 1 – point -a (new)';
  assert.equal(check(p,negative,insert(3)).status,'verified');
  const firstRoman='Article 1 – paragraph 1 – point 1 – point b – point i (new)';
  assert.equal(check(p,firstRoman,insert(7)).status,'verified');
});

test('raw annex assertions use exact annex identity, published point styles and source EOF',()=>{
  const p=proposal([['ANNEX III','Annexetitre'],['Other annex.','Normal'],['ANNEX IV','Annexetitre'],['Annexes are amended as follows:','Normal'],['(1) First instruction.','Point0number'],['(2) Second instruction:','Point0number'],['(e) Earlier instruction.','Point1letter'],['(f) Point 1 is replaced:','Point1letter'],['‘1. Replacement wording.’;','Text1']]);
  assert.equal(check(p,'Annex IV – paragraph 1 – point 2 – point f',replace(8)).status,'verified');
  assert.equal(check(p,'Annex IV – paragraph 1 – point 2 – point f',replace(6)).status,'failed');
});

test('raw assertions retain unsupported, incomplete and duplicate identities as unverified',()=>{
  const p=proposal([['Article [6]','Titrearticle'],['Title','Titrearticle'],['2. Lead:','ManualNumPar1'],['(d) Wording.','Point1'],['Article [7]','Titrearticle']]);
  assert.equal(check(p,'Article 6 – paragraph 2 – subparagraph 1 – point d',replace(3)).status,'verified');
  p.paragraphs[3].source.complete=false;
  assert.equal(check(p,'Article 6 – paragraph 2 – point d',replace(3)).status,'unverified');
  const duplicated=proposal([['Article 1','Titrearticle'],['1. First.','ManualNumPar1'],['Article 1','Titrearticle'],['1. Second.','ManualNumPar1'],['Article 2','Titrearticle']]);
  assert.equal(check(duplicated,'Article 1 – paragraph 1',replace(1)).status,'unverified');
});

test('raw resolution assertions select the report motion independently and preserve native scripts',()=>{
  const paragraphs=['The European Parliament,','1. Earlier decision.','2. End.','2. MOTION FOR A EUROPEAN PARLIAMENT RESOLUTION','The European Parliament,','1. Main motion.','2. Next.','ANNEX','The European Parliament,','1. Reproduced decision.','2. End.'];
  const text={paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({ordinal,complete:true,container:'body',containerPath:'body',segment:0})),paragraphFormats:paragraphs.map((s,i)=>i===3?{marks:[{kind:'bold',start:0,end:s.length}]}:{})};
  const wording={...amendment('Paragraph 1 a (new)'),baseline:'motion-resolution'};
  assert.equal(verifyPlacement({text,wording,placement:insert(6)}).status,'verified');
  assert.equal(verifyPlacement({text,wording,placement:insert(2)}).status,'failed');
  for(const [language,targetLabel,prefix] of [['bg','Съображение Р','Р.'],['hu','Q preambulumbekezdés','Q.'],['sv','Skäl K','K.'],['sk','Odôvodnenie E','E.']]) {
    const opening=language==='bg'?['Европейският парламент,']:[],paragraphs=[...opening,prefix+' Source wording.','1. Next.'];
    const text={paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({ordinal,complete:true,container:'body',containerPath:'body',segment:0}))};
    const wording={...amendment(targetLabel,'Source wording.'),language,baseline:'motion-resolution'};
    assert.equal(parseBenchmarkTarget(wording).complete,true);
    assert.equal(verifyPlacement({text,wording,placement:replace(opening.length)}).status,'verified',language);
  }
});

test('a Romanian report motion excludes repeated annex and opinion numbering',()=>{
  const paragraphs=['PROPUNERE DE REZOLUȚIE A PARLAMENTULUI EUROPEAN','Parlamentul European,','1. Main motion.','2. Next.','ANEXĂ','1. Annex decision.','2. End.'];
  const text={paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({ordinal,complete:true,container:'body',containerPath:'body',segment:0})),paragraphFormats:paragraphs.map((s,i)=>i===0?{marks:[{kind:'bold',start:0,end:s.length}]}:{})};
  const wording={...amendment('Punctul 1 a (nou)'),language:'ro',baseline:'motion-resolution'};
  assert.equal(verifyPlacement({text,wording,placement:insert(3)}).status,'verified');
  assert.equal(verifyPlacement({text,wording,placement:insert(6)}).status,'failed');
});

test('raw address recovery cannot replace an unavailable object comparison with coordinate-only verification',()=>{
  const p=proposal([['Article 1','Titrearticle'],['1. Source sentence.','ManualNumPar1'],['Article 2','Titrearticle']]);
  const placement={...replace(1),itemIndex:0,splice:{start:{paragraph:1,offset:0},end:{paragraph:1,offset:p.paragraphs[1].text.length}}};
  const wording=amendment('Article 1 – paragraph 1 – subparagraph 1','\uFFFC');
  const result=verifyPlacement({placement,wording,items:[{proposal:p}]});
  assert.equal(result.status,'unverified');
  assert.equal(result.reason,'oracle-object-comparison-unavailable');
});

test('integrated raw resolution assertions retain published Greek and Cyrillic numeric suffixes',async()=>{
  const {examples}=JSON.parse(await readFile(new URL('../server/fixtures/amendment-language-labels.json',import.meta.url),'utf8'));
  const openings={el:'Το Ευρωπαϊκό Κοινοβούλιο,',bg:'Европейският парламент,'};
  for(const example of examples.filter(e=>openings[e.language]&&e.expected.kind==='paragraph')) {
    const paragraphs=[openings[example.language],example.expected.label+'. Published provision.','99. Next provision.','ANNEX'];
    const text={paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({ordinal,complete:true,container:'body',containerPath:'body',segment:0}))};
    const result=rawResolutionUnits(text,example.language);
    assert(result.units.some(unit=>unit.kind==='paragraph'&&unit.label===example.expected.label),example.amendmentId);
  }
});

test('raw proposal recovery cannot override a failed independent operation assertion',()=>{
  const p=proposal([['Article 1','Titrearticle'],['1. Published source sentence.','ManualNumPar1'],['Article 2','Titrearticle']]);
  const wording={...amendment('Article 1 – paragraph 1 – subparagraph 1',p.paragraphs[1].text),proposedText:'Deleted.'};
  const placement={...replace(1),operation:'delete',itemIndex:0,splice:{start:{paragraph:1,offset:0},end:{paragraph:1,offset:p.paragraphs[1].text.length}}};
  assert.equal(verifyPlacement({placement,wording,items:[{proposal:p}]}).status,'verified');
  const wrong=verifyPlacement({placement:{...placement,operation:'replace'},wording,items:[{proposal:p}]});
  assert.equal(wrong.status,'failed');assert.equal(wrong.reason,'oracle-operation-mismatch');
});

test('a published new marker cannot erase an existing address during replacement verification',()=>{
 const p=proposal([['Article 1','Titrearticle'],['1. Amendments:','ManualNumPar1'],['(1) First instruction.','Point0'],['(2) Second instruction.','Point0'],['Article 2','Titrearticle']]);
 // Finnish A-10-2025-0150 AM20 retains (uusi) on point 4 although the
 // comparison replaces wording in the existing fourth proposal instruction.
 assert.equal(check(p,'Article 1 – paragraph 1 – point 2 (new)',replace(3)).status,'verified');
 assert.equal(check(p,'Article 1 – paragraph 1 – point 2 (new)',replace(2)).status,'failed');
});

test('Dutch instructions retain the consecutive list across a numbered added paragraph',async()=>{
 const {oracleInstruction}=await import('./amendment-oracle-grammar.mjs');
 assert.deepEqual(oracleInstruction('59) Aan artikel 115 wordt het volgende lid 4 toegevoegd:','nl'),{value:'59',level:0});
});

test('recorded Dutch AM104 verifies its complete instruction address and independent similarity margin',async()=>{
 const f=JSON.parse(await readFile(new URL('./fixtures/dutch-added-paragraph-oracle.json',import.meta.url)));
 const rows=[...f.root.map(r=>[r.text,r.style]),...Array.from({length:58},(_,i)=>[`${i+1}) Artikel 1 wordt vervangen:`, 'Normal']),[f.instruction59.text,f.instruction59.style],...Array.from({length:4},(_,i)=>[`${i+60}) Artikel 1 wordt vervangen:`, 'Normal']),...f.instruction64.map(r=>[r.text,r.style]),['65) Artikel 1 wordt vervangen:','Normal'],['Artikel 2','Titrearticle']];
 const p=proposal(rows),at=p.paragraphs.findIndex(r=>r.text.startsWith('5. Lidstaten die aan boord'));
 const placement={...replace(at),splice:{start:{paragraph:at,offset:0},end:{paragraph:at,offset:p.paragraphs[at].text.length}}};
 const wording={language:'nl',targetLabel:f.targetLabel,originalText:f.originalText};
 const address=rawProposalAssertion({proposal:p,wording,placement});assert.equal(address.status,'verified');
 const {assertSimilarPlacement}=await import('./amendment-similarity-oracle.mjs');assert.equal(assertSimilarPlacement({proposal:p,wording,placement,address}).status,'verified');
 const damaged=structuredClone(p);damaged.paragraphs.find(r=>r.text===f.instruction59.text).text='59) Onduidelijke instructie.';
 assert.equal(rawProposalAssertion({proposal:damaged,wording,placement}).status,'unverified');
});


test('new subparagraph follows the full native subparagraph including its points',()=>{
  const p=proposal([['Article 3','Titrearticle'],['1. Lead:','ManualNumPar1'],['(a) Point.','Point2'],['Second subparagraph.','Text1'],['Third subparagraph.','Text1'],['2. Next paragraph.','ManualNumPar1'],['Article 4','Titrearticle']]);
  for(const row of p.paragraphs)Object.assign(row.source,{ordinal:row.index,containerPath:'/body',segment:0});
  const label='Article 3 – paragraph 1 – subparagraph 2 a (new)';
  assert.equal(check(p,label,insert(4)).status,'verified');
  assert.equal(check(p,label,insert(3)).status,'failed');
  assert.equal(check(p,'Article 3 – paragraph 1 – subparagraph 1 a (new)',insert(3)).status,'verified');
  assert.equal(check(p,'Article 3 – paragraph 1 – subparagraph 9 a (new)',insert(4)).status,'unverified');
  assert.equal(check(p,'Article 3 – paragraph 1 – subparagraph 2 b (new)',insert(4)).status,'unverified');
  p.paragraphs[4].source.ordinal++;
  assert.equal(check(p,label,insert(4)).status,'unverified');
});
test('a printed paragraph-one prefix may identify a sole implicit paragraph without changing its wording',()=>{
 const make=()=>{
  const p=proposal([['Article [1]','Titrearticle'],['Subject matter','Titrearticle'],['A legal body.','Normal'],['Article [2]','Titrearticle']]);
  p.paragraphs.forEach((p,i)=>Object.assign(p.source,{ordinal:i,containerPath:'body',segment:0}));
  const wording={...amendment('Article 1 – paragraph 1','1. A legal body.'),proposedText:'1. A revised legal body.'},placement={...replace(2),itemIndex:0,splice:{start:{paragraph:2,offset:0},end:{paragraph:2,offset:13}}};
  return {proposal:p,wording,placement};
 };
 const a=make();Object.defineProperty(a.proposal,'units',{get(){throw Error('tree forbidden');}});assert.equal(assertImplicitParagraphLabel(a).status,'verified');assert.equal(verifyPlacement({...a,items:[{proposal:a.proposal}]}).status,'verified');
 for(const mutate of [a=>a.placement.splice.start.offset++,a=>a.placement.span.end++]){const a=make();mutate(a);assert.equal(assertImplicitParagraphLabel(a).status,'failed');}
 for(const mutate of [a=>a.proposal.anchors=[{paragraph:2,note:'1',offset:5}],a=>a.proposal.paragraphs[2].objects=[{complete:true}],a=>a.wording.originalText='1. Another body.',a=>a.wording.language='fr',a=>a.wording.baseline='present-text',a=>a.wording.targetLabel='Article 1 – paragraph 2',a=>a.proposal.paragraphs[2].source.complete=false,a=>a.proposal.paragraphs[3].source.ordinal++,a=>a.proposal.paragraphs[2].properties.numberingLabel='1.',a=>a.proposal.paragraphs[2].properties.styleId='ManualNumPar1',a=>a.wording.proposedText='2. Changed paragraph.']){const a=make();mutate(a);assert.equal(assertImplicitParagraphLabel(a).status,'unverified');}
});

test('XHTML native rows verify article titles and subparagraph addresses without producer units',()=>{
  const xhtml=rows=>{const p=proposal(rows.map(text=>[text,'Normal']));p.sourceKind='xhtml';for(const row of p.paragraphs){row.properties=null;row.source.part='xhtml';row.source.path='/1/2/'+(row.index+1)+'/1';}return p;};
  const p=xhtml(['Article 9','Database of decisions','1. The Commission shall establish a database.','The database shall contain:','(a) the name;','(b) the designation;','(c) the techniques;','(d) the traits;','(e) an identification number.','The database shall be public.','2. Changes shall be notified.','Article 10','Labelling of material','1. Material shall bear a label.','Article 11','Next title','1. Next paragraph.']);
  const target='Article 9 – paragraph 1 – subparagraph 2 – point d a (new)';
  assert.equal(check(p,target,insert(8)).status,'verified');
  assert.equal(check(p,target,insert(7)).status,'failed');
  assert.equal(check(p,'Article 9 – paragraph 1 – subparagraph 1 – point d a (new)',insert(8)).status,'unverified');
  assert.equal(check(p,'Article 10 – title',replace(12)).status,'verified');
  assert.equal(check(p,'Article 10 – title',replace(13)).status,'failed');
  assert.equal(check(p,'Article 9 – paragraph 1 – subparagraph 3',replace(9)).status,'verified');
  const wording={...amendment('Article 1 – paragraph 1 – point -1 (new)'),baseline:'present-text',targetPath:{underlying:[{raw:'Article 9 – paragraph 1 – subparagraph 3'}]}};
  assert.equal(rawProposalAssertion({proposal:p,wording,placement:replace(9)}).status,'verified');
  assert.equal(rawProposalAssertion({proposal:p,wording,placement:replace(3)}).status,'failed');
  p.paragraphs[9].source.complete=false;
  assert.equal(rawProposalAssertion({proposal:p,wording,placement:replace(9)}).status,'unverified');
});


test('native Council Article 6 Roman children cannot be flattened into sibling insertion boundaries',()=>{
  const excerpt=JSON.parse(readFileSync(new URL('./fixtures/amendment-xhtml-nested-oracle.json',import.meta.url)));
  const proposal={sourceKind:'xhtml',paragraphs:excerpt.paragraphs};
  const wording=amendment('Article 6 – paragraph 3 – point d a (new)');
  for(const before of [150,151,152]) {
    const result=rawProposalAssertion({proposal,wording,placement:insert(before)});
    assert.equal(result.status,'unverified');
    assert.equal(result.reason,'oracle-raw-xhtml-point-nesting-unavailable');
  }
});


test('nested XHTML Roman points cannot verify a replacement at the outer point address',()=>{
  const excerpt=JSON.parse(readFileSync(new URL('./fixtures/amendment-xhtml-nested-oracle.json',import.meta.url)));
  const proposal={sourceKind:'xhtml',paragraphs:excerpt.paragraphs,units:[]};
  const row=proposal.paragraphs.find(row=>row.index===150);
  const wording={...amendment('Article 6 – paragraph 3 – point i',row.text),baseline:'council-position'};
  const placement={...replace(150),itemIndex:0,splice:{start:{paragraph:150,offset:0},end:{paragraph:150,offset:row.text.length}}};
  assert.equal(rawProposalAssertion({proposal,wording,placement}).status,'unverified');
  assert.equal(verifyPlacement({items:[{proposal}],wording,placement}).status,'unverified');
});

test('native consolidated Article 32 point a includes its four tobacco indents',()=>{
 // 02020L0262-20220426, ENG DOC_2, Article 32(3)(a): literal native grid text.
 const texts=['Article 32','Acquisition by private individuals','3. These guide levels may not be lower than:','(a) for tobacco products:','— cigarettes: 800 items,','— cigarillos (cigars weighing not more than 3 g each): 400 items,','— cigars: 200 items,','— smoking tobacco: 1,0 kg;','(b) for alcoholic beverages:','Article 33'];
 const p=proposal(texts.map(text=>[text,'Normal']));p.sourceKind='xhtml';for(const row of p.paragraphs){row.source.part='xhtml';row.source.path='/1/2/'+(row.index+1)+'/1';row.properties=null;}
 const w={...amendment('Article 1 – paragraph 1 – point 1 a (new)'),baseline:'present-text',targetPath:{underlying:[{raw:'Article 32 – paragraph 3 – point a'}]}};
 assert.equal(rawProposalAssertion({proposal:p,wording:w,placement:{status:'placed',operation:'replace',span:{start:3,end:7}}}).status,'verified');
 assert.equal(rawProposalAssertion({proposal:p,wording:w,placement:replace(8)}).status,'failed');
});
