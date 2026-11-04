import test from 'node:test';import assert from 'node:assert/strict';
import {parseProposal} from './proposal-structure.mjs';import {resolveProposalPlacement} from './proposal-placement.mjs';import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
const source=(rows)=>({paragraphs:rows.map(r=>r[0]),structureStatus:'extracted',paragraphSources:rows.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:rows.map(r=>({styleId:r[1],numberingComplete:true,notesComplete:true}))});
const articleRows=[['Article 4','Titrearticle'],['Existing body.','Normal'],['Article 5','Titrearticle'],['Next body.','Normal'],['Article 6','Titrearticle']];
const pointRows=[['Article 1','Titrearticle'],['The act is amended as follows:','Normal'],['(6) An existing instruction.','Point0'],['(7) Next instruction.','Point0'],['Article 2','Titrearticle']];
const wording=targetLabel=>({language:'en',baseline:'commission-proposal',originalText:'',proposedText:'New child wording.',targetLabel});
const run=(rows,w,mutate=()=>{})=>{const p=structuredClone(parseProposal(source(rows)));mutate(p);const items=[{kind:'act',index:1,proposal:p}],placement=resolveProposalPlacement(items,w);return {placement,verification:placement.status==='placed'?verifyPlacement({items,placement,wording:w}):null};};
test('new numeric paragraphs and lettered children share the absent parent boundary',()=>{
 for(const n of [1,2,3,4,5]){const r=run(articleRows,wording('Article 4 a – paragraph '+n+' (new)'));assert.equal(r.placement.insertBefore,2);assert.equal(r.verification.status,'verified');}
 const r=run(pointRows,wording('Article 1 – paragraph 1 – point 6 a – point b (new)'));assert.equal(r.placement.insertBefore,3);assert.equal(r.verification.status,'verified');
});
test('missing siblings, existing parents, incomplete source and discontinuities cannot borrow the boundary',()=>{
 const w=wording('Article 4 a – paragraph 1 (new)');
 for(const rows of [articleRows.filter(r=>r[0]!=='Article 5'),[...articleRows.slice(0,2),['Article 4a','Titrearticle'],['Existing parent body.','Normal'],...articleRows.slice(2)],articleRows.map(r=>r[0]==='Article 5'?['Article 7','Titrearticle']:r)])assert.notEqual(run(rows,w).placement.status,'placed');
 for(const mutate of [p=>p.paragraphs[1].complete=false,p=>p.paragraphs[2].source.ordinal=20])assert.notEqual(run(articleRows,w,mutate).placement.status,'placed');
 assert.notEqual(run(articleRows,{...w,originalText:'Some original wording.'}).placement.status,'placed');
 assert.notEqual(run(articleRows,wording('Article 4 a – paragraph 1')).placement.status,'placed');
});
