import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPlacement} from './amendment-benchmark-model.mjs';

// Rows: [text, path] with Word paths; table cells carry tbl/tr/tc/p indexes.
const body=(n)=>`/w:document[1]/w:body[1]/w:p[${n}]`,cellPath=(t,r,c,p=1)=>`/w:document[1]/w:body[1]/w:tbl[${t}]/w:tr[${r}]/w:tc[${c}]/w:p[${p}]`;
// Source table structure as extracted: every cell, empty ones with no paragraphs.
// `widths` adds empty cells (tbl -> columns) so trailing blank columns exist.
function proposal(rows,widths={}) {
  const paragraphs=rows.map(([text,path],index)=>({index,text,complete:true,source:{path,container:path.includes('/w:tc[')?'table-cell':'body',complete:true}}));
  const tables=new Map();
  for(const p of paragraphs){const m=/w:tbl\[(\d+)\]\/w:tr\[(\d+)\]\/w:tc\[(\d+)\]/u.exec(p.source.path);if(!m)continue;
    const t=tables.get(m[1])??new Map();tables.set(m[1],t);const r=t.get(m[2])??new Map();t.set(m[2],r);r.set(Number(m[3]),[...(r.get(Number(m[3]))??[]),p.index]);}
  const units=[...tables].map(([tbl,t])=>({kind:'table',children:[],table:{sourcePath:`/w:document[1]/w:body[1]/w:tbl[${tbl}]`,complete:true,rows:[...t.values()].map(r=>{const width=Math.max(...r.keys(),widths[tbl]??0);return {cells:Array.from({length:width},(_,i)=>({paragraphs:r.get(i+1)??[],colSpan:1}))};})}}));
  return {sourceKind:'docx',units,paragraphs};
}
const annex=()=>proposal([['ANNEX III',body(1)],['The following Annex VIII is added:',body(2)],['Iron and steel',body(3)],['CN code',cellPath(1,1,1)],['Greenhouse gas',cellPath(1,1,2)],['ex 7204 Ferrous waste',cellPath(1,2,1)],['Carbon dioxide',cellPath(1,2,2)],['Aluminium',body(4)],['CN code',cellPath(2,1,1)],['Greenhouse gas',cellPath(2,1,2)],['ex 7602 Aluminium waste',cellPath(2,2,1)],['Carbon dioxide',cellPath(2,2,2)],['’',body(5)]]);
const replace=(start,end,p=annex())=>({status:'placed',operation:'replace',itemIndex:0,span:{start,end},splice:{start:{paragraph:start,offset:0},end:{paragraph:end,offset:p.paragraphs[end].text.length}}});
const wording=(targetLabel,originalText)=>({targetLabel,originalText,proposedText:'Changed',language:'en',baseline:'commission-proposal'});
const check=(w,placement,p=annex())=>verifyPlacement({placement,wording:w,items:[{proposal:p}]});

test('an article table is verified as all cells within the unique paragraph',()=>{
 const p=proposal([['Article 20',body(1)],['2. The following applies:',body(2)],['(a)',cellPath(1,1,1)],['Cigars',cellPath(1,1,2)],['(b)',cellPath(1,2,1)],['Other',cellPath(1,2,2)],['3. Next paragraph;',body(3)],['Article 21',body(4)]]);
 const w=wording('Article 20 – paragraph 2 – table','(a)\tCigars\n(b)\tOther');
 assert.equal(check(w,replace(2,5,p),p).reason,'oracle-article-table-rows');
 assert.notEqual(check({...w,targetLabel:'Article 20 – paragraph 1 – table'},replace(2,5,p),p).status,'verified');
 assert.notEqual(check({...w,originalText:'(a)\tCigars'},replace(2,3,p),p).status,'verified');
 assert.notEqual(check(w,replace(3,5,p),p).status,'verified');
 const flatten=units=>units.flatMap(u=>[u,...flatten(u.children??[])]);const find=units=>flatten(units).find(u=>u.table)?.table;
 for(const at of ['start','end']){const changed=structuredClone(p),table=find(changed.units),empty={cells:[{paragraphs:[],colSpan:1},{paragraphs:[],colSpan:1}]};if(at==='start')table.rows.unshift(empty);else table.rows.push(empty);assert.notEqual(check(w,replace(2,5,changed),changed).status,'verified');}
});

test('annex table rows verify cell for cell inside the named annex', () => {
  const original='Aluminium\nCN code\tGreenhouse gas\nex 7602 Aluminium waste\tCarbon dioxide';
  assert.deepEqual(check(wording('Annex III – paragraph 1 – table',original),replace(7,11)),{status:'verified',reason:'oracle-annex-table-rows'});
  assert.equal(check(wording('Annex III – paragraph 1 – table',original),replace(2,6)).status,'failed');
  assert.equal(check(wording('Annex II – paragraph 1 – table',original),replace(7,11)).status,'unverified','another annex');
  assert.equal(check(wording('Annex III – paragraph 1 – table','Aluminium\nCN code\tGreenhouse gas\n7602 Aluminium waste\tCarbon dioxide'),replace(7,11)).status,'verified','one omitted word in a corresponding cell is accepted');
  assert.equal(check(wording('Annex III – paragraph 1 – table',original.replace('7602','7603')),replace(7,11)).status,'unverified','a changed code is not a small word difference');
  assert.equal(check(wording('Annex III – paragraph 1 – table','CN code\tGreenhouse gas'),replace(8,9)).status,'unverified','repeated rows are not unique');
});

test('a subordinate address other than the owning provision stays unverified', () => {
  const original='Aluminium\nCN code\tGreenhouse gas\nex 7602 Aluminium waste\tCarbon dioxide';
  assert.equal(check(wording('Annex III – paragraph 2 – table',original),replace(7,11)).status,'unverified');
  assert.equal(check(wording('Annex III – point 1 – table',original),replace(7,11)).status,'unverified');
  assert.equal(check(wording('Annex III – paragraph 1 – point 1 – table',original),replace(7,11)).status,'unverified');
});

test('empty cells, skipped rows and partial splices never verify', () => {
  // A | (empty) | B: the empty middle cell keeps no paragraph.
  const gapped=proposal([['ANNEX III',body(1)],['A',cellPath(1,1,1)],['B',cellPath(1,1,3)],['C',cellPath(1,2,1)],['D',cellPath(1,2,2)],['E',cellPath(1,2,3)]]);
  assert.equal(check(wording('Annex III – table','A\tB'),replace(1,2),gapped).status,'unverified');
  // Row 2 is entirely empty and absent: rows 1 and 3 are not adjacent.
  const skipped=proposal([['ANNEX III',body(1)],['A',cellPath(1,1,1)],['B',cellPath(1,1,2)],['C',cellPath(1,3,1)],['D',cellPath(1,3,2)]]);
  assert.equal(check(wording('Annex III – table','A\tB\nC\tD'),replace(1,4),skipped).status,'unverified');
  const original='Aluminium\nCN code\tGreenhouse gas\nex 7602 Aluminium waste\tCarbon dioxide';
  const offset={...replace(7,11),splice:{start:{paragraph:7,offset:1},end:{paragraph:11,offset:'Carbon dioxide'.length}}};
  assert.equal(check(wording('Annex III – paragraph 1 – table',original),offset).status,'failed');
});

test('a blank trailing column keeps rows from matching fewer cells', () => {
  const p=proposal([['ANNEX III',body(1)],['A',cellPath(1,1,1)],['B',cellPath(1,1,2)],['C',cellPath(1,2,1)],['D',cellPath(1,2,2)]],{1:3});
  assert.equal(check(wording('Annex III – table','A\tB'),replace(1,2,p),p).status,'unverified');
});
test('a stray opening caption decoration is bounded by exact cells and both printed annex paths',()=>{
 const p=proposal([['ANNEX III',body(1)],['The following Annex VIII is added:',body(2)],['‘ANNEX VIII',body(3)],['Iron and steel',body(4)],['CN code',cellPath(1,1,1)],['Greenhouse gas',cellPath(1,1,2)],['ex 7204 Ferrous waste',cellPath(1,2,1)],['Carbon dioxide',cellPath(1,2,2)],['’',body(5)]]);
 const w=wording('Annex III – paragraph 1 – table on iron and steel\nRegulation (EU) 2023/956\nAnnex VIII – table Iron and Steel','‘[Iron and steel\nCN code\tGreenhouse gas\nex 7204 Ferrous waste\tCarbon dioxide'),act={paragraphs:[{text:'Regulation (EU) 2023/956 is amended as follows:',complete:true,source:{complete:true,container:'body'}}]},items=[{kind:'annex',proposal:p},{kind:'act',proposal:act}],placement=replace(3,7,p);
 const run=(wording=w,proposal=p)=>verifyPlacement({items:[{kind:'annex',proposal},items[1]],wording,placement});
 assert.equal(run().status,'verified');assert.equal(run().reason,'oracle-annex-table-caption-decoration');
 for(const originalText of [w.originalText.replace('ex 7204','7204'),w.originalText.replace('Ferrous waste','Changed waste'),w.originalText.replace('‘[Iron','[Iron'),w.originalText.replace('Iron and steel','Iron and steel]'),w.originalText.replace('Carbon dioxide','Other gas')])assert.notEqual(run({...w,originalText}).status,'verified');
 for(const targetLabel of [w.targetLabel.replace('Annex VIII','Annex VII'),w.targetLabel.replace('Regulation (EU) 2023/956','Regulation (EU) 2023/957'),w.targetLabel.replace('table Iron and Steel','table Aluminium')])assert.notEqual(run({...w,targetLabel}).status,'verified');
 const duplicated=proposal(p.paragraphs.map(row=>[row.text,row.source.path]).concat(p.paragraphs.slice(3,8).map(row=>[row.text,row.source.path.replace('w:tbl[1]','w:tbl[2]')])));assert.notEqual(run(w,duplicated).status,'verified');
});

test('caption repair rejects a competing native inner annex frame',()=>{
 const rows=[['ANNEX III',body(1)],['The following Annex VIII is added:',body(2)],['‘ANNEX VIII',body(3)],['The following Annex VII is added:',body(4)],['‘ANNEX VII',body(5)],['Iron and steel',body(6)],['CN code',cellPath(1,1,1)],['Greenhouse gas',cellPath(1,1,2)],['ex 7204 Ferrous waste',cellPath(1,2,1)],['Carbon dioxide',cellPath(1,2,2)],['’',body(7)]],p=proposal(rows);
 const w=wording('Annex III – paragraph 1 – table on iron and steel\nRegulation (EU) 2023/956\nAnnex VIII – table Iron and Steel','‘[Iron and steel\nCN code\tGreenhouse gas\nex 7204 Ferrous waste\tCarbon dioxide'),act={paragraphs:[{text:'Regulation (EU) 2023/956 is amended as follows:',complete:true,source:{complete:true,container:'body'}}]};
 for(const source of [p,proposal(rows.filter(r=>r[0]!=='The following Annex VII is added:')),proposal(rows.filter(r=>r[0]!=='‘ANNEX VII'))]){const start=source.paragraphs.findIndex(r=>r.text==='Iron and steel');assert.notEqual(verifyPlacement({items:[{kind:'annex',proposal:source},{kind:'act',proposal:act}],wording:w,placement:replace(start,start+4,source)}).status,'verified');}
});


test('an annex point can address exact published table wording without the word table',()=>{
 const p=proposal([['ANNEX I',body(1)],['(1) Earlier instruction.',body(2)],['(2) The combined products table is replaced:',body(3)],['CN code',cellPath(1,1,1)],['Greenhouse gas',cellPath(1,1,2)],['7314 Metal products',cellPath(1,2,1)],['Carbon dioxide',cellPath(1,2,2)],['ANNEX II',body(4)]]);
 const w=wording('Annex I – point 2','CN code\tGreenhouse gas\n7314 Metal products\tCarbon dioxide');
 assert.equal(check(w,replace(3,6,p),p).status,'verified');
 assert.equal(check({...w,targetLabel:'Annex I – point 1'},replace(3,6,p),p).status,'unverified');
 assert.equal(check(w,replace(3,5,p),p).status,'failed');
 assert.notEqual(check({...w,originalText:w.originalText.replace('7314','7315')},replace(3,6,p),p).status,'verified');
});

test('native empty first or last table rows prevent article-table placement and verification',async()=>{
 const {fixtureZip}=await import('./fixtures/bare-annex-indent-native.mjs');
 const {parseProposal}=await import('../server/proposal-structure.mjs');
 const {resolveProposalPlacement}=await import('../server/proposal-placement.mjs');
 const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const paragraph=(style,text)=>`<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
 const tr=(a,b)=>`<w:tr>${[a,b].map(v=>`<w:tc><w:p>${v?`<w:r><w:t>${v}</w:t></w:r>`:''}</w:p></w:tc>`).join('')}</w:tr>`;
 const w=wording('Article 20 – paragraph 2 – table','(a)\tCigars\n(b)\tOther');
 for(const at of ['none','first','last','duplicate']){
  const table=[...(at==='first'?[tr('','')]:[]),tr('(a)','Cigars'),tr('(b)','Other'),...(at==='last'?[tr('','')]:[])].join('');
  const extra=at==='duplicate'?`<w:tbl>${tr('(a)','Cigars')}${tr('(b)','Other')}</w:tbl>`:'';
  const xml=`<w:document xmlns:w="${ns}"><w:body>${paragraph('Titrearticle','Article 20')}${paragraph('ManualNumPar1','2. The following applies:')}<w:tbl>${table}</w:tbl>${extra}${paragraph('ManualNumPar1','3. Next paragraph;')}${paragraph('Titrearticle','Article 21')}</w:body></w:document>`;
  const buffer=fixtureZip({'word/document.xml':xml}),p=parseProposal(buffer),items=[{kind:'act',proposal:p}],placed=resolveProposalPlacement(items,w);
  if(at==='none'){assert.equal(placed.status,'placed');assert.equal(verifyPlacement({items,wording:w,placement:placed}).status,'verified');}
  else {assert.notEqual(placed.status,'placed');const first=p.paragraphs.find(x=>x.text==='(a)').index,last=p.paragraphs.find(x=>x.text==='Other').index;assert.notEqual(verifyPlacement({items,wording:w,placement:replace(first,last,p)}).status,'verified');}
 }
});
