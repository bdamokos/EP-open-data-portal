import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {extractAmendments} from './amendment-documents.mjs';
function zip(xml){
  const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),packed=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}

const p=text=>'<w:p><w:r><w:t>'+text+'</w:t></w:r></w:p>';
const tc=content=>'<w:tc>'+content+'</w:tc>',tr=(a,b)=>'<w:tr>'+tc(a)+tc(b)+'</w:tr>';
const formula='<m:oMathPara><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></m:oMathPara>';
function input(rewrite=x=>x){
 const target='Article 12 – paragraph 4 a (new)', proposed='4a.\tApply the formula:\nwhere y is the year.';
 const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>'+p('&lt;Amend&gt;&lt;NumAm&gt;57&lt;/NumAm&gt;')+p('&lt;DocAmend&gt;Proposal for a directive&lt;/DocAmend&gt;')+p('&lt;Article&gt;'+target+'&lt;/Article&gt;')+'<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>'+tr(p('Text proposed by the Commission'),p('Amendment'))+tr(p(''),'<w:p><w:r><w:t>4a.</w:t><w:tab/><w:t>Apply the formula:</w:t></w:r>'+formula+'</w:p>')+tr(p(''),p('where y is the year.'))+'</w:tbl>'+p('&lt;/Amend&gt;')+'</w:body></w:document>';
 return {wording:{number:57,targetLabel:target,language:'en',baseline:'commission-proposal',originalText:'',proposedText:proposed,gaps:[{code:'formula-not-shown'}]},nativeQuoted:{number:57,amendmentBuffer:zip(rewrite(xml))}};
}

const extract=(rewrite=x=>x)=>extractAmendments(input(rewrite).nativeQuoted.amendmentBuffer,{language:'en',sourceUrl:'https://example.org/amendment.docx'}).amendments[0];
test('new paragraph formula keeps surrounding wording with an explicit source gap',()=>{const w=extract();assert.equal(w.originalText,'');assert.equal(w.proposedText,input().wording.proposedText);assert(w.gaps.some(g=>g.code==='formula-not-shown'&&g.sourceUrl==='https://example.org/amendment.docx'));assert(!w.gaps.some(g=>g.code==='non-text-content'));});
test('replacement, mismatched prefix, missing grids and other opaque objects withhold wording',()=>{
 for(const rewrite of [x=>x.replace(/<w:tblGrid>.*?<\/w:tblGrid>/u,''),x=>x.replace('<w:gridCol/><w:gridCol/>',''),x=>x.replace('(new)',''),x=>x.replace('>4a.<','>5a.<'),x=>x.replace(formula,'<w:drawing/>'),x=>x.replace(formula,formula+formula),x=>x.replace('officeDocument/2006/math','wrong/math'),x=>x.replace('<m:r>','<m:r><w:drawing/>')]){const w=extract(rewrite);assert.equal(w.originalText,null);assert.equal(w.proposedText,null);assert(!w.gaps.some(g=>g.code==='formula-not-shown'));}
});
test('hidden words, changed cell ownership and tracked edits cannot opt in',()=>{
 for(const rewrite of [x=>x.replace('Apply the formula:','Apply the formula:</w:t><w:vanish/><w:t>'),x=>x.replace('<w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>','<w:tc>'+p('Original')+'</w:tc>'),x=>x.replace('<m:oMathPara>','<w:ins><m:oMathPara>').replace('</m:oMathPara>','</m:oMathPara></w:ins>')])assert.equal(extract(rewrite).proposedText,null);
});

test('formula recovery requires a usable source link',()=>{for(const sourceUrl of [null,'javascript:alert(1)','https://user:pass@example.org/a.docx']){const w=extractAmendments(input().nativeQuoted.amendmentBuffer,{language:'en',sourceUrl}).amendments[0];assert.equal(w.proposedText,null);}});
