import test from 'node:test';
import assert from 'node:assert/strict';
import {rawProposalAssertion} from './amendment-benchmark-proposal-oracle.mjs';
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
    const text={paragraphs:[prefix+' Source wording.','1. Next.'],paragraphSources:[0,1].map(ordinal=>({ordinal,complete:true,container:'body',containerPath:'body',segment:0}))};
    const wording={...amendment(targetLabel,'Source wording.'),language,baseline:'motion-resolution'};
    assert.equal(parseBenchmarkTarget(wording).complete,true);
    assert.equal(verifyPlacement({text,wording,placement:replace(0)}).status,'verified',language);
  }
});
