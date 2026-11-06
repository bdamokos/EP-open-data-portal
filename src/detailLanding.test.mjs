import assert from 'node:assert/strict';
import test from 'node:test';
import {createDetailLanding} from './detailLanding.mjs';

test('a deep link keeps focus where it is, however often the item re-renders',()=>{
  const landing=createDetailLanding('ITEM-1');
  landing.seen('ITEM-1');
  assert.equal(landing.movesFocus('ITEM-1'),false);
  landing.seen('ITEM-1');
  assert.equal(landing.movesFocus('ITEM-1'),false);
});
test('choosing another item, or leaving and re-choosing the landing item, moves focus',()=>{
  const landing=createDetailLanding('ITEM-1');
  landing.seen('ITEM-2');
  assert.equal(landing.movesFocus('ITEM-2'),true);
  assert.equal(landing.movesFocus('ITEM-1'),true,'landing is over once the topic changed');
  const back=createDetailLanding('ITEM-1');
  back.seen('');
  back.seen('ITEM-1');
  assert.equal(back.movesFocus('ITEM-1'),true);
});
test('opening the page on the agenda without an item never suppresses a later choice',()=>{
  const landing=createDetailLanding('');
  landing.seen('ITEM-3');
  assert.equal(landing.movesFocus('ITEM-3'),true);
});

import {landedOnVotePage,votePageActive} from './detailLanding.mjs';
test('only a fresh load on a vote item starts as its own page, and only while the item has votes',()=>{
  assert.equal(landedOnVotePage('?view=legislation&agenda-topic=MTG-PL-2026-10-22-OJ-ITM-V-72'),true);
  assert.equal(landedOnVotePage('?view=legislation&agenda-topic=MTG-PL-2026-10-22-OJ-ITM-D-69'),false,'a debate item is not a vote page');
  assert.equal(landedOnVotePage('?view=legislation'),false);
  assert.equal(votePageActive({landed:true,hasTopic:true,loadedVoteCount:undefined}),true,'before the item loads');
  assert.equal(votePageActive({landed:true,hasTopic:true,loadedVoteCount:35}),true);
  assert.equal(votePageActive({landed:true,hasTopic:true,loadedVoteCount:0}),false,'no votes: back to the agenda view');
  assert.equal(votePageActive({landed:true,hasTopic:false,loadedVoteCount:undefined}),false,'Back to agenda was used');
  assert.equal(votePageActive({landed:false,hasTopic:true,loadedVoteCount:35}),false,'choosing from the list keeps two panes');
});
