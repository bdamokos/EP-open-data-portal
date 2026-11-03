// Small supplied XML packages, not recorded HTTP observations. Full native
// source bytes remain outside Git; the private actual-byte cohort is separate.
export function word(body) {
  const name=Buffer.from('word/document.xml'),bytes=Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  const local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+bytes.length,16);
  return Buffer.concat([local,name,bytes,central,name,end]);
}
export const p=(text,style='Normal',hidden=false)=>`<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r>${hidden?'<w:rPr><w:vanish/></w:rPr>':''}<w:t>${text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</w:t></w:r></w:p>`;
export const heading=(procedure='2026/0137 (NLE)',type='COUNCIL DECISION',hidden=false)=>p(procedure,'Rfrenceinterinstitutionnelle',hidden)+p('Proposal for a','Statut',hidden)+p(type,'Typedudocument',hidden);
export const reportId='A-10-2026-0260',procedure='2026/0137(NLE)',reference='(COM(2026)0510 – C10-0153/2026 – '+procedure+')';
