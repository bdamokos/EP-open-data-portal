import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectVoteTitle} from './voteTitles.mjs';

const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/multilingual-vote-titles.json',import.meta.url)));
const results=fixture.sources[0].payload.data;
const pfe=results.find(node=>node.activity_id.endsWith('000001')).activity_label;
const english='Monday’s Agenda - Request from the PfE Group - Riots';

test('published multilingual agenda titles select the embedded language without rewriting source maps',()=>{
  const before=JSON.stringify(results);
  for(const result of results) {
    const values=result.activity_label;
    const en=selectVoteTitle(values,'en'),de=selectVoteTitle(values,'de'),fr=selectVoteTitle(values,'fr');
    assert.equal(en.language,'en');assert.match(en.text,/^(?:Monday|Tuesday)’s Agenda - Request from /);
    assert(!en.text.includes('Tagesordnung'));assert(!en.text.includes('Ordre du jour'));
    assert.equal(en.sourceLiteral,values.mul);
    assert.equal(de.language,'de');assert.match(de.text,/^Tagesordnung für (?:Montag|Dienstag) - Antrag /);
    assert.equal(de.sourceLiteral,values.mul);
    assert.deepEqual(fr,{text:values.fr,language:'fr',sourceLiteral:values.fr});
    assert.deepEqual(selectVoteTitle(values,'hu'),en,'missing requested languages use English without claiming a translation');
    assert.deepEqual(selectVoteTitle(Object.fromEntries(Object.entries(values).reverse()),'en'),en,'source key order does not select the language');
  }
  assert.equal(selectVoteTitle(pfe,'en').text,english);
  assert.equal(JSON.stringify(results),before);
});

test('explicit monolingual fields take precedence and French-only decision names stay French',()=>{
  assert.equal(selectVoteTitle({...pfe,en:'Published English label'},'en').text,'Published English label');
  assert.equal(selectVoteTitle({...pfe,hu:'Közzétett magyar cím'},'hu').language,'hu');
  for(const node of fixture.sources[1].payload.data) {
    assert.deepEqual(selectVoteTitle(node.activity_label,'en'),{text:node.activity_label.fr,language:'fr',sourceLiteral:node.activity_label.fr});
  }
  assert.equal(selectVoteTitle({mul:'Texte original',fr:'Titre français'},'en').text,'Titre français');
  assert.deepEqual(selectVoteTitle({mul:'Unstructured - title - with hyphens'},'en'),{text:'Unstructured - title - with hyphens',language:'mul',sourceLiteral:'Unstructured - title - with hyphens'});
});

test('incomplete, repeated, mismatched and unanchored language boundaries never yield a guessed title',()=>{
  for(const values of [
    {...pfe,mul:pfe.mul.split(' - Tagesordnung')[0]},
    {...pfe,mul:pfe.mul.replace('für Montag','für Dienstag')},
    {...pfe,mul:pfe.mul+' - Monday’s Agenda - Another title'},
    {...pfe,fr:'Unrelated French title'},
    {mul:pfe.mul},
    {...pfe,mul:pfe.mul.replace('Request from the PfE Group - Riots','')},
  ]) {
    const selected=selectVoteTitle(values,'en');
    assert.notEqual(selected.language,'en');
    assert.equal(selected.text,values.fr||values.mul);
  }
  assert.equal(selectVoteTitle({fr:pfe.fr.replaceAll(' - ',' – '),mul:pfe.mul.replaceAll(' - ',' – ').replace('Monday’s Agenda',"Monday's agenda")},'en').text,"Monday's agenda – Request from the PfE Group – Riots");
  assert.deepEqual(selectVoteTitle(null,'en','Retained fallback','fr'),{text:'Retained fallback',language:'fr',sourceLiteral:'Retained fallback'});
});
