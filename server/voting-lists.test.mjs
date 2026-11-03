import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseVotingList,votingDocumentId} from './voting-lists.mjs';
const fixture=name=>readFileSync(new URL('./fixtures/voting-lists/'+name,import.meta.url));
const parse=name=>parseVotingList(fixture(name),{observedAt:'2026-11-03T12:00:00Z'});
test('five public DOCX samples preserve row structure and exact references',()=>{
 for(const [name,id,count] of [['A10-0201.docx','A-10-2026-0201',77],['A10-0212_Jukneviciene.docx','A-10-2026-0212',13],['B10-0381_Objection_maize_MON-87460.docx','B-10-2026-0381',2],['B10-0386_Fisheries_Policy.docx','B-10-2026-0386',34],['C10-0189.docx','C-10-2026-0189',1]]){
  const doc=parse(name);assert.equal(doc.documentId,id);assert.equal(doc.rows.length,count);assert.deepEqual(doc.gaps,[]);
 }
 const a=parse('A10-0201.docx');assert.equal(a.versionLabel,'FINAL VERSION/2');assert.deepEqual(a.notes.withdrawn,[93,95]);assert.deepEqual(a.notes.inadmissible,[106]);
 assert.equal(a.rows[0].amendments.length,66);assert.deepEqual(a.rows[13].subject,['Article 1, § 1, point 1, after point a','Article 2, § 2a']);
 assert.deepEqual(a.rows.find(r=>r.identical).authors,['ECR','PfE','MEPs']);assert.equal(a.rows.find(r=>r.amendments[0]?.number===70).amendments[0].deleting,true);
 assert.deepEqual(a.rows.find(r=>r.amendments[0]?.number===129).falls.amendments,[{number:83,cp:2}]);
 const b=parse('B10-0386_Fisheries_Policy.docx');assert.equal(b.rows[4].parentRow,3);assert.equal(b.rows[4].kind,'text');assert.equal(b.rows[31].motion,'B-10-2026-0387');assert.deepEqual(b.rows[31].falls.motions,['B-10-2026-0388','B-10-2026-0389']);assert.ok(b.notes.requests.some(r=>r.type==='split'&&r.parts.length));assert.ok(b.notes.votingScheme.length);
 assert.equal(parse('C10-0189.docx').rows[0].kind,'procedural');assert.equal(votingDocumentId('RC-B10-1234/2026'),null);
});
for(const [name,date] of [['A10-0201.docx','2026-09-15'],['B10-0386_Fisheries_Policy.docx','2026-09-17']])test('ODP activity_order agrees with voting list row: '+name,()=>{
 const list=parse(name),decisions=JSON.parse(fixture('decisions-'+date+'.json')).data;assert.ok(decisions.length>20);
 for(const decision of decisions){const row=list.rows[Number(decision.activity_order)-1];assert.ok(row);assert.equal(row.row,Number(decision.activity_order));
 const ids=[...(decision.decided_on_a_realization_of||[]),...(decision.decided_on_a_part_of_a_realization_of||[])].map(r=>String(r.id||r)).filter(r=>/-AM-\d+$/.test(r));
 if(ids.length)assert.deepEqual(row.amendments.map(a=>a.number).sort((a,b)=>a-b),ids.map(id=>Number(id.match(/-AM-(\d+)$/)[1])).sort((a,b)=>a-b));
 if(decision.decisionAboutId_XMLLiteral?.includes('§'))assert.equal(row.subject.join(' / '),decision.referenceText.en);
 }
});
test('unknown row values remain unrecognised with raw cells and cannot acquire guessed amendments',async()=>{
 const {docxParts}=await import('./document-text.mjs');
 const xml=docxParts(fixture('A10-0212_Jukneviciene.docx')).get('word/document.xml').replace(/>3<\/w:t>/,'>not-an-amendment</w:t>');
 const name=Buffer.from('word/document.xml'),body=Buffer.from(xml),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
 const entry=Buffer.concat([local,name,body]),directory=Buffer.concat([central,name]);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(entry.length,16);
 const doc=parseVotingList(Buffer.concat([entry,directory,end]));assert.equal(doc.rows[0].kind,'unrecognised');assert.deepEqual(doc.rows[0].amendments,[]);assert.equal(doc.rows[0].cells[1],'not-an-amendment');assert.equal(doc.gaps[0].code,'unrecognised-row');
});
test('all forty September voting lists classify all 677 physical rows',()=>{
 const manifest=JSON.parse(fixture('september/provenance.json'));assert.equal(manifest.files.length,40);let total=0;
 const parsed=new Map(manifest.files.map(({file})=>[file,parse('september/'+file)]));
 for(const [file,list] of parsed){assert.ok(list.documentId,file);assert.deepEqual(list.gaps,[],file);assert.ok(list.rows.every(r=>r.kind!=='unrecognised'),file);total+=list.rows.length;}
 assert.equal(total,677);
 for(const file of ['A10-0196_Wilmes.docx','A10-0205_Cabral.docx','A10-0221_Jerkovic.docx','A10-0226_Zdrojewski.docx']){const row=parsed.get(file).rows[0];assert.equal(row.kind,'final');assert.equal(row.vote.rollCall,true);}
 const block=parsed.get('A10-0216_Dibrani.docx').rows[0];assert.equal(block.kind,'block');assert.deepEqual(block.amendments.map(a=>a.number),[...Array.from({length:83},(_,i)=>i+1)].filter(n=>![4,22,55,64,65,66,68].includes(n)));
 const oral=parsed.get('A10-0168_FOURLAS_RAZZA.docx').rows[8];assert.equal(oral.kind,'oral');assert.equal(oral.row,9);assert.deepEqual(oral.amendments,[]);assert.deepEqual(oral.subject,['After § 13']);assert.equal(oral.cells[5],'oral amendment');
 const motion=parsed.get('_A10-0098_2026__Nerudova.docx').rows[3];assert.equal(motion.kind,'procedural');assert.deepEqual(motion.authors,['ECR']);assert.equal(motion.falls.text,'adoption = vote on provisional agreement falls');
 const free=parsed.get('_A10-0202_2026__Canfin.docx').rows.find(r=>r.remarks==='adoption 86 = all ams to article 7 fall');assert.deepEqual(free.falls,{amendments:[],motions:[],replacesMotions:false,text:free.remarks});
});
function docxWithXml(xml){
 const name=Buffer.from('word/document.xml'),body=Buffer.from(xml),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
 const entry=Buffer.concat([local,name,body]),directory=Buffer.concat([central,name]);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(entry.length,16);
 return Buffer.concat([entry,directory,end]);
}
test('short motion fall references use full table references and never borrow the report year',async()=>{
 const {docxParts}=await import('./document-text.mjs'),xml=docxParts(fixture('B10-0386_Fisheries_Policy.docx')).get('word/document.xml');
 const parseXml=xml=>parseVotingList(docxWithXml(xml));
 const previousYear=parseXml(xml.replaceAll('B10-0388/2026','B10-0388/2025'));
 assert.deepEqual(previousYear.rows[31].falls.motions,['B-10-2025-0388','B-10-2026-0389']);
 const missing=parseXml(xml.replaceAll('B10-0388/2026','B10-0999/2026')).rows[31];
 assert.deepEqual(missing.falls,{amendments:[],motions:[],replacesMotions:false,text:missing.remarks});
 const ambiguous=parseXml(xml.replaceAll('B10-0389/2026','B10-0388/2025')).rows[31];
 assert.deepEqual(ambiguous.falls,{amendments:[],motions:[],replacesMotions:false,text:ambiguous.remarks});
});
