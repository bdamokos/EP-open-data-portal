import test from 'node:test';
import assert from 'node:assert/strict';
import {amendmentNumber,documentReferenceLabel,legacyReaderRedirect,provisionLabel,readHref,readRoute,readableDocument} from './readRoute.mjs';
import {paragraphPassage,passageNotes,proposalPassage} from './proposalPassage.mjs';
import {documentContextQuery} from '../server/document-context.mjs';
import {explorerParams} from './explorerQuery.mjs';

const report='A-10-2026-0257',amendment=report+'-AM-4',list=report+'-AM-001-163';
const query=value=>new URLSearchParams(value);

test('the reader URL round-trips exact identifiers and an unknown wording language',()=>{
  const href=readHref({documentId:report,amendmentId:amendment,listId:list,wordingLanguage:'en',language:'en'});
  assert.equal(href,'?view=legislation&pl-mode=read&read-doc=A-10-2026-0257&read-amendment=A-10-2026-0257-AM-4&read-list=A-10-2026-0257-AM-001-163&read-lang=en&lang=en');
  assert.deepEqual(readRoute(query(href)),{documentId:report,amendmentId:amendment,staleAmendment:false,listId:list,wordingLanguage:'en'});
  assert.equal(readRoute(query(readHref({documentId:report,amendmentId:amendment,listId:list,wordingLanguage:null}))).wordingLanguage,null);
  assert.deepEqual(readRoute(query(readHref({documentId:report}))),{documentId:report,staleAmendment:false});
  assert.deepEqual(readRoute(query('read-doc='+report+'&read-lang=fr')),{documentId:report,staleAmendment:false,textLanguage:'fr'});
});

test('committee amendments keep their exact list in the reader URL',()=>{
  const committee='committee:CULT-AM-789899:12',href=readHref({documentId:'CULT-PR-787958',amendmentId:committee,listId:'CULT-AM-789899',wordingLanguage:'en'});
  assert.deepEqual(readRoute(query(href)),{documentId:'CULT-PR-787958',amendmentId:committee,staleAmendment:false,listId:'CULT-AM-789899',wordingLanguage:'en'});
  assert.equal(amendmentNumber(committee),'12');
});

test('a malformed amendment reads as a stale link and a malformed document opens nothing',()=>{
  assert.deepEqual(readRoute(query('read-doc='+report+'&read-amendment=A-10-2026-0001-AM-4')),{documentId:report,staleAmendment:true});
  assert.deepEqual(readRoute(query('read-doc='+report+'&read-amendment=<script>')),{documentId:report,staleAmendment:true});
  assert.equal(readRoute(query('read-doc=nonsense')),null);
  assert.equal(readRoute(query('read-amendment='+amendment)),null);
  assert.equal(readRoute(query('read-doc='+report+'&read-amendment='+amendment+'&read-list=A-10-2026-0001-AM-001-163')).listId,undefined);
});

test('the client accepts the documents the server reads, so a link never becomes a 400',()=>{
  for(const id of [report,'B-10-2026-0424','RC-10-2026-0005','TA-10-2026-0342',list,'CULT-PR-787958','CULT-PA-787958','CULT-AM-789899'])assert.equal(readableDocument(id),true,id);
  for(const id of [report,'B-10-2026-0424','TA-10-2026-0342','CULT-PR-787958','CULT-AM-789899'])assert.doesNotThrow(()=>documentContextQuery(id,new URLSearchParams()),id);
  for(const id of ['C-10-2026-0012','CULT-AD-787958','','nonsense',null])assert.equal(readableDocument(id),false,String(id));
});

test('App keeps the reader parameters when it rewrites the query',()=>{
  const params=explorerParams(query('view=legislation&pl-mode=read&read-doc='+report+'&read-amendment='+amendment+'&read-list='+list+'&read-lang=en'),'legislation');
  assert.deepEqual(Object.fromEntries(params),{'pl-mode':'read','read-doc':report,'read-amendment':amendment,'read-list':list,'read-lang':'en'});
});

test('an old amendment URL becomes the reader, with its origin kept for Back',()=>{
  const origin='member=113523&module=votes&mv-week=2026-10-19&mv-positions=all&mv-decision=MTG-PL-2026-10-22-DEC-199360&mv-snapshot='+'a'.repeat(64)+'&mv-expanded=%5B%22MTG-PL-2026-10-22-VOT-ITM-993260%22%5D';
  const old=origin+'&mv-document='+report+'&mv-view=document&mv-amendment='+amendment+'&mv-list='+list+'&mv-wording-lang=en';
  const result=legacyReaderRedirect('?'+old);
  assert.deepEqual(Object.fromEntries(query(result.read)),{view:'legislation','pl-mode':'read','read-doc':report,'read-amendment':amendment,'read-list':list,'read-lang':'en'});
  assert.deepEqual(Object.fromEntries(query(result.origin)),Object.fromEntries(query(origin)));
  assert.equal(query(legacyReaderRedirect('?'+origin+'&mv-document='+report+'&mv-view=document&mv-amendment='+amendment+'&mv-list='+list+'&mv-wording-lang=unknown').read).get('read-lang'),'unknown');
});

test('only an exact valid amendment context redirects',()=>{
  const base='member=113523&module=votes&mv-decision=MTG-PL-2026-10-22-DEC-199360';
  for(const search of [base,base+'&mv-document='+report+'&mv-view=document',base+'&mv-document='+report+'&mv-view=adopted',base+'&mv-document=A-10-2026-0001&mv-view=document&mv-amendment='+amendment,'member=113523&module=votes&mv-document='+report+'&mv-view=document&mv-amendment='+amendment,'view=legislation&mv-view=document&mv-amendment='+amendment])assert.equal(legacyReaderRedirect('?'+search),null,search);
});

test('references and provision labels use their published forms',()=>{
  assert.equal(documentReferenceLabel(report),'A10-0257/2026');
  assert.equal(documentReferenceLabel('B-10-2026-0424'),'B10-0424/2026');
  assert.equal(documentReferenceLabel('RC-10-2026-0005'),'RC10-0005/2026');
  assert.equal(documentReferenceLabel('TA-10-2026-0342'),'T10-0342/2026');
  assert.equal(documentReferenceLabel('CULT-PR-787958'),'CULT-PR-787958');
  assert.equal(provisionLabel('Article 3 – paragraph 1 – subparagraph 1'),'Article 3');
  assert.equal(provisionLabel('Recital 3'),'Recital 3');
  assert.equal(provisionLabel('Annex I - part A'),'Annex I');
  assert.equal(provisionLabel('Article 3 a (new)'),'Article 3 a (new)');
  assert.equal(provisionLabel(null),null);
  assert.equal(amendmentNumber(report+'-AM-004'),'4');assert.equal(amendmentNumber(report+'-AM-12-1'),'12-1');
});

// Half-open extents as ProposalDocument records them.
const unit=(kind,start,end,children=[],extra={})=>({kind,extent:{start,end},children,...extra});
const recitals=Array.from({length:6},(_,index)=>unit('recital',10+index,11+index));
const articles=[unit('article',20,22),unit('article',22,25,[unit('paragraph',23,24),unit('paragraph',24,25)]),unit('article',26,27),unit('article',27,28),unit('article',28,29)];
const document={paragraphs:Array.from({length:40}),units:[unit('frontmatter',0,1),unit('memorandum',1,10),unit('preamble',10,20,[unit('title',16,17),...recitals]),unit('body',20,30,[unit('chapter',20,25,articles.slice(0,2)),unit('chapter',25,29,[unit('subheading',25,26),...articles.slice(2)])]),unit('financial-statement',30,40,[unit('table',30,35,[],{table:{paragraphs:[30,31,32,33,34]}})])]};
const replace=(start,end=start)=>({operation:'replace',span:{start,end}});

test('a passage is the targeted provision with two provisions either side',()=>{
  assert.deepEqual(proposalPassage(document,replace(13)),{start:11,end:16},'recital 4 shows recitals 2 to 6');
  assert.deepEqual(proposalPassage(document,replace(10)),{start:10,end:13},'the first recital has none before it, and the memorandum is not one');
  assert.deepEqual(proposalPassage(document,replace(5)),{start:1,end:10},'a target in the memorandum stays in the memorandum');
  assert.deepEqual(proposalPassage(document,replace(15)),{start:13,end:25},'the last recital runs into the first articles, past a heading');
});

test('a point inside an article shows the whole article and two articles either side',()=>{
  assert.deepEqual(proposalPassage(document,replace(23)),{start:15,end:28},'headings between provisions stay in the run');
  assert.deepEqual(proposalPassage(document,replace(26)),{start:20,end:29});
});

test('new text between two provisions shows two provisions either side of the gap',()=>{
  assert.deepEqual(proposalPassage(document,{operation:'insert',insertAfter:12,insertBefore:13}),{start:11,end:15});
  assert.deepEqual(proposalPassage(document,{operation:'insert',insertAfter:23,insertBefore:24}),{start:15,end:28},'inside an article it stays with that article');
});

test('a target outside any provision falls back to source paragraphs and never cuts a table',()=>{
  const heading=proposalPassage(document,replace(16));
  assert(heading.start<=16&&heading.end>16);
  const table=proposalPassage(document,replace(32));
  assert(table.start<=30&&table.end>=35,JSON.stringify(table));
  assert.equal(proposalPassage(document,{operation:'replace'}),null);
});

test('a report passage counts paragraphs, stays inside the body and keeps whole tables',()=>{
  assert.deepEqual(paragraphPassage(replace(10),{start:0,count:40}),{start:8,end:13});
  assert.deepEqual(paragraphPassage(replace(10,12),{start:0,count:40}),{start:8,end:15});
  assert.deepEqual(paragraphPassage(replace(10),{start:9,count:11}),{start:9,end:11});
  assert.deepEqual(paragraphPassage({operation:'insert',insertAfter:10,insertBefore:11},{start:0,count:40}),{start:8,end:13});
  assert.deepEqual(paragraphPassage(replace(10),{start:0,count:40,tables:[{rows:[[{start:11,end:13},{start:13,end:17}]]}]}),{start:8,end:17});
});

test('a passage lists only the notes its text cites',()=>{
  const notes=[{id:'1'},{id:'2'}],anchors=[{paragraph:3,note:'1'},{paragraph:9,note:'2'}];
  assert.deepEqual(passageNotes(notes,anchors,{start:0,end:5}),[{id:'1'}]);
  assert.deepEqual(passageNotes(notes,anchors,null),notes);
});
