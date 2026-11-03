import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertBareAnnexIndent} from './amendment-annex-indent-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main',esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),hash=b=>createHash('sha256').update(b).digest('hex');
function zip(parts){let offset=0;const locals=[],central=[];for(const [name,value] of Object.entries(parts)){const n=Buffer.from(name),b=Buffer.from(value),l=Buffer.alloc(30),c=Buffer.alloc(46);l.writeUInt32LE(0x04034b50);l.writeUInt32LE(b.length,18);l.writeUInt32LE(b.length,22);l.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);locals.push(l,n,b);central.push(c,n);offset+=l.length+n.length+b.length;}const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(parts).length,8);end.writeUInt16LE(Object.keys(parts).length,10);end.writeUInt32LE(central.reduce((n,b)=>n+b.length,0),12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,...central,end]);}
const p=(text,style='Normal',id=null)=>`<w:p><w:pPr><w:pStyle w:val="${style}"/>${id?`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`:''}</w:pPr><w:r><w:t>${esc(text)}</w:t></w:r></w:p>`;
const wrap=body=>`<w:document xmlns:w="${ns}"><w:body>${body}</w:body></w:document>`;
const instance=(id,abstract,restart=false)=>`<w:num w:numId="${id}"><w:abstractNumId w:val="${abstract}"/>${restart?'<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>':''}</w:num>`;
function input(){
 const rows=[['ANNEX','Annexetitre'],['Funding actions','Normal'],['First point:','Point0number','28','(1)\t'],['First bullet.','Bullet0','10','•\t'],['','Normal'],['Second point:','Point0number',null,'(2)\t'],['Second bullet.','Bullet0','11','•\t'],['Third point:','Point0number',null,'(3)\t'],...Array.from({length:7},(_,i)=>['Native bullet '+(i+1)+'.','Bullet0','12','•\t'])];
 const body=rows.map(([t,s,id])=>p(t,s,id)).join(''),numbering=`<w:numbering xmlns:w="${ns}"><w:abstractNum w:abstractNumId="8"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="(%1)"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="16"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:rPr><w:rFonts w:ascii="Symbol"/></w:rPr></w:lvl></w:abstractNum>${instance('28','8',true)}${instance('37','8')}${['10','11','12','38'].map(id=>instance(id,'16',true)).join('')}</w:numbering>`;
 const styles=`<w:styles xmlns:w="${ns}">${['Normal','Annexetitre'].map(id=>`<w:style w:styleId="${id}"/>`).join('')}<w:style w:styleId="Point0number"><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="37"/></w:numPr></w:pPr></w:style><w:style w:styleId="Bullet0"><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="38"/></w:numPr></w:pPr></w:style></w:styles>`;
 const parts={'word/document.xml':wrap(body),'word/numbering.xml':numbering,'word/styles.xml':styles},proposalBuffer=zip(parts),actBuffer=zip({'word/document.xml':wrap(p('Eligible groups are listed in the Annex.'))});let segment=0;
 const paragraphs=rows.flatMap(([text,,id,prefix],ordinal)=>{if(!text){segment++;return [];}return [{text:(prefix||'')+text,complete:true,source:{path:`/w:document[1]/w:body[1]/w:p[${ordinal+1}]`,ordinal,segment,container:'body',containerPath:'body',complete:true}}];}).map((p,index)=>({...p,index}));
 const proposal={sourceHash:hash(proposalBuffer),paragraphs},items=[{kind:'act',proposal:{sourceHash:hash(actBuffer)}},{kind:'annex',proposal}];
 return {items,proposal,wording:{baseline:'commission-proposal',language:'en',targetLabel:'Annex I – point 3 – indent 6 a (new)',originalText:'',proposedText:'– New professional group.'},placement:{operation:'insert',status:'placed',itemIndex:1,insertBefore:13,insertAfter:12},nativeQuoted:{proposalBuffer,proposalBuffers:[actBuffer,proposalBuffer]},parts};
}
function source(a,from,to){assert.notEqual(from,to);a.parts['word/document.xml']=a.parts['word/document.xml'].replace(from,to);a.nativeQuoted.proposalBuffer=zip(a.parts);a.nativeQuoted.proposalBuffers[1]=a.nativeQuoted.proposalBuffer;a.proposal.sourceHash=hash(a.nativeQuoted.proposalBuffer);}
test('independent native list decoding proves interior indent order and bare first annex identity',()=>{
 const a=input();for(const item of a.items)Object.defineProperty(item.proposal,'units',{get(){throw Error('placer tree forbidden');}});assert.equal(assertBareAnnexIndent(a).status,'verified');assert.equal(verifyPlacement(a).status,'verified');
 for(const before of [7,8,12,14]){const a=input();a.placement.insertBefore=before;a.placement.insertAfter=before-1;assert.equal(assertBareAnnexIndent(a).status,'failed');}
});
test('source identity, native numbering and every projected row must agree',()=>{
 for(const mutate of [a=>a.proposal.sourceHash='wrong',a=>a.nativeQuoted.proposalBuffers.pop(),a=>a.items.push({kind:'annex'}),a=>a.wording.targetLabel=a.wording.targetLabel.replace('Annex I','Annex II'),a=>a.wording.targetLabel=a.wording.targetLabel.replace('6 a','6 b'),a=>a.proposal.paragraphs[12].source.ordinal++,a=>a.proposal.paragraphs[12].complete=false,a=>a.proposal.paragraphs[12].text='Clipped.',a=>source(a,'ANNEX','ANNEX I'),a=>source(a,p('Native bullet 2.','Bullet0','12'),''),a=>source(a,'Native bullet 4.','<w:object/>Native bullet 4.'),a=>source(a,'</w:body>','<w:altChunk/></w:body>')]){const a=input();mutate(a);assert.equal(assertBareAnnexIndent(a).status,'unverified',String(mutate));}
});
test('numbering changes cannot preserve a synthetic ordinal answer',()=>{
 for(const [from,to] of [['w:val="(%1)"','w:val="%1."'],['w:val="bullet"','w:val="decimal"'],['w:val=""','w:val="?"'],['w:ascii="Symbol"','w:ascii="Other"']]){const a=input();a.parts['word/numbering.xml']=a.parts['word/numbering.xml'].replace(from,to);a.nativeQuoted.proposalBuffer=zip(a.parts);a.nativeQuoted.proposalBuffers[1]=a.nativeQuoted.proposalBuffer;a.proposal.sourceHash=hash(a.nativeQuoted.proposalBuffer);assert.equal(assertBareAnnexIndent(a).status,'unverified');}
});

test('bookmarks carry no ordinal, but additional annex headings and act identity conflicts stay unavailable',()=>{
 const a=input();source(a,p('Native bullet 4.','Bullet0','12'),'<w:bookmarkEnd w:id="2"/>'+p('Native bullet 4.','Bullet0','12'));assert.equal(assertBareAnnexIndent(a).status,'verified');
 const extra=input();source(extra,p('Funding actions'),p('ANNEX II'));assert.equal(assertBareAnnexIndent(extra).status,'unverified');
 const conflict=input();conflict.nativeQuoted.proposalBuffers[0]=zip({'word/document.xml':wrap(p('Eligible groups are listed in the Annex II.'))});conflict.items[0].proposal.sourceHash=hash(conflict.nativeQuoted.proposalBuffers[0]);assert.equal(assertBareAnnexIndent(conflict).status,'unverified');
});
