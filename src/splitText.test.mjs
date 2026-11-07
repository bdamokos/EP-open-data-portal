import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describePart,findQuote,partResult,partsInLanguage,splitRuns,stripNumberPrefix} from './splitRuns.mjs';
import {freshLoader} from './test-support/viteRunner.mjs';

const fixture=JSON.parse(readFileSync(new URL('./test-support/split-parts-amendment-4.json',import.meta.url)));
const inLanguage=language=>[{number:'1',description:fixture.parts[language]['1']},{number:'2',description:fixture.parts[language]['2']}];
const joined=match=>match.runs.map(run=>run.text).join('');
const whole='Text as a whole without the words: ';
const parts=(first,second='those words')=>[{number:'1',description:first},{number:'2',description:second}];

test('the real English part 2 brackets exactly the quoted words, and the rest belongs to part 1',()=>{
  const match=splitRuns(fixture.wordingEn,inLanguage('en'));
  assert.deepEqual(match.runs.map(run=>[run.part,run.bracketed]),[['1',false],['2',true],['1',false]]);
  assert.equal(match.runs[1].text,describePart(fixture.parts.en['1']).quote);
  assert.equal(match.runs[0].text,'The Union needs to ');
  assert.equal(joined(match),stripNumberPrefix(fixture.wordingEn),'runs are the exact wording');
  assert.deepEqual(match.whole,{number:'1',lead:'Text as a whole without the words',other:'2'});
});
test('every language of the decision opens and closes its quote, with or without a colon',()=>{
  assert.equal(Object.keys(fixture.parts).length,24);
  for(const language of Object.keys(fixture.parts)) {
    const read=describePart(fixture.parts[language]['1']);
    assert(read&&read.before.trim(),language+' has words before its quote');
    assert.equal(describePart(fixture.parts[language]['2']),null,language+': the other part has no quote');
    const quote=read.quote.trim(),text='(3)\tAlpha beta '+quote+' gamma delta.',match=splitRuns(text,inLanguage(language));
    assert(match,language+' matches wording in its own language');
    assert.equal(match.runs.find(run=>run.bracketed).text,quote,language);
    assert.equal(joined(match),stripNumberPrefix(text),language);
    assert.equal(match.whole.other,'2',language);
    assert(!/[:\s]$/.test(match.whole.lead),language+' lead ends in a word');
  }
});
test('a word such as l\'insieme never opens a quote',()=>{
  assert.equal(describePart(fixture.parts.it['1']).before,"l'insieme del testo tranne i termini: ");
  assert.equal(describePart(fixture.parts.fr['1']).before,"ensemble du texte à l'exclusion des termes: ");
  assert.equal(describePart("l'insieme del testo"),null);
  assert.deepEqual(describePart("'words'"),{before:'',quote:'words',after:''});
  assert.equal(describePart('the words: ‘never closed'),false);
});
test('description and wording never match across languages',()=>{
  assert.equal(splitRuns(fixture.wordingEn,inLanguage('fr')),null);
  assert.equal(partsInLanguage([{number:'1',contentByLanguage:{en:{text:'those words'}}},{number:'2',contentByLanguage:{fr:{text:'ces termes'}}}],'en'),null);
  assert.deepEqual(partsInLanguage([{number:'1',contentByLanguage:{en:{text:'a'}}},{number:'2',contentByLanguage:{en:{text:'b'}}}],'en'),[{number:'1',description:'a'},{number:'2',description:'b'}]);
});
test('normalised matching maps back to exact offsets',()=>{
  const text='(1)\tThe  Union’s “pact” — and more études, today.';
  const match=splitRuns(text,parts(whole+'‘The Union\'s "pact" - and more études, today.’'));
  assert(match,'spaces, quote and dash styles, composition and trailing punctuation are normalised');
  assert.equal(match.runs[0].text,'The  Union’s “pact” — and more études, today');
  assert.equal(joined(match),stripNumberPrefix(text));
  assert.deepEqual(findQuote('one two','one two'),{start:0,end:7});
});
test('a quote that repeats, is missing or overlaps gets the fallback',()=>{
  assert.equal(splitRuns('(1)\tthe Union and the Union.',parts(whole+'‘the Union’')),null,'more than one occurrence');
  assert.equal(splitRuns('(1)\ta–b and a—b.',parts(whole+'‘a-b’')),null,'more than one after normalising');
  assert.equal(splitRuns('(1)\tSome text.',parts(whole+'‘words nobody wrote’')),null);
  assert.equal(splitRuns('(1)\talpha beta gamma.',parts('‘alpha beta’','‘beta gamma’')),null,'overlap');
});
test('other shapes: every part quoted brackets each, words no part names stay plain, anything else falls back',()=>{
  const match=splitRuns('(1)\tOne two three four five.',parts('‘One two’','‘four five’'));
  assert.deepEqual(match.runs.map(run=>[run.text,run.part,run.bracketed]),[['One two','1',true],[' three ',null,false],['four five','2',true],['.',null,false]]);
  assert.equal(match.whole,null);
  assert.equal(joined(match),'One two three four five.');
  assert.equal(splitRuns('(1)\tOne two.',[{number:'1',description:whole+'‘One’'}]),null,'one part alone');
  assert.equal(splitRuns('(1)\tOne two.',parts('first bit','second bit')),null,'no quote at all');
  assert.equal(splitRuns('(1)\tOne two.',parts('‘One’','those words')),null,'a quote with no words before it isn\'t the whole-without shape');
  assert.equal(splitRuns('(1)\tOne two.',[...parts(whole+'‘One’'),{number:'3',description:'more words'}]),null,'three parts with one quote');
  assert.equal(splitRuns('(1)\tOne two.',parts(whole+'‘One')),null,'opener with no closer');
});
test('words after the quote keep the description whole in the key',()=>{
  const match=splitRuns('(1)\tOne two three.',parts(whole+'‘One’, and also more'));
  assert.equal(match.whole.lead,null);
});
test('a part\'s result is one sentence, larger number first on rejection through its template',()=>{
  assert.deepEqual(partResult({outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:423,against:125,abstaining:32}}),{id:'votepage.key.adopted.tally',values:{for:423,against:125,abstaining:32}});
  assert.equal(partResult({outcome:'REJECTED',totals:{for:1,against:2,abstaining:0}}).id,'votepage.key.rejected.tally');
  assert.equal(partResult({outcome:'ADOPTED',method:'VOTE_HAND',totals:{for:null,against:null,abstaining:null}}).id,'votepage.key.adopted.hands');
  assert.equal(partResult({outcome:'REJECTED',method:'VOTE_ELECTRONIC',totals:null}).id,'votepage.key.rejected');
  assert.equal(partResult({outcome:'LAPSED'}).id,'votepage.key.lapsed');
  assert.equal(partResult({outcome:null,ballotStatus:'not-conducted'}).id,'votepage.key.not_held');
  assert.equal(partResult({outcome:null}),null);
  assert.equal(partResult(null),null);
});
test('the text\'s emphasis follows its view, and an overview stresses nothing',async t=>{
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  t.after(()=>load.close());
  const {SplitText,SplitKey}=await load('/src/SplitText.tsx');
  const match=splitRuns(fixture.wordingEn,inLanguage('en'));
  const render=props=>renderToStaticMarkup(createElement(SplitText,{runs:match.runs,language:'en',...props}));
  const quote=describePart(fixture.parts.en['1']).quote;
  const part2=render({emphasis:'part',current:['2']});
  assert.match(part2,/class="clause-text marked"/);
  assert.equal([...part2.matchAll(/class="run-on"/g)].length,1,'part 2 stresses the one bracketed run');
  assert.match(part2,/class="run-on"><span class="br">\[<\/span>support and prepare/);
  assert.match(part2,/<sub[^>]*>Part 2<\/sub>/);
  const part1=render({emphasis:'part',current:['1']});
  assert.equal([...part1.matchAll(/class="run-on"/g)].length,2,'part 1 stresses the text outside the brackets');
  assert.match(part1,/<span class="run-on">The Union needs to <\/span><span><span class="br">\[/);
  const none=render({emphasis:'none'});
  assert.match(none,/class="clause-text plain"/);
  assert(!/run-on|marked/.test(none),'no emphasis class in an overview');
  assert.match(none,/<span class="br">\[<\/span>/,'brackets stay');
  assert.match(none,/<sub[^>]*>Part 2<\/sub>/,'subscripts stay');
  assert.equal(none.replace(/<sub.*?<\/sub>/g,'').replace(/<span class="br">[[\]]<\/span>/g,'').replace(/<[^>]+>/g,'').replace(/&#x27;/g,"'"),stripNumberPrefix(fixture.wordingEn),'nothing but marks is added');
  assert(quote.length>100);
  const key=renderToStaticMarkup(createElement(SplitKey,{match,parts:[
    {number:'1',description:fixture.parts.en['1'],language:'en',result:{outcome:'ADOPTED',method:'VOTE_HAND',totals:null},href:'?one'},
    {number:'2',description:fixture.parts.en['2'],language:'en',result:{outcome:'ADOPTED',totals:{for:423,against:125,abstaining:32}},href:'?two',current:true},
  ]})).replace(/<[^>]+>/g,'');
  assert.match(key,/Part 1: Text as a whole without the words in part 2\. Adopted by show of hands\./);
  assert.match(key,/Part 2: those words\. Adopted by 423 to 125, with 32 abstaining\. This vote\./);
  const fallback=renderToStaticMarkup(createElement(SplitKey,{match:null,parts:[{number:'1',description:'ensemble du texte: "x y z"',language:'fr',seeVote:'?v'}]}));
  assert.match(fallback,/lang="fr">ensemble du texte: &quot;x y z&quot;/,'a fallback keeps the published words whole');
  assert.match(fallback,/See the vote/);
  const mixed=renderToStaticMarkup(createElement(SplitKey,{match,parts:[{number:'1',description:fixture.parts.en['1'],language:'de'}]}));
  assert(mixed.includes(fixture.parts.en['1'].slice(0,60)),'wording in another language keeps its description whole, unmixed');
});
