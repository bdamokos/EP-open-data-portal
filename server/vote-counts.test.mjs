import {test} from 'node:test';
import assert from 'node:assert/strict';
import {namedVoters,voteCounts,voteCountFields} from './vote-counts.mjs';

test('a count ODP leaves out is zero when the published counts add up to the attendance',()=>{
  // MTG-PL-2026-11-12-DEC-199981 and -200496.
  assert.deepEqual(voteCounts({number_of_votes_favor:613,number_of_votes_against:3,number_of_attendees:616}),{for:613,against:3,abstaining:0});
  assert.deepEqual(voteCounts({number_of_votes_favor:559,number_of_votes_abstention:24,number_of_attendees:583}),{for:559,against:0,abstaining:24});
  assert.deepEqual(voteCountFields({number_of_votes_favor:'559',number_of_votes_abstention:'24',number_of_attendees:'583'}),{number_of_votes_favor:559,number_of_votes_against:0,number_of_votes_abstention:24});
});

test('without proof an omitted count stays unknown',()=>{
  assert.deepEqual(voteCounts({number_of_votes_favor:613,number_of_votes_against:3}),{for:613,against:3,abstaining:null},'no attendance');
  assert.deepEqual(voteCounts({number_of_votes_favor:613,number_of_votes_against:3,number_of_attendees:620}),{for:613,against:3,abstaining:null},'counts do not add up');
  assert.deepEqual(voteCounts({number_of_attendees:600}),{for:null,against:null,abstaining:null},'no published count');
  assert.deepEqual(voteCounts({number_of_votes_favor:613,number_of_votes_against:3,number_of_votes_abstention:'x',number_of_attendees:616}),{for:613,against:3,abstaining:null},'a malformed count is not an omission');
  assert.deepEqual(voteCounts(undefined),{for:null,against:null,abstaining:null});
});

test('an absent voter list is empty only when its count is proven zero',()=>{
  const raw={had_voter_favor:['person/1','person/2'],had_voter_against:['person/3'],number_of_votes_favor:2,number_of_votes_against:1,number_of_attendees:3};
  assert.deepEqual(namedVoters(raw,'abstaining'),[]);
  assert.deepEqual(namedVoters(raw,'for'),['person/1','person/2']);
  assert.equal(namedVoters({...raw,number_of_attendees:4},'abstaining'),undefined,'counts do not add up');
  assert.equal(namedVoters({had_voter_favor:['person/1']},'against'),undefined,'no counts');
});
