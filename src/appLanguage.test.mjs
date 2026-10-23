import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const member={id:257043,firstName:'Mika',lastName:'Aaltola',sortName:'AALTOLA Mika',gender:'m',countryCode:'FI',groupCode:'EPP',memberships:[{id:'AFET',role:'MEMBER',classification:'COMMITTEE',current:true,start:'2024-07-16',end:null}],accounts:[]};
const directory={day:'2026-10-16',members:[member],committees:[{id:'AFET',code:'AFET',names:{en:'Foreign affairs',fr:'Affaires étrangères',hu:'Külügy'},classification:'COMMITTEE'},{id:'LIBE',code:'LIBE',names:{en:'Civil liberties'},classification:'COMMITTEE'}],index:{complete:true,loaded:1,total:1,failed:0,error:null}};
const copy={
  en:{title:'Members of the European Parliament',back:'Back',speeches:'Latest speeches',profile:'Profile',country:'Country'},
  hu:{title:'Európai parlamenti képviselők',back:'Vissza',speeches:'Legutóbbi felszólalások',profile:'Profil',country:'Ország'},
  fr:{title:'Députés au Parlement européen',back:'Retour',speeches:'Dernières interventions',profile:'Profil',country:'Pays'},
};
const date=(value,language)=>new Intl.DateTimeFormat(language,{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(value+'T12:00:00Z'));
const page=items=>({categories:{'written-questions':'Written questions','plenary-contributions':'Plenary contributions'},categoryGroups:[],categoryCoverage:{},items,selectedItems:[],indexedTotal:items.length,nextOffset:null,unclassifiedMotionCount:0,cache:{complete:true,stale:false,lastSuccessfulRefresh:'2026-10-16'}});
const speech=(number,titles)=>({id:'speech:'+number,sourceId:'MTG-PL-2026-10-07-OTH-'+number,date:'2026-10-07',title:'Unused server title',titles,titleLanguage:null,recordKind:'speech',category:'plenary-contributions',categoryLabel:'Plenary contributions',speechKind:'PLENARY_DEBATE_SPEECH',reference:'CRE-'+number,files:[],start:'2026-10-07T10:00:00Z',end:'2026-10-07T10:01:00Z',websiteUrl:'https://www.europarl.europa.eu/doceo/document/CRE-'+number+'_EN.html',websiteLanguage:'en',provenance:{role:'SPEAKER'}});
const speeches=[speech(101,{en:'English title',hu:'Magyar cím',fr:'Titre français'}),speech(102,{en:'English fallback'}),speech(103,{de:'Erster Titel',it:'Secondo titolo'}),speech(104,{de:'',it:'Do not scan to this title'}),speech(105,{}),speech(106,{'':'Language unknown title'})];
const questionId='E-10-2026-003031',unknownId='E-10-2026-003032',frenchId='E-10-2026-003033';
const answerId=questionId+'-ASW';
const question=(id,title,titleLanguage)=>({id:'question:'+id,sourceId:id,date:'2026-10-01',title,titleLanguage,recordKind:'document',category:'written-questions',categoryLabel:'Written questions',reference:id,files:[],answerIds:[],provenance:{role:'QUESTION_AUTHOR'}});
const questions=[question(questionId,'Titre de la question','fr'),question(unknownId,'Unknown source title',null),question(frenchId,'Francia kérdés','hu')];
const download='https://www.europarl.europa.eu/doceo/document/'+questionId+'_EN.docx';
const bodies={
  [questionId]:{language:'en',translationType:'original',paragraphs:['Question for written answer E-003031/2026','Mika Aaltola (PPE)','Subject: Fixture title','This English source paragraph keeps its original punctuation and supplied note marker.'],note:'An English source note.'},
  [unknownId]:{language:null,translationType:null,paragraphs:['Nyelvmegjelölés nélküli eredeti szöveg.'],note:'Language metadata is absent for this note.'},
  [frenchId]:{language:'fr',translationType:'unspecified',paragraphs:['Ce texte français conserve sa langue et sa ponctuation.'],note:'Une note française.'},
  [answerId]:{language:'en',translationType:'original',paragraphs:['An English answer with its original source text.'],note:'An English answer note.'},
};
function documentResult(id) {
  const body=bodies[id];
  return {id,selectedDocumentId:id,date:'2026-10-01',titles:{fr:'Titre de la question'},roles:['AUTHOR'],files:[{format:'DOCX',language:'en',url:download}],answers:id===questionId?[{id:answerId,date:'2026-10-02',titles:{en:'Answer fixture'},files:[]}]:[],coAuthors:[{id:member.id,name:'Mika Aaltola',profileAvailable:true,role:'QUESTION_AUTHOR'}],selectedText:{status:'available',paragraphs:body.paragraphs,textLanguage:body.language,availableTextLanguages:['en','fr'],translationType:body.translationType,sourceFormat:'DOCX',sourceUrl:download,notes:[{id:'1',label:'1',text:body.note,links:[]}],noteAnchors:[{paragraph:body.paragraphs.length-1,offset:10,note:'1',label:'1'}],documentLinks:[]}};
}
// An empty lang attribute is an explicit unknown boundary, not a reason to
// continue searching ancestors for the interface language.
function effectiveLanguage(node) {
  const element=node?.nodeType===3?node.parentElement:node;
  assert(element,'language assertion has a rendered target');
  return element.closest('[lang]')?.getAttribute('lang')??null;
}
function exactText(container,selector,text) {
  const node=[...container.querySelectorAll(selector)].find(node=>node.textContent===text);
  assert(node,'Missing '+selector+': '+text);return node;
}
async function harness(t,language,{items=speeches,query={},linkedDocument,speechResponse}={}) {
  const window=new Window({url:'http://localhost/?'+new URLSearchParams({lang:language,...query})}),unexpected=[],requests=[];
  class ReaderDOMParser extends window.DOMParser {
    parseFromString(...args) {
      const parsed=super.parseFromString(...args),query=parsed.getElementsByTagNameNS.bind(parsed);
      // Happy DOM lacks the wildcard namespace query used by the real reader.
      parsed.getElementsByTagNameNS=(namespace,name)=>namespace==='*'?parsed.getElementsByTagName(name):query(namespace,name);
      return parsed;
    }
  }
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:ReaderDOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),innerWidth:1440,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,loadModule;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
    assert.deepEqual(unexpected,[],'every fetch stays within the isolated app fixtures');
  });
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href),route=url.pathname.split('/api/')[1];
    if(route?.startsWith('speech-transcript/'))return Response.json({id:route.split('/')[1],available:false});requests.push(route+url.search);
    if(route==='directory')return Response.json(directory);
    if(route?.startsWith('portrait/'))return new Response(null,{status:404});
    if(route?.startsWith('profile/'))return Response.json({...member,birthDate:'1969-05-02',birthPlace:'Jämsänkoski',email:'fixture@example.invalid'});
    if(route?.startsWith('latest-activities/'))return Response.json(page(items));
    if(route?.startsWith('speech-statistics/'))return Response.json({items:[],counts:{},groups:[],coverage:{available:0,total:0,complete:true,headers:0},sources:[],nextPage:null});
    if(route==='insights/speech-cloud')return Response.json({scope:{},words:[],speeches:[],coverage:{transcripts:0,complete:true},window:{},nextPage:null});
    if(route==='insights/following-status')return Response.json({epoch:'test',generation:1,marksReady:false,indexComplete:false});
    if(route==='insights/saved')return Response.json({members:[],questions:[]});
    if(route?.startsWith('speech-context/'))return Response.json({speechId:route.slice(15),unavailable:true,debates:[]});
    if(route?.startsWith('speech/')) {
      const id=route.slice(7),unknown=id===speeches[1].sourceId;
      if(speechResponse)return Response.json({id,...speechResponse});
      return Response.json({id,xml:'<speech><p>'+(unknown?'Unspecified source transcript.':'Texte français du discours.')+'</p></speech>',textLanguage:unknown?null:'fr',translationType:unknown?'unspecified':'machine',availableTextLanguages:['fr'],textCache:{stale:true,refreshInProgress:false,refreshError:null}});
    }
    if(route?.startsWith('document/')) {
      const id=decodeURIComponent(route.slice(9));
      if(linkedDocument)return Response.json({...documentResult(questionId),...linkedDocument});
      if(bodies[id])return Response.json(documentResult(id));
    }
    unexpected.push(url.href);throw new Error('Unexpected fixture request: '+url.href);
  });
  loadModule=await freshLoader(t,{configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {default:App}=await loadModule('/src/App.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(App)));
  const click=node=>{assert(node,'Missing control');return act(async()=>node.click());};
  return {window,container,click,requests,wait:()=>act(async()=>new Promise(resolve=>setTimeout(resolve,400)))};
}

for(const language of ['en','hu','fr']) {
  test(language+': interface copy, English shell, endonyms, speech-title fallbacks and transcript language stay distinct',async t=>{
    const h=await harness(t,language),c=copy[language];
    assert.equal(document.documentElement.lang,language);assert.equal(h.container.querySelector('main.explorer').lang,language);
    assert.equal(document.title,c.title+' — European Parliament data explorer');assert.equal(document.querySelector('title').lang,language);
    assert.equal(effectiveLanguage(exactText(h.container,'h1',c.title)),language);
    assert.equal(effectiveLanguage(h.container.querySelector('.explorer-filters input')),language);
    const footerSelect=h.container.querySelector('select[aria-label="Interface language"]');
    assert.equal(effectiveLanguage(footerSelect),'en');
    for(const code of ['en','hu','fr','ga','mt'])assert.equal(effectiveLanguage(footerSelect.querySelector(`[value="${code}"]`)),code);
    const countries=[...h.container.querySelectorAll('.explorer-filter-line label')].find(node=>node.firstChild.textContent===c.country);
    assert(countries);assert.equal(effectiveLanguage(countries),language);
    assert.equal(effectiveLanguage(countries.querySelector('option[value=""]')),'en');
    assert.equal(effectiveLanguage(countries.querySelector('option[value="FI"]')),language);
    assert.equal(effectiveLanguage(exactText(h.container,'option','EPP')),'');
    // Exact committee identifiers retain the selected dictionary entry's
    // language, including the English fallback under a localized interface.
    const committeeFallback=exactText(h.container,'option','LIBE · Civil liberties');
    assert.equal(effectiveLanguage(committeeFallback),'en');assert.equal(committeeFallback.getAttribute('aria-label'),null);
    const freshness=h.container.querySelector('.explorer-results small');assert.equal(effectiveLanguage(freshness),'en');
    assert.equal(freshness.textContent,'Current at '+date(directory.day,language));assert.equal(effectiveLanguage(freshness.querySelector('time')),language);
    assert.equal(effectiveLanguage(h.container.querySelector('.portrait--button')),'');

    await h.click(h.container.querySelector('.portrait--button'));
    assert.equal(effectiveLanguage(h.container.querySelector('.explorer-profile h1')),'');
    assert.equal(effectiveLanguage(h.container.querySelector('.explorer-back')),language);
    assert.equal(effectiveLanguage(exactText(h.container,'h2',c.speeches)),language);
    const expected=[language==='hu'?'Magyar cím':language==='fr'?'Titre français':'English title','English fallback','Erster Titel','Plenary contribution','Plenary contribution','Language unknown title'];
    const expectedLanguages=[language,'en','de','en','en',''];
    const rows=[...h.container.querySelectorAll('.explorer-speech')];assert.equal(rows.length,speeches.length);
    rows.forEach((row,index)=>{
      const title=row.querySelector('strong');assert.equal(title.textContent,expected[index]);assert.equal(effectiveLanguage(title),expectedLanguages[index]);
      const metadata=row.querySelector('.explorer-speech-toggle > span');assert.equal(effectiveLanguage(metadata),'en');
      assert.equal(metadata.querySelector('span').textContent,date('2026-10-07',language));assert.equal(effectiveLanguage(metadata.querySelector('span')),language);
      assert(!row.querySelector('.explorer-speech-toggle').textContent.includes(speeches[index].reference),'speech reference stays out of the card label');
    });
    await h.click(rows[0].querySelector('button'));
    const detail=rows[0].querySelector('.explorer-speech-detail'),body=detail.querySelector('.explorer-transcript');
    assert.equal(body.textContent,'Texte français du discours.');assert.equal(effectiveLanguage(body.querySelector('p')),'fr');
    assert.equal(body.closest('[aria-live],[role="status"],[role="alert"]'),null);
    assert.equal(effectiveLanguage(detail.querySelector('h3')),language);
    assert.equal(effectiveLanguage(detail.querySelector('.explorer-text-meta')),'en');assert.match(detail.querySelector('.explorer-text-meta').textContent,/Parliament machine translation/);
    assert.equal(effectiveLanguage(exactText(detail,'small','Showing saved transcript.')),'en');
    const source=detail.querySelector('.explorer-source-link a');assert.equal(source.href,speeches[0].websiteUrl);assert.equal(effectiveLanguage(source),'en');
    assert.equal(effectiveLanguage(detail.querySelector('button[aria-label="Find in speech"]')),'en');
    await h.click(rows[1].querySelector('button'));
    const unknown=rows[1].querySelector('.explorer-transcript');assert.equal(effectiveLanguage(unknown.querySelector('p')),'');assert.equal(unknown.textContent,'Unspecified source transcript.');
    assert.equal(rows[1].querySelector('.explorer-text-meta').textContent,'Language unspecified');

    await h.click(exactText(h.container,'.explorer-tabs button',c.profile));
    const born=[...h.container.querySelectorAll('.explorer-profile-body p')].find(node=>node.textContent.startsWith('Born '));
    assert.equal(effectiveLanguage(born),'en');assert.equal(effectiveLanguage(born.querySelector('span')),language);assert.equal(effectiveLanguage(born.querySelectorAll('span')[1]),'');
    assert.equal(effectiveLanguage(h.container.querySelector('a[href^="mailto:"]')),'');
    assert.equal(effectiveLanguage(h.container.querySelector('.explorer-membership p')),language);
    await h.click(exactText(h.container,'.parliament-header button','Following'));
    assert.equal(document.title,'Following — European Parliament data explorer');assert.equal(document.querySelector('title').lang,'en');
    assert.equal(document.documentElement.lang,language);assert.equal(h.container.querySelector('main.explorer').lang,language);
  });

  test(language+': source documents keep headers, notes, unknown-language boundaries and English controls, and save exact title language',async t=>{
    const h=await harness(t,language,{items:questions,query:{member:String(member.id),module:'activities'}});
    const rows=[...h.container.querySelectorAll('.explorer-speech')];
    assert.deepEqual(rows.map(row=>effectiveLanguage(row.querySelector('strong'))),['fr','','hu']);
    assert.equal(effectiveLanguage(h.container.querySelector('.explorer-activities h2')),language);
    const metadata=rows[0].querySelector('.explorer-speech-toggle small');
    assert.equal(metadata.childNodes.length,1,'activity category and date retain one flex item');assert.equal(metadata.textContent,'Written question · '+date('2026-10-01',language));
    assert.equal(effectiveLanguage(metadata),'en');assert.equal(effectiveLanguage(metadata.querySelector('time')),language);
    for(let index=0;index<rows.length;index++) {
      await h.click(rows[index].querySelector('button'));
      const reader=rows[index].querySelector('.explorer-document-text'),id=questions[index].sourceId,fixture=bodies[id],body=reader.querySelector('.explorer-transcript');
      assert.equal(effectiveLanguage(body.querySelector('p')),fixture.language||'');
      assert.equal(effectiveLanguage(reader.querySelector('.legal-notes li')),fixture.language||'');
      assert.equal(effectiveLanguage(reader.querySelector('.legal-notes summary')),'en');
      assert.equal(effectiveLanguage(reader.querySelector('.explorer-reader-download summary')),'en');
      assert.equal(effectiveLanguage(reader.querySelector('.explorer-reader-heading h3')),'en');
      assert.equal(effectiveLanguage(reader.querySelector('.explorer-publication-files select')),'en');
      assert.equal(effectiveLanguage(reader.querySelector('.explorer-reader-heading option')),'');
      assert(reader.querySelector('sup a[href*="-note-1"]'),'superscript source note marker remains available');
      assert.equal(body.closest('[aria-live],[role="status"],[role="alert"]'),null);
      const author=reader.querySelector('.explorer-coauthors strong');assert.equal(author.textContent,'Mika Aaltola');assert.equal(effectiveLanguage(author),'');assert.equal(author.querySelector('a'),null,'the current author remains strong, not a self-link');
      assert.equal(reader.querySelector('.explorer-publication-files a').href,download);
      if(index===0) {
        const header=reader.querySelector('.explorer-reader-download > p');assert.equal(header.textContent,fixture.paragraphs[0]);assert.equal(effectiveLanguage(header),'en');
        assert(!body.textContent.includes(fixture.paragraphs[0]),'the existing recognised-header split stays intact');
        const save=rows[index].querySelector('.explorer-save-button');
        const label={en:'Save question',hu:'Kérdés mentése',fr:'Enregistrer la question'}[language];
        assert.equal(save.getAttribute('aria-label'),label+' · Titre de la question');assert.equal(save.getAttribute('aria-labelledby'),null);assert.equal(effectiveLanguage(save),language==='fr'?'fr':'','the French title remains separate from a differing UI language');
        assert.equal(save.querySelector('span[lang]').textContent,label);assert.equal(effectiveLanguage(save.querySelector('span[lang]')),language);
        const answer=reader.querySelector('#document-'+answerId),answerHeading='Answer · '+date('2026-10-02',language);
        assert.equal(answer.querySelector('h3').textContent,answerHeading);assert.equal(effectiveLanguage(answer.querySelector('h3 span')),language);
        // OPEN: this existing flat name mixes English with a localized date.
        const answerSelect=answer.querySelector('select');assert.equal(answerSelect.getAttribute('aria-label'),answerHeading+' language');assert.equal(effectiveLanguage(answerSelect),'en');
        await h.click(save);
        const saved=JSON.parse(h.window.localStorage.getItem('ep.following.v2')).items[0];
        assert.equal(saved.id,questionId);assert.equal(saved.title,questions[0].title);assert.equal(saved.titleLanguage,'fr');assert.deepEqual(saved.baseline.answerIds,[]);
      }
    }
    await h.wait();
    const status=rows[2].querySelector('[role="status"][aria-live]');assert.equal(status.textContent,'Question: Text loaded.');assert.equal(effectiveLanguage(status),'en');
  });
}

test('linked-source fallback keeps the first dictionary entry and an unknown identifier fallback without changing exact links',async t=>{
  const h=await harness(t,'hu',{items:[],query:{member:String(member.id),module:'activities',activity:questionId},linkedDocument:{titles:{de:'',fr:'Do not select a later entry'}}});
  const fallback=h.container.querySelector('aside.explorer-notice');assert(fallback);assert.equal(effectiveLanguage(fallback),'en');
  await h.click(exactText(fallback,'button','Check this source with Parliament'));
  const title=fallback.querySelector('h3');assert.equal(title.textContent,questionId);assert.equal(effectiveLanguage(title),'');
  assert(fallback.querySelector('#document-'+questionId));
  assert.equal(fallback.querySelector('.explorer-publication-files a').href,download);
});

test('oral-question deep links show the body first and retain header, note and link provenance',async t=>{
  const id='O-10-2026-000042',item={...questions[0],id:'oral-questions:'+id,sourceId:id,category:'oral-questions',categoryLabel:'Oral questions'};
  const paragraphs=['Question for oral answer O-000042/2026','to the Commission','Rule 142','Mika Aaltola (PPE)','Subject:\tFixture oral question','Exact oral question body with a source link.','1.\tWhat will the Commission do?'];
  const url='https://example.org/public-source',note={id:'oral-note',label:'1',text:'Exact oral source note.',links:[]};
  const linkStart=paragraphs[5].indexOf('source link');
  const sourceUrl='https://www.europarl.europa.eu/doceo/document/'+id+'_EN.docx';
  const linkedDocument={...documentResult(questionId),id,selectedDocumentId:id,files:[{format:'DOCX',language:'en',url:sourceUrl}],selectedText:{...documentResult(questionId).selectedText,sourceUrl,paragraphs,notes:[note],noteAnchors:[{paragraph:5,offset:10,note:note.id,label:note.label}],documentLinks:[{paragraph:5,start:linkStart,end:linkStart+'source link'.length,url}]}};
  const h=await harness(t,'en',{items:[item],query:{member:String(member.id),module:'activities',activity:item.id},linkedDocument});await h.wait();
  const reader=h.container.querySelector('#document-'+id),body=reader.querySelector('.explorer-transcript'),details=reader.querySelector('.explorer-reader-download');
  assert(body.textContent.startsWith('Exact oral'));
  assert(!body.textContent.includes(paragraphs[0]));assert(!body.textContent.includes(paragraphs[3]));
  assert.deepEqual([...details.querySelectorAll(':scope > p')].map(p=>p.textContent),paragraphs.slice(0,5));
  const anchor=body.querySelector('a[aria-label="Note 1"]'),link=body.querySelector(`a[href="${url}"]`);
  assert(anchor,'the note anchor keeps its original paragraph index');
  assert.equal(link?.textContent,'source link');
  assert(body.textContent.includes(note.text));
  assert.equal(details.querySelector('.explorer-publication-files a')?.href,sourceUrl);
});

const readableXml='<speech><p>Exact transcript text.</p><p>Second source paragraph.</p></speech>';
const transcriptCases=[
  {name:'readable known language',xml:readableXml,textLanguage:'fr',translationType:'machine',prefix:'FR',provenance:'Parliament machine translation',readable:true},
  {name:'readable unknown language and unspecified provenance',xml:readableXml,textLanguage:null,translationType:'unspecified',prefix:'Language unspecified',readable:true},
  {name:'readable unknown language and original provenance',xml:readableXml,textLanguage:null,translationType:'original',prefix:'Language unspecified',provenance:'Original text',readable:true},
  {name:'readable unknown language and machine provenance',xml:readableXml,textLanguage:null,translationType:'machine',prefix:'Language unspecified',provenance:'Parliament machine translation',readable:true},
  {name:'readable unknown language with an XML machine marker',xml:readableXml.replace('<speech>','<speech xml:lang="en-t-hu-mtec">'),textLanguage:null,translationType:'unspecified',prefix:'Language unspecified',provenance:'Parliament machine translation',readable:true},
  {name:'unavailable transcript',xml:null,textLanguage:null,translationType:'unspecified',prefix:'Text unavailable'},
  {name:'empty transcript with supplied language',xml:'<speech/>',textLanguage:'en',translationType:'original',prefix:'EN',provenance:'Original text'},
  // Happy DOM exposes a parser-error document directly; the browser fixture
  // separately exercises native DOMParser with malformed XML.
  {name:'unreadable transcript with unknown language',xml:'<parsererror>Invalid XML fixture</parsererror>',textLanguage:null,translationType:'unspecified',prefix:'Text unavailable',unreadable:true},
  {name:'unreadable transcript with supplied language',xml:'<parsererror>Invalid XML fixture</parsererror>',textLanguage:'fr',translationType:'original',prefix:'FR',provenance:'Original text',unreadable:true},
];
for(const language of ['en','hu','fr'])test(language+': transcript availability stays distinct from language and provenance',async t=>{
  for(const scenario of transcriptCases)await t.test(scenario.name,async t=>{
    const {name,prefix,provenance,readable,unreadable,...response}=scenario;
    const h=await harness(t,language,{items:[speeches[0]],query:{member:String(member.id),module:'speeches',speech:speeches[0].sourceId},speechResponse:{...response,availableTextLanguages:[]}});
    const detail=h.container.querySelector('.explorer-speech-detail'),metadata=detail.querySelector('.explorer-text-meta');
    assert.equal(effectiveLanguage(metadata),'en');assert(metadata.textContent.startsWith(prefix));
    if(provenance)assert(metadata.textContent.includes(provenance));
    else assert.equal(metadata.textContent,prefix,'no language or provenance is inferred from readable text');
    const body=detail.querySelector('.explorer-transcript'),find=detail.querySelector('button[aria-label="Find in speech"]');
    if(readable){
      assert.deepEqual([...body.querySelectorAll('p')].map(p=>p.textContent),['Exact transcript text.','Second source paragraph.']);
      assert.equal(effectiveLanguage(body),response.textLanguage||'');assert(find);
      assert(!metadata.textContent.includes('Text unavailable'));
      assert.equal(body.closest('[aria-live],[role="status"],[role="alert"]'),null);
      if(!response.textLanguage)assert(!metadata.textContent.includes('Interface-language text unavailable'));
    }else{
      assert.equal(body,null);assert.equal(find,null);assert(!metadata.textContent.includes('Language unspecified'));
      assert(detail.textContent.includes(unreadable?'Parliament returned transcript text that could not be read.':'No transcript text is available from Parliament’s API for this contribution.'));
    }
    await h.wait();
    assert.equal(detail.querySelector('[role="status"][aria-live]').textContent,readable?'Transcript loaded.':unreadable?'Parliament returned transcript text that could not be read.':'No transcript text is available from Parliament’s API for this contribution.');
    assert(!h.requests.some(route=>route.startsWith('speech-media/')),'opening transcript metadata does not acquire media');
  });
});
