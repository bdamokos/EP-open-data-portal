import test from 'node:test';import assert from 'node:assert/strict';
import {typoPassage} from './proposal-similarity.mjs';
// Shapes from A-10-2025-0150-AM-001-129: point 17 inserts Articles 30a-30d and
// point 22 inserts Articles 37a-37d with near-identical bodies.
const article=(number,body)=>[`Article ${number}`,'Infringements','1.\tFor the purposes of this Article, the following activities shall be considered as infringements:',`(a)\tthe activities referred to in ${body};`,'(b)\tinterference with satellite monitoring system; and','(c)\toperating without a VMS.'];
const rows=[...article('30d','Article 3(1) of Regulation (EC) No 1005/2008'),'Unrelated text between the two points of the amending act.',...article('37d','Article 3(1) of Regulation (EC) No 1005/2008 and Article 30')].map((text,index)=>({text,index}));
const point17=rows.slice(0,6),quote=lines=>lines.join('\n');
test('one or two changed words in the quote still select the passage',()=>{
 // One changed word, as AM 27 fr prints "un" for the act's "l'".
 assert.deepEqual(typoPassage(point17,rows,quote(article('30d','Article 3(1) of Regulation (EC) No 1005/2008')).replace('interference with','interfering with')),{start:0,end:5,distance:1,cost:1});
 assert.equal(typoPassage(point17,rows,quote(article('30d','Article 3(1) of Regulation (EC) No 1005/2008')).replace('interference with satellite','interfering into the satellite'))?.cost,undefined);
});
test('whitespace or punctuation inside a label is formatting',()=>{
 // AM 32 and 34 lt/ro print "37 b"; ro prints "1." for the act's "1)".
 const spaced=quote(article('30 d','Article 3(1) of Regulation (EC) No 1005/2008')).replace('interference','interferance');
 assert.deepEqual(typoPassage(point17,rows,spaced),{start:0,end:5,distance:3,cost:1});
 const relabelled=quote(article('30d','Article 3(1) of Regulation (EC) No 1005/2008')).replace('(a)\t','a.\t').replace('interference','interferance');
 assert.equal(typoPassage(point17,rows,relabelled)?.cost,1);
});
test('a different number or article label is never a typo',()=>{
 // AM 30 cs/sk and AM 28 es quote 30a/30 where the act reads 37a/37.
 assert.equal(typoPassage(point17,rows,quote(article('30d','Article 3(2) of Regulation (EC) No 1005/2008'))),null);
 assert.equal(typoPassage(point17,rows,quote(article('31d','Article 3(1) of Regulation (EC) No 1005/2008'))),null);
 assert.equal(typoPassage(point17,rows,quote(article('30d','Article 3(1) of Regulation (EC) No 1005/2008')).replace('(c)\toperating','(c)\t–operating')),null);
 // A different list label is another provision, not a typo.
 assert.equal(typoPassage(point17,rows,quote(article('30d','Article 3(1) of Regulation (EC) No 1005/2008')).replace('(b)\tinterference','(d)\tinterference')),null);
});
test('punctuation counts toward the limit outside label formatting',()=>{
 const base=quote(article('30d','Article 3(1) of Regulation (EC) No 1005/2008'));
 assert.equal(typoPassage(point17,rows,base.replace('Infringements','Infringements,'))?.cost,1);
 assert.equal(typoPassage(point17,rows,base.replace('interference with satellite monitoring system','interference, with satellite; monitoring: system')),null);
});
test('a near-identical passage elsewhere blocks the match',()=>{
 // Genuine duplicates: the closest competitor is within one or two words.
 const near=rows.map(row=>row.index===10?{...row,text:'(a)\tthe activities referred to in Article 3(1) of Regulation (EC) No 1005/2008;'}:row);
 const typo=quote(article('30d','Article 3(1) of Regulation (EC) No 1005/2008')).replace('interference','interferance').replace('Article 30d\n','');
 assert.equal(typoPassage(point17,rows,typo)?.cost,1);
 assert.equal(typoPassage(point17,near,typo),null);
});
test('label look-alikes and elided articles are compared as the act prints them',()=>{
 // AM 34 bg prints a Cyrillic "а)" where the act has a Latin "a)"; AM 27 fr
 // prints "un organisme" for "l'organisme".
 const base=quote(article('30d','Article 3(1) of Regulation (EC) No 1005/2008'));
 assert.equal(typoPassage(point17,rows,base.replace('(a)\t','(а)\t').replace('interference','interferance'))?.cost,1);
 const elided=rows.map(row=>row.index===4?{...row,text:"(b)\tinterference with l'system; and"}:row);
 assert.equal(typoPassage(elided.slice(0,6),elided,base.replace('with satellite monitoring system','with un system'))?.cost,1);
});

test('a letter reference inside the text is a label, not a typo',()=>{
 // Independent review of #808: "point (a)" for "point (b)", "Annex I" for "Annex II".
 const text=['Member States shall ensure that the activities referred to in point (a) of Article 3(1) are supervised by the competent authority.','The measures listed in Annex II shall apply to every vessel flying their flag.','Other text that does not compare at all with either sentence.'].map((text,index)=>({text,index}));
 assert.equal(typoPassage(text.slice(0,1),text,text[0].text.replace('point (a)','point (b)')),null);
 assert.equal(typoPassage(text.slice(1,2),text,text[1].text.replace('Annex II','Annex I')),null);
 assert.equal(typoPassage(text.slice(0,1),text,text[0].text.replace('(a)','(ii)')),null);
 // An ordinary word change in the same sentence still places.
 assert.equal(typoPassage(text.slice(0,1),text,text[0].text.replace('supervised','supervized'))?.cost,1);
});
