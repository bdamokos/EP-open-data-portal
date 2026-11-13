import {test} from 'node:test';
import assert from 'node:assert/strict';
import {englishVoteLabel,standardVoteLabel} from './vote-labels.mjs';

test('English labels are used as published',()=>{
  assert.equal(englishVoteLabel({en:'Motion for a resolution (as a whole)',fr:'Proposition de résolution (ensemble du texte)'}),'Motion for a resolution (as a whole)');
  assert.equal(englishVoteLabel(undefined),null);
  assert.equal(englishVoteLabel({}),null);
});

test('French-only vote-day labels map to the English ODP publishes later',()=>{
  assert.equal(englishVoteLabel({fr:'Proposition de résolution (ensemble du texte)'}),'Motion for a resolution (as a whole)');
  assert.equal(englishVoteLabel({fr:'Proposition de la Commission'}),'Commission proposal');
  assert.equal(englishVoteLabel({fr:"Projet d’acte législatif"}),'Draft legislative act');
  assert.equal(englishVoteLabel({fr:'Demande de renvoi (article 60, paragraphe 4, du \nrèglement)'}),'Request for referral back (Rule 60(4))');
  assert.equal(englishVoteLabel({mul:'A10-0211/2026 - Dainius Žalimas - Accord provisoire - Am 36'}),'A10-0211/2026 – Dainius Žalimas – Provisional agreement – Am 36');
  assert.equal(englishVoteLabel({fr:'Proposition de résolution commune RC-B10-0497/2026 \n(PPE, S&D, ECR, Renew, Verts/ALE, députés)'}),'Joint motion for a resolution RC-B10-0497/2026 (PPE, S&D, ECR, Renew, Verts/ALE, députés)');
  assert.equal(englishVoteLabel({fr:'§ 4'}),'§ 4','references pass unchanged');
  assert.equal(englishVoteLabel({mul:'RC-B10-0497/2026 - § 1'}),'RC-B10-0497/2026 - § 1');
  assert.equal(englishVoteLabel({fr:'Article 5, alinéa 1, point b'}),null,'unknown wording is not translated');
  assert.equal(englishVoteLabel({fr:'Commission proposal'}),null,'French-keyed text is never read as English');
});

test('standard labels never return French text',()=>{
  assert.equal(standardVoteLabel({fr:'Accord provisoire'}),'Provisional agreement');
  assert.equal(standardVoteLabel({fr:'Article 5, alinéa 1, point b'}),null);
  assert.equal(standardVoteLabel({en:'After § 7'}),'After § 7');
});
