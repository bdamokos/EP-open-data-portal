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
