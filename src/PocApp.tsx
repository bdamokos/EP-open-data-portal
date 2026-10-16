import {filterCountry,matchesCountry} from './pocCountries.mjs';
import {explorerParams} from './pocExplorerUrl';
import {PocSpeechCloud} from './PocSpeechCloud';
import {InterventionBadges,PocSpeechContext,PocInterventionStatistics} from './PocSpeechInterventions';
import {publicationBody} from './publication-body.mjs';
import {orderedMemberships} from './pocMemberships.mjs';
import {PocSaved,SaveButton,SavedNav,useSavedChecks} from './PocSaved';
import {QuestionStatus} from './PocQuestionStatus';
import {MotionStatuses,PocMotionOutcome} from './PocMotionOutcome';
import { useEffect, useMemo, useRef, useState } from "react";
import { Portrait } from "./components/Portrait";
import { DataNotice } from "./components/DataNotice";
import { API_ROOT } from "./api";
import { interfaceLabel, countryName, languageName } from "./interfaceLabels.mjs";
import { publicUrl } from "./publicUrl";
import { pocCopy, pocLanguages } from "./pocCopy";
import type {
  Directory,
  PocProfile,
  Speech,
  SpeechDetail,
  Membership,
  JoinedActivityPage,
  JoinedActivity,
  DocumentFile,
  PublicationDocument,
  CoAuthor,
} from "./pocTypes";
import "./poc.css";
import { activitySourceId } from "../server/activity-links.mjs";
import { transcriptLanguage } from "../server/transcript-language.mjs";
import { useData } from "./pocData";
import { PocSpeechPlayer } from "./PocSpeechPlayer";
import { PocLegislation } from './PocLegislation';
import { PocQuestionTopics } from './PocQuestionTopics';
import {PocOutsideVoices} from './PocOutsideVoices';
import { coAuthorSegments, linkedCoAuthors, coAuthorProfileUrl } from './pocCoAuthors.mjs';

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
const title = (s: Speech, lang: string) =>
  s.titles[lang] ||
  s.titles.en ||
  Object.values(s.titles)[0] ||
  "Plenary contribution";
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
    <div className="poc-notice" role="alert">
      <p>{message}</p>
      <button onClick={retry}>Try again</button>
    </div>
  );
}
export function transcript(xml: string | null) {
  if (!xml) return { paragraphs: [], machine: false, error: false };
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror"))
    return { paragraphs: [], machine: false, error: true };
  return {
    paragraphs: Array.from(doc.getElementsByTagNameNS("*", "p"))
      .map((p) => {const timed=Array.from(p.getElementsByTagNameNS("*","time"));return (timed.length?timed.map(t=>t.textContent||"").join(" "):p.textContent||"").replace(/\s+([,.;:!?])/g,"$1");})
      .filter(Boolean),
    machine: transcriptLanguage(xml).machine,
    error: false,
  };
}
function Detail({ speech, lang }: { speech: Speech; lang: string }) {
  const c = pocCopy(lang);
  const state = useData<SpeechDetail>(
    `speech/${encodeURIComponent(speech.id)}?lang=${lang}`,
  );
  const text = useMemo(
    () => transcript(state.data?.xml ?? null),
    [state.data?.xml],
  );
  return (
    <div className="poc-speech-detail" aria-live="polite">
      <PocSpeechPlayer speech={speech} lang={lang} />
      <InterventionBadges value={state.data?.intervention}/>
      <PocSpeechContext key={speech.id} id={speech.id} language={lang}/>
      <h3>{c.transcript}</h3>
      {speech.websiteUrl && <p className="poc-source-link"><a href={speech.websiteUrl} target="_blank" rel="noreferrer">Speech on Parliament’s website ↗</a>{" "}<small>Original {speech.websiteLanguage?.toUpperCase()}</small></p>}
      {state.loading && !state.data && <p role="status">Loading transcript…</p>}
      {state.error && <ErrorView message={state.error} retry={state.retry} />}
      {state.data && (
        <>
          {state.data.textCache?.stale && <small>Showing saved transcript.{state.data.textCache.refreshInProgress ? " A refresh is running in the background." : state.data.textCache.refreshError ? " The last refresh failed." : ""}</small>}
          <div className="poc-text-meta">
            {state.data.textLanguage?.toUpperCase() || "Text unavailable"}
            {state.data.translationType === "machine" || text.machine
              ? " · Parliament machine translation"
              : state.data.translationType === "original"
                ? " · Original text"
                : state.data.textLanguage ? " · Translation method unspecified" : ""}
            {state.data.textLanguage && state.data.textLanguage !== lang
              ? " · Interface-language text unavailable"
              : ""}
          </div>
          {text.error ? (
            <p>Parliament returned transcript text that could not be read.</p>
          ) : text.paragraphs.length ? (
            <div
              className="poc-transcript"
              lang={state.data.textLanguage || undefined}
            >
              {text.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          ) : (
            <p>
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
  if (!files.length) return <p>No downloadable files were returned for this document.</p>;
  return <div className="poc-publication-files">
    <label>Document language <select aria-label="Document language" value={selected} onChange={e => setSelected(e.target.value)}>{languages.map(l => <option value={l} key={l}>{l === "und" ? "Language unavailable" : l.toUpperCase()}</option>)}</select></label>
    {!languages.includes(lang) && <small>Files in the interface language are unavailable. Choose an available language.</small>}
    <p>{files.filter(f => (f.language || "und") === selected).map((f,i) => <a key={f.url + i} href={f.url} target="_blank" rel="noreferrer">{f.format} · {f.language?.toUpperCase() || "Language unavailable"} ↗</a>)}</p>
  </div>;
}
function AuthorMention({text,authors,lang}:{text:string;authors?:CoAuthor[];lang:string}) {
  return <>{coAuthorSegments(text,authors).map((part,index)=>part.id ? <a key={index} className="poc-author-link" href={coAuthorProfileUrl(location.pathname,lang,part.id)}>{part.text}</a> : part.text)}</>;
}
function CoAuthors({authors,lang}:{authors?:CoAuthor[];lang:string}) {
  const people=linkedCoAuthors(authors);
  if(!people.length)return null;
  return <details className="poc-coauthors"><summary>{people.some(person=>person.role==='QUESTION_AUTHOR') ? 'Question authors' : 'MEP authors'} · {people.length}</summary><ul>{people.map(person=><li key={person.id}><a href={coAuthorProfileUrl(location.pathname,lang,person.id)}>{person.name}</a></li>)}</ul></details>;
}
function PublicationText({ sourceId, member, lang, heading, includeAnswers = false,question }: { sourceId: string; member: number; lang: string; heading: string; includeAnswers?: boolean;question?:{id:string;title?:string} }) {
  const [requestedLanguage,setRequestedLanguage]=useState(lang);useEffect(()=>setRequestedLanguage(lang),[lang]);
  const state=useData<PublicationDocument>(`document/${encodeURIComponent(sourceId)}?member=${member}&lang=${requestedLanguage}`);
  const text=state.data?.selectedDocumentId===sourceId ? state.data.selectedText : null;
  const files=sourceId.endsWith('-ASW')?state.data?.answers.find(answer=>answer.id===sourceId)?.files||[]:state.data?.files||[];
  const body=publicationBody(text?.paragraphs||[],sourceId,text?.textLanguage);
  const languageName=(code:string)=>{try{return new Intl.DisplayNames([lang],{type:'language'}).of(code)||code.toUpperCase();}catch{return code.toUpperCase();}};
  return <section className="poc-document-text" id={'document-'+sourceId} aria-live="polite">
    <div className="poc-reader-heading"><h3>{heading}</h3>{question&&<a href={"#document-"+question.id} title={question.title}>Read question</a>}{text?.availableTextLanguages.length ? <select aria-label={`${heading} language`} title={text.translationType==='original'?'Original text':'Translation method not specified'} value={text.textLanguage||requestedLanguage} onChange={event=>setRequestedLanguage(event.target.value)}>{text.availableTextLanguages.map(code=><option key={code} value={code}>{code.toUpperCase()}</option>)}</select> : null}{text?.textLanguage&&text.textLanguage!==requestedLanguage&&<small>{languageName(requestedLanguage)} unavailable · showing {languageName(text.textLanguage)}</small>}</div>
    {state.loading&&!text&&<p role="status">Loading text…</p>}{state.error&&<p>Text temporarily unavailable.</p>}
    {text?.status==='available'?<div className="poc-transcript" lang={text.textLanguage||undefined}>{body.paragraphs.map((paragraph,index)=><p key={index}><AuthorMention text={paragraph} authors={state.data?.coAuthors} lang={lang}/></p>)}</div>:text&&<p>Text unavailable. Download the document below.</p>}
    {text&&<><CoAuthors authors={state.data?.coAuthors} lang={lang}/><details className="poc-reader-download"><summary>Document & download</summary>{body.header.map((paragraph,index)=><p key={index}><AuthorMention text={paragraph} authors={state.data?.coAuthors} lang={lang}/></p>)}<PublicationFiles files={files} lang={text.textLanguage||lang}/></details></>}
    {includeAnswers&&state.data?.answers.map(answer=><PublicationText key={answer.id} sourceId={answer.id} member={member} lang={lang} heading={"Answer"+(answer.date?" · "+date(answer.date,lang):"")}/>)}
    {includeAnswers&&state.data&&!state.data.answers.length&&<p>No answer published.</p>}
  </section>;
}
function JoinedDetails({ item, lang, member }: { item: JoinedActivity; lang: string; member: number }) {
  const hasText=item.category==='written-questions' || item.category==='oral-questions' || item.recordKind==='answer';
  const document=useData<PublicationDocument>(item.recordKind!=='speech' && !hasText ? `document/${item.sourceId}?member=${member}&lang=${lang}` : null);
  const roles: Record<string,string> = {AUTHOR:"Author",QUESTION_AUTHOR:"Author of the question",RAPPORTEUR:"Rapporteur",RAPPORTEUR_SHADOW:"Shadow rapporteur",RAPPORTEUR_OPINION:"Opinion rapporteur",RAPPORTEUR_SHADOW_OPINION:"Shadow opinion rapporteur",SPEAKER:"Plenary contribution"};
  if (item.recordKind === "speech") return <Detail speech={{id:item.sourceId,date:item.date,start:item.start || null,end:item.end || null,titles:item.titles || {},kind:item.speechKind || "PLENARY_DEBATE_SPEECH",reference:item.reference,originalLanguages:item.originalLanguages || [],participants:[],websiteUrl:item.websiteUrl || null,websiteLanguage:item.websiteLanguage || null}} lang={lang} />;
  return <div className="poc-speech-detail">
    {!hasText&&<p><strong>{item.relatedJointMotions?.length && item.provenance.role==="AUTHOR" ? "Author of the original motion" : roles[item.provenance.role] || item.provenance.role}</strong>{item.provenance.stage ? ` · ${item.provenance.stage === "RDG1" ? "First reading" : item.provenance.stage === "RDG2" ? "Second reading" : item.provenance.stage}` : ""}</p>}
    <PocMotionOutcome outcome={item.resolutionOutcome} related={item.relatedJointMotions} reference={item.reference} sourceId={item.sourceId} language={lang}/>
    {(item.category==='written-questions' || item.category==='oral-questions' || item.recordKind==='answer') && <>
      {item.recordKind!=='answer'&&<SaveButton item={{kind:'question',id:item.sourceId,title:item.title,memberId:String(member),date:item.date,baseline:item.answerIds?{answerIds:item.answerIds}:undefined}}/>}
      <PublicationText sourceId={item.sourceId} member={member} lang={lang} heading={item.recordKind==='answer' ? 'Answer' : 'Question'} includeAnswers={item.recordKind!=='answer'} question={item.recordKind==='answer'&&item.relatedQuestionId?{id:item.relatedQuestionId,title:item.relatedQuestionTitle}:undefined} />
      {item.recordKind==='answer' && item.relatedQuestionId && <PublicationText sourceId={item.relatedQuestionId} member={member} lang={lang} heading="Linked question" />}
    </>}
    {!hasText && <section aria-label={item.relatedJointMotions?.length ? 'Original motion document' : 'Document'}>
      {!!item.relatedJointMotions?.length && <h3>Original motion document</h3>}
      <CoAuthors authors={document.data?.coAuthors} lang={lang}/>
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
  return <aside className="poc-notice" aria-live="polite">
    <strong>Linked activity {sourceId || "identifier not recognised"}</strong>
    <p>{!sourceId ? "This older link could not be matched to an API source identifier." : complete ? "This item is outside this MEP’s saved activity index. No category or MEP relationship is inferred from the link." : "This item has not been indexed for this MEP yet. Saved activities remain available while the term 10 load continues."}</p>
    {sourceId && !check && <button onClick={() => setCheck(true)}>Check this source with Parliament</button>}
    {(document.loading || contribution.loading) && <p role="status">Loading the linked source…</p>}
    {document.error && <ErrorView message={document.error} retry={document.retry} />}
    {contribution.error && <ErrorView message={contribution.error} retry={contribution.retry} />}
    {matched && <>
      <h3>{matched.titles[lang] || matched.titles.en || Object.values(matched.titles)[0] || matched.id}</h3>
      {matched.date && <p>{date(matched.date,lang)}{answer ? " · Answer" : ""}</p>}
      <p>{answer && authored ? "The API links this answer to a question authored by this MEP." : document.data!.roles.length ? `The document records these roles for this MEP: ${document.data!.roles.join(", ")}.` : "The document source is available. A relationship to this MEP has not been established."}</p>
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
  const c=pocCopy(lang);
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
    resultsHeading.current?.closest(".poc-profile-body")?.scrollTo({top:0});
  },[category,categoriesOpen,offset]);
  useEffect(()=>{
    if(state.data?.cache.complete || open)return;
    const timer=window.setInterval(state.retry,30_000);return ()=>window.clearInterval(timer);
  },[state.data?.cache.complete,open,state.retry]);
  const choose=(value:string)=>{moveToResults.current=true;setCategoriesOpen(false);onCategory(value);setOffset(0);onOpen(null);};
  const coverage=category ? page?.categoryCoverage[category] : null;
  const selectedLabel=category ? page?.categories[category] || category : "All activities";
  return <section className="poc-activities">
    <h2>{c.activities}</h2>
    {page && <>
      <div className="poc-category-selection">
        <button aria-expanded={categoriesOpen} aria-controls="activity-categories" onClick={()=>setCategoriesOpen(value=>!value)}>{categoriesOpen ? "Close categories" : "Change category"}</button>
      </div>
      {categoriesOpen && <nav id="activity-categories" className="poc-category-groups" aria-label="Parliamentary activity categories">
        <button className={!category ? "selected" : ""} aria-pressed={!category} onClick={()=>choose("")}>All activities</button>
        {page.categoryGroups.map(group=><section key={group.label}><h3>{group.label}</h3>{group.categories.map(key=>{
          const status=page.categoryCoverage[key];
          const count=status.status === "source-not-verified" ? "API source required" : `${status.indexedCount} saved`;
          return <button key={key} className={category===key ? "selected" : ""} aria-pressed={category===key} onClick={()=>choose(key)}><span>{page.categories[key]}</span><small>{count}</small></button>;
        })}</section>)}
      </nav>}
    </>}
    <h3 ref={resultsHeading} tabIndex={-1} className="poc-activity-results-title">{selectedLabel}{state.data && coverage?.status!=="source-not-verified" ? ` · ${state.data.indexedTotal} saved` : ""}</h3>
    {state.loading && !state.data && <p role="status">Loading saved results…</p>}
    {state.error && <ErrorView message={state.error} retry={state.retry} />}
    {page && <>
      {coverage?.status === "source-not-verified" && <div className="poc-notice"><strong>API source not verified</strong><p>{coverage.reason}</p><p>This category is not shown as an empty history.</p></div>}
      {coverage?.status === "incomplete-joins" && <p className="poc-notice">{coverage.reason} </p>}
      {!state.loading && state.data && !state.data.items.length && coverage?.status !== "source-not-verified" && <p>No saved activities were found in this selection.{!page.cache.complete ? " The term 10 history is still incomplete." : ""}</p>}
      {open && pinned.loading && !items.some(isOpen) && <p role="status">Checking the saved linked activity…</p>}
      {open && pinned.error && <ErrorView message={pinned.error} retry={pinned.retry} />}
      {open && state.data && !pinned.loading && !items.some(isOpen) && <LinkedActivityFallback key={sourceId} sourceId={sourceId} member={id} lang={lang} complete={page.cache.complete} />}
      {items.map(item=>{
        const key=`${item.category}:${item.sourceId}`;
        return <article className="poc-speech" id={`publication-${item.id}`} key={key}>
          <button className="poc-speech-toggle" aria-expanded={isOpen(item)} onClick={()=>{const next=isOpen(item)?null:key;onOpen(next);}}><span><small>{item.recordKind === "answer" ? "Answer" : item.category === "written-questions" ? "Written question" : item.category === "oral-questions" ? "Oral question" : item.categoryLabel} · {date(item.date,lang)}</small><strong>{item.title}</strong>{item.recordKind!=="answer"&&item.answerStatus&&<QuestionStatus answered={item.answerStatus==="answered"}/>} {item.resolutionOutcome&&<MotionStatuses outcome={item.resolutionOutcome} related={item.relatedJointMotions} sourceId={item.sourceId}/>}</span><b aria-hidden="true">{isOpen(item)?"−":"+"}</b></button>

          {isOpen(item) && <JoinedDetails item={item} lang={lang} member={id} />}
        </article>;
      })}
      {state.data && <div className="poc-category-top">{offset>0 && <button onClick={()=>{moveToResults.current=true;setOffset(Math.max(0,offset-10));onOpen(null);}}>Previous</button>}{state.data.nextOffset!==null && <button onClick={()=>{moveToResults.current=true;setOffset(state.data!.nextOffset!);onOpen(null);}}>Next 10</button>}<button onClick={state.retry}>Refresh list</button></div>}
      <details className="poc-source-join"><summary>{page.cache.complete ? "History and source information" : "Partial term 10 history — source information"}</summary>
        <p>{page.cache.complete ? "The saved history is available." : "Saved results are shown now. The term 10 history is incomplete; some source records are awaiting retry."}{page.cache.stale && page.cache.complete ? " The daily update is pending." : ""}</p>
        {page.cache.lastError && <p>An upstream request failed. Saved results remain available.</p>}
        {!category && page.unclassifiedMotionCount>0 && <p>Some motions lack a verified rule basis and remain unclassified.</p>}
        <small>{page.cache.lastSuccessfulRefresh ? `Last completed refresh: ${date(page.cache.lastSuccessfulRefresh,lang)}. ` : ""}Questions appear by the question date, with answers attached. New answers appear as updates in Following.</small>
      </details>
    </>}
    {open && state.error && !state.data && <LinkedActivityFallback key={sourceId} sourceId={sourceId} member={id} lang={lang} complete={false} />}
  </section>;
}
function speechSummary(item: JoinedActivity): Speech {
  return {id:item.sourceId,date:item.date,start:item.start || null,end:item.end || null,titles:item.titles || {},kind:item.speechKind || "PLENARY_DEBATE_SPEECH",reference:item.reference,originalLanguages:item.originalLanguages || [],participants:[],websiteUrl:item.websiteUrl || null,websiteLanguage:item.websiteLanguage || null};
}
function Speeches({ id, lang, initialSpeech, onOpen }: { id:number;lang:string;initialSpeech:string|null;onOpen:(id:string|null)=>void }) {
  const c=pocCopy(lang);
  const [offset,setOffset]=useState(0),[speechLanguage,setSpeechLanguage]=useState<string|null>(null);
  const [enrichedSpeeches,setEnrichedSpeeches]=useState<Speech[]>([]);
  const focusedSpeech=useRef<string|null>(null);
  const state=useData<JoinedActivityPage>(`latest-activities/${id}?lang=${lang}&limit=10&offset=${offset}&category=plenary-contributions`);
  const pinned=useData<JoinedActivityPage>(initialSpeech && state.data && !state.data.items.some(item=>item.sourceId===initialSpeech) ? `latest-activities/${id}?lang=${lang}&limit=10&category=plenary-contributions&source-id=${encodeURIComponent(initialSpeech)}` : null);
  useEffect(()=>{setOffset(0);setSpeechLanguage(null);},[id,lang]);
  useEffect(()=>{setEnrichedSpeeches([]);},[id]);
  const items=state.data ? [...(pinned.data?.selectedItems || []).filter(item=>!state.data!.items.some(row=>row.id===item.id)),...state.data.items].filter(item=>item.recordKind==='speech') : [];
  useEffect(()=>{if(!initialSpeech){focusedSpeech.current=null;return;}const key=id+':'+initialSpeech;if(focusedSpeech.current===key)return;const target=document.getElementById('speech-'+initialSpeech);if(!target)return;target.scrollIntoView({block:'start'});target.querySelector<HTMLButtonElement>('.poc-speech-toggle')?.focus({preventScroll:true});focusedSpeech.current=key;},[id,initialSpeech,state.data,pinned.data]);
  return <section>
    <PocInterventionStatistics key={id} member={id} onItems={setEnrichedSpeeches}/>
    <PocSpeechCloud key={id} member={id} interfaceLanguage={lang} onSpeech={(speech,language)=>{setSpeechLanguage(language);onOpen(speech);}}/>
    <div className="poc-section-title"><h2>{c.speeches}</h2><span>Term 10{state.data ? ` · ${state.data.indexedTotal} contributions` : ""}</span></div>
    {state.loading && !state.data && <p role="status">Loading saved speeches…</p>}
    {state.error && <ErrorView message={state.error} retry={state.retry} />}
    {state.data && !items.length && <p className="poc-notice">{state.data.cache.complete ? "No indexed plenary contributions were found for this MEP." : "No plenary contributions have been loaded for this MEP yet."}</p>}
    {initialSpeech && pinned.loading && <p role="status">Checking the saved linked speech…</p>}
    {initialSpeech && pinned.error && <ErrorView message={pinned.error} retry={pinned.retry} />}
    {initialSpeech && state.data && !pinned.loading && !items.some(item=>item.sourceId===initialSpeech) && <LinkedActivityFallback key={initialSpeech} sourceId={initialSpeech} member={id} lang={lang} complete={state.data.cache.complete} />}
    {items.map(item=>{const base=speechSummary(item),enriched=enrichedSpeeches.find(row=>row.id===item.sourceId),speech={...base,...enriched,titles:{...base.titles,...enriched?.titles}};const open=initialSpeech===speech.id;return <article className="poc-speech" key={item.id} id={`speech-${speech.id}`}>
      <button className="poc-speech-toggle" onClick={()=>{setSpeechLanguage(null);onOpen(open ? null : speech.id);}} aria-expanded={open}><span>{date(speech.date,lang)} · {speech.kind==='PLENARY_DEBATE_WRITTEN_STATEMENT' ? 'Written statement' : 'Plenary speech'}{speech.start ? ` · ${time(speech.start,lang)} Brussels` : ''}</span><strong>{title(speech,lang)}</strong><small>{speech.reference}<b>{open ? '−' : '+'}</b></small></button>
      {!open&&<div className="poc-speech-list-badges"><InterventionBadges value={speech.intervention}/></div>}
      {open && <Detail speech={speech} lang={speechLanguage||lang} />}
    </article>})}
    {state.data && <div className="poc-category-top">{offset>0 && <button onClick={()=>{setOffset(Math.max(0,offset-10));onOpen(null);}}>Newer</button>}{state.data.nextOffset!==null && <button onClick={()=>{setOffset(state.data!.nextOffset!);onOpen(null);}}>Older</button>}<button onClick={state.retry}>Refresh list</button></div>}
  </section>;
}
export default function PocApp() {
  const [initial] = useState(() => new URLSearchParams(location.search));
  const [lang, setLang] = useState(
    pocLanguages.includes(initial.get("lang") || "")
      ? initial.get("lang")!
      : "en",
  );
  const [member, setMember] = useState<number | null>(
    /^\d+$/.test(initial.get("member") || "")
      ? Number(initial.get("member"))
      : null,
  );
  const [committee, setCommittee] = useState(initial.get("committee") || "");
  const [role, setRole] = useState(
    ["both", "member", "substitute"].includes(initial.get("role") || "")
      ? initial.get("role")!
      : "both",
  );
  const [country, setCountry] = useState(initial.get("view") ? "" : filterCountry(initial.get("country")));
  const [group, setGroup] = useState(initial.get("group") || "");
  const [search, setSearch] = useState("");
  const [speechLink, setSpeechLink] = useState(initial.get("speech"));
  const [activityLink, setActivityLink] = useState(initial.get("activity"));
  const [activityCategory, setActivityCategory] = useState(initial.get("activity-category") || "");
  const [view, setView] = useState<'legislation'|'questions'|'outside'|'saved'|null>(
    ['legislation','questions','outside','saved'].includes(initial.get('view') || '')
      ? initial.get('view') as 'legislation'|'questions'|'outside'|'saved' : null,
  );
  const [tab, setTab] = useState(
    ["profile", "activities"].includes(initial.get("module") || "") ? initial.get("module")! : "speeches",
  );
  const directoryState = useData<Directory>(view==='outside'?null:"directory");
  const directory = directoryState.data;
  const error = directoryState.error;
  const profile = useData<PocProfile>(!view && member && tab === "profile" ? `profile/${member}` : null);
  const c = pocCopy(lang);
  useSavedChecks(lang);
  const label = (key: string, fallback: string) => interfaceLabel(lang,key,fallback);
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
    const ownParams=explorerParams(u.searchParams,view);
    u.search = new URLSearchParams({
      ...Object.fromEntries(ownParams),
      poc: "1",
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
    history.replaceState(null, "", u);
    document.documentElement.lang = lang;
  }, [lang, member, tab, committee, role, country, group, view, speechLink, activityLink, activityCategory]);
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
    if(next===view)return;
    const url=new URL(location.href);
    // Country on the member wall is deliberately not an explorer default.
    url.searchParams.delete('country');
    for(const key of [...url.searchParams.keys()])if(/^(q|pl|agenda|hot|cloud|dossier|trend|ov)-/.test(key))url.searchParams.delete(key);
    next?url.searchParams.set('view',next):url.searchParams.delete('view');
    history.pushState(null,'',url);setView(next);
  }
  useEffect(()=>{
    const restore=()=>{
      const query=new URLSearchParams(location.search),next=query.get('view');
      const restored=['legislation','questions','outside','saved'].includes(next||'')?next as typeof view:null;
      setView(restored);setMember(/^\d+$/.test(query.get('member')||'')?Number(query.get('member')):null);
      if(!restored){setCountry(filterCountry(query.get('country')));setCommittee(query.get('committee')||'');setGroup(query.get('group')||'');}
      setTab(['profile','activities'].includes(query.get('module')||'')?query.get('module')!:'speeches');
      setSpeechLink(query.get('speech'));setActivityLink(query.get('activity'));setActivityCategory(query.get('activity-category')||'');
    };
    window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);
  },[]);
  const openInsightMember = (id: number, sourceId?: string) => {
    navigateView(null);setMember(id);setActivityCategory('');
    const speech=Boolean(sourceId?.startsWith('MTG-PL-'));
    setTab(sourceId ? speech ? 'speeches' : 'activities' : 'profile');
    setSpeechLink(speech ? sourceId! : null);
    setActivityLink(sourceId && !speech ? sourceId : null);
  };
  if (view === 'legislation' || view === 'questions' || view === 'outside') {
    const props={language:lang,onBack:()=>{navigateView(null);setMember(null);},onNavigate:navigateView,onMember:openInsightMember,onSaved:()=>navigateView('saved')};
    return view==='legislation' ? <PocLegislation {...props}/> : view==='outside' ? <PocOutsideVoices {...props}/> : <PocQuestionTopics {...props}/>;
  }
  return (
    <main className="poc" lang={lang}>
        <header className="poc-header">
          <span>
            EUROPEAN PARLIAMENT
          </span>
          <nav className="poc-explorer-nav" aria-label="Explore Parliament">
            <button onClick={() => navigateView('legislation')}>Plenary agenda</button>
            <button onClick={() => navigateView('questions')}>Questions</button>
            <button onClick={() => navigateView('outside')}>Outside voices</button>
            <SavedNav onClick={()=>navigateView('saved')}/>
          </nav>
        </header>
        {view === 'saved' ? <PocSaved language={lang} onBack={()=>navigateView(null)} onMember={openInsightMember}/> : member ? (
          <section className="poc-profile">
            <button
              className="poc-back"
              onClick={() => {
                setMember(null);
                setSpeechLink(null);
                setActivityLink(null);
              }}
            >
              ← {c.back}
            </button>
            <div className="poc-profile-header">
              {selected && (
                <Portrait
                  member={{
                    ...selected,
                    imageUrl: `${API_ROOT}/poc/portrait/${selected.id}`,
                  }}
                />
              )}
              <div>
                <h1>
                  {profile.data?.firstName || selected?.firstName}
                  <br />
                  {profile.data?.lastName || selected?.lastName}
                </h1>
                <p>
                  {selected?.countryCode} · {selected?.groupCode}
                </p>
                <SaveButton item={{kind:'mep',id:String(member),title:[profile.data?.firstName||selected?.firstName,profile.data?.lastName||selected?.lastName].filter(Boolean).join(' ')}}/>
              </div>
            </div>
            <nav className="poc-tabs">
              <button
                className={tab === "profile" ? "selected" : ""}
                onClick={() => setTab("profile")}
              >
                {c.profile}
              </button>
              <button
                className={tab === "speeches" ? "selected" : ""}
                onClick={() => setTab("speeches")}
              >
                {c.speeches}
              </button>
              <button className={tab === "activities" ? "selected" : ""} onClick={() => setTab("activities")}>{c.activities}</button>
            </nav>
            <div className="poc-profile-body">
              {tab === "speeches" ? (
                <Speeches
                  id={member}
                  lang={lang}
                  initialSpeech={speechLink}
                  onOpen={setSpeechLink}
                />
              ) : tab === "activities" ? <Activities id={member} lang={lang} initialActivity={activityLink} onOpen={setActivityLink} category={activityCategory} onCategory={setActivityCategory} /> : (
                <>
                  {profile.loading && <p role="status">Loading profile…</p>}
                  {profile.error && (
                    <ErrorView message={profile.error} retry={profile.retry} />
                  )}{" "}
                  {profile.data && (
                    <>
                      <h2>{c.profile}</h2>
                      {profile.data.birthDate && (
                        <p>
                          Born {date(profile.data.birthDate, lang)}
                          {profile.data.birthPlace
                            ? ` · ${profile.data.birthPlace}`
                            : ""}
                        </p>
                      )}
                      {profile.data.email && (
                        <p>
                          <a href={`mailto:${profile.data.email}`}>
                            {profile.data.email}
                          </a>
                        </p>
                      )}
                      <h2>{c.committee}</h2>
                      {!profile.data.memberships?.some(m => m.current && directory?.committees.some(b => b.id === m.id)) && (
                        <p>No active committee memberships were returned.</p>
                      )}
                      {orderedMemberships(profile.data.memberships||[],directory?.committees||[]).map((m, i) => {
                        const body = directory?.committees.find(
                          (b) => b.id === m.id,
                        );
                        return (
                          <div
                            className={`poc-membership ${m.current ? "" : "poc-historical"}`}
                            key={i}
                          >
                            <strong>
                              {body?.code || m.id} · {roleName(m.role)}
                            </strong>
                            <p>
                              {body?.names[lang] ||
                                body?.names.en ||
                                m.classification
                                  .replaceAll("_", " ")
                                  .toLowerCase()}
                            </p>
                            <small>
                              {m.start
                                ? date(m.start, lang)
                                : "Start date unavailable"}{" "}
                              — {m.end ? date(m.end, lang) : c.ongoing}
                              {m.current ? "" : " · Historical / future"}
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
          <section className="poc-wall">
            <h1>{c.title}</h1>
            <div className="poc-filters">
              <label>
                {c.committee}
                <select
                  value={committee}
                  onChange={(e) => setCommittee(e.target.value)}
                >
                  <option value="">{c.all}</option>
                  {committee && !directory?.committees.some(b => b.id === committee) && (
                    <option value={committee}>Checking committee {committee}…</option>
                  )}
                  {directory?.committees.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.names[lang] || b.names.en}
                    </option>
                  ))}
                </select>
              </label>
              <div className="poc-filter-line">
                <label>
                  Membership
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="both">{c.both}</option>
                    <option value="member">{c.members}</option>
                    <option value="substitute">{c.substitutes}</option>
                  </select>
                </label>
                <label>
                  {label("country", "Country")}
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  >
                    <option value="">All</option>
                    {Array.from(
                      new Set(directory?.members.map((m) => filterCountry(m.countryCode))),
                    )
                      .filter(Boolean)
                      .sort()
                      .map((v) => (
                        <option key={v} value={v}>
                          {countryName(lang,v)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {label("political_group", "Political group")}
                  <select
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                  >
                    <option value="">All</option>
                    {Array.from(
                      new Set(directory?.members.map((m) => m.groupCode)),
                    )
                      .sort()
                      .map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                  </select>
                </label>
              </div>
              <input
                aria-label={c.search}
                placeholder={c.search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {error && (
              <ErrorView
                message={error}
                retry={directoryState.retry}
              />
            )}{" "}
            {!directory && !error && (
              <p role="status">Loading current MEPs and committees…</p>
            )}
            {directory && (
              <>
                <div className="poc-results">
                  <strong>{unavailable ? "—" : filtered.length}</strong>
                  <span>
                    {c.members}{" "}
                    <small>Current at {date(directory.day, lang)}</small>
                  </span>
                  <button
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
                  <div className="poc-index" role="status">
                    Update feed unavailable. Showing cached profiles; last
                    successful feed check:{" "}
                    {directory.sync.lastSuccess || "not yet completed"}.
                  </div>
                )}
                {!directory.index.complete && (
                  <div className="poc-index" role="status">
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
                  <div className="poc-portraits" data-portrait-scroll-root>
                    {filtered.map((m, index) => (
                      <div className="poc-portrait-item" key={m.id}>
                        <Portrait
                          member={{
                            ...m,
                            imageUrl: m.memberships
                              ? `${API_ROOT}/poc/portrait/${m.id}`
                              : publicUrl("assets/portrait-placeholder.svg"),
                          }}
                          labelled
                          eager={index < 18}
                          onClick={() => {
                            setMember(m.id);
                            setSpeechLink(null);
                            setActivityLink(null);
                            setTab("speeches");
                          }}
                        />
                        {committee && (
                          <small>
                            {m.memberships
                              ?.filter((v) => v.current && v.id === committee)
                              .map((v) => roleName(v.role))
                              .join(" · ")}
                          </small>
                        )}
                      </div>
                    ))}
                    {!filtered.length && <p>No MEPs match these filters.</p>}
                  </div>
                )}
              </>
            )}
          </section>
        )}
        <footer className="poc-footer">
          <label>
            Language
            <select
              aria-label="Interface language"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
            >
              {pocLanguages.map((code) => (
                <option key={code} value={code}>
                  {languageName(code)}
                </option>
              ))}
            </select>
          </label>
          <DataNotice/>
        </footer>
    </main>
  );
}
