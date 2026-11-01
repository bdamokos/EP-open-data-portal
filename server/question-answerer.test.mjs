import test from 'node:test';
import assert from 'node:assert/strict';
import {answerHeaderSignatory,answerInstitution,questionAnswerer} from './question-answerer.mjs';

test('answer header signatory keeps the published title and name',()=>{
  assert.deepEqual(answerHeaderSignatory('EN\nE-003292/2026\nAnswer given by High Representative/Vice-President Kallas\non behalf of the European Commission\n\n(6.10.2026)'),{statement:'High Representative/Vice-President Kallas',title:'High Representative/Vice-President',name:'Kallas',onBehalfOf:'European Commission'});
  assert.equal(answerHeaderSignatory('EN\nP-000108/2025\nAnswer given by Executive Vice-President Virkkunen\nOn behalf of the European Commission\n\n(20.2.2025)').title,'Executive Vice-President');
  assert.equal(answerHeaderSignatory('EN\nE-001634/2024\nAnswer given by President von der Leyen\non behalf of the European Commission\n(18.11.2024)').name,'von der Leyen');
  assert.equal(answerHeaderSignatory('EN\nE-000225/2026\nAnswer given by the Executive Vice-President Ribera\non behalf of the Commission\t\n\n(31.3.2026)').onBehalfOf,'Commission');
  assert.equal(answerHeaderSignatory('EN\nE-000791/2025\nE-000825/2025\nJoint Answer given by Executive Vice-President Fitto\non behalf of the European Commission\n\n(10.4.2025)').name,'Fitto');
  assert.deepEqual(answerHeaderSignatory('EN\nP-004822/2025\nAnswer given by Mr Kadis\non behalf of the European Commission\n\n(30.1.2026)'),{statement:'Mr Kadis',title:'Mr',name:'Kadis',onBehalfOf:'European Commission'});
  assert.equal(answerHeaderSignatory('EN\nE-001052/2026\nReply\n(8.7.2026)'),null);
});

test('answerer combines the API institution with the English header only',()=>{
  const answer={creator:['org/EU_COUNCIL'],workHadParticipation:[{participation_role:'def/ep-roles/AUTHOR',had_participant_organization:['org/EU_COUNCIL']}]};
  assert.equal(answerInstitution(answer),'org/EU_COUNCIL');
  assert.deepEqual(questionAnswerer(answer,{textLanguage:'en',paragraphs:['EN\nE-001052/2026\nReply\n(8.7.2026)']}),{institution:'org/EU_COUNCIL',signatory:null});
  const header='EN\nE-1/2026\nAnswer given by Mr Brunner\non behalf of the European Commission\n(1.1.2026)';
  assert.equal(questionAnswerer({creator:['org/EU_COMMISSION']},{textLanguage:'el',paragraphs:[header]}).signatory,null);
  assert.equal(questionAnswerer({creator:['org/EU_COMMISSION']},{textLanguage:'en',paragraphs:[header],sourceUrl:'https://example.test/a_en.docx'}).signatory.sourceUrl,'https://example.test/a_en.docx');
  assert.equal(questionAnswerer({},null),null);
});
