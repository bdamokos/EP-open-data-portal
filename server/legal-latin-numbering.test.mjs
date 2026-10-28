import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LATIN_NUMBER_SUFFIXES,latinSuffixRank} from './legal-latin-numbering.mjs';
import {proposalNumber,parseLabelSegment,parseTargetLabel,unitLabel} from './proposal-labels.mjs';
import {parseProposal,proposalCandidates} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';

const projection=paragraphs=>({paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paragraphs.map(()=>({styleId:'Normal',numberingComplete:true,notesComplete:true}))});
const parse=paragraphs=>parseProposal(projection(paragraphs),{language:'fr'});
const place=(proposal,targetLabel,originalText='',proposedText='Nouveau texte.')=>resolveProposalPlacement([{kind:'act',index:1,proposal}],{targetLabel,originalText,proposedText,language:'fr'});
const fixture=JSON.parse(readFileSync(new URL('./fixtures/legal-latin-numbering.json',import.meta.url)));

test('published Council and Parliament Latin-numbered addresses parse without dropping their suffix',()=>{
  for(const example of fixture.examples)for(const label of example.labels) {
    const target=parseTargetLabel(label,fixture.language);
    assert.equal(target.complete,true,label);assert(target.segments.at(-1).suffix,label);
    assert.equal(target.raw,label);
  }
});

test('French numbering uses the complete ISG Annex B inventory and distinct compound suffixes',()=>{
  for(const suffix of [...LATIN_NUMBER_SUFFIXES,'bis bis','undecies bis','undecies ter']) {
    for(const base of ['1','a','I']) {
      const label=parseLabelSegment(`${base==='a'?'point':base==='I'?'annexe':'Article'} ${base} ${suffix}`,'fr');
      assert(label,`${base} ${suffix}`);assert.equal(label.value,base+suffix);
      assert.equal(parseLabelSegment(unitLabel(label,'fr'),'fr')?.value,label.value);
    }
  }
  assert.notEqual(proposalNumber('1 bis bis','fr').value,proposalNumber('1 bis','fr').value);
  for(const invalid of ['1 arbitrary','1 undecies prose','1 bis noise','1 bis bis bis bis'])assert.equal(proposalNumber(invalid,'fr'),null,invalid);
  assert.equal(proposalNumber('1 undecies','en'),null,'extended French vocabulary stays language-specific');
  const target=parseTargetLabel('Article 1 – paragraphe 1 undecies bis\nRèglement (UE) no 833/2014','fr');
  assert.equal(target.complete,true);assert.equal(target.segments.at(-1).value,'1undecies bis');
  assert.equal(target.underlyingLabel,'Règlement (UE) no 833/2014');
});

test('long and compound literal source paragraphs keep separate extents and exact replacement targets',()=>{
  const proposal=parse(['Article premier','1. Premier texte.','1 quater. Quatrième texte.','1 undecies bis. Texte composé.','2. Texte suivant.']);
  for(const [value,text,end] of [['1 quater','1 quater. Quatrième texte.',3],['1 undecies bis','1 undecies bis. Texte composé.',4]]) {
    const target=`Article 1 – paragraphe ${value}`,candidates=proposalCandidates(proposal,target,{language:'fr'});
    assert.equal(candidates.length,1,target);assert.equal(candidates[0].extent.end,end);
    const placed=place(proposal,target,text);assert.equal(placed.status,'placed',placed.reason);assert.equal(placed.originalText,text);
  }
  const input=projection(['Article premier','1. Liste:','(26 decies) Texte précédent.','(26 undecies) Texte modifié.','(27) Texte suivant.']);
  for(const i of [2,3,4])input.paragraphProperties[i].styleId='Point1';
  const points=parseProposal(input,{language:'fr'});
  assert.equal(proposalCandidates(points,'Article 1 – paragraphe 1 – point 26 undecies',{language:'fr'}).length,1);
});

test('extended and compound insertions follow their complete preceding sibling',()=>{
  const proposal=parse(['Article 1 decies','1. Texte précédent.','Article 1 undecies','1. Texte principal.','(a) Dernier enfant.','Article 1 undecies ter','1. Texte suivant.','Article 1 duodecies','1. Dernier article.']);
  const compound=place(proposal,'Article 1 undecies bis (nouveau)');
  assert.equal(compound.status,'placed',compound.reason);assert.equal(compound.insertBefore,5);
  const extended=place(parse(['Article 1 decies','1. Texte précédent.','Article 1 duodecies','1. Texte suivant.']),'Article 1 undecies (nouveau)');
  assert.equal(extended.status,'placed',extended.reason);assert.equal(extended.insertBefore,2);
  const ranks=['','bis','bis bis','ter','decies','undecies','undecies bis','undecies ter','duodecies','quinvicies'].map(latinSuffixRank);
  assert(ranks.every((rank,index)=>index===0||rank>ranks[index-1]));
});

test('ordinary French parenthetical prose cannot become a suffix-bearing point',()=>{
  for(const word of ['ajouter','rester','adapter'])assert.equal(proposalNumber(word,'fr'),null,word);
  const paragraphs=['Article premier','1. Liste:','(a) Première règle.','(ajouter) Cette précision appartient à la première règle.','(b) Deuxième règle.'];
  const proposal=parse(paragraphs),target='Article 1 – paragraphe 1 – point a';
  assert.deepEqual(proposalCandidates(proposal,target,{language:'fr'})[0].extent,{start:2,end:4});
  const replacement=place(proposal,target,paragraphs.slice(2,4).join('\n'));
  assert.equal(replacement.status,'placed',replacement.reason);assert.deepEqual(replacement.span,{start:2,end:3});
  const insertion=place(proposal,target+' bis (nouveau)');
  assert.equal(insertion.status,'placed',insertion.reason);assert.equal(insertion.insertBefore,4);
});

test('published compound quater decies remains distinct from single quaterdecies',()=>{
  const compound=parseLabelSegment('Article 171 quater decies','fr'),single=parseLabelSegment('Article 171 quaterdecies','fr');
  assert.notEqual(compound.value,single.value);assert.notEqual(compound.suffix,single.suffix);
  assert.equal(unitLabel(compound,'fr'),'Article 171 quater decies');
  assert.equal(unitLabel(single,'fr'),'Article 171 quaterdecies');
  const proposal=parse(['Article 171 quater nonies','1. Texte précédent.','Article 171 quater undecies','1. Texte suivant.']);
  const insertion=place(proposal,'Article 171 quater decies (nouveau)');
  assert.equal(insertion.status,'placed',insertion.reason);assert.equal(insertion.insertBefore,2);
  const both=parse(['Article 171 quater decies','1. Texte composé.','Article 171 quaterdecies','1. Texte simple.']);
  for(const [label,text] of [['171 quater decies','1. Texte composé.'],['171 quaterdecies','1. Texte simple.']]) {
    const placed=place(both,'Article '+label+' – paragraphe 1',text);
    assert.equal(placed.status,'placed',placed.reason);assert.equal(placed.originalText,text);
  }
  assert.equal(proposalNumber('171quaterdecies','fr').value,single.value);
  assert.equal(proposalNumber('171 bisbis','fr'),null,'unknown compact compounds are not reconstructed');
});
