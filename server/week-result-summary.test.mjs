import test from 'node:test';
import assert from 'node:assert/strict';
import {itemVoteSummary} from './week-result-summary.mjs';
const counted={id:'counted',title:'Published vote label',outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:470,against:83,abstaining:108}};
const hands={id:'hands',title:'Published referral label',outcome:'ADOPTED',method:'VOTE_HAND',totals:{for:null,against:null,abstaining:null}};
test('one counted sibling of up to three decisions is shown under its own label',()=>{
 const result=itemVoteSummary([counted,hands],null);assert.equal(result.kind,'single');assert.equal(result.vote.id,'counted');assert.equal(result.vote.label,counted.title);
 assert.equal(itemVoteSummary([counted,hands,{...hands,id:'third'}],null).kind,'single');
 const counts=itemVoteSummary([counted,hands,{...hands,id:'third'},{...hands,id:'fourth'}],null);assert.deepEqual(counts,{kind:'counts',adopted:4,rejected:0,lapsed:0,unknown:0});
 assert.equal(itemVoteSummary([hands],null).vote.method,'VOTE_HAND');assert.equal(itemVoteSummary([counted],counted),null);
});
