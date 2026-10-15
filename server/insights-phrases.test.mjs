import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {capitalPhrases,phraseModel,cachedEnglishQuestionBodies} from './insights-phrases.mjs';
import {analyzeQuestions} from './insights-model.mjs';
const q=(id,title)=>({id,date:'2026-10-01',titles:{en:title},authors:[{id:'1'}]});

test('named phrases retain lowercase connectors, legal endings and possessives without swallowing the next subject',()=>{
  assert.deepEqual(capitalPhrases('Digital Services Act on TikTok').map(p=>p.key),['digital-services-act']);
  assert.deepEqual(capitalPhrases('Court of Justice’s declaration').map(p=>p.label),['Court of Justice']);
  assert.deepEqual(capitalPhrases('Pact on Migration and Asylum').map(p=>p.key),['pact-on-migration-and-asylum']);
  assert(capitalPhrases('Action by the European Court of Human Rights',{title:true}).some(p=>p.key==='european-court-of-human-rights'));
});
test('title case alone does not turn a generic heading into a named entity',()=>{
  assert.deepEqual(capitalPhrases('The Need For More Financial Support In All Member States',{title:true}),[]);
  for(const title of ['Member State','Member States’','New EU','Use of EU','European Commission'])assert.deepEqual(capitalPhrases(title,{title:true}),[]);
});
test('one question is one phrase observation and component words do not replace its full legal name',()=>{
  const a=q('1','Enforcement of the Digital Services Act against advertising'),b=q('2','Digital Services Act and cross-border content moderation');
  const data=analyzeQuestions([a,a,b]);
  assert.equal(data.words.find(w=>w.word==='digital-services-act').questionCount,2);
  assert.equal(data.words.find(w=>w.word==='digital-services-act').label,'Digital Services Act');
  assert(!data.questions.some(q=>q.tokens.includes('digital')||q.tokens.includes('services')||q.tokens.includes('act')));
});
test('saved body capitalization recognises lowercase title phrases without assigning body-only topics',()=>{
  const rows=[q('1','Enforcement of the digital services act'),q('2','Moderation under the digital services act')];
  const bodies=new Map([['1',{paragraphs:['The Digital Services Act applies here. The Nuclear Energy Programme is a separate issue.']}]]);
  const data=analyzeQuestions(rows,{bodies});
  assert.equal(data.words.find(w=>w.word==='digital-services-act').questionCount,2);
  assert(!data.words.some(w=>w.word==='nuclear-energy-programme'));
  assert.equal(data.analysis.phraseCoverage.cachedEnglishBodies,1);
});
test('a single shared named phrase does not automatically merge different question subjects',()=>{
  const data=analyzeQuestions([q('1','Digital Services Act and fishing quotas'),q('2','Digital Services Act and online advertising'),q('3','Digital Services Act and healthcare staffing')]);
  assert(!data.clusters.some(c=>c.questionCount===3));
});
test('cache-only question bodies resolve relative official URLs and reject answers, unrelated URLs and bad filenames',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'question-phrases-'));await mkdir(path.join(directory,'document-text-v1'));
  const sourceUrl='https://data.europarl.europa.eu/distribution/example/E-10-2026-000001_en.docx';
  const source={work:{identifier:'E-10-2026-000001',is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:'distribution/example/E-10-2026-000001_en.docx'}]}]}};
  const record={schemaVersion:1,sourceId:source.work.identifier,sourceUrl,fetchedAt:'2026-10-14T00:00:00Z',paragraphs:['The Digital Services Act.']};
  const file=path.join(directory,'document-text-v1',createHash('sha256').update(sourceUrl).digest('hex')+'.json');
  try {
    await writeFile(file,JSON.stringify(record));assert.equal((await cachedEnglishQuestionBodies([source],{directory})).size,1);assert.equal((await cachedEnglishQuestionBodies([source],{directory,maxBytes:0})).size,0);assert.equal((await cachedEnglishQuestionBodies([source],{directory,maxFiles:0})).size,0);
    await writeFile(file,JSON.stringify({...record,sourceId:record.sourceId+'-ASW'}));assert.equal((await cachedEnglishQuestionBodies([source],{directory})).size,0);
    await writeFile(file,JSON.stringify({...record,sourceUrl:'https://example.org/question.docx'}));assert.equal((await cachedEnglishQuestionBodies([source],{directory})).size,0);
    await rm(file);await writeFile(path.join(directory,'document-text-v1','a'.repeat(64)+'.json'),JSON.stringify(record));assert.equal((await cachedEnglishQuestionBodies([source],{directory})).size,0);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('a single specific legal title remains recognisable without a repeated corpus occurrence',async()=>{
  assert.equal((await cachedEnglishQuestionBodies([],{directory:'/no/such/task-cache',maxFiles:0,maxBytes:0})).size,0);
  const model=phraseModel([q('1','Digital Services Act')]);assert(model.extract('digital services act').phrases.some(p=>p.key==='digital-services-act'));
});
test('generic administrative facets do not displace an identifiable legal topic',()=>{
 const data=analyzeQuestions([q('1','Impact of the Digital Services Act on child safety'),q('2','Support for the Digital Services Act and platform transparency')]);
 assert.equal(data.words.find(w=>w.word==='digital-services-act')?.questionCount,2);
 for(const generic of ['impact','support','act','services','digital'])assert(!data.words.some(w=>w.word===generic));
 assert(data.words.some(w=>w.word==='child'));assert(data.words.some(w=>w.word==='platform'));
});
test('indexed matching preserves longest names, Unicode case and punctuation boundaries',()=>{
 const model=phraseModel([q('1','Digital Services Act and Services Act'),q('2','Court of Justice and Åland Convention'),q('3',"Children’s Rights Act and EU-Africa Partnership Act")]);
 const entries=Object.entries(model.labels),escaped=entries.map(([,label])=>label).sort((a,b)=>b.length-a.length).map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 const pattern=new RegExp('(?<![\\p{L}])(?:'+escaped.join('|')+')(?![\\p{L}])','giu'),byLabel=new Map(entries.map(([key,label])=>[label.toLowerCase(),key]));
 for(const text of entries.flatMap(([,label])=>[label,label.toLowerCase(),label.toUpperCase(),'EU-'+label+';',label+'2','123'+label,'x'+label,label.replaceAll(' ','\n')])){
  const normalized=text.normalize('NFKC'),expected=[],mask=normalized.split('');
  for(const match of normalized.matchAll(pattern)){const key=byLabel.get(match[0].toLowerCase());if(key){if(!expected.includes(key))expected.push(key);mask.fill(' ',match.index,match.index+match[0].length);}}
  const actual=model.extract(text);assert.deepEqual(actual.phrases.map(p=>p.key),expected,text);assert.equal(actual.text,mask.join(''),text);
 }
});
