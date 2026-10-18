import {ErrorBoundary,ViewContent,ViewLoading} from './ErrorBoundary';
import {filterCountry,matchesCountry} from './countries.mjs';
import {explorerParams} from './explorerUrl';
import {SpeechCloud} from './SpeechCloud';
import {FindInText,TextSearch} from './TextSearch';
import {InterventionBadges,SpeechContextPanel,InterventionStatistics} from './SpeechInterventions';
import {SpeakerName,SpeakerRoleLine} from './SpeakerIdentity';
import {publicationBody} from './publication-body.mjs';
import {orderedMemberships} from './memberships.mjs';
import {SaveButton,useSavedChecks} from './SavedControls';
import {interfaceTerm} from './terms.mjs';
import {ParliamentHeader} from './ParliamentHeader';
import {QuestionStatus} from './QuestionStatus';
import {MotionStatuses,MotionOutcome} from './MotionOutcome';
import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {DocumentNotes,ReferenceScope,ReferenceText,readerTexts} from "./References";
import { Portrait } from "./components/Portrait";
import './focus.css';
import { DataNotice } from "./components/DataNotice";
import { API_ROOT } from "./api";
import { interfaceLabel, countryName, languageName } from "./interfaceLabels.mjs";
import { publicUrl } from "./publicUrl";
import { interfaceCopy, interfaceLanguages } from "./interfaceCopy";
import type {
  Directory,
  MemberProfile,
  Speech,
  SpeechDetail,
  Membership,
  JoinedActivityPage,
  JoinedActivity,
  DocumentFile,
  PublicationDocument,
  CoAuthor,
  NoteAnchor,
  DocumentLink,
} from "./explorerTypes";
import "./explorer.css";
import { activitySourceId } from "../server/activity-links.mjs";
import {transcriptParagraphs,TranscriptText} from "./Transcript";
import { transcriptLanguage } from "../server/transcript-language.mjs";
import { useSpeechData, useData } from "./data";
import { useSpeechVideo } from "./SpeechPlayer";
import {AmendmentTrailLink} from './AmendmentTrailLink';
import {publicAmendmentsEnabled,publicExplorerView,publicMemberModule} from './publicFeatures';
import {Status} from './Status';
import { coAuthorSegments, linkedCoAuthors, coAuthorProfileUrl } from './coAuthors.mjs';
import {selectLanguageText} from './language.mjs';
import {memberVotesJourneyParams} from './memberVotesJourney.mjs';
import {useMemberVotesJourney} from './useMemberVotesJourney';

const MemberVotes=lazy(()=>import('./MemberVotes').then(module=>({default:module.MemberVotes})));
const DocumentContextReader=lazy(()=>import('./DocumentContextReader').then(module=>({default:module.DocumentContextReader})));

const GroupVoices=lazy(()=>import('./GroupVoices').then(module=>({default:module.GroupVoices})));
const Legislation=lazy(()=>import('./Legislation').then(module=>({default:module.Legislation})));
const QuestionTopics=lazy(()=>import('./QuestionTopics').then(module=>({default:module.QuestionTopics})));
const OutsideVoices=lazy(()=>import('./OutsideVoices').then(module=>({default:module.OutsideVoices})));
const Saved=lazy(()=>import('./Saved').then(module=>({default:module.Saved})));
const Amendments=lazy(()=>import('./Amendments').then(module=>({default:module.Amendments})));
const AmendmentsPage=lazy(()=>import('./Amendments').then(module=>({default:module.AmendmentsPage})));

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
const queryLanguage = (query: URLSearchParams) =>
  interfaceLanguages.includes(query.get("lang") || "") ? query.get("lang")! : "en";
const queryRole = (query: URLSearchParams) =>
  ["both", "member", "substitute"].includes(query.get("role") || "") ? query.get("role")! : "both";
const title = (s: Speech, lang: string) =>
  selectLanguageText(s.titles,lang,"Plenary contribution");
const date = (s: string, lang: string) =>
  new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  }).format(new Date(s.length === 10 ? s + "T12:00:00Z" : s));
const time = (s: string, lang: string) =>
  new Intl.DateTimeFormat(lang, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Brussels",
  }).format(new Date(s));
function ErrorView({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="explorer-notice" role="alert" lang="en">
      <p>{message}</p>
      <button onClick={event=>{
        if(document.activeElement===event.currentTarget){
          const scope=event.currentTarget.closest('section,article,main');
          const target=scope?.querySelector<HTMLElement>('.explorer-speech-toggle,h1,h2,h3')||scope?.parentElement?.closest('section,main')?.querySelector<HTMLElement>('h1,h2,h3');
          if(target){if(/^H[1-6]$/.test(target.tagName))target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});}
        }
        retry();
      }}>Try again</button>
    </div>
  );
}
export function transcript(xml: string | null) {
  if (!xml) return { paragraphs: [], machine: false, error: false };
  const text=transcriptParagraphs(xml);
  return {...text,machine:transcriptLanguage(xml).machine};
}
function Detail({ speech, lang, transcriptLanguage=lang }: { speech: Speech; lang: string;transcriptLanguage?:string }) {
  const c = interfaceCopy(lang);
  const transcriptText=useRef<HTMLDivElement>(null);
  const video=useSpeechVideo(speech,lang);
  const state = useSpeechData(speech.id,transcriptLanguage);
  const body=state.transcript;
  const text = useMemo(
    () => transcript(body?.xml ?? null),
    [body?.xml],
  );
  return (
    <div className="explorer-speech-detail" lang={lang}>
      <Status scope={`transcript:${speech.id}:${lang}`} pending={state.loading} message={state.error||!body?null:text.error?'Parliament returned transcript text that could not be read.':text.paragraphs.length?'Transcript loaded.':'No transcript text is available from Parliament’s API for this contribution.'}/>
      {state.data?.speakers?.map(person=><div key={person.id}><strong><SpeakerName person={person} language={lang}/></strong><SpeakerRoleLine person={person} language={lang} intervention={state.data?.intervention} className="insight-secondary"/></div>)}
      {state.data?.intervention?.type!=='chair'&&<InterventionBadges value={state.data?.intervention} language={lang}/>}
      <SpeechContextPanel key={speech.id} id={speech.id} language={lang} transcriptLanguage={transcriptLanguage} preload={Boolean(state.data)&&!state.loading}/>
      <div className="explorer-speech-transcript-heading" lang="en"><h3 lang={lang}>{c.transcript}</h3><div className="explorer-reader-tools">{video.toggle}{text.paragraphs.length>0&&<FindInText key={speech.id+':'+transcriptLanguage} label="Find in speech" target={transcriptText}/>}</div></div>
      {video.panel}
      {speech.websiteUrl && <p className="explorer-source-link" lang="en"><a href={speech.websiteUrl} target="_blank" rel="noreferrer">Speech on Parliament’s website ↗</a>{" "}<small>Original <span lang="">{speech.websiteLanguage?.toUpperCase()}</span></small></p>}
      {state.loading && !body && <p role="status" lang="en">Loading transcript…</p>}
      {state.error && <ErrorView message={state.error} retry={state.retry} />}
      {body && (
        <>
          {body===state.data&&state.data?.textCache?.stale && <small lang="en">Showing saved transcript.{state.data.textCache.refreshInProgress ? " A refresh is running in the background." : state.data.textCache.refreshError ? " The last refresh failed." : ""}</small>}
          <div className="explorer-text-meta" lang="en">
            {body.textLanguage ? <span lang="">{body.textLanguage.toUpperCase()}</span> : text.paragraphs.length ? "Language unspecified" : "Text unavailable"}
            {body.translationType === "machine" || text.machine
              ? " · Parliament machine translation"
              : body.translationType === "original"
                ? " · Original text"
                : body.textLanguage ? " · Translation method unspecified" : ""}
            {body.textLanguage && body.textLanguage !== transcriptLanguage
              ? " · Requested-language text unavailable"
              : ""}
          </div>
          {text.error ? (
            <p lang="en">Parliament returned transcript text that could not be read.</p>
          ) : text.paragraphs.length ? (
            <div
              className="explorer-transcript"
              ref={transcriptText}
              lang={body.textLanguage || ""}
            >
              {text.paragraphs.map((p, i) => (
                <p key={i}><TranscriptText paragraph={p}/></p>
              ))}
            </div>
          ) : (
            <p lang="en">
              No transcript text is available from Parliament’s API for this
              contribution.
            </p>
          )}
        </>
      )}
    </div>
  );
}
function PublicationFiles({ files, lang }: { files: DocumentFile[]; lang: string }) {
  const languages = [...new Set(files.map(f => f.language || "und"))];
  const [selected, setSelected] = useState(lang);
  const fileKey=files.map(f => `${f.url}|${f.language}`).join(",");
  useEffect(() => setSelected(languages.includes(lang) ? lang : languages[0] || "und"), [lang, fileKey]);
  if (!files.length) return <p lang="en">No downloadable files were returned for this document.</p>;
  return <div className="explorer-publication-files" lang="en">
    <label>Document language <select aria-label="Document language" value={selected} onChange={e => setSelected(e.target.value)}>{languages.map(l => <option lang={l === "und" ? "en" : ""} value={l} key={l}>{l === "und" ? "Language unavailable" : l.toUpperCase()}</option>)}</select></label>
    {!languages.includes(lang) && <small>Files in the interface language are unavailable. Choose an available language.</small>}
    <p>{files.filter(f => (f.language || "und") === selected).map((f,i) => <a key={f.url + i} href={f.url} target="_blank" rel="noreferrer"><span lang="">{f.format}</span> · <span lang={f.language ? "" : "en"}>{f.language?.toUpperCase() || "Language unavailable"}</span> ↗</a>)}</p>
  </div>;
}
function AuthorMention({text,authors,lang,anchors,links,notePrefix}:{text:string;authors?:CoAuthor[];lang:string;anchors?:NoteAnchor[];links?:DocumentLink[];notePrefix?:string}) {
  const parts=coAuthorSegments(text,authors);let start=0;
  return <>{parts.map((part,index)=>{const from=start;start+=part.text.length;return part.id ? <a key={index} lang="" className="explorer-author-link" href={coAuthorProfileUrl(location.pathname,lang,part.id)}>{part.text}</a> : anchors ? <ReferenceText key={index} text={part.text} start={from} final={index===parts.length-1} anchors={anchors} links={links} notePrefix={notePrefix}/> : part.text;})}</>;
}
function CoAuthors({authors,lang,member}:{authors?:CoAuthor[];lang:string;member:number}) {
  const people=linkedCoAuthors(authors);
  if(!people.length)return null;
  return <details className="explorer-coauthors" lang="en"><summary>{people.some(person=>person.role==='QUESTION_AUTHOR') ? 'Question authors' : 'MEP authors'} · {people.length}</summary><ul>{people.map(person=><li key={person.id} lang="">{person.id===member ? <strong>{person.name}</strong> : <a href={coAuthorProfileUrl(location.pathname,lang,person.id)}>{person.name}</a>}</li>)}</ul></details>;
}
function PublicationText({ sourceId, member, lang, heading, headingDate, includeAnswers = false,question }: { sourceId: string; member: number; lang: string; heading: string; headingDate?:string|null; includeAnswers?: boolean;question?:{id:string;title?:string} }) {
  const [requestedLanguage,setRequestedLanguage]=useState(lang);useEffect(()=>setRequestedLanguage(lang),[lang]);
  const state=useData<PublicationDocument>(`document/${encodeURIComponent(sourceId)}?member=${member}&lang=${requestedLanguage}`);
  const text=state.data?.selectedDocumentId===sourceId ? state.data.selectedText : null;
  const files=sourceId.endsWith('-ASW')?state.data?.answers.find(answer=>answer.id===sourceId)?.files||[]:state.data?.files||[];
  const body=publicationBody(text?.paragraphs||[],sourceId,text?.textLanguage),notePrefix='notes'+useId().replace(/[^A-Za-z0-9_-]/g,'');
  const notes=text?.notes||[],anchors=body.exact?text?.noteAnchors||[]:[],documentLinks=body.exact?text?.documentLinks||[]:[];
  const languageName=(code:string)=>{try{const text=new Intl.DisplayNames([lang],{type:'language'}).of(code);return {text:text||code.toUpperCase(),language:text&&text!==code?lang:''};}catch{return {text:code.toUpperCase(),language:''};}};
  const requestedName=languageName(requestedLanguage),textName=languageName(text?.textLanguage||requestedLanguage);
  return <section className="explorer-document-text" lang="en" id={'document-'+sourceId}>
    <Status scope={`document:${sourceId}:${member}:${requestedLanguage}`} pending={state.loading} message={state.error?`${heading}: Text temporarily unavailable.`:state.data?`${heading}: ${text?.status==='available'?'Text loaded.':'Text unavailable.'}`:null}/>
    <div className="explorer-reader-heading"><h3>{headingDate ? <>Answer · <span lang={lang}>{date(headingDate,lang)}</span></> : heading}</h3>{question&&<a lang="" href={"#document-"+question.id} title={question.title}><span lang="en">Read question</span></a>}{text?.availableTextLanguages.length ? <select aria-label={`${heading} language`} title={text.translationType==='original'?'Original text':'Translation method not specified'} value={text.textLanguage||requestedLanguage} onChange={event=>setRequestedLanguage(event.target.value)}>{text.availableTextLanguages.map(code=><option lang="" key={code} value={code}>{code.toUpperCase()}</option>)}</select> : null}{text?.textLanguage&&text.textLanguage!==requestedLanguage&&<small><span lang={requestedName.language}>{requestedName.text}</span> unavailable · showing <span lang={textName.language}>{textName.text}</span></small>}</div>
    {/^(?:A|B|RC)-/.test(sourceId)&&<AmendmentTrailLink document={sourceId} language={lang}>Amendments to this document</AmendmentTrailLink>}
    {state.loading&&!text&&<p role="status">Loading text…</p>}{state.error&&<p>Text temporarily unavailable.</p>}
    {text?.status==='available'?<ReferenceScope texts={readerTexts(body.paragraphs,notes,documentLinks)} notes={notes} notePrefix={notePrefix} language={lang} textLanguage={text.textLanguage} renderQuestion={question=><PublicationText sourceId={question} member={member} lang={lang} heading="Referenced question" includeAnswers/>}><div className="explorer-transcript" lang={text.textLanguage||""}>{body.paragraphs.map((paragraph,index)=><p key={index}><AuthorMention text={paragraph} authors={state.data?.coAuthors} lang={lang} anchors={anchors.filter(anchor=>anchor.paragraph===body.start+index)} links={documentLinks.filter(link=>link.paragraph===body.start+index)} notePrefix={notePrefix}/></p>)}<DocumentNotes notes={notes} prefix={notePrefix}/></div></ReferenceScope>:text&&<p>Text unavailable. Download the document below.</p>}
    {text&&<><CoAuthors authors={state.data?.coAuthors} lang={lang} member={member}/><details className="explorer-reader-download"><summary>Document & download</summary>{body.header.map((paragraph,index)=><p lang={text.textLanguage||""} key={index}><AuthorMention text={paragraph} authors={state.data?.coAuthors} lang={lang}/></p>)}<PublicationFiles files={files} lang={text.textLanguage||lang}/></details></>}
    {includeAnswers&&state.data?.answers.map(answer=><PublicationText key={answer.id} sourceId={answer.id} member={member} lang={lang} heading={"Answer"+(answer.date?" · "+date(answer.date,lang):"")} headingDate={answer.date}/>)}
    {includeAnswers&&state.data&&!state.data.answers.length&&<p>No answer published.</p>}
  </section>;
}
function JoinedDetails({ item, lang, member }: { item: JoinedActivity; lang: string; member: number }) {
  const hasText=item.category==='written-questions' || item.category==='oral-questions' || item.recordKind==='answer';
  const document=useData<PublicationDocument>(item.recordKind!=='speech' && !hasText ? `document/${item.sourceId}?member=${member}&lang=${lang}` : null);
  const roles: Record<string,string> = {AUTHOR:"Author",QUESTION_AUTHOR:"Author of the question",RAPPORTEUR:"Rapporteur",RAPPORTEUR_SHADOW:"Shadow rapporteur",RAPPORTEUR_OPINION:"Opinion rapporteur",RAPPORTEUR_SHADOW_OPINION:"Shadow opinion rapporteur",SPEAKER:"Plenary contribution"};
  const stage=item.provenance.stage==='RDG1'?interfaceTerm('first-reading',lang):item.provenance.stage==='RDG2'?interfaceTerm('second-reading',lang):{text:item.provenance.stage,language:''};
  if (item.recordKind === "speech") return <Detail speech={{id:item.sourceId,date:item.date,start:item.start || null,end:item.end || null,titles:item.titles || {},kind:item.speechKind || "PLENARY_DEBATE_SPEECH",reference:item.reference,originalLanguages:item.originalLanguages || [],participants:[],websiteUrl:item.websiteUrl || null,websiteLanguage:item.websiteLanguage || null}} lang={lang} />;
  return <div className="explorer-speech-detail" lang={lang}>
    {!hasText&&<p lang="en"><strong lang={roles[item.provenance.role] ? "en" : ""}>{item.relatedJointMotions?.length && item.provenance.role==="AUTHOR" ? "Author of the original motion" : roles[item.provenance.role] || item.provenance.role}</strong>{item.provenance.stage ? <> · <span lang={stage.language}>{stage.text}</span></> : ""}</p>}
    {!hasText&&<span lang="en"><AmendmentTrailLink document={item.sourceId} language={lang}>Amendments to this document</AmendmentTrailLink></span>}
    <MotionOutcome outcome={item.resolutionOutcome} related={item.relatedJointMotions} reference={item.reference} sourceId={item.sourceId} language={lang}/>
    {(item.category==='written-questions' || item.category==='oral-questions' || item.recordKind==='answer') && <>
      {item.recordKind!=='answer'&&<SaveButton language={lang} item={{kind:'question',id:item.sourceId,title:item.title,titleLanguage:item.titleLanguage,memberId:String(member),date:item.date,baseline:item.answerIds?{answerIds:item.answerIds}:undefined}}/>}
      <PublicationText sourceId={item.sourceId} member={member} lang={lang} heading={item.recordKind==='answer' ? 'Answer' : 'Question'} includeAnswers={item.recordKind!=='answer'} question={item.recordKind==='answer'&&item.relatedQuestionId?{id:item.relatedQuestionId,title:item.relatedQuestionTitle}:undefined} />
      {item.recordKind==='answer' && item.relatedQuestionId && <PublicationText sourceId={item.relatedQuestionId} member={member} lang={lang} heading="Linked question" />}
    </>}
    {!hasText && <section lang="en" aria-label={item.relatedJointMotions?.length ? 'Original motion document' : 'Document'}>
      {!!item.relatedJointMotions?.length && <h3>Original motion document</h3>}
      <CoAuthors authors={document.data?.coAuthors} lang={lang} member={member}/>
      <PublicationFiles files={item.files} lang={lang}/>
    </section>}

  </div>;
}
function LinkedActivityFallback({ sourceId, member, lang, complete }: { sourceId: string | null; member: number; lang: string; complete: boolean }) {
  const [check, setCheck] = useState(false);
  const speech=Boolean(sourceId?.startsWith("MTG-PL-"));
  const document=useData<PublicationDocument>(check && sourceId && !speech ? `document/${sourceId}?member=${member}&lang=${lang}` : null);
  const contribution=useData<SpeechDetail>(check && sourceId && speech ? `speech/${sourceId}?lang=${lang}` : null);
  const answer=document.data?.answers.find(item=>item.id===sourceId);
  const matched=answer || (document.data?.id===sourceId ? document.data : null);
  const authored=document.data?.roles.includes("AUTHOR");
  const speechAuthor=contribution.data?.participants.includes(String(member));
  const matchedTitle=selectLanguageText(matched?.titles,lang,matched?.id||'', '');
  return <aside className="explorer-notice" lang="en">
    <Status scope={`linked:${sourceId}:${member}:${lang}:${check}`} pending={document.loading||contribution.loading} message={document.error||contribution.error?null:!check?!sourceId?'This older link could not be matched to an API source identifier.':complete?'This item is outside this MEP’s saved activity index.':'This item has not been indexed for this MEP yet.':document.data&&!matched?'The API did not return the exact linked document or answer.':matched||contribution.data?'Linked source available.':null}/>
    <strong>Linked activity <span lang={sourceId ? "" : "en"}>{sourceId || "identifier not recognised"}</span></strong>
    <p>{!sourceId ? "This older link could not be matched to an API source identifier." : complete ? "This item is outside this MEP’s saved activity index. No category or MEP relationship is inferred from the link." : "This item has not been indexed for this MEP yet. Saved activities remain available while the term 10 load continues."}</p>
    {sourceId && !check && <button onClick={() => setCheck(true)}>Check this source with Parliament</button>}
    {(document.loading || contribution.loading) && <p role="status">Loading the linked source…</p>}
    {document.error && <ErrorView message={document.error} retry={document.retry} />}
    {contribution.error && <ErrorView message={contribution.error} retry={contribution.retry} />}
    {matched && <>
      <h3 lang={matchedTitle.language}>{matchedTitle.text}</h3>
      {matched.date && <p><span lang={lang}>{date(matched.date,lang)}</span>{answer ? " · Answer" : ""}</p>}
      <p>{answer && authored ? "The API links this answer to a question authored by this MEP." : document.data!.roles.length ? <>The document records these roles for this MEP: <span lang="">{document.data!.roles.join(", ")}</span>.</> : "The document source is available. A relationship to this MEP has not been established."}</p>
      <PublicationText sourceId={sourceId!} member={member} lang={lang} heading={answer ? 'Answer' : /^[EPO]-/.test(sourceId!) ? 'Question' : 'Document text'} includeAnswers={!answer && /^[EPO]-/.test(sourceId!)} />
      {answer && document.data!.id!==sourceId && <PublicationText sourceId={document.data!.id} member={member} lang={lang} heading="Linked question" />}
      <PublicationFiles files={matched.files} lang={lang} />
    </>}
    {document.data && !matched && <p>The API did not return the exact linked document or answer.</p>}
    {contribution.data && <><p>{speechAuthor ? "The speech API names this MEP as a participant." : "The speech source is available. A relationship to this MEP has not been established."}</p><Detail speech={contribution.data} lang={lang} /></>}
  </aside>;
}
function Activities({ id, lang, initialActivity, onOpen, category, onCategory }: { id: number; lang: string; initialActivity: string | null; onOpen: (id: string | null) => void; category: string; onCategory: (category: string) => void }) {
  const [offset,setOffset]=useState(0);
  const [categoriesOpen,setCategoriesOpen]=useState(false);
  const resultsHeading=useRef<HTMLHeadingElement>(null);
  const moveToResults=useRef(false);
  const lastPage=useRef<{member:number;data:JoinedActivityPage} | null>(null);
  const open=initialActivity;
  const sourceId=activitySourceId(open);
  const c=interfaceCopy(lang);
  const state=useData<JoinedActivityPage>(`latest-activities/${id}?lang=${lang}&limit=10&offset=${offset}${category ? `&category=${encodeURIComponent(category)}` : ""}`);
  if(state.data)lastPage.current={member:id,data:state.data};
  const page=state.data || (lastPage.current?.member===id ? lastPage.current.data : null);
  const visibleSelection = state.data?.items.some(item => item.sourceId === sourceId);
  const pinned=useData<JoinedActivityPage>(sourceId && state.data && !visibleSelection ? `latest-activities/${id}?lang=${lang}&limit=10&source-id=${encodeURIComponent(sourceId)}` : null);
  useEffect(()=>{setOffset(0);},[id,category]);
  const selectedItems = pinned.data?.selectedItems || [];
  const items=state.data ? [...selectedItems.filter(selected=>!state.data!.items.some(item=>item.id===selected.id)),...state.data.items] : [];
  const isOpen=(item:JoinedActivity)=>open===`${item.category}:${item.sourceId}` || sourceId===item.sourceId && !open?.includes(":");
  useEffect(()=>{
    if(open && !open.includes(":") && selectedItems.length===1){
      const selected=selectedItems[0];onOpen(`${selected.category}:${selected.sourceId}`);
    }
  },[open,pinned.data,onOpen]);
  useEffect(()=>{if(open && state.data)document.getElementById(`publication-${items.find(isOpen)?.id || open}`)?.scrollIntoView({block:"nearest"});},[open,state.data,pinned.data]);
  useEffect(()=>{
    if(!moveToResults.current)return;
    moveToResults.current=false;
    resultsHeading.current?.focus({preventScroll:true});
    const body=resultsHeading.current?.closest(".explorer-profile-body");
    if(body&&body.scrollHeight>body.clientHeight)body.scrollTo({top:0});else resultsHeading.current?.scrollIntoView({block:"start"});
  },[category,categoriesOpen,offset]);
  useEffect(()=>{
    if(state.data?.cache.complete || open)return;
    const timer=window.setInterval(state.retry,30_000);return ()=>window.clearInterval(timer);
  },[state.data?.cache.complete,open,state.retry]);
  const choose=(value:string)=>{moveToResults.current=true;setCategoriesOpen(false);onCategory(value);setOffset(0);onOpen(null);};
  const coverage=category ? page?.categoryCoverage[category] : null;
  const selectedLabel=category ? page?.categories[category] || category : "All activities";
  return <section className="explorer-activities" lang="en">
    <div className="explorer-section-title"><h2 lang={lang}>{c.activities}</h2>
    <TextSearch prefix="mep-activity-fts" label="Search this MEP’s text" language={lang} member={id} kinds={['speech','question','answer']} from="2024-07-16" scopeNote="Searches this MEP’s saved speeches, questions and linked answers for the current term. Reports and other activity categories are outside this text collection."/></div>
    {page && <>
      <div className="explorer-category-selection">
        <button aria-expanded={categoriesOpen} aria-controls="activity-categories" onClick={()=>setCategoriesOpen(value=>!value)}>{categoriesOpen ? "Close categories" : "Change category"}</button>
      </div>
      {categoriesOpen && <nav id="activity-categories" className="explorer-category-groups" aria-label="Parliamentary activity categories">
        <button className={!category ? "selected" : ""} aria-pressed={!category} onClick={()=>choose("")}>All activities</button>
        {page.categoryGroups.map(group=><section key={group.label}><h3>{group.label}</h3>{group.categories.map(key=>{
          const status=page.categoryCoverage[key];
          const count=status.status === "source-not-verified" ? "API source required" : `${status.indexedCount} saved`;
          return <button key={key} className={category===key ? "selected" : ""} aria-pressed={category===key} onClick={()=>choose(key)}><span>{page.categories[key]}</span><small>{count}</small></button>;
        })}</section>)}
      </nav>}
    </>}
    <h3 ref={resultsHeading} tabIndex={-1} className="explorer-activity-results-title">{selectedLabel}{state.data && coverage?.status!=="source-not-verified" ? ` · ${state.data.indexedTotal} saved` : ""}</h3>
    {state.loading && !state.data && <p role="status">Loading saved results…</p>}
    {state.error && <ErrorView message={state.error} retry={state.retry} />}
    {page && <>
      {coverage?.status === "source-not-verified" && <div className="explorer-notice"><strong>API source not verified</strong><p>{coverage.reason}</p><p>This category is not shown as an empty history.</p></div>}
      {coverage?.status === "incomplete-joins" && <p className="explorer-notice">{coverage.reason} </p>}
      {!state.loading && state.data && !state.data.items.length && coverage?.status !== "source-not-verified" && <p>No saved activities were found in this selection.{!page.cache.complete ? " The term 10 history is still incomplete." : ""}</p>}
      {open && pinned.loading && !items.some(isOpen) && <p role="status">Checking the saved linked activity…</p>}
      {open && pinned.error && <ErrorView message={pinned.error} retry={pinned.retry} />}
      {open && state.data && !pinned.loading && !items.some(isOpen) && <LinkedActivityFallback key={sourceId} sourceId={sourceId} member={id} lang={lang} complete={page.cache.complete} />}
      {items.map(item=>{
        const key=`${item.category}:${item.sourceId}`;
        return <article className="explorer-speech" id={`publication-${item.id}`} key={key}>
          <button className="explorer-speech-toggle" aria-expanded={isOpen(item)} onClick={()=>{const next=isOpen(item)?null:key;onOpen(next);}}><span><small><span>{item.recordKind === "answer" ? "Answer" : item.category === "written-questions" ? "Written question" : item.category === "oral-questions" ? "Oral question" : item.categoryLabel} · <time lang={lang} dateTime={item.date}>{date(item.date,lang)}</time></span></small><strong lang={item.titleLanguage||""}>{item.title}</strong>{item.recordKind!=="answer"&&item.answerStatus&&<QuestionStatus answered={item.answerStatus==="answered"}/>} {item.resolutionOutcome&&<MotionStatuses outcome={item.resolutionOutcome} related={item.relatedJointMotions} sourceId={item.sourceId}/>}</span><b aria-hidden="true">{isOpen(item)?"−":"+"}</b></button>

          {isOpen(item) && <JoinedDetails item={item} lang={lang} member={id} />}
        </article>;
      })}
      {state.data && <div className="explorer-category-top">{offset>0 && <button onClick={()=>{moveToResults.current=true;setOffset(Math.max(0,offset-10));onOpen(null);}}>Previous</button>}{state.data.nextOffset!==null && <button onClick={()=>{moveToResults.current=true;setOffset(state.data!.nextOffset!);onOpen(null);}}>Next 10</button>}<button onClick={state.retry}>Refresh list</button></div>}
      <details className="explorer-source-join"><summary>{page.cache.complete ? "History and source information" : "Partial term 10 history — source information"}</summary>
        <p>{page.cache.complete ? "The saved history is available." : "Saved results are shown now. The term 10 history is incomplete; some source records are awaiting retry."}{page.cache.stale && page.cache.complete ? " The daily update is pending." : ""}</p>
        {page.cache.lastError && <p>An upstream request failed. Saved results remain available.</p>}
        {!category && page.unclassifiedMotionCount>0 && <p>Some motions lack a verified rule basis and remain unclassified.</p>}
        <small>{page.cache.lastSuccessfulRefresh ? <>Last completed refresh: <span lang={lang}>{date(page.cache.lastSuccessfulRefresh,lang)}</span>. </> : ""}Questions appear by the question date, with answers attached. New answers appear as updates in Following.</small>
      </details>
    </>}
    {open && state.error && !state.data && <LinkedActivityFallback key={sourceId} sourceId={sourceId} member={id} lang={lang} complete={false} />}
  </section>;
}
function speechSummary(item: JoinedActivity): Speech {
  return {id:item.sourceId,date:item.date,start:item.start || null,end:item.end || null,titles:item.titles || {},kind:item.speechKind || "PLENARY_DEBATE_SPEECH",reference:item.reference,originalLanguages:item.originalLanguages || [],participants:[],websiteUrl:item.websiteUrl || null,websiteLanguage:item.websiteLanguage || null};
}
function revealSpeech(target: HTMLElement) {
  const panel=target.closest<HTMLElement>('.explorer-profile-body');
  const scroller=panel&&/^(auto|scroll)$/.test(getComputedStyle(panel).overflowY)
    ? panel : target.closest<HTMLElement>('.explorer');
  if(!scroller)return;
  // scrollIntoView also scrolls the hidden-overflow desktop shell, lifting its footer.
  const margin=Number.parseFloat(getComputedStyle(target).scrollMarginTop)||0;
  const top=scroller.scrollTop+target.getBoundingClientRect().top-scroller.getBoundingClientRect().top-scroller.clientTop-margin;
  scroller.scrollTo({top});
}
function Speeches({ id, lang, initialSpeech, onOpen }: { id:number;lang:string;initialSpeech:string|null;onOpen:(id:string|null)=>void }) {
  const c=interfaceCopy(lang);
  const [offset,setOffset]=useState(0),[speechLanguage,setSpeechLanguage]=useState<string|null>(null);
  const [enrichedSpeeches,setEnrichedSpeeches]=useState<Speech[]>([]);
  const focusedSpeech=useRef<string|null>(null);
  const resultsHeading=useRef<HTMLHeadingElement>(null);
  const speechOrigin=useRef<{key:string;owner:Element|null}|null>(null);
  useLayoutEffect(()=>{
    const intent=initialSpeech?{key:id+':'+initialSpeech,owner:document.activeElement}:null;
    speechOrigin.current=intent;
    const cancel=(event:FocusEvent)=>{if(event.target!==intent?.owner)speechOrigin.current=null;};
    document.addEventListener('focusin',cancel);
    return()=>{document.removeEventListener('focusin',cancel);speechOrigin.current=null;};
  },[id,initialSpeech]);
  const state=useData<JoinedActivityPage>(`latest-activities/${id}?lang=${lang}&limit=10&offset=${offset}&category=plenary-contributions`);
  const pinned=useData<JoinedActivityPage>(initialSpeech && state.data && !state.data.items.some(item=>item.sourceId===initialSpeech) ? `latest-activities/${id}?lang=${lang}&limit=10&category=plenary-contributions&source-id=${encodeURIComponent(initialSpeech)}` : null);
  useEffect(()=>{setOffset(0);setSpeechLanguage(null);},[id,lang]);
  useEffect(()=>{setEnrichedSpeeches([]);},[id]);
  const items=state.data ? [...(pinned.data?.selectedItems || []).filter(item=>!state.data!.items.some(row=>row.id===item.id)),...state.data.items].filter(item=>item.recordKind==='speech') : [];
  const changePage=(next:number)=>{
    const heading=resultsHeading.current;
    heading?.focus({preventScroll:true});
    const body=heading?.closest('.explorer-profile-body');
    // Reuse the activity list's local results-reveal convention.
    if(body&&body.scrollHeight>body.clientHeight)body.scrollTo({top:0});else heading?.scrollIntoView({block:'start'});
    setOffset(next);onOpen(null);
  };
  useEffect(()=>{if(!initialSpeech){focusedSpeech.current=null;return;}const key=id+':'+initialSpeech;if(focusedSpeech.current===key)return;const target=document.getElementById('speech-'+initialSpeech);if(!target)return;const origin=speechOrigin.current,active=document.activeElement;if(origin?.key===key&&(active===origin.owner||active===document.body&&!origin.owner?.isConnected)){revealSpeech(target);target.querySelector<HTMLButtonElement>('.explorer-speech-toggle')?.focus({preventScroll:true});}focusedSpeech.current=key;},[id,initialSpeech,state.data,pinned.data]);
  return <section lang={lang}>
    <div className="explorer-section-title"><h2 lang={lang} ref={resultsHeading} id={'speech-results-'+id} tabIndex={-1}>{c.speeches}</h2><TextSearch prefix="mep-speech-fts" label="Search this MEP’s speeches" language={lang} member={id} kinds={['speech']} from="2024-07-16" scopeNote="Searches saved speech text for this MEP in the current term. Transcript and language coverage may be incomplete."/></div>
    <InterventionStatistics key={'statistics:'+id} member={id} onItems={setEnrichedSpeeches}/>
    <SpeechCloud key={'cloud:'+id} member={id} interfaceLanguage={lang} onSpeech={(speech,language)=>{setSpeechLanguage(language);onOpen(speech);}}/>
    <div className="explorer-section-title" lang="en"><span>Term 10{state.data ? ` · ${state.data.indexedTotal} contributions` : ""}</span></div>
    {state.loading && !state.data && <p role="status" lang="en">Loading saved speeches…</p>}
    {state.error && <ErrorView message={state.error} retry={state.retry} />}
    {state.data && !items.length && <p className="explorer-notice" lang="en">{state.data.cache.complete ? "No indexed plenary contributions were found for this MEP." : "No plenary contributions have been loaded for this MEP yet."}</p>}
    {initialSpeech && pinned.loading && <p role="status" lang="en">Checking the saved linked speech…</p>}
    {initialSpeech && pinned.error && <ErrorView message={pinned.error} retry={pinned.retry} />}
    {initialSpeech && state.data && !pinned.loading && !items.some(item=>item.sourceId===initialSpeech) && <LinkedActivityFallback key={initialSpeech} sourceId={initialSpeech} member={id} lang={lang} complete={state.data.cache.complete} />}
    {items.map(item=>{const base=speechSummary(item),enriched=enrichedSpeeches.find(row=>row.id===item.sourceId),speech={...base,...enriched,titles:{...base.titles,...enriched?.titles}};const open=initialSpeech===speech.id,speechTitle=title(speech,lang);return <article className="explorer-speech" key={item.id} id={`speech-${speech.id}`}>
      <button className="explorer-speech-toggle" lang="en" onClick={()=>{setSpeechLanguage(null);onOpen(open ? null : speech.id);}} aria-expanded={open}><span><span lang={lang}>{date(speech.date,lang)}</span> · {speech.kind==='PLENARY_DEBATE_WRITTEN_STATEMENT' ? 'Written statement' : 'Plenary speech'}{speech.start ? <> · <span lang={lang}>{time(speech.start,lang)}</span> Brussels</> : ''}</span><span className="explorer-speech-heading"><strong lang={speechTitle.language}>{speechTitle.text}</strong><b aria-hidden="true">{open ? '−' : '+'}</b></span></button>
      {!open&&<div className="explorer-speech-list-badges"><InterventionBadges value={speech.intervention} language={lang}/></div>}
      {open && <Detail speech={speech} lang={lang} transcriptLanguage={speechLanguage||lang} />}
    </article>})}
    {state.data && <div className="explorer-category-top" lang="en">{offset>0 && <button onClick={()=>changePage(Math.max(0,offset-10))}>Newer</button>}{state.data.nextOffset!==null && <button onClick={()=>changePage(state.data!.nextOffset!)}>Older</button>}<button onClick={state.retry}>Refresh list</button></div>}
  </section>;
}
export default function App() {
  const [initial] = useState(() => new URLSearchParams(location.search));
  const [restoration,setRestoration]=useState(0);
  const [lang, setLang] = useState(() => queryLanguage(initial));
  const [member, setMember] = useState<number | null>(
    /^\d+$/.test(initial.get("member") || "")
      ? Number(initial.get("member"))
      : null,
  );
  const [committee, setCommittee] = useState(initial.get("committee") || "");
  const [role, setRole] = useState(() => queryRole(initial));
  const [country, setCountry] = useState(initial.get("view") ? "" : filterCountry(initial.get("country")));
  const [group, setGroup] = useState(initial.get("group") || "");
  const [search, setSearch] = useState("");
  const [speechLink, setSpeechLink] = useState(initial.get("speech"));
  const [activityLink, setActivityLink] = useState(initial.get("activity"));
  const [activityCategory, setActivityCategory] = useState(initial.get("activity-category") || "");
  const [view, setView] = useState<'legislation'|'questions'|'outside'|'amendments'|'groups'|'saved'|null>(
    publicExplorerView(initial.get('view')),
  );
  const [tab, setTab] = useState(
    publicMemberModule(initial.get('module')),
  );
  const votes=useMemberVotesJourney(member,!view&&Boolean(member)&&tab==='votes',initial);
  const memberOpener=useRef<number|null>(null);
  const viewOpener=useRef<{node:HTMLElement|null;headerIndex:number}|null>(null);
  // Member and Votes tab navigation add one entry through the URL effect.
  const memberStep=useRef(false);
  const pendingDestination=useRef<{view:typeof view;member:number|null;portrait?:number|null;opener?:{node:HTMLElement|null;headerIndex:number}|null}|null>(null);
  const directoryState = useData<Directory>(view==='outside'||view==='groups'?null:"directory");
  const directory = directoryState.data;
  const error = directoryState.error;
  const profile = useData<MemberProfile>(!view && member && tab === "profile" ? `profile/${member}` : null);
  const c = interfaceCopy(lang);
  useSavedChecks(lang);
  const label = (key: string, fallback: string) => interfaceLabel(lang,key,fallback);
  useLayoutEffect(() => {
    const page=document.querySelector<HTMLElement>(".explorer"),tabs=page?.querySelector<HTMLElement>(".explorer-tabs");
    if(!page||!tabs)return;
    const measure=()=>page.style.setProperty("--explorer-tabs-height",`${tabs.getBoundingClientRect().height}px`);
    measure();
    const observer=new ResizeObserver(measure);observer.observe(tabs);
    return ()=>{observer.disconnect();page.style.removeProperty("--explorer-tabs-height");};
  }, [member, view, lang]);
  const scrolledView = useRef({member,tab,view});
  useEffect(() => {
    // Small screens scroll the whole explorer; start new pages at the top and new tabs at their content.
    const previous=scrolledView.current;scrolledView.current={member,tab,view};
    const page=document.querySelector<HTMLElement>(".explorer");
    if(!page||page.scrollHeight<=page.clientHeight)return;
    if(previous.member!==member||previous.view!==view){if(!speechLink&&!activityLink)page.scrollTo({top:0});return;}
    if(previous.tab===tab||(tab==="speeches"&&speechLink)||(tab==="activities"&&activityLink))return;
    const body=page.querySelector<HTMLElement>(".explorer-profile-body"),tabs=page.querySelector<HTMLElement>(".explorer-tabs");
    if(!body||!tabs||getComputedStyle(tabs).position!=="sticky")return;
    const contentTop=page.scrollTop+body.getBoundingClientRect().top-page.getBoundingClientRect().top-tabs.offsetHeight;
    if(page.scrollTop>contentTop)page.scrollTo({top:contentTop});
  }, [member, tab, view, speechLink, activityLink]);
  // Apply the destination after the existing responsive scroll policy has settled.
  function focusDestination(){
    const intent=pendingDestination.current;
    if(!intent||intent.view!==view||intent.member!==member)return;
    // Suspense can retain the previous view's hidden DOM while a chunk loads.
    if(document.querySelector('[data-view-loading]'))return;
    // Selected speech links already hand focus to the exact item once it mounts.
    if(!view&&member&&speechLink&&!intent.opener){pendingDestination.current=null;return;}
    const page=document.querySelector<HTMLElement>('main.explorer,main.explorer-insights');
    const portrait=intent.portrait!=null?page?.querySelector<HTMLElement>(`[data-member-id="${intent.portrait}"] .portrait--button`):null;
    const opener=intent.opener;
    const returned=opener?.node?.isConnected?opener.node:opener&&opener.headerIndex>=0?page?.querySelectorAll<HTMLElement>('.parliament-header nav button')[opener.headerIndex]:null;
    const target=portrait||returned||page?.querySelector<HTMLElement>('h1');
    if(!target)return;
    pendingDestination.current=null;
    if(target.tagName==='H1')target.tabIndex=-1;
    target.focus({preventScroll:true});
    if(portrait||returned)target.scrollIntoView({block:'nearest'});
  }
  useEffect(()=>{
    focusDestination();
    const cancel=()=>{pendingDestination.current=null;};
    document.addEventListener('focusin',cancel);
    return ()=>document.removeEventListener('focusin',cancel);
  },[view,member,speechLink]);
  useEffect(() => {
    const timer=window.setInterval(directoryState.retry,directory?.index.complete ? 60_000 : 10_000);
    return ()=>window.clearInterval(timer);
  }, [directory?.index.complete,directoryState.retry]);
  useEffect(() => {
    if (!directory?.members.length) return;
    if (committee) {
      const body = directory.committees.find(
        b => b.id === committee || b.code.toUpperCase() === committee.toUpperCase(),
      );
      if (body) setCommittee(body.id);
      else if (directory.index.complete) setCommittee("");
    }
    if (country && !directory.members.some(m => matchesCountry(country,m.countryCode))) setCountry("");
    if (group && !directory.members.some(m => m.groupCode === group)) setGroup("");
  }, [directory, committee, country, group]);
  useEffect(() => {
    const u = new URL(location.href);
    const ownParams=explorerParams(u.searchParams,view,member);
    for(const key of [...ownParams.keys()])if(key.startsWith('mv-'))ownParams.delete(key);
    if(!view&&member)for(const [key,value] of memberVotesJourneyParams(votes.journey))ownParams.set(key,value);
    u.search = new URLSearchParams({
      ...Object.fromEntries(ownParams),
      lang,
      ...(!view && member ? { member: String(member), module: tab } : {}),
      ...(!view && committee ? { committee } : {}),
      ...(!view && country ? { country } : {}),
      ...(!view && group ? { group } : {}),
      role,
      ...(view ? { view } : {}),
      ...(!view && member && speechLink ? { speech: speechLink } : {}),
      ...(!view && member && activityLink ? { activity: activityLink } : {}),
      ...(!view && member && activityCategory ? { "activity-category": activityCategory } : {}),
    }).toString();
    const step=memberStep.current;memberStep.current=false;
    if (u.href !== location.href) step ? history.pushState(null, "", u) : history.replaceState(history.state, "", u);
    window.dispatchEvent(new Event('explorer-query-change'));
    document.documentElement.lang = lang;
  }, [lang, member, tab, committee, role, country, group, view, speechLink, activityLink, activityCategory,votes.journey]);
  const filtered = useMemo(
    () =>
      directory?.members.filter(
        (m) =>
          matchesCountry(country,m.countryCode) &&
          (!group || group === m.groupCode) &&
          (!search ||
            normalize(m.firstName + " " + m.lastName).includes(
              normalize(search),
            )) &&
          (!committee ||
            m.memberships?.some(
              (v: Membership) =>
                v.current &&
                v.id === committee &&
                (role === "both" ||
                  (role === "substitute"
                    ? v.role === "MEMBER_SUBSTITUTE"
                    : v.role !== "MEMBER_SUBSTITUTE")),
            )),
      ) || [],
    [directory, country, group, search, committee, role],
  );
  const unavailable = Boolean(committee && !directory?.index.complete);
  const selected = directory?.members.find((m) => m.id === member);
  const titleMember = profile.data?.id === member ? profile.data : selected;
  const memberName = [titleMember?.firstName,titleMember?.lastName].filter(Boolean).join(' ') || `MEP ${member}`;
  const pageTitle = view==='legislation' ? null : view ? {questions:'Questions',outside:'Outside voices',groups:'Group voices',amendments:'Amendments',saved:'Following'}[view]
    : member ? `${memberName} · ${tab==='profile'?c.profile:tab==='activities'?c.activities:tab==='amendments'?'Amendments':tab==='votes'?'Votes':c.speeches}` : c.title;
  const pageTitleLanguage=view||member&&(tab==='amendments'||tab==='votes')?'en':lang;
  useEffect(()=>{if(pageTitle)document.title = `${pageTitle} — European Parliament data explorer`;document.querySelector('title')?.setAttribute('lang',pageTitleLanguage);},[pageTitle,pageTitleLanguage]);
  const roleName = (value: string) =>
    value === "MEMBER_SUBSTITUTE"
      ? label("substitute", c.substitutes)
      : value === "MEMBER"
        ? label("member", c.members)
        : value === "CHAIR"
          ? lang === "en" ? "Chair" : label("chair", "Chair")
          : value === "CHAIR_VICE"
            ? lang === "en" ? "Vice-Chair" : label("viceChair", "Vice-Chair")
            : value.toLowerCase().replaceAll("_", " ");
  function navigateView(next:typeof view) {
    next=publicExplorerView(next);
    if(next===view)return;
    const active=document.activeElement instanceof HTMLElement?document.activeElement:null;
    viewOpener.current={node:active,headerIndex:active?Array.from(document.querySelectorAll('.parliament-header nav button')).indexOf(active):-1};
    pendingDestination.current={view:next,member:next?member:null};
    const url=new URL(location.href);
    // Country on the member wall is deliberately not an explorer default.
    url.searchParams.delete('country');
    for(const key of [...url.searchParams.keys()])if(/^(q|pl|agenda|hot|cloud|dossier|trend|ov|am|gv|mv|ma|mep-speech-fts|mep-activity-fts)-/.test(key))url.searchParams.delete(key);
    next?url.searchParams.set('view',next):url.searchParams.delete('view');
    history.pushState(null,'',url);setView(next);
  }
  useEffect(()=>{
    const restore=()=>{
      pendingDestination.current=null;
      setRestoration(value=>value+1);
      const query=new URLSearchParams(location.search),next=query.get('view');
      const restored=publicExplorerView(next);
      setLang(queryLanguage(query));setRole(queryRole(query));
      const nextMember=/^\d+$/.test(query.get('member')||'')?Number(query.get('member')):null;
      votes.restore(query,nextMember);
      setView(restored);setMember(nextMember);
      if(!restored){setCountry(filterCountry(query.get('country')));setCommittee(query.get('committee')||'');setGroup(query.get('group')||'');}
      setTab(publicMemberModule(query.get('module')));
      setSpeechLink(query.get('speech'));setActivityLink(query.get('activity'));setActivityCategory(query.get('activity-category')||'');
      // A restored disabled link may resolve to the current state, so the URL
      // effect need not run. Canonicalize that history entry immediately too.
      if(!publicAmendmentsEnabled&&(next==='amendments'||query.get('module')==='amendments')){
        const url=new URL(location.href);
        if(next==='amendments')url.searchParams.delete('view');
        if(query.get('module')==='amendments')url.searchParams.set('module','speeches');
        for(const key of [...url.searchParams.keys()])if(key.startsWith('am-'))url.searchParams.delete(key);
        history.replaceState(null,'',url);
      }
    };
    window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);
  },[]);
  const changeMemberTab=(next:string)=>{if(next!==tab&&(next==='votes'||tab==='votes'))memberStep.current=true;setTab(next);};
  const openInsightMember = (id: number, sourceId?: string) => {
    navigateView(null);setMember(id);setActivityCategory('');
    memberOpener.current=null;
    pendingDestination.current={view:null,member:id};
    const speech=Boolean(sourceId?.startsWith('MTG-PL-'));
    setTab(sourceId ? speech ? 'speeches' : 'activities' : 'profile');
    setSpeechLink(speech ? sourceId! : null);
    setActivityLink(sourceId && !speech ? sourceId : null);
  };
  const showMembers = () => {
    navigateView(null);setMember(null);setSpeechLink(null);setActivityLink(null);
    pendingDestination.current={view:null,member:null};
  };
  const leaveMember=()=>{
    pendingDestination.current={view:null,member:null,portrait:memberOpener.current};
    memberStep.current=true;setMember(null);setSpeechLink(null);setActivityLink(null);
  };
  const leaveSaved=()=>{
    const opener=viewOpener.current;
    navigateView(null);
    pendingDestination.current={view:null,member,opener};
  };
  return <ErrorBoundary resetKey={`${view}:${member}:${tab}:${restoration}`} language={lang}
    navigation={<ParliamentHeader view={view||'members'} onMembers={showMembers} onNavigate={navigateView} onSaved={()=>navigateView('saved')} language={lang}/>}
    onRetry={()=>{pendingDestination.current={view,member};}}
  ><Suspense fallback={<ViewLoading language={lang}/>}><ViewContent onReady={focusDestination} render={()=>{
  if (view === 'legislation' || view === 'questions' || view === 'outside' || (publicAmendmentsEnabled && view === 'amendments') || view === 'groups') {
    const props={language:lang,onBack:showMembers,onNavigate:navigateView,onMember:openInsightMember,onSaved:()=>navigateView('saved')};
    return view==='groups' ? <GroupVoices {...props}/> : view==='amendments' ? <AmendmentsPage {...props}/> : view==='legislation' ? <Legislation {...props}/> : view==='outside' ? <OutsideVoices {...props}/> : <QuestionTopics {...props}/>;
  }
  return (
    <main className="explorer" lang={lang}>
        <ParliamentHeader view={view==='saved'?'saved':'members'} onMembers={showMembers} onNavigate={navigateView} onSaved={()=>navigateView('saved')} language={lang}/>
        {view === 'saved' ? <Saved language={lang} onBack={leaveSaved} onMember={openInsightMember}/> : member ? (
          <section className="explorer-profile">
            <button
              lang={lang}
              className="explorer-back"
              onClick={leaveMember}
            >
              ← {c.back}
            </button>
            <div className="explorer-profile-header">
              {selected && (
                <Portrait
                  member={{
                    ...selected,
                    imageUrl: `${API_ROOT}/portrait/${selected.id}`,
                  }}
                />
              )}
              <div>
                <h1 lang="" tabIndex={-1} aria-label={memberName}>
                  {profile.data?.firstName || selected?.firstName}
                  <br />
                  {profile.data?.lastName || selected?.lastName}
                </h1>
                <p lang="">
                  {selected?.countryCode} · {selected?.groupCode}
                </p>
                <SaveButton item={{kind:'mep',id:String(member),title:[profile.data?.firstName||selected?.firstName,profile.data?.lastName||selected?.lastName].filter(Boolean).join(' ')}}/>
              </div>
            </div>
            <nav className="explorer-tabs" aria-label="MEP sections" lang={lang}>
              <button
                className={tab === "profile" ? "selected" : ""}
                aria-pressed={tab === "profile"}
                onClick={() => changeMemberTab("profile")}
              >
                {c.profile}
              </button>
              <button
                className={tab === "speeches" ? "selected" : ""}
                aria-pressed={tab === "speeches"}
                onClick={() => changeMemberTab("speeches")}
              >
                {c.speeches}
              </button>
              <button className={tab === "activities" ? "selected" : ""} aria-pressed={tab === "activities"} onClick={() => changeMemberTab("activities")}>{c.activities}</button>
              <button lang="en" className={tab==='votes'?'selected':''} aria-pressed={tab==='votes'} onClick={()=>changeMemberTab('votes')}>Votes</button>
              {publicAmendmentsEnabled&&<button lang="en" className={tab === "amendments" ? "selected" : ""} aria-pressed={tab === "amendments"} onClick={() => changeMemberTab("amendments")}>Amendments</button>}
            </nav>
            <div className="explorer-profile-body">
              {tab === "speeches" ? (
                <Speeches
                  id={member}
                  lang={lang}
                  initialSpeech={speechLink}
                  onOpen={setSpeechLink}
                />
              ) : tab==='votes' ? (
                votes.journey.invalid ? <section lang="en" role="alert"><h2>Invalid voting records link</h2><p>The requested voting records are unavailable. Check the period, decision and document in the link.</p></section> :
                  <Suspense fallback={<p className="member-votes-loading" role="status" lang="en">Loading voting records…</p>}>
                    <MemberVotes key={member} memberId={member} memberName={memberName} language={lang} state={votes.journey.state} onStateChange={votes.onStateChange}
                      renderContext={request=><Suspense fallback={<p className="member-votes-loading" role="status" lang="en">Loading document context…</p>}>
                        <DocumentContextReader request={request} language={lang} selectedDocumentId={votes.journey.adoptedId} onSelectedDocumentIdChange={votes.onSelectedDocumentIdChange}/>
                      </Suspense>}/>
                  </Suspense>
              ) : publicAmendmentsEnabled && tab === "amendments" ? <Amendments key={member} member={member} language={lang} onMember={openInsightMember} heading="Amendments tabled"/> : tab === "activities" ? <Activities id={member} lang={lang} initialActivity={activityLink} onOpen={setActivityLink} category={activityCategory} onCategory={setActivityCategory} /> : (
                <>
                  {profile.loading && <p role="status" lang="en">Loading profile…</p>}
                  {profile.error && (
                    <ErrorView message={profile.error} retry={profile.retry} />
                  )}{" "}
                  {profile.data && (
                    <>
                      <h2 lang={lang}>{c.profile}</h2>
                      {profile.data.birthDate && (
                        <p lang="en">
                          Born <span lang={lang}>{date(profile.data.birthDate, lang)}</span>
                          {profile.data.birthPlace
                            ? <> · <span lang="">{profile.data.birthPlace}</span></>
                            : ""}
                        </p>
                      )}
                      {profile.data.email && (
                        <p>
                          <a lang="" href={`mailto:${profile.data.email}`}>
                            {profile.data.email}
                          </a>
                        </p>
                      )}
                      <h2 lang={lang}>{c.committee}</h2>
                      {!profile.data.memberships?.some(m => m.current && directory?.committees.some(b => b.id === m.id)) && (
                        <p lang="en">No active committee memberships were returned.</p>
                      )}
                      {orderedMemberships(profile.data.memberships||[],directory?.committees||[]).map((m, i) => {
                        const body = directory?.committees.find(
                          (b) => b.id === m.id,
                        );
                        // This view intentionally has no first-entry name fallback.
                        const bodyName=body?.names[lang] ? {text:body.names[lang],language:lang} : body?.names.en ? {text:body.names.en,language:'en'} : {text:m.classification.replaceAll("_", " ").toLowerCase(),language:''};
                        return (
                          <div
                            className={`explorer-membership ${m.current ? "" : "explorer-historical"}`}
                            key={i}
                          >
                            <strong>
                              <span lang="">{body?.code || m.id}</span> · <span lang={['MEMBER_SUBSTITUTE','MEMBER','CHAIR','CHAIR_VICE'].includes(m.role) ? lang : ''}>{roleName(m.role)}</span>
                            </strong>
                            <p lang={bodyName.language}>
                              {bodyName.text}
                            </p>
                            <small lang={lang}>
                              {m.start
                                ? date(m.start, lang)
                                : <span lang="en">Start date unavailable</span>}{" "}
                              — {m.end ? date(m.end, lang) : c.ongoing}
                              {m.current ? "" : <span lang="en"> · Historical / future</span>}
                            </small>
                          </div>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </div>
          </section>
        ) : (
          <section className="explorer-wall">
            <h1 lang={lang}>{c.title}</h1>
            <div className="explorer-filters">
              <label lang={lang}>
                {c.committee}
                <select
                  value={committee}
                  onChange={(e) => setCommittee(e.target.value)}
                >
                  <option value="">{c.all}</option>
                  {committee && !directory?.committees.some(b => b.id === committee) && (
                    <option lang="en" value={committee}>Checking committee {committee}…</option>
                  )}
                  {directory?.committees.map((b) => (
                    <option lang={b.names[lang]?lang:b.names.en?'en':''} key={b.id} value={b.id}>
                      {b.code} · {b.names[lang] || b.names.en}
                    </option>
                  ))}
                </select>
              </label>
              <div className="explorer-filter-line">
                <label lang="en">
                  Membership
                  <select
                    lang={lang}
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="both">{c.both}</option>
                    <option value="member">{c.members}</option>
                    <option value="substitute">{c.substitutes}</option>
                  </select>
                </label>
                <label lang={lang}>
                  {label("country", "Country")}
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  >
                    <option lang="en" value="">All</option>
                    {Array.from(
                      new Set(directory?.members.map((m) => filterCountry(m.countryCode))),
                    )
                      .filter(Boolean)
                      .sort()
                      .map((v) => {
                        const name=countryName(lang,v);
                        return <option lang={name===v?'':lang} key={v} value={v}>{name}</option>;
                      })}
                  </select>
                </label>
                <label lang={lang}>
                  {label("political_group", "Political group")}
                  <select
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                  >
                    <option lang="en" value="">All</option>
                    {Array.from(
                      new Set(directory?.members.map((m) => m.groupCode)),
                    )
                      .sort()
                      .map((v) => (
                        <option lang="" key={v}>{v}</option>
                      ))}
                  </select>
                </label>
              </div>
              <input
                lang={lang}
                aria-label={c.search}
                placeholder={c.search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Status scope={JSON.stringify([lang,committee,country,group,search,role])} pending={directoryState.loading||unavailable} oncePerScope message={!directory||error||unavailable?null:(filtered.length?`${filtered.length} ${filtered.length===1?'MEP matches':'MEPs match'} these filters.`:'No MEPs match these filters.')+(!directory.index.complete?' Committee memberships are incomplete.':'')}/>
            {error && (
              <ErrorView
                message={error}
                retry={directoryState.retry}
              />
            )}{" "}
            {!directory && !error && (
              <p role="status" lang="en">Loading current MEPs and committees…</p>
            )}
            {directory && (
              <>
                <div className="explorer-results">
                  <strong>{unavailable ? "—" : filtered.length}</strong>
                  <span lang={lang}>
                    {c.members}{" "}
                    <small lang="en">Current at <time lang={lang} dateTime={directory.day}>{date(directory.day, lang)}</time></small>
                  </span>
                  <button
                    lang={lang}
                    onClick={() => {
                      setCommittee("");
                      setCountry("");
                      setGroup("");
                      setSearch("");
                      setRole("both");
                    }}
                  >
                    {label("reset_filters", "Reset filters")}
                  </button>
                </div>
                {directory.sync?.error && (
                  <div className="explorer-index" role="status" lang="en">
                    Update feed unavailable. Showing cached profiles; last
                    successful feed check:{" "}
                    <span lang={directory.sync.lastSuccess ? "" : "en"}>{directory.sync.lastSuccess || "not yet completed"}</span>.
                  </div>
                )}
                {!directory.index.complete && (
                  <div className="explorer-index" role="status" lang="en">
                    {directory.index.error ||
                      `Loading committee memberships: ${directory.index.loaded} / ${directory.index.total}.`}
                    {unavailable && (
                      <p>
                        Committee results will appear when all memberships are
                        loaded.
                      </p>
                    )}
                    {directory.index.error && (
                      <button onClick={directoryState.retry}>
                        Retry membership index
                      </button>
                    )}
                  </div>
                )}
                {!unavailable && (
                  <div className="explorer-portraits" data-portrait-scroll-root>
                    {filtered.map((m, index) => (
                      <div className="explorer-portrait-item" lang="" key={m.id} data-member-id={m.id}>
                        <Portrait
                          member={{
                            ...m,
                            imageUrl: m.memberships
                              ? `${API_ROOT}/portrait/${m.id}`
                              : publicUrl("assets/portrait-placeholder.svg"),
                          }}
                          labelled
                          eager={index < 18}
                          onClick={() => {
                            memberOpener.current=m.id;
                            pendingDestination.current={view:null,member:m.id};
                            memberStep.current=true;setMember(m.id);
                            setSpeechLink(null);
                            setActivityLink(null);
                            setTab("speeches");
                          }}
                        />
                        {committee && (
                          <small>
                            {m.memberships
                              ?.filter((v) => v.current && v.id === committee)
                              .map((v,index) => <span key={index} lang={['MEMBER_SUBSTITUTE','MEMBER','CHAIR','CHAIR_VICE'].includes(v.role) ? lang : ''}>{index>0 ? " · " : ""}{roleName(v.role)}</span>)}
                          </small>
                        )}
                      </div>
                    ))}
                    {!filtered.length && <p lang="en">No MEPs match these filters.</p>}
                  </div>
                )}
              </>
            )}
          </section>
        )}
        <footer className="explorer-footer" lang="en">
          <label>
            Language
            <select
              aria-label="Interface language"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
            >
              {interfaceLanguages.map((code) => (
                <option lang={code} key={code} value={code}>
                  {languageName(code)}
                </option>
              ))}
            </select>
          </label>
          <DataNotice/>
        </footer>
    </main>
  );
  }}/></Suspense></ErrorBoundary>;
}
