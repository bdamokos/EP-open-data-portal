// Synthetic source package. Native downloaded bytes remain outside Git.
export function noteWord(body,{notes=[],styles='',footnotePr=''}={}) {
 const wrap=(tag,content)=>`<w:${tag} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${content}</w:${tag}>`;
 const entries=[['word/document.xml',wrap('document',`<w:body>${body}${footnotePr}</w:body>`)],['word/footnotes.xml',wrap('footnotes',notes.map(([id,text])=>`<w:footnote w:id="${id}"><w:p><w:r><w:footnoteRef/><w:t>${text}</w:t></w:r></w:p></w:footnote>`).join(''))]];
 if(styles)entries.push(['word/styles.xml',wrap('styles',styles)]);
 const files=[],directory=[];let offset=0;
 for(const [path,xml] of entries){const name=Buffer.from(path),bytes=Buffer.from(xml),local=Buffer.alloc(30),central=Buffer.alloc(46);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);files.push(local,name,bytes);directory.push(central,name);offset+=local.length+name.length+bytes.length;}
 const end=Buffer.alloc(22),central=Buffer.concat(directory);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...files,central,end]);
}
export const noteBody='<w:p><w:r><w:t>(1)\tAlpha</w:t><w:footnoteReference w:id="7"/><w:t> and Beta</w:t><w:footnoteReference w:id="9"/><w:t>.</w:t></w:r></w:p>';
export const noteDefinitions=[['7','First citation.'],['9','Second citation.']];
