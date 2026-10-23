import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseProposal,proposalCandidates} from './proposal-structure.mjs';
import {docxContent} from './document-text.mjs';
import {freshLoader} from '../src/test-support/viteRunner.mjs';

function archive(documentXml,extra=[]) {
  const entries=[['word/document.xml',documentXml],...extra],locals=[],directory=[];let offset=0;
  for(const [filename,xml] of entries) {
    const name=Buffer.from(filename),body=Buffer.from(xml),compressed=deflateRawSync(body),local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,name,compressed);directory.push(central,name);offset+=local.length+name.length+compressed.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,central,end]);
}
const text=value=>`<w:r><w:t>${value}</w:t></w:r>`;
const p=value=>`<w:p>${text(value)}</w:p>`;
const body=value=>`<w:document xmlns:w="urn:word" xmlns:m="urn:math" xmlns:r="urn:relationships"><w:body>${value}</w:body></w:document>`;
const equation='<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>';
const link=(id,contents)=>`<w:hyperlink r:id="r${id}">${contents}</w:hyperlink>`;
const relationships=count=>'<Relationships>'+Array.from({length:count},(_,i)=>`<Relationship Id="r${i+1}" Target="https://example.org/link-${i+1}" TargetMode="External"/>`).join('')+'</Relationships>';
const ref=(kind,id=1)=>`<w:p>${text('1. Provision.')}<w:r><w:${kind}Reference w:id="${id}"/></w:r></w:p>`;
const notePart=(kind,inside,id=1)=>`<w:${kind}s xmlns:w="urn:word" xmlns:m="urn:math" xmlns:r="urn:relationships"><w:${kind} w:id="${id}">${inside}</w:${kind}></w:${kind}s>`;
const sourceUrl='https://publications.europa.eu/resource/cellar/example';
function owning(result,first,second=first){
  assert.equal(proposalCandidates(result,'Article 1')[0].complete,first);
  assert.equal(proposalCandidates(result,'Article 2')[0].complete,second);
  assert.equal(proposalCandidates(result,'Article 3')[0].complete,true);
}
function ordinaryUnchanged(buffer,result){
  const ordinary=docxContent(buffer);
  assert.deepEqual(ordinary.paragraphs,result.paragraphs.map(p=>p.text));
  assert.deepEqual(ordinary.notes,result.notes.map(({id,label,text,links,linkSpans})=>({id,label,text,links,linkSpans})));
  assert.deepEqual(ordinary.anchors,result.anchors);assert.deepEqual(ordinary.links,result.links);
  assert(!('extractionGaps' in ordinary));
}

test('note hyperlink cap exposes only actual loss for footnotes/endnotes and preserves rendered text and equations',async t=>{
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>load.close());
  const {ProposalNotes}=await load('/src/ProposalNotes.tsx'),{ReferenceScope}=await load('/src/References.tsx');
  for(const kind of ['footnote','endnote'])for(const math of [false,true])for(const count of [10,11]){
    const prefix=Array.from({length:count-1},(_,i)=>link(i+1,text('linked '))).join('');
    const buffer=archive(body(p('Article 1')+ref(kind)+p('Article 2')+ref(kind)+p('Article 3')+p('1. Unaffected.')),
      [[`word/${kind}s.xml`,notePart(kind,`<w:p>${prefix}${link(count,math?equation:text('last text'))}${text(' tail')}</w:p>`)],[`word/_rels/${kind}s.xml.rels`,relationships(count)]]);
    const result=parseProposal(buffer,{sourceUrl}),note=result.notes[0],id=kind==='footnote'?'1':'endnote:1',over=count>10;
    assert.equal(note.id,id);assert.equal(note.complete,!over);assert.equal(note.extractionComplete,!over);
    assert.equal(note.text,'linked '.repeat(count-1)+(math?'\uFFFC':'last text')+' tail');
    assert.equal(note.linkSpans.length,10);assert.equal(note.links.length,10);assert.equal(note.links.includes(`https://example.org/link-${count}`),!over);
    assert.deepEqual(result.gaps.filter(g=>g.code==='note-links-truncated'),over?[{code:'note-links-truncated',limit:10,retained:10,total:11,
      message:'A source note exceeds the retained hyperlink limit.',note:id,sourcePart:`word/${kind}s.xml`,sourcePath:`/w:${kind}s[1]/w:${kind}[1]`}]:[]);
    assert.equal(result.complete,!over);assert.equal(result.contentComplete,!over);owning(result,!over);
    assert.equal(result.paragraphs[1].complete,!over);assert.equal(result.paragraphs[3].complete,!over);
    if(math){
      const object=note.objects[0];assert.equal(object.status,'converted');assert(object.complete);assert.equal(object.offset,7*(count-1));
      assert.equal(object.note,id);assert.equal(object.sourcePart,`word/${kind}s.xml`);
      assert.equal(object.path,`/w:${kind}s[1]/w:${kind}[1]/w:p[1]/w:hyperlink[${count}]/m:oMath[1]`);assert.equal(object.sourceUrl,sourceUrl);
    }
    const html=renderToStaticMarkup(createElement(ReferenceScope,{texts:[],language:'en',notes:result.notes,notePrefix:'caps'},createElement(ProposalNotes,{notes:result.notes,prefix:'caps'})));
    assert(html.includes(`id="caps-note-${id}"`));assert(html.includes(' tail'));assert.equal(html.includes(`<math>`),math);
    assert.equal(html.includes(`href="https://example.org/link-${count}"`),!over);
    if(!math)assert(html.includes('last text'));
    assert(!html.includes('Equation unavailable'));assert(!/<a\b[^>]*>(?:(?!<\/a>).)*<a\b/s.test(html));
    ordinaryUnchanged(buffer,result);
  }
});

test('note text at 4000 and above retains bounded text, surviving objects and source ownership',()=>{
  for(const kind of ['footnote','endnote'])for(const length of [4000,4001]){
    const buffer=archive(body(p('Article 1')+ref(kind)+p('Article 2')+ref(kind)+p('Article 3')+p('1. Unaffected.')),
      [[`word/${kind}s.xml`,notePart(kind,`<w:p>${text('a'.repeat(3998))}${equation}${text('z'.repeat(length-3999))}</w:p>`)]]);
    const result=parseProposal(buffer,{sourceUrl}),note=result.notes[0],over=length>4000;
    assert.equal(note.text,'a'.repeat(3998)+'\uFFFCz');assert.equal(note.text.length,4000);assert.equal(note.complete,!over);
    assert.equal(note.objects[0].offset,3998);assert.equal(note.objects[0].status,'converted');assert.equal(note.objects[0].path,note.source.path+'/w:p[1]/m:oMath[1]');
    assert.deepEqual(result.gaps.filter(g=>g.code==='note-text-truncated'),over?[{code:'note-text-truncated',limit:4000,retained:4000,total:4001,
      message:'A source note exceeds the retained text limit.',note:note.id,sourcePart:`word/${kind}s.xml`,sourcePath:note.source.path}]:[]);
    assert.equal(result.complete,!over);owning(result,!over);ordinaryUnchanged(buffer,result);
  }
});

test('the shared 500-note cap attributes omitted footnotes/endnotes to every referencing paragraph',()=>{
  for(const kind of ['footnote','endnote'])for(const count of [500,501]){
    // A footnote/endnote mixture shares the same projection budget.
    const firstKind=kind==='footnote'?'endnote':'footnote';
    const first=Array.from({length:499},(_,i)=>`<w:${firstKind} w:id="${i+1}">${p('Note '+(i+1))}</w:${firstKind}>`).join('');
    const references=Array.from({length:499},(_,i)=>`<w:r><w:${firstKind}Reference w:id="${i+1}"/></w:r>`).join('');
    const tail=`<w:${kind} w:id="1">${p('Retained note.')}</w:${kind}>`+(count>500?`<w:${kind} w:id="2"><w:p>${equation}${text(' Omitted note.')}</w:p></w:${kind}>`:'');
    const second=count>500?ref(kind,2)+ref(kind,2).replace('1. Provision.','2. Provision.'):p('1. Unaffected at cap.');
    const buffer=archive(body(p('Article 1')+`<w:p>${text('1. Provision.')}${references}</w:p>`+ref(kind).replace('1. Provision.','2. Provision.')+p('Article 2')+second+p('Article 3')+p('1. Unaffected.')),
      [[`word/${firstKind}s.xml`,`<w:${firstKind}s xmlns:w="urn:word">${first}</w:${firstKind}s>`],[`word/${kind}s.xml`,`<w:${kind}s xmlns:w="urn:word" xmlns:m="urn:math">${tail}</w:${kind}s>`]]);
    const result=parseProposal(buffer,{sourceUrl}),over=count>500,id=kind==='footnote'?'2':'endnote:2';
    assert.equal(result.notes.length,500);assert(result.notes.every(n=>n.complete));
    const gaps=result.gaps.filter(g=>g.code==='note-count-truncated');assert.equal(gaps.length,over?2:0);
    for(const [i,gap] of gaps.entries())assert.deepEqual(gap,{code:'note-count-truncated',note:id,paragraph:4+i,offset:13,sourcePart:`word/${kind}s.xml`,sourcePath:`/w:${kind}s[1]/w:${kind}[2]`,limit:500,message:'A referenced source note exceeds the retained note count.'});
    assert.equal(result.complete,!over,JSON.stringify(result.gaps));assert.equal(result.contentComplete,!over);owning(result,true,!over);ordinaryUnchanged(buffer,result);
  }
});

test('the 500-body-link cap affects only paragraphs losing text or equation hyperlink annotations',()=>{
  for(const math of [false,true])for(const count of [500,501]){
    const first=Array.from({length:500},(_,i)=>link(i+1,math&&i===499?equation:text('linked '))).join('');
    const last=count>500?link(501,math?equation:text('last text')):text('At cap.');
    const buffer=archive(body(p('Article 1')+`<w:p>${first}</w:p>`+p('Article 2')+`<w:p>${last}${text(' tail')}</w:p>`+p('Article 3')+p('1. Unaffected.')),[['word/_rels/document.xml.rels',relationships(count)]]);
    const result=parseProposal(buffer,{sourceUrl}),over=count>500;
    assert.equal(result.links.length,500);assert.equal(result.paragraphs[1].complete,true);assert.equal(result.paragraphs[3].complete,!over);
    assert.equal(result.paragraphs[3].text,(over?(math?'\uFFFC':'last text'):'At cap.')+' tail');
    assert.deepEqual(result.gaps.filter(g=>g.code==='document-links-truncated'),over?[{code:'document-links-truncated',paragraph:3,sourcePart:'word/document.xml',sourcePath:'/w:document[1]/w:body[1]/w:p[4]',limit:500,omitted:1,message:'Source paragraph hyperlinks exceed the retained document hyperlink limit.'}]:[]);
    assert.equal(result.links.at(-1).url,'https://example.org/link-500');
    if(math){
      const retained=result.paragraphs[1].objects[0];assert.equal(retained.status,'converted');assert(retained.complete);assert.equal(retained.offset,499*7);
      assert.equal(retained.path,'/w:document[1]/w:body[1]/w:p[2]/w:hyperlink[500]/m:oMath[1]');
      if(over){const omitted=result.paragraphs[3].objects[0];assert.equal(omitted.status,'converted');assert(omitted.complete);assert.equal(omitted.path,'/w:document[1]/w:body[1]/w:p[4]/w:hyperlink[1]/m:oMath[1]');}
    }
    assert.equal(result.complete,!over,JSON.stringify(result.gaps));assert.equal(result.contentComplete,!over);owning(result,true,!over);ordinaryUnchanged(buffer,result);
  }
});
