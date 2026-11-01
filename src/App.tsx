import {TopicBatch,RecordTopics,OfficialTitle} from './RecordTopics';
const legacyTopicUrl=legacyTopics(new URLSearchParams(location.search));
if(legacyTopicUrl)history.replaceState(history.state,'',legacyTopicUrl);
import {legacyTopics} from './topicPresentation.mjs';
const Topics=lazyView(()=>import('./Topics').then(m=>({default:m.Topics})));
import {usePlenaryUiLanguage} from './PlenaryLive';
import {defaultUi} from './uiDefault.mjs';
import {appUiI18n, uiForLocale} from './appUiI18n';
import {UiI18nProvider} from './UiI18nReact';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {DocumentObjectText} from './DocumentObjectText';
import {DocumentPages} from './DocumentPages';
import {useSpeechTranslation} from './SpeechTranslation';
import {MemberAffiliation} from './components/MemberAffiliation';
import {ActivityDossierLinks} from './DossierActivity';
import {useDossierJourney,dossierJourneyRestoring,useDossierReaderState} from './dossierJourney';
import {matchesCommittee,matchesOrganization,organizationId,organizationCoverageComplete} from './memberFilters.mjs';
import {AvailabilityNote} from './AvailabilityNote';
import {coverageStore} from './SavedControls';
import {FormerMemberNotice} from './MembershipUpdates';
import {PersonName,PersonNamesProvider} from './PersonName';
import {languagePreference} from '../server/language-order.mjs';
import {TextLanguagePicker,TextLanguageFallback} from './TextLanguagePicker';
import {ErrorBoundary,ViewContent,ViewLoading} from './ErrorBoundary';
import {lazyView} from './lazyView';
import {filterCountry,matchesCountry} from './countries.mjs';
import {explorerParams,useExplorerParam} from './explorerUrl';
import {compareMembers} from './memberOrder.mjs';
import {SpeechCloud} from './SpeechCloud';
import {FindInText,TextSearch} from './TextSearch';
import {InterventionBadges,SpeechContextPanel,InterventionStatistics,speechCategories,matchesSpeechCategory, speechCategoriesUi} from './SpeechInterventions';
import type {SpeechCategory} from './SpeechInterventions';
import {SpeakerName,SpeakerRoleLine} from './SpeakerIdentity';
import {publicationBody,publicationCoverLogo} from './publication-body.mjs';
import {CommitteeMemberships} from './CommitteeMemberships';
import {ParliamentaryService} from './ParliamentaryService';
import {ProfileMemberships} from './ProfileMemberships';
import {SaveButton,useSavedChecks,useSaved} from './SavedControls';
import {interfaceTerm} from './terms.mjs';
import {ParliamentHeader} from './ParliamentHeader';
import {InsightFrame} from './InsightFrame';
import {plenaryModes,plenaryModeTitles,type PlenaryMode, plenaryModeTitlesUi} from './plenaryModes';
import {QuestionStatus} from './QuestionStatus';
import {MotionStatuses,MotionOutcome} from './MotionOutcome';
import { startTransition, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {DocumentNotes,ReferenceScope,ReferenceText,readerTexts} from "./References";
import {DocumentParagraphs,clipLinks,usableFormatting,type FormatMark} from "./DocumentFormatting";
import { Portrait } from "./components/Portrait";
import './focus.css';
import { DataNotice } from "./components/DataNotice";
import { API_ROOT } from "./api";
import { interfaceLabel, countryName, compareCountries, languageName } from "./interfaceLabels.mjs";
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
import './Controls.css';
import { activitySourceId } from "../server/activity-links.mjs";
import {transcriptParagraphs,TranscriptText} from "./Transcript";
import { transcriptLanguage } from "../server/transcript-language.mjs";
import { api, useData } from "./data";
import {validateVotePeriods,type VotePeriodsResponse} from "./plenaryPeriods.mjs";
import { useSpeechVideo } from "./SpeechPlayer";
import {AmendmentTrailLink} from './AmendmentTrailLink';
import {publicAmendmentsEnabled,publicExplorerView,publicMemberModule} from './publicFeatures';
import {Status} from './Status';
import {ReaderRetry} from './ReaderRetry';
import { coAuthorSegments, linkedCoAuthors, coAuthorProfileUrl } from './coAuthors.mjs';
import {selectLanguageText} from './language.mjs';
import {memberVotesJourneyParams} from './memberVotesJourney.mjs';
import {useMemberVotesJourney} from './useMemberVotesJourney';
import {useMemberMotionJourney} from './useMemberMotionJourney';
import {motionJourneyParams} from './motionJourney.mjs';
import type {MemberMotionReaderProps} from './MemberMotionReader';

const MemberVotes=lazyView(()=>import('./MemberVotes').then(module=>({default:module.MemberVotes})));
const DocumentContextReader=lazyView(()=>import('./DocumentContextReader').then(module=>({default:module.DocumentContextReader})));
const MemberMotionReader=lazyView(()=>import('./MemberMotionReader').then(module=>({default:module.MemberMotionReader})));

const GroupVoices=lazyView(()=>import('./GroupVoices').then(module=>({default:module.GroupVoices})));
const Legislation=lazyView(()=>import('./Legislation').then(module=>({default:module.Legislation})));
const QuestionTopics=lazyView(()=>import('./QuestionTopics').then(module=>({default:module.QuestionTopics})));
const OutsideVoices=lazyView(()=>import('./OutsideVoices').then(module=>({default:module.OutsideVoices})));
const Saved=lazyView(()=>import('./Saved').then(module=>({default:module.Saved})));
const Amendments=lazyView(()=>import('./Amendments').then(module=>({default:module.Amendments})));
const AmendmentsPage=lazyView(()=>import('./Amendments').then(module=>({default:module.AmendmentsPage})));

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
const queryLanguage = (query: URLSearchParams) =>
  interfaceLanguages.includes(query.get("lang") || "") ? (query.get("lang")!) : "en";
const queryRole = (query: URLSearchParams) =>
  ["both", "member", "substitute"].includes(query.get("role") || "") ? (query.get("role")!) : "both";
const queryActivityOffset=(query:URLSearchParams)=>{
  const value=query.get('activity-offset');
  return (((value!==null) && /^\d{1,7}$/.test(value)) && (Number(value)<=1_000_000)) ? Number(value) : 0;
};
const title = (s: Speech, lang: string, ui: import('./uiI18n.mjs').UiFormatter = defaultUi) =>
  selectLanguageText(s.titles,lang,ui.t("app.plenary_contribution"), ui.messageLocale("app.plenary_contribution"));
const date = (s: string, lang: string) =>
  new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  }).format(new Date((s.length === 10) ? (s + "T12:00:00Z") : s));
const time = (s: string, lang: string) =>
  new Intl.DateTimeFormat(lang, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Brussels",
  }).format(new Date(s));
function ErrorView({ message, retry }: { message: string; retry: () => void }) {
  const ui = useUiI18n();
  return <div className="explorer-notice" role="alert" lang={ui.language}>
      <p>{message}</p>
      <button onClick={event=>{
        if(document.activeElement===event.currentTarget){
          const scope=event.currentTarget.closest('section,article,main');
          const target=scope?.querySelector<HTMLElement>('.explorer-speech-toggle,h1,h2,h3')||scope?.parentElement?.closest('section,main')?.querySelector<HTMLElement>('h1,h2,h3');
          if(target){if(/^H[1-6]$/.test(target.tagName))target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});}
        }
        retry();
      }}><UiMessage id="commissionfollowups.try_again"/></button>
    </div>;
}
export function transcript(xml: string | null) {
  if (!xml) return { paragraphs: [], machine: false, error: false };
  const text=transcriptParagraphs(xml);
  return {...text,machine:transcriptLanguage(xml).machine};
}
function Detail({ speech, lang, transcriptLanguage=lang }: { speech: Speech; lang: string;transcriptLanguage?:string }) {
  const ui = useUiI18n();
  const c = interfaceCopy(lang);
  const transcriptText=useRef<HTMLDivElement>(null);
  const translation=useSpeechTranslation(speech.id,transcriptLanguage,lang);
  const video=useSpeechVideo(speech,lang,translation.originalAudio);
  const state = translation.state;
  const body=state.transcript;
  const text = useMemo(
    () => transcript(body?.xml ?? null),
    [body?.xml],
  );
  return <div className="explorer-speech-detail" lang={lang} data-reader-source={speech.id} data-reader-language={transcriptLanguage} data-reader-pending={state.loading ? "true" : undefined}>
      <RecordTopics id={speech.id} full language={lang}/><Status scope={`transcript:${speech.id}:${lang}`} pending={state.loading} message={(state.error||!body) ? null : (text.error ? ui.t("app.transcript_could_not_be_read") : (text.paragraphs.length ? ui.t("app.transcript_loaded") : ui.t("batch4.speechinterventions.tsx.transcript.unavailable")))}/>
      {state.data?.speakers?.map(person=><div key={person.id}><strong><SpeakerName person={person} language={lang}/></strong><SpeakerRoleLine person={person} language={lang} intervention={state.data?.intervention} className="insight-secondary"/></div>)}
      {state.data?.intervention?.type!=='chair'&&<InterventionBadges value={state.data?.intervention} language={lang}/>}
      <SpeechContextPanel key={speech.id} id={speech.id} language={lang} transcriptLanguage={transcriptLanguage} preload={Boolean(state.data)&&!state.loading}/>
      <div className="explorer-speech-transcript-heading" lang={ui.language}><h3 lang={lang}>{c.transcript}</h3><div className="explorer-reader-tools">{video.toggle}{text.paragraphs.length>0&&<FindInText key={speech.id+':'+transcriptLanguage} label={ui.t("app.find_in_speech")} target={transcriptText}/>}</div></div>
      {video.panel}
      {(body||translation.control)&&<div className="explorer-text-meta" lang={ui.language}>
        {body&&(body.textLanguage ? <span lang="">{body.textLanguage.toUpperCase()}</span> : (text.paragraphs.length ? null : ui.t("app.text_unavailable")))}
        {((body && (body.textLanguage||!text.paragraphs.length)) && (translation.control||body.translationType==='original')) ? ' · ' : ''}
        {translation.control|| ((body?.translationType==='original') ? ui.t("textsearch.original_text") : null)}
        {(body?.textLanguage && (body.textLanguage!==translation.selected)) ? (' · '+ui.t('app.requestedTextUnavailable')) : ''}
      </div>}
      {translation.originalGap&&<p lang={ui.language}><UiMessage id="batch4.speechinterventions.tsx.original.text.unavailable"/></p>}
      {state.loading && !body && <p role="status" lang={ui.language}><UiMessage id="app.loading_transcript"/></p>}
      {state.error && <ErrorView message={state.error} retry={state.retry} />}
      {body && <>
          {body===state.data&&state.data?.textCache?.stale && <small lang={ui.language}>{state.data.textCache.refreshInProgress ? <UiMessage id="app.savedTranscriptRefreshing"/> : (state.data.textCache.refreshError ? <UiMessage id="app.savedTranscriptRefreshFailed"/> : <UiMessage id="app.savedTranscript"/>)}</small>}
          {text.error ? <p lang={ui.language}><UiMessage id="app.transcript_could_not_be_read"/></p> : (text.paragraphs.length ? <div
              className="explorer-transcript"
              ref={transcriptText}
              lang={body.textLanguage || ""}
            >
              {text.paragraphs.map((p, i) => <p key={i}><TranscriptText paragraph={p}/></p>)}
            </div> : <p lang={ui.language}><UiMessage id="batch4.speechinterventions.tsx.transcript.unavailable"/></p>)}
        </>}
    </div>;
}
function PublicationFiles({ files, lang }: { files: DocumentFile[]; lang: string }) {
  const ui = useUiI18n();
  const languages = languagePreference(files.map(f => f.language || "und"),lang);
  const [selected, setSelected] = useState(lang);
  const fileKey=files.map(f => `${f.url}|${f.language}`).join(",");
  useEffect(() => setSelected(languages.includes(lang) ? lang : (languages[0] || "und")), [lang, fileKey]);
  if (!files.length) return <p lang={ui.language}><UiMessage id="app.no_files_available"/></p>;
  return <div className="explorer-publication-files" lang={ui.language}>
    <label><UiMessage id="app.document_language"/> <select aria-label={ui.t("app.document_language")} value={selected} onChange={e => setSelected(e.target.value)}>{languages.map(l => <option lang={(l === "und") ? ui.language : ""} value={l} key={l}>{(l === "und") ? ui.t("app.language_unavailable") : l.toUpperCase()}</option>)}</select></label>
    {!languages.includes(lang) && <small><UiMessage id="speechcloud.not_available_in_this_language.37fcae"/></small>}
    <p>{files.filter(f => (f.language || "und") === selected).map((f,i) => <a key={f.url + i} href={f.url} target="_blank" rel="noreferrer"><span lang="">{f.format}</span> · <span lang={f.language ? "" : ui.language}>{f.language?.toUpperCase() || ui.t("app.language_unavailable")}</span> ↗</a>)}</p>
  </div>;
}
function AuthorMention({text,authors,lang,anchors,links,marks,notePrefix,offset=0,final=true}:{text:string;authors?:CoAuthor[];lang:string;anchors?:NoteAnchor[];links?:DocumentLink[];marks?:FormatMark[];notePrefix?:string;offset?:number;final?:boolean}) {
  const parts=coAuthorSegments(text,authors);let start=offset;
  return <>{parts.map((part,index)=>{const from=start;start+=part.text.length;return part.id ? <a key={index} lang="" className="explorer-author-link" href={coAuthorProfileUrl(lang,part.id)}>{part.text}</a> : (anchors ? <ReferenceText key={index} text={part.text} start={from} final={final&&index===parts.length-1} anchors={anchors} links={links} marks={marks} notePrefix={notePrefix}/> : part.text);})}</>;
}
function CoAuthors({authors,lang,member}:{authors?:CoAuthor[];lang:string;member:number}) {
  const ui = useUiI18n();
  const people=linkedCoAuthors(authors);
  if(!people.length)return null;
  return <details className="explorer-coauthors" lang={ui.language}><summary><UiMessage id={people.some(person=>person.role==='QUESTION_AUTHOR') ? "app.questionAuthors" : "app.mepAuthors"} values={{count:people.length}}/></summary><ul>{people.map(person=><li key={person.id} lang="">{(person.id===member) ? <strong><PersonName id={person.id} label={person.name}/></strong> : <a href={coAuthorProfileUrl(lang,person.id)}><PersonName id={person.id} label={person.name}/></a>}</li>)}</ul></details>;
}
function PublicationText({ sourceId, member, lang, heading, headingDate, includeAnswers = false,question, showDownloads = true }: { sourceId: string; member: number; lang: string; heading: string; headingDate?:string|null; includeAnswers?: boolean;question?:{id:string;title?:string};showDownloads?:boolean }) {
  const ui = useUiI18n();
  const [requestedLanguage,setRequestedLanguage]=useState(lang);useEffect(()=>setRequestedLanguage(lang),[lang,sourceId]);
  const state=useData<PublicationDocument>(`document/${encodeURIComponent(sourceId)}?member=${member}&lang=${requestedLanguage}`);
  const text=(state.data?.selectedDocumentId===sourceId) ? state.data.selectedText : null;
  const questionDocument=/^[EPHO]-\d+-\d{4}-\d+(?:-ASW)?$/.test(sourceId);
  const files=sourceId.endsWith('-ASW') ? (state.data?.answers.find(answer=>answer.id===sourceId)?.files||[]) : (state.data?.files||[]);
  const body=publicationBody(text?.paragraphs||[],sourceId,text?.textLanguage),notePrefix='notes'+useId().replace(/[^A-Za-z0-9_-]/g,'');
  const logo=publicationCoverLogo(text,sourceId,text?.textLanguage);
  const notes=text?.notes||[],anchors=body.exact ? (text?.noteAnchors||[]) : ([]),documentLinks=body.exact ? (text?.documentLinks||[]) : ([]);
  const failed=Boolean(state.error||text?.status==='error'||text?.refreshError||state.data&&!text),retryAt=state.retryAt??(text?.nextRetryAt ? Date.parse(text.nextRetryAt) : undefined);
  return <section className="explorer-document-text" lang={ui.language} id={'document-'+sourceId}><RecordTopics id={sourceId} full language={lang}/>
    <Status scope={`document:${sourceId}:${member}:${requestedLanguage}`} pending={state.loading} message={failed ? ui.t("app.documentStatusUnavailable", {heading: String(heading)}) : (state.data ? ((text?.status==='available') ? ui.t("app.documentStatusLoaded", {heading: String(heading)}) : ui.t("app.documentStatusNoText", {heading: String(heading)})) : null)}/>
    <div className="explorer-reader-heading"><h3>{headingDate ? <><UiMessage id="batch4.questiontopics.tsx.answer.date" values={{date: <span lang={lang}>{date(headingDate,lang)}</span>}}/></> : heading}</h3>{question&&<a lang="" href={"#document-"+question.id} title={question.title}><span lang={ui.language}><UiMessage id="textsearch.read_question"/></span></a>}{text&&<TextLanguagePicker available={text.availableTextLanguages} requested={lang} value={text.textLanguage} onChange={setRequestedLanguage} visibleLabel={false} title={(text.translationType==='original') ? ui.t("textsearch.original_text") : undefined} note={<TextLanguageFallback requested={requestedLanguage} actual={text.textLanguage} interfaceLanguage={lang}/>}/>}</div>
    {/^(?:A|B|RC)-/.test(sourceId)&&<AmendmentTrailLink document={sourceId} language={lang}><UiMessage id="app.amendments_to_this_document"/></AmendmentTrailLink>}
    {state.loading&&!text&&<p role="status"><UiMessage id="dossieractivity.loading_text"/></p>}{failed&&!state.loading&&<ReaderRetry message={ui.t("app.text_temporarily_unavailable")} language={lang} retry={state.retry} retryAt={retryAt}/>}
    {text&&<DocumentPages documentId={sourceId} language={text.textLanguage||requestedLanguage}/>}{(text?.status==='available') ? <ReferenceScope texts={readerTexts(body.paragraphs,notes,documentLinks)} notes={notes} notePrefix={notePrefix} language={lang} textLanguage={text.textLanguage} renderQuestion={question=><PublicationText sourceId={question} member={member} lang={lang} heading={ui.t("batch6.references.referenced.question.112")} includeAnswers showDownloads={showDownloads}/>}><div className="explorer-transcript" lang={text.textLanguage||""}><DocumentParagraphs texts={body.paragraphs} start={body.start} formatting={usableFormatting(text,text.paragraphs.length)} exactOffsets={body.exact} renderText={(source,paragraph,from,to,final,marks)=><DocumentObjectText logo={logo} text={paragraph} paragraph={source} from={from} to={to} final={final} marks={marks} objects={text.documentObjects||[]} assets={text.imageAssets} sourceUrl={text.sourceUrl} anchors={anchors.filter(anchor=>anchor.paragraph===source)} links={clipLinks(documentLinks.filter(link=>link.paragraph===source),from,to)} notePrefix={notePrefix} renderText={(a,b,last)=><AuthorMention text={paragraph.slice(a,b)} offset={a} final={last} authors={state.data?.coAuthors} lang={lang} anchors={anchors.filter(anchor=>anchor.paragraph===source)} links={clipLinks(documentLinks.filter(link=>link.paragraph===source),a,b)} marks={marks} notePrefix={notePrefix}/>}/>}/><DocumentNotes assets={text.imageAssets} notes={notes} prefix={notePrefix}/></div></ReferenceScope> : (text&&!failed&&<p><UiMessage id="batch5.dossiervotetext.tsx.24.50"/></p>)}
    {text&&<>{!sourceId.endsWith('-ASW')&&<CoAuthors authors={state.data?.coAuthors} lang={lang} member={member}/>}{showDownloads&&!questionDocument&&<details className="explorer-reader-download"><summary><UiMessage id="app.document_download"/></summary>{body.header.map((paragraph,index)=><p lang={text.textLanguage||""} key={index}><AuthorMention text={paragraph} authors={state.data?.coAuthors} lang={lang}/></p>)}<PublicationFiles files={files} lang={text.textLanguage||lang}/></details>}</>}
    {includeAnswers&&state.data?.answers.map(answer=><PublicationText key={answer.id} sourceId={answer.id} member={member} lang={lang} heading={answer.date ? ui.t("batch4.questiontopics.tsx.answer.date", {date: String(date(answer.date,lang))}) : ui.t("textsearch.answer")} headingDate={answer.date} showDownloads={showDownloads}/>)}
    {includeAnswers&&state.data&&!failed&&!state.loading&&!state.data.answers.length&&<p><UiMessage id="app.no_answer_published"/></p>}
  </section>;
}
function JoinedDetails({ item, lang, member, memberName, motionQuery, onMotionChange, showDownloads = true }: { item: JoinedActivity; lang: string; member: number; memberName?:string; motionQuery:URLSearchParams; onMotionChange:MemberMotionReaderProps['onJourneyChange']; showDownloads?:boolean }) {
  const ui = useUiI18n();
  const hasText=item.category==='written-questions' || item.category==='oral-questions' || item.recordKind==='answer';
  const motion=/^(?:B|RC)-10-\d{4}-\d{4,6}$/.test(item.sourceId);
  const [documentOpen,setDocumentOpen]=useDossierReaderState('activity-document:'+item.sourceId,false);
  const document=useData<PublicationDocument>((((item.recordKind!=='speech') && (!hasText)) && (!motion||documentOpen)) ? (`document/${item.sourceId}?member=${member}&lang=${lang}`) : null);
  const roles: Record<string,string> = {AUTHOR:ui.t("insightshared.author"),QUESTION_AUTHOR:ui.t("app.author_of_the_question"),RAPPORTEUR:ui.t("insightshared.rapporteur"),RAPPORTEUR_SHADOW:ui.t("insightshared.shadow_rapporteur"),RAPPORTEUR_OPINION:ui.t("insightshared.opinion_rapporteur"),RAPPORTEUR_SHADOW_OPINION:ui.t("insightshared.shadow_opinion_rapporteur"),SPEAKER:ui.t("app.plenary_contribution")};
  const stage=(item.provenance.stage==='RDG1') ? interfaceTerm('first-reading',lang) : ((item.provenance.stage==='RDG2') ? interfaceTerm('second-reading',lang) : ({text:item.provenance.stage,language:''}));
  if (item.recordKind === "speech") return <><ActivityDossierLinks procedureIds={item.procedureIds} person={member} language={lang}/><Detail speech={{id:item.sourceId,date:item.date,start:item.start || null,end:item.end || null,titles:item.titles || {},kind:item.speechKind || "PLENARY_DEBATE_SPEECH",reference:item.reference,originalLanguages:item.originalLanguages || [],participants:[],websiteUrl:item.websiteUrl || null,websiteLanguage:item.websiteLanguage || null}} lang={lang} /></>;
  return <div className="explorer-speech-detail" lang={lang} data-reader-pending={document.loading ? "true" : undefined}>
    <ActivityDossierLinks procedureIds={item.procedureIds} person={member} language={lang}/>
    {!hasText&&<p lang={ui.language}><strong lang={roles[item.provenance.role] ? ui.language : ""}>{(item.relatedJointMotions?.length && (item.provenance.role==="AUTHOR")) ? ui.t("app.author_of_the_original_motion") : (roles[item.provenance.role] || item.provenance.role)}</strong>{item.provenance.stage ? <> · <span lang={stage.language}>{stage.text}</span></> : ""}</p>}
    {!hasText&&<span lang={ui.language}><AmendmentTrailLink document={item.sourceId} language={lang}><UiMessage id="app.amendments_to_this_document"/></AmendmentTrailLink></span>}
    <MotionOutcome outcome={item.resolutionOutcome} related={item.relatedJointMotions} reference={item.reference} sourceId={item.sourceId} language={lang} memberId={member} memberName={memberName}/>
    {motion&&<Suspense fallback={<p data-motion-pending="true" role="status" lang={ui.language}><UiMessage id="app.loading_motion_reader"/></p>}>
      <MemberMotionReader activity={item} memberId={member} memberName={memberName} language={lang} query={motionQuery} onJourneyChange={onMotionChange}/>
    </Suspense>}
    {(item.category==='written-questions' || item.category==='oral-questions' || item.recordKind==='answer') && <>
      {item.recordKind!=='answer'&&<SaveButton language={lang} item={{kind:'question',id:item.sourceId,title:item.title,titleLanguage:item.titleLanguage,memberId:String(member),date:item.date,baseline:item.answerIds ? ({answerIds:item.answerIds}) : undefined}}/>}
      <PublicationText sourceId={item.sourceId} member={member} lang={lang} heading={(item.recordKind==='answer') ? ui.t("textsearch.answer") : ui.t("textsearch.question")} includeAnswers={item.recordKind!=='answer'} question={((item.recordKind==='answer') && item.relatedQuestionId) ? ({id:item.relatedQuestionId,title:item.relatedQuestionTitle}) : undefined} showDownloads={showDownloads} />
      {item.recordKind==='answer' && item.relatedQuestionId && <PublicationText sourceId={item.relatedQuestionId} member={member} lang={lang} heading={ui.t("app.linked_question")} showDownloads={showDownloads} />}
    </>}
    {!hasText && (motion ? <details className="explorer-reader-download" lang={ui.language} onToggle={event=>setDocumentOpen(event.currentTarget.open)}><summary>{item.relatedJointMotions?.length ? <UiMessage id="app.original_motion_document_and_authors"/> : <UiMessage id="app.document_and_authors"/>}</summary>
      {document.loading&&<p role="status"><UiMessage id="app.loading_document_details"/></p>}
      {document.error&&<ErrorView message={document.error} retry={document.retry}/>}
      <CoAuthors authors={document.data?.coAuthors} lang={lang} member={member}/>
      <PublicationFiles files={item.files} lang={lang}/>
    </details> : <section lang={ui.language} aria-label={item.relatedJointMotions?.length ? ui.t("app.original_motion_document") : ui.t("dossierCard.event.1")}>
      {!!item.relatedJointMotions?.length && <h3><UiMessage id="app.original_motion_document"/></h3>}
      <CoAuthors authors={document.data?.coAuthors} lang={lang} member={member}/>
      <PublicationFiles files={item.files} lang={lang}/>
    </section>)}

  </div>;
}
function LinkedActivityFallback({ sourceId, member, lang, complete, showDownloads = true }: { sourceId: string | null; member: number; lang: string; complete: boolean; showDownloads?:boolean }) {
  const ui = useUiI18n();
  const [check, setCheck] = useState(false);
  const speech=Boolean(sourceId?.startsWith("MTG-PL-"));
  const document=useData<PublicationDocument>(((check && sourceId) && (!speech)) ? (`document/${sourceId}?member=${member}&lang=${lang}`) : null);
  const contribution=useData<SpeechDetail>(((check && sourceId) && speech) ? (`speech/${sourceId}?lang=${lang}`) : null);
  const answer=document.data?.answers.find(item=>item.id===sourceId);
  const matched=answer || ((document.data?.id===sourceId) ? document.data : null);
  const authored=document.data?.roles.includes("AUTHOR");
  const speechAuthor=contribution.data?.participants.includes(String(member));
  const matchedTitle=selectLanguageText(matched?.titles,lang,matched?.id||'', '');
  return <aside className="explorer-notice" lang={ui.language}>
    <Status scope={`linked:${sourceId}:${member}:${lang}:${check}`} pending={document.loading||contribution.loading} message={(document.error||contribution.error) ? null : ((!check) ? ((!sourceId) ? ui.t("app.link_not_recognised") : (complete ? ui.t("app.not_in_this_mep_s_activity") : ui.t("app.not_loaded_yet"))) : ((document.data && (!matched)) ? ui.t("app.linked_item_unavailable") : ((matched||contribution.data) ? ui.t("app.linked_item_loaded") : null)))}/>
    <strong><UiMessage id="app.linkedActivity" values={{identifier: <span lang={sourceId ? "" : ui.language}>{sourceId || ui.t("app.identifier_not_recognised")}</span>}}/></strong>
    <p>{(!sourceId) ? ui.t("app.link_not_recognised") : (complete ? ui.t("app.not_in_this_mep_s_activity") : ui.t("app.not_loaded_yet"))}</p>
    {sourceId && !check && <button onClick={() => setCheck(true)}><UiMessage id="app.look_it_up"/></button>}
    {(document.loading || contribution.loading) && <p role="status"><UiMessage id="insightshared.loading"/></p>}
    {document.error && <ErrorView message={document.error} retry={document.retry} />}
    {contribution.error && <ErrorView message={contribution.error} retry={contribution.retry} />}
    {matched && <>
      <h3 lang={matchedTitle.language}>{matchedTitle.text}</h3>
      {matched.date && <p><span lang={lang}>{date(matched.date,lang)}</span>{answer ? (' · '+ui.t('textsearch.answer')) : ""}</p>}
      {(answer && authored) ? <p><UiMessage id="app.answer_to_this_mep_s_question"/></p> : (document.data!.roles.length ? <p><UiMessage id="app.linkedRoles" values={{roles: <span lang="">{document.data!.roles.join(", ")}</span>}}/></p> : <p><UiMessage id="app.not_linked_to_this_mep"/></p>)}
      <PublicationText sourceId={sourceId!} member={member} lang={lang} heading={answer ? ui.t("textsearch.answer") : (/^[EPO]-/.test(sourceId!) ? ui.t("textsearch.question") : ui.t("batch6.documentcontextreader.document.text.37"))} includeAnswers={!answer && /^[EPO]-/.test(sourceId!)} showDownloads={showDownloads} />
      {answer && document.data!.id!==sourceId && <PublicationText sourceId={document.data!.id} member={member} lang={lang} heading={ui.t("app.linked_question")} showDownloads={showDownloads} />}
      {showDownloads&&<PublicationFiles files={matched.files} lang={lang} />}
    </>}
    {document.data && !matched && <p><UiMessage id="app.linked_item_unavailable"/></p>}
    {contribution.data && <>{!speechAuthor&&<p><UiMessage id="app.not_linked_to_this_mep"/></p>}<Detail speech={contribution.data} lang={lang} /></>}
  </aside>;
}
export function FollowingActivityDetail({member,sourceId,lang,profileHref,onOpenProfile}:{member:number|string;sourceId:string;lang:string;profileHref:string;onOpenProfile:()=>void}) {
  const ui = useUiI18n();
  const state=useData<JoinedActivityPage>(`latest-activities/${member}?lang=${lang}&limit=1&source-id=${encodeURIComponent(sourceId)}`);
  const selected=state.data?.selectedItems.find(item=>item.sourceId===sourceId);
  const showDownloads=!/^[EPHO]-10-\d{4}-\d{6}(?:-ASW)?$/.test(sourceId);
  const scope=JSON.stringify([member,sourceId,lang]);
  const [motion,setMotion]=useState(()=>({scope,query:new URLSearchParams()}));
  const motionQuery=(motion.scope===scope) ? motion.query : (new URLSearchParams());
  const onMotionChange:MemberMotionReaderProps['onJourneyChange']=(binding,next)=>{
    const query=motionJourneyParams(binding,next, ui);query.set('member',String(member));
    setMotion({scope,query});
  };
  return <section lang={ui.language}>
    <Status scope={`following-detail:${scope}`} pending={state.loading} message={state.error ? ui.t("app.activity_temporarily_unavailable") : (selected ? ui.t("app.activity_loaded") : (state.data ? ui.t("app.this_activity_is_unavailable") : null))}/>
    {state.loading&&!selected&&<p role="status"><UiMessage id="insightshared.loading"/></p>}
    {state.error&&<ErrorView message={state.error} retry={state.retry}/>}
    {selected ? <JoinedDetails key={`${scope}:${selected.id}`} item={selected} member={Number(member)} lang={lang} motionQuery={motionQuery} onMotionChange={onMotionChange} showDownloads={showDownloads}/> : (!state.loading&&state.data&&<LinkedActivityFallback key={scope} sourceId={sourceId} member={Number(member)} lang={lang} complete={state.data.cache.complete} showDownloads={showDownloads}/>)}
    {!selected&&!state.loading&&<p><a href={profileHref} onClick={event=>{
      if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      event.preventDefault();onOpenProfile();
    }}><UiMessage id="app.open_in_profile"/></a></p>}
  </section>;
}
function Activities({ id, lang, memberName, initialActivity, onOpen, category, onCategory, offset, onOffset, motionQuery, onMotionChange, preserveScroll }: { id: number; lang: string; memberName?:string; initialActivity: string | null; onOpen: (id: string | null,options?:{replace?:boolean}) => void; category: string; onCategory: (category: string) => void; offset:number; onOffset:(offset:number)=>void; motionQuery:URLSearchParams; onMotionChange:MemberMotionReaderProps['onJourneyChange']; preserveScroll:boolean }) {
  const ui = useUiI18n();
  const [categoriesOpen,setCategoriesOpen]=useState(false);
  const resultsHeading=useRef<HTMLHeadingElement>(null);
  const moveToResults=useRef(false);
  const lastPage=useRef<{member:number;data:JoinedActivityPage} | null>(null);
  const revealed=useRef<string|null>(null);
  const open=initialActivity;
  const sourceId=activitySourceId(open);
  const c=interfaceCopy(lang);
  const state=useData<JoinedActivityPage>(`latest-activities/${id}?lang=${lang}&limit=10&offset=${offset}${category ? (`&category=${encodeURIComponent(category)}`) : ""}`);
  if(state.data)lastPage.current={member:id,data:state.data};
  const page=state.data || ((lastPage.current?.member===id) ? lastPage.current.data : null);
  const visibleSelection = state.data?.items.some(item => item.sourceId === sourceId);
  const pinned=useData<JoinedActivityPage>(((sourceId && state.data) && (!visibleSelection)) ? (`latest-activities/${id}?lang=${lang}&limit=10&source-id=${encodeURIComponent(sourceId)}`) : null);
  const selectedItems = pinned.data?.selectedItems || [];
  const items=state.data ? ([...selectedItems.filter(selected=>!state.data!.items.some(item=>item.id===selected.id)),...state.data.items]) : ([]);
  const isOpen=(item:JoinedActivity)=>open===`${item.category}:${item.sourceId}` || sourceId===item.sourceId && !open?.includes(":");
  useEffect(()=>{
    if(open && !open.includes(":") && selectedItems.length===1){
      const selected=selectedItems[0];onOpen(`${selected.category}:${selected.sourceId}`,{replace:true});
    }
  },[open,pinned.data,onOpen]);
  useEffect(()=>{
    if(!open){revealed.current=null;return;}
    const selected=items.find(isOpen);
    if(!selected)return;
    const key=String(id)+':'+selected.id;
    if(revealed.current===key)return;
    revealed.current=key;
    if(!preserveScroll)document.getElementById(`publication-${selected.id}`)?.scrollIntoView({block:"nearest"});
  },[id,open,state.data,pinned.data,preserveScroll]);
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
  const choose=(value:string)=>{moveToResults.current=true;setCategoriesOpen(false);onCategory(value);onOffset(0);onOpen(null);};
  const coverage=category ? page?.categoryCoverage[category] : null;
  const selectedLabel=category ? (page?.categories[category] || category) : ui.t("app.all_activities");
  return <section className="explorer-activities" lang={ui.language} data-activities-pending={(state.loading&&!state.data||open&&pinned.loading&&!items.some(isOpen)) ? 'true' : undefined}>
    <div className="explorer-section-title"><h2 lang={lang}>{c.activities}</h2>
    <TextSearch prefix="mep-activity-fts" label={ui.t("app.search_this_mep_s_text")} language={lang} member={id} kinds={['speech','question','answer']} from="2024-07-16"/></div>
    {page && <>
      <div className="explorer-category-selection">
        <button aria-expanded={categoriesOpen} aria-controls="activity-categories" onClick={()=>setCategoriesOpen(value=>!value)}>{categoriesOpen ? <UiMessage id="app.close_categories"/> : <UiMessage id="app.change_category"/>}</button>
      </div>
      {categoriesOpen && <nav id="activity-categories" className="explorer-category-groups" aria-label={ui.t("app.parliamentary_activity_categories")}>
        <button className={(!category) ? "selected" : ""} aria-pressed={!category} onClick={()=>choose("")}><UiMessage id="app.all_activities"/></button>
        {page.categoryGroups.map(group=><section key={group.label}><h3>{group.label}</h3>{group.categories.map(key=>{
          const status=page.categoryCoverage[key];
          const count=(status.status === "source-not-verified") ? ui.t("grouplabels.ts.unavailable") : (`${status.indexedCount}`);
          return <button key={key} className={(category===key) ? "selected" : ""} aria-pressed={category===key} onClick={()=>choose(key)}><span>{page.categories[key]}</span><small>{count}</small></button>;
        })}</section>)}
      </nav>}
    </>}
    <h3 ref={resultsHeading} tabIndex={-1} className="explorer-activity-results-title">{selectedLabel}{(state.data && (coverage?.status!=="source-not-verified")) ? (` · ${state.data.indexedTotal}`) : ""}</h3>
    {page&&coverage?.status!=='source-not-verified'&&<AvailabilityNote showGaps={false} sources={page.availability} language={lang}/>}
    {state.loading && !state.data && <p role="status"><UiMessage id="insightshared.loading"/></p>}
    {state.error && <ErrorView message={state.error} retry={state.retry} />}
    {page && <>
      {coverage?.status === "source-not-verified" && <div className="explorer-notice"><strong><UiMessage id="grouplabels.ts.unavailable"/></strong><p>{coverage.reason}</p></div>}
      {coverage?.status === "incomplete-joins" && <p className="explorer-notice">{coverage.reason} </p>}
      {!state.loading && state.data && !state.data.items.length && coverage?.status !== "source-not-verified" && <p><UiMessage id="app.no_activities_in_this_selection"/></p>}
      {open && pinned.loading && !items.some(isOpen) && <p role="status"><UiMessage id="insightshared.loading"/></p>}
      {open && pinned.error && <ErrorView message={pinned.error} retry={pinned.retry} />}
      {open && state.data && !pinned.loading && !items.some(isOpen) && <LinkedActivityFallback key={sourceId} sourceId={sourceId} member={id} lang={lang} complete={page.cache.complete} />}
      <TopicBatch ids={items.map(item=>item.sourceId)} language={lang}>{items.map(item=>{
        const key=`${item.category}:${item.sourceId}`;
        return <article className="explorer-speech" id={`publication-${item.id}`} key={key}><RecordTopics id={item.sourceId}/>
          <button className="explorer-speech-toggle" aria-expanded={isOpen(item)} onClick={()=>{const next=isOpen(item) ? null : key;onOpen(next);}}><span><small><span><>{((item.recordKind === "answer") ? ui.t("textsearch.answer") : ((item.category === "written-questions") ? ui.t("batch4.questiontopics.tsx.written.question") : ((item.category === "oral-questions") ? ui.t("batch4.questiontopics.tsx.oral.question") : item.categoryLabel)))} · {<time lang={lang} dateTime={item.date}>{date(item.date,lang)}</time>}</></span></small><strong lang={item.titleLanguage||""}><OfficialTitle title={item.title} language={item.titleLanguage}/></strong>{item.recordKind!=="answer"&&item.answerStatus&&<QuestionStatus answered={item.answerStatus==="answered"}/>} {item.resolutionOutcome&&<MotionStatuses outcome={item.resolutionOutcome} related={item.relatedJointMotions} sourceId={item.sourceId}/>}</span><b aria-hidden="true">{isOpen(item) ? "−" : "+"}</b></button>

          {!isOpen(item)&&item.provenance.role.startsWith('RAPPORTEUR')&&<ActivityDossierLinks procedureIds={item.procedureIds} person={id} language={lang}/>}
          {isOpen(item) && <JoinedDetails item={item} lang={lang} member={id} memberName={memberName} motionQuery={motionQuery} onMotionChange={onMotionChange} />}
        </article>;
      })}</TopicBatch>
      {state.data && <div className="explorer-category-top">{offset>0 && <button onClick={()=>{moveToResults.current=true;onOffset(Math.max(0,offset-10));onOpen(null);}}><UiMessage id="textsearch.previous"/></button>}{state.data.nextOffset!==null && <button onClick={()=>{moveToResults.current=true;onOffset(state.data!.nextOffset!);onOpen(null);}}><UiMessage id="app.next_10"/></button>}<button onClick={state.retry}><UiMessage id="app.refresh_list"/></button></div>}
      {page.cache.lastSuccessfulRefresh&&<p className="explorer-source-join"><UiMessage id="outsidevoices.updated_tolocaledatestring.62ed42" values={{date:<span lang={lang}>{date(page.cache.lastSuccessfulRefresh,lang)}</span>}}/></p>}
    </>}
    {open && state.error && !state.data && <LinkedActivityFallback key={sourceId} sourceId={sourceId} member={id} lang={lang} complete={false} />}
  </section>;
}
function speechSummary(item: JoinedActivity): Speech {
  return {id:item.sourceId,date:item.date,start:item.start || null,end:item.end || null,titles:item.titles || {},kind:item.speechKind || "PLENARY_DEBATE_SPEECH",reference:item.reference,originalLanguages:item.originalLanguages || [],participants:[],websiteUrl:item.websiteUrl || null,websiteLanguage:item.websiteLanguage || null};
}
function revealSpeech(target: HTMLElement) {
  const panel=target.closest<HTMLElement>('.explorer-profile-body');
  const scroller=(panel && /^(auto|scroll)$/.test(getComputedStyle(panel).overflowY)) ? panel : target.closest<HTMLElement>('.explorer');
  if(!scroller)return;
  // scrollIntoView also scrolls the hidden-overflow desktop shell, lifting its footer.
  const margin=Number.parseFloat(getComputedStyle(target).scrollMarginTop)||0;
  const top=scroller.scrollTop+target.getBoundingClientRect().top-scroller.getBoundingClientRect().top-scroller.clientTop-margin;
  scroller.scrollTo({top});
}
function Speeches({ id, lang, initialSpeech, onOpen }: { id:number;lang:string;initialSpeech:string|null;onOpen:(id:string|null)=>void }) {
  const ui = useUiI18n();
  const c=interfaceCopy(lang);
  const calendar=useData<VotePeriodsResponse>('vote-periods');
  const sittingLocations=new Map(validateVotePeriods(calendar.data) ? calendar.data.weeks.flatMap(week=>week.sittings.map(sitting=>[sitting.sittingId,sitting.location] as const)) : []);
  const [offset,setOffset]=useState(0),[speechLanguage,setSpeechLanguage]=useState<string|null>(null);
  const [enrichedSpeeches,setEnrichedSpeeches]=useState<Speech[]>([]);
  const [speechSearchActive,setSpeechSearchActive]=useState(false);
  const [speechSearchReset,setSpeechSearchReset]=useState(0);
  const [statisticsStatus,setStatisticsStatus]=useState<'loading'|'ready'|'unavailable'>('loading');
  const speechSearchInput=useRef<HTMLInputElement>(null);
  const resetSpeechSearch=useRef<(()=>void)|null>(null);
  const [,setSpeechSearch]=useExplorerParam<string>('mep-speech-fts-search','');
  const [,setSpeechSearchRead]=useExplorerParam<string>('mep-speech-fts-read','');
  const [category,setCategory]=useExplorerParam<string>('mep-speech-category','',speechCategoriesUi(ui).map(([key])=>key));
  const [categoryOffset,setCategoryOffset]=useState(0);
  const filtered=category ? enrichedSpeeches.filter(speech=>matchesSpeechCategory(speech,category as SpeechCategory)) : null;
  const lastCategoryOffset=Math.max(0,Math.ceil((filtered?.length||0)/10)-1)*10;
  const filteredOffset=Math.min(categoryOffset,lastCategoryOffset);
  const filterHeading=useRef<HTMLHeadingElement>(null),revealFilter=useRef(false);
  const filterHref=(value:SpeechCategory)=>{const url=new URL(location.href);url.searchParams.set('mep-speech-category',value);url.searchParams.delete('speech');url.hash='speech-filter-results-'+id;return url.href;};
  const selectCategory=(value:SpeechCategory)=>{revealFilter.current=true;filterHeading.current?.focus({preventScroll:true});if(filterHeading.current)revealSpeech(filterHeading.current);setCategoryOffset(0);setCategory(value);setSpeechLanguage(null);onOpen(null);};
  useEffect(()=>{setCategoryOffset(0);},[category]);
  useEffect(()=>{setCategoryOffset(value=>Math.min(value,lastCategoryOffset));},[lastCategoryOffset]);
  useEffect(()=>{if(!category||!initialSpeech)return;const index=enrichedSpeeches.filter(speech=>matchesSpeechCategory(speech,category as SpeechCategory)).findIndex(speech=>speech.id===initialSpeech);if(index>=0)setCategoryOffset(Math.floor(index/10)*10);},[category,initialSpeech,enrichedSpeeches]);
  useEffect(()=>{if(revealFilter.current){revealFilter.current=false;filterHeading.current?.focus({preventScroll:true});if(filterHeading.current)revealSpeech(filterHeading.current);}},[category,categoryOffset]);
  const focusedSpeech=useRef<string|null>(null);
  const resultsHeading=useRef<HTMLHeadingElement>(null);
  const speechOrigin=useRef<{key:string;owner:Element|null}|null>(null);
  useLayoutEffect(()=>{
    const intent=initialSpeech ? ({key:id+':'+initialSpeech,owner:document.activeElement}) : null;
    speechOrigin.current=intent;
    const cancel=(event:FocusEvent)=>{if(event.target!==speechOrigin.current?.owner)speechOrigin.current=null;};
    document.addEventListener('focusin',cancel);
    return()=>{document.removeEventListener('focusin',cancel);speechOrigin.current=null;};
  },[id,initialSpeech]);
  const state=useData<JoinedActivityPage>(`latest-activities/${id}?lang=${lang}&limit=10&offset=${offset}&category=plenary-contributions`);
  const pinned=useData<JoinedActivityPage>(((initialSpeech && state.data) && (!state.data.items.some(item=>item.sourceId===initialSpeech))) ? (`latest-activities/${id}?lang=${lang}&limit=10&category=plenary-contributions&source-id=${encodeURIComponent(initialSpeech)}`) : null);
  useEffect(()=>{setOffset(0);setSpeechLanguage(null);},[id,lang]);
  useEffect(()=>{setEnrichedSpeeches([]);},[id]);
  const items=state.data ? [...(pinned.data?.selectedItems || []).filter(item=>!state.data!.items.some(row=>row.id===item.id)),...state.data.items].filter(item=>item.recordKind==='speech') : ([]);
  const changePage=(next:number)=>{
    const heading=resultsHeading.current;
    heading?.focus({preventScroll:true});
    const body=heading?.closest('.explorer-profile-body');
    // Reuse the activity list's local results-reveal convention.
    if(body&&body.scrollHeight>body.clientHeight)body.scrollTo({top:0});else heading?.scrollIntoView({block:'start'});
    setOffset(next);onOpen(null);
  };
  useEffect(()=>{if(!initialSpeech){focusedSpeech.current=null;return;}if(speechSearchActive)return;const key=id+':'+initialSpeech;if(focusedSpeech.current===key)return;const target=document.getElementById('speech-'+initialSpeech);if(!target)return;const origin=speechOrigin.current,active=document.activeElement;if(origin?.key===key&&(active===origin.owner||active===document.body&&!origin.owner?.isConnected)){revealSpeech(target);target.querySelector<HTMLButtonElement>('.explorer-speech-toggle')?.focus({preventScroll:true});}focusedSpeech.current=key;},[id,initialSpeech,state.data,pinned.data,enrichedSpeeches,category,categoryOffset,speechSearchActive,speechSearchReset]);
  return <section lang={lang}>
    <div className="explorer-section-title"><h2 lang={lang} ref={resultsHeading} id={'speech-results-'+id} tabIndex={-1}>{c.speeches}</h2></div>
    <InterventionStatistics key={'statistics:'+id} member={id} onItems={setEnrichedSpeeches} onStatus={setStatisticsStatus} filter={{selected:category,href:filterHref,select:selectCategory}}/>
    <SpeechCloud key={'cloud:'+id} member={id} interfaceLanguage={lang} onSpeech={(speech,language)=>{focusedSpeech.current=null;speechOrigin.current={key:id+':'+speech,owner:document.activeElement};resetSpeechSearch.current?.();setSpeechSearchReset(value=>value+1);setSpeechSearch('');setSpeechSearchRead('');setCategory('');setSpeechLanguage(language);onOpen(speech);}}/>
    {filtered&&<div className="explorer-section-title" lang={ui.language}><h3 ref={filterHeading} id={'speech-filter-results-'+id} tabIndex={-1}><UiMessage id="app.filteredSpeechCount" values={{category: speechCategoriesUi(ui).find(([key])=>key===category)?.[1], count: filtered.length}}/></h3>{speechSearchActive&&<button onClick={()=>{speechSearchInput.current?.focus({preventScroll:true});setCategory('');}}><UiMessage id="app.clear_category"/></button>}</div>}
    <TextSearch key={'search:'+id} inline inputRef={speechSearchInput} resetRef={resetSpeechSearch} prefix="mep-speech-fts" label={ui.t("app.search_this_mep_s_speeches")} language={lang} member={id} kinds={['speech']} from="2024-07-16" sourceIds={filtered?.map(speech=>speech.id)} disabledReason={(category && (statisticsStatus!=='ready')) ? ((statisticsStatus==='loading') ? ui.t("app.loading_category") : ui.t("app.category_unavailable")) : undefined} onActiveChange={setSpeechSearchActive} summary={<>{state.data ? <UiMessage id="app.termContributions" values={{count: state.data.indexedTotal}} counts={{count: state.data.indexedTotal}}/> : <UiMessage id="batch4.speechinterventions.tsx.term.10"/>}</>}/>
    {!speechSearchActive&&<>
    {!filtered&&state.loading && !state.data && <p role="status" lang={ui.language}><UiMessage id="app.loading_speeches"/></p>}
    {!filtered&&state.error && <ErrorView message={state.error} retry={state.retry} />}
    {(filtered && (!filtered.length)) ? <p className="explorer-notice" lang={ui.language}>{(statisticsStatus==='loading') ? ui.t("app.loading_contributions") : ((statisticsStatus==='unavailable') ? ui.t("app.contributions_unavailable") : ui.t("app.no_matching_contributions"))}</p> : (!filtered&&state.data && !items.length && <p className="explorer-notice" lang={ui.language}>{state.data.cache.complete ? <UiMessage id="app.no_plenary_contributions"/> : <UiMessage id="app.no_plenary_contributions_loaded_yet"/>}</p>)}
    {!filtered&&initialSpeech && pinned.loading && <p role="status" lang={ui.language}><UiMessage id="insightshared.loading"/></p>}
    {!filtered&&initialSpeech && pinned.error && <ErrorView message={pinned.error} retry={pinned.retry} />}
    {!filtered&&initialSpeech && state.data && !pinned.loading && !items.some(item=>item.sourceId===initialSpeech) && <LinkedActivityFallback key={initialSpeech} sourceId={initialSpeech} member={id} lang={lang} complete={state.data.cache.complete} />}
    <TopicBatch language={lang} ids={filtered ? filtered.slice(filteredOffset,filteredOffset+10).map(s=>s.id) : items.map(i=>i.sourceId)}>{(filtered ? filtered.slice(filteredOffset,filteredOffset+10) : items.map(item=>{const base=speechSummary(item),enriched=enrichedSpeeches.find(row=>row.id===item.sourceId);return {...base,...enriched,titles:{...base.titles,...enriched?.titles}};})).map(speech=>{const open=initialSpeech===speech.id,speechTitle=title(speech,lang, ui),city=(speech.id.startsWith('MTG-PL-'+speech.date+'-') ? sittingLocations.get('MTG-PL-'+speech.date) : null);return <article className="explorer-speech" key={speech.id} id={`speech-${speech.id}`}><RecordTopics id={speech.id}/>
      <button className="explorer-speech-toggle" lang={ui.language} onClick={()=>{setSpeechLanguage(null);onOpen(open ? null : speech.id);}} aria-expanded={open}><span><span lang={lang}>{date(speech.date,lang)}</span> · {(speech.kind==='PLENARY_DEBATE_WRITTEN_STATEMENT') ? ui.t("insightshared.written_statement") : ui.t("app.plenary_speech")}{speech.start ? <> · <span lang={lang}>{time(speech.start,lang)}</span></> : ''}{city&&<> · <span lang="en">{city}</span></>}</span><span className="explorer-speech-heading"><strong lang={speechTitle.language}>{speechTitle.text}</strong><b aria-hidden="true">{open ? '−' : '+'}</b></span></button>
      {!open&&<div className="explorer-speech-list-badges"><InterventionBadges value={speech.intervention} language={lang}/></div>}
      {open && <Detail speech={speech} lang={lang} transcriptLanguage={speechLanguage||lang} />}
    </article>})}</TopicBatch>
    {filtered ? <div className="explorer-category-top" lang={ui.language}>{filteredOffset>0&&<button onClick={()=>{revealFilter.current=true;setCategoryOffset(Math.max(0,filteredOffset-10));onOpen(null);}}><UiMessage id="app.newer"/></button>}{filteredOffset+10<filtered.length&&<button onClick={()=>{revealFilter.current=true;setCategoryOffset(filteredOffset+10);onOpen(null);}}><UiMessage id="app.older"/></button>}<button onClick={()=>{setCategory('');setCategoryOffset(0);changePage(0);}}><UiMessage id="app.clear_filter"/></button></div> : (state.data && <div className="explorer-category-top" lang={ui.language}>{offset>0 && <button onClick={()=>changePage(Math.max(0,offset-10))}><UiMessage id="app.newer"/></button>}{state.data.nextOffset!==null && <button onClick={()=>changePage(state.data!.nextOffset!)}><UiMessage id="app.older"/></button>}<button onClick={()=>{state.retry();calendar.retry();}}><UiMessage id="app.refresh_list"/></button></div>)}
    </>}
  </section>;
}
export default function App() {
  useDossierJourney();
  const [initial] = useState(() => new URLSearchParams(location.search));
  const [restoration,setRestoration]=useState(0);
  const [plenaryMode]=useExplorerParam<PlenaryMode>('pl-mode','agenda',plenaryModes);
  const [lang, setLang] = useState(() => queryLanguage(initial));
  const ui = uiForLocale(lang);
  usePlenaryUiLanguage(lang);
  const [member, setMember] = useState<number | null>(
    /^\d+$/.test(initial.get("member") || "") ? Number(initial.get("member")) : null,
  );
  const [organization,setOrganization]=useState(()=>organizationId(initial.get('organization')));
  const [organizationName,setOrganizationName]=useState(()=>initial.get('organization-name')?.slice(0,512)||'');
  const [committee, setCommittee] = useState(initial.get("committee") || "");
  const [role, setRole] = useState(() => queryRole(initial));
  const [country, setCountry] = useState(initial.get("view") ? "" : filterCountry(initial.get("country")));
  const [group, setGroup] = useState(initial.get("group") || "");
  const [search, setSearch] = useState("");
  const [speechLink, setSpeechLink] = useState(initial.get("speech"));
  const [activityLink, setActivityLink] = useState(initial.get("activity"));
  const [activityCategory, setActivityCategory] = useState(initial.get("activity-category") || "");
  const [activityOffset,setActivityOffset]=useState(()=>queryActivityOffset(initial));
  const [view, setView] = useState<'legislation'|'questions'|'topics'|'outside'|'amendments'|'groups'|'saved'|null>(
    publicExplorerView(initial.get('view')),
  );
  const [tab, setTab] = useState(
    publicMemberModule(initial.get('module')),
  );
  const votes=useMemberVotesJourney(member,!view&&Boolean(member)&&tab==='votes',initial);
  const motions=useMemberMotionJourney(member,!view&&Boolean(member)&&tab==='activities',initial,{language:lang,activity:activityLink,category:activityCategory,offset:activityOffset});
  const memberOpener=useRef<number|null>(null);
  const viewOpener=useRef<{node:HTMLElement|null;headerIndex:number}|null>(null);
  // Member and Votes tab navigation add one entry through the URL effect.
  const memberStep=useRef(false);
  const pendingDestination=useRef<{view:typeof view;member:number|null;portrait?:number|null;opener?:{node:HTMLElement|null;headerIndex:number}|null}|null>(null);
  const directoryState=useData<Directory>((view==='outside'||view==='groups') ? null : "directory");
  const directory = directoryState.data;
  const coverageFollows=useSaved().items;
  useEffect(()=>{coverageStore.observe(directory,coverageFollows,Boolean(directoryState.error));},[directory,directoryState.error,coverageFollows]);
  const followed=useSaved().items.find(item=>item.kind==='mep'&&item.id===String(member));
  const outsideRoster=Boolean(member&&directory&&!directoryState.error&&!directory.members.some(item=>item.id===member));
  const error = directoryState.error;
  const profile = useData<MemberProfile>((((!view) && member) && (tab === "profile")) ? (`profile/${member}`) : null);
  const c = interfaceCopy(lang);
  useSavedChecks(lang,view==='saved');
  const label = (key: string, fallback: string) => interfaceLabel(lang,key,fallback);
  useLayoutEffect(() => {
    const page=document.querySelector<HTMLElement>(".explorer"),tabs=page?.querySelector<HTMLElement>(".explorer-tabs");
    if(!page||!tabs)return;
    const measure=()=>page.style.setProperty("--explorer-tabs-height",`${tabs.getBoundingClientRect().height}px`);
    measure();
    const observer=new ResizeObserver(measure);observer.observe(tabs);
    return ()=>{observer.disconnect();page.style.removeProperty("--explorer-tabs-height");};
  }, [member, view, lang]);
  // The member wall stays mounted (hidden) behind member pages and Following,
  // so returning keeps its portraits; restore where the reader left it.
  const wallVisible=!view&&!member;
  const wallScroll=useRef({page:0,portraits:0});
  const wallShown=useRef(wallVisible);
  useLayoutEffect(()=>{
    const returned=wallVisible&&!wallShown.current;wallShown.current=wallVisible;
    if(!returned)return;
    const page=document.querySelector<HTMLElement>(".explorer"),portraits=page?.querySelector<HTMLElement>(".explorer-portraits");
    if(portraits)portraits.scrollTop=wallScroll.current.portraits;
    if(page)page.scrollTop=wallScroll.current.page;
  },[wallVisible]);
  const scrolledView = useRef({member,tab,view});
  useEffect(() => {
    // Small screens scroll the whole explorer; start new pages at the top and new tabs at their content.
    const previous=scrolledView.current;scrolledView.current={member,tab,view};
    const page=document.querySelector<HTMLElement>(".explorer");
    if(!page||page.scrollHeight<=page.clientHeight||dossierJourneyRestoring())return;
    if(!view&&tab==='votes'&&votes.hasSavedScroll)return;
    if(!view&&tab==='activities'&&motions.hasSavedScroll)return;
    if(previous.member!==member||previous.view!==view){if(!wallVisible&&!speechLink&&!activityLink)page.scrollTo({top:0});return;}
    if(previous.tab===tab||(tab==="speeches"&&speechLink)||(tab==="activities"&&activityLink))return;
    const body=page.querySelector<HTMLElement>(".explorer-profile-body"),tabs=page.querySelector<HTMLElement>(".explorer-tabs");
    if(!body||!tabs||getComputedStyle(tabs).position!=="sticky")return;
    const contentTop=page.scrollTop+body.getBoundingClientRect().top-page.getBoundingClientRect().top-tabs.offsetHeight;
    if(page.scrollTop>contentTop)page.scrollTo({top:contentTop});
  }, [member, tab, view, speechLink, activityLink,votes.hasSavedScroll,motions.hasSavedScroll,wallVisible]);
  // Apply the destination after the existing responsive scroll policy has settled.
  function focusDestination(){
    const intent=pendingDestination.current;
    if(!intent||intent.view!==view||intent.member!==member||dossierJourneyRestoring())return;
    // Suspense can retain the previous view's hidden DOM while a chunk loads.
    if(document.querySelector('[data-view-loading]'))return;
    // Selected speech links already hand focus to the exact item once it mounts.
    if(!view&&member&&speechLink&&!intent.opener){pendingDestination.current=null;return;}
    const page=document.querySelector<HTMLElement>('main.explorer,main.explorer-insights');
    const portrait=(intent.portrait!=null) ? page?.querySelector<HTMLElement>(`[data-member-id="${intent.portrait}"] .portrait--button`) : null;
    const opener=intent.opener;
    const returned=opener?.node?.isConnected ? opener.node : ((opener && (opener.headerIndex>=0)) ? page?.querySelectorAll<HTMLElement>('.parliament-header nav button')[opener.headerIndex] : null);
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
    const settled=directory?.index.complete && directory?.committeeDetails?.complete!==false;
    const timer=window.setInterval(directoryState.retry,settled ? 60_000 : 10_000);
    return ()=>window.clearInterval(timer);
  }, [directory?.index.complete,directory?.committeeDetails?.complete,directoryState.retry]);
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
    for(const key of [...ownParams.keys()])if(key.startsWith('mv-')||key.startsWith('ma-'))ownParams.delete(key);
    if(!view&&member)for(const [key,value] of memberVotesJourneyParams(votes.journey))ownParams.set(key,value);
    u.search = new URLSearchParams({
      ...Object.fromEntries(ownParams),
      ...((lang!=='en') ? ({lang}) : ({})),
      ...(((!view) && member) ? ({ member: String(member), module: tab }) : ({})),
      ...((!view && organization) ? {organization,...(organizationName?{'organization-name':organizationName}:{})} : {}),
      ...(((!view) && committee) ? ({ committee }) : ({})),
      ...(((!view) && country) ? ({ country }) : ({})),
      ...(((!view) && group) ? ({ group }) : ({})),
      ...(((!view) && (role!=='both')) ? ({role}) : ({})),
      ...(view ? ({ view }) : ({})),
      ...((((!view) && member) && speechLink) ? ({ speech: speechLink }) : ({})),
      ...((((!view) && member) && activityLink) ? ({ activity: activityLink }) : ({})),
      ...((((!view) && member) && activityCategory) ? ({ "activity-category": activityCategory }) : ({})),
      ...((((!view) && member) && activityOffset) ? ({ "activity-offset": String(activityOffset) }) : ({})),
    }).toString();
    // Retain duplicate motion-reader fields so an invalid share cannot become a
    // valid selection merely because App rewrote its own navigation fields.
    if(!view&&member)for(const [key,value] of motions.query)if(key.startsWith('ma-'))u.searchParams.append(key,value);
    const step=memberStep.current;memberStep.current=false;
    if (u.href !== location.href) step ? history.pushState(history.state, "", u) : history.replaceState(history.state, "", u);
    window.dispatchEvent(new Event('explorer-query-change'));
    document.documentElement.lang = lang;
  }, [lang, member, tab, committee, organization, organizationName, role, country, group, view, speechLink, activityLink, activityCategory,activityOffset,votes.journey,motions.query]);
  const filtered = useMemo(
    () =>
      (organization&&directoryState.loading?[]:directory?.members)?.filter(
        (m) =>
          matchesOrganization(m,organization) &&
          matchesCountry(country,m.countryCode) &&
          (!group || group === m.groupCode) &&
          (!search ||
            normalize(m.firstName + " " + m.lastName).includes(
              normalize(search),
            )) &&
          matchesCommittee(m,committee,role),
      ).sort(compareMembers) || [],
    [directory, country, group, search, committee, role,organization,directoryState.loading],
  );
  const partialCommittee = Boolean((committee||organization) && (!directory?.index.complete||Boolean(organization&&directoryState.loading)||Boolean(organization&&directory?.members.some(m=>!organizationCoverageComplete(m,organization)))));
  const selected = directory?.members.find((m) => m.id === member);
  const titleMember = (profile.data?.id === member) ? profile.data : selected;
  const memberName = [titleMember?.firstName,titleMember?.lastName].filter(Boolean).join(' ') || followed?.title || ui.t("amendmentnamedvotes.tsx.mep.id", {id: String(member)});
  const pageTitle = (view==='legislation') ? null : (view ? {topics:ui.t("topics.topics"),questions:ui.t("textsearch.questions"),outside:ui.t("outsidevoices.outside_voices.a027e6"),groups:ui.t("groupvoices.group_voices.f21b8b"),amendments:ui.t("legislation.amendments.900866"),saved:ui.t("batch4.dossiercontrols.tsx.64.2")}[view] : (member ? ui.t("app.activityResultsCount", {category: String(memberName), count: String(((tab==='profile') ? c.profile : ((tab==='activities') ? c.activities : ((tab==='amendments') ? ui.t("legislation.amendments.900866") : ((tab==='votes') ? ui.t("dossieractivity.votes") : c.speeches)))))}) : c.title));
  const pageTitleLanguage=ui.language;
  useEffect(()=>{if(pageTitle)document.title = ui.t("legislation.pagetitle_european_parliament_data_explorer.42a26b", {pageTitle: String(pageTitle)});document.querySelector('title')?.setAttribute('lang',pageTitleLanguage);},[pageTitle,pageTitleLanguage]);
  const roleName = (value: string) =>
    (value === "MEMBER_SUBSTITUTE") ? label("substitute", c.substitutes) : ((value === "MEMBER") ? label("member", c.members) : ((value === "CHAIR") ? ((lang === "en") ? ui.t("batch4.speechinterventions.tsx.chair") : label("chair", ui.t("batch4.speechinterventions.tsx.chair"))) : ((value === "CHAIR_VICE") ? ((lang === "en") ? ui.t("interfaceLabels.viceChair") : label("viceChair", ui.t("interfaceLabels.viceChair"))) : value.toLowerCase().replaceAll("_", " "))));
  function navigateView(next:typeof view) {
    next=publicExplorerView(next);
    if(next===view)return;
    votes.remember();
    motions.remember();
    const active=(document.activeElement instanceof HTMLElement) ? document.activeElement : null;
    viewOpener.current={node:active,headerIndex:active ? Array.from(document.querySelectorAll('.parliament-header nav button')).indexOf(active) : (-1)};
    pendingDestination.current={view:next,member:next ? member : null};
    const url=new URL(location.href);
    // Country on the member wall is deliberately not an explorer default.
    url.searchParams.delete('country');
    for(const key of [...url.searchParams.keys()])if(/^(t|q|pl|agenda|hot|cloud|dossier|trend|ov|am|gv|mv|ma|mep-speech-fts|mep-activity-fts)-/.test(key))url.searchParams.delete(key);
    url.searchParams.delete('topic');url.searchParams.delete('place');
    next ? url.searchParams.set('view',next) : url.searchParams.delete('view');
    history.pushState(history.state,'',url);setView(next);
  }
  useEffect(()=>{
    const restore=()=>{
      pendingDestination.current=null;
      setRestoration(value=>value+1);
      const query=new URLSearchParams(location.search),next=query.get('view');
      const restored=publicExplorerView(next);
      setLang(queryLanguage(query));setRole(queryRole(query));setOrganization(organizationId(query.get('organization')));setOrganizationName(query.get('organization-name')?.slice(0,512)||'');
      const nextMember=/^\d+$/.test(query.get('member')||'') ? Number(query.get('member')) : null;
      votes.restore(query,nextMember);
      motions.restore(query,nextMember);
      setView(restored);setMember(nextMember);
      if(!restored){setCountry(filterCountry(query.get('country')));setCommittee(query.get('committee')||'');setGroup(query.get('group')||'');}
      setTab(publicMemberModule(query.get('module')));
      setSpeechLink(query.get('speech'));setActivityLink(query.get('activity'));setActivityCategory(query.get('activity-category')||'');setActivityOffset(queryActivityOffset(query));
      // A restored disabled link may resolve to the current state, so the URL
      // effect need not run. Canonicalize that history entry immediately too.
      if(!publicAmendmentsEnabled&&(next==='amendments'||query.get('module')==='amendments')){
        const url=new URL(location.href);
        if(next==='amendments')url.searchParams.delete('view');
        if(query.get('module')==='amendments')url.searchParams.set('module','speeches');
        for(const key of [...url.searchParams.keys()])if(key.startsWith('am-'))url.searchParams.delete(key);
        history.replaceState(history.state,'',url);
      }
    };
    window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);
  },[]);
  const changeMemberTab=(next:string)=>{if(next!==tab){votes.remember();motions.remember();if(['votes','activities'].includes(next)||['votes','activities'].includes(tab))memberStep.current=true;}setTab(next);};
  const changeActivity=(next:string|null,options?:{replace?:boolean})=>{
    if(next===activityLink)return;
    motions.remember();if(!options?.replace)memberStep.current=true;setActivityLink(next);
  };
  const changeActivityCategory=(next:string)=>{
    motions.remember();memberStep.current=true;setActivityCategory(next);setActivityOffset(0);
  };
  const changeActivityOffset=(next:number)=>{
    if(next===activityOffset)return;
    motions.remember();memberStep.current=true;setActivityOffset(next);
  };
  const openInsightMember = (id: number, sourceId?: string) => {
    votes.remember();
    motions.remember();
    navigateView(null);setMember(id);setActivityCategory('');setActivityOffset(0);
    memberOpener.current=null;
    pendingDestination.current={view:null,member:id};
    const speech=Boolean(sourceId?.startsWith('MTG-PL-'));
    setTab(sourceId ? (speech ? 'speeches' : 'activities') : 'profile');
    setSpeechLink(speech ? (sourceId!) : null);
    setActivityLink((sourceId && (!speech)) ? sourceId : null);
  };
  const showMembers = () => {
    votes.remember();
    motions.remember();
    navigateView(null);setMember(null);setSpeechLink(null);setActivityLink(null);
    pendingDestination.current={view:null,member:null};
  };
  const openOrganization=(id:string,name:string)=>{
    votes.remember();motions.remember();memberStep.current=true;
    directoryState.retry();setOrganization(id);setOrganizationName(name);setCommittee('');setCountry('');setGroup('');setSearch('');setRole('both');
    setMember(null);setSpeechLink(null);setActivityLink(null);setActivityCategory('');setActivityOffset(0);
    wallScroll.current={page:0,portraits:0};pendingDestination.current={view:null,member:null};
  };
  const leaveMember=()=>{
    votes.remember();
    motions.remember();
    pendingDestination.current={view:null,member:null,portrait:memberOpener.current};
    memberStep.current=true;setMember(null);setSpeechLink(null);setActivityLink(null);
  };
  const leaveSaved=()=>{
    const opener=viewOpener.current;
    navigateView(null);
    pendingDestination.current={view:null,member,opener};
  };
  return <UiI18nProvider i18n={appUiI18n} language={lang}><PersonNamesProvider members={directory?.members}><ErrorBoundary resetKey={`${view}:${member}:${tab}:${restoration}`} language={lang}
    navigation={<ParliamentHeader view={view||'members'} onMembers={showMembers} onNavigate={navigateView} onSaved={()=>navigateView('saved')} language={lang}/>}
    onRetry={()=>{pendingDestination.current={view,member};}}
  ><Suspense fallback={<ViewLoading language={lang}/>}><ViewContent onReady={focusDestination} render={()=>{
  if (view === 'topics' || view === 'legislation' || view === 'questions' || view === 'outside' || (publicAmendmentsEnabled && view === 'amendments') || view === 'groups') {
    const props={language:lang,onBack:showMembers,onNavigate:navigateView,onMember:openInsightMember,onSaved:()=>navigateView('saved')};
    const title={groups:ui.t("groupvoices.group_voices.f21b8b"),amendments:ui.t("legislation.amendments.900866"),legislation:plenaryModeTitlesUi(ui)[plenaryMode],outside:ui.t("outsidevoices.outside_voices.a027e6"),topics:ui.t("topics.topics"),questions:ui.t("textsearch.questions")}[view];
    return <InsightFrame {...props} view={view}><Suspense fallback={<ViewLoading language={lang} title={title} embedded/>}><ViewContent onReady={focusDestination} render={()=>(view==='topics') ? <Topics {...props}/> : (view==='groups') ? <GroupVoices {...props}/> : ((view==='amendments') ? <AmendmentsPage {...props}/> : ((view==='legislation') ? <Legislation {...props} members={directory?.members}/> : ((view==='outside') ? <OutsideVoices {...props}/> : <QuestionTopics {...props}/>)))}/></Suspense></InsightFrame>;
  }
  return <main className="explorer" lang={lang} onScroll={event=>{if(wallVisible&&event.target===event.currentTarget)wallScroll.current.page=event.currentTarget.scrollTop;}}>
        <ParliamentHeader view={(view==='saved') ? 'saved' : 'members'} onMembers={showMembers} onNavigate={navigateView} onSaved={()=>navigateView('saved')} language={lang}/>
        {(view === 'saved') ? <Suspense fallback={<ViewLoading language={lang} title={ui.t("batch4.dossiercontrols.tsx.64.2")} embedded/>}><ViewContent onReady={focusDestination} render={()=><Saved members={directory?.members} language={lang} onBack={leaveSaved} onMember={openInsightMember} renderActivity={props=><FollowingActivityDetail {...props} lang={lang}/>}/>}/></Suspense> : (member ? <section className="explorer-profile">
            <button
              lang={lang}
              className="explorer-back"
              onClick={leaveMember}
            >
              ← {c.back}
            </button>
            <div className="explorer-profile-header">
              {selected && <Portrait
                  member={{
                    ...selected,
                    imageUrl: `${API_ROOT}/portrait/${selected.id}`,
                  }}
                />}
              <div>
                <h1 lang="" tabIndex={-1} aria-label={memberName}>
                  {profile.data?.firstName || selected?.firstName || followed?.title || (outsideRoster ? ui.t("amendmentnamedvotes.tsx.mep.id", {id: String(member)}) : null)}
                  <br />
                  {profile.data?.lastName || selected?.lastName}
                </h1>
                <MemberAffiliation group={selected?.groupCode} country={selected?.countryCode} language={lang}/>
                <SaveButton item={{kind:'mep',id:String(member),title:[profile.data?.firstName||selected?.firstName,profile.data?.lastName||selected?.lastName].filter(Boolean).join(' ')}}/>
              </div>
            </div>
            <nav className="explorer-tabs" aria-label={ui.t("app.mep_sections")} lang={lang}>
              <button
                className={(tab === "profile") ? "selected" : ""}
                aria-pressed={tab === "profile"}
                onClick={() => changeMemberTab("profile")}
              >
                {c.profile}
              </button>
              <button
                className={(tab === "speeches") ? "selected" : ""}
                aria-pressed={tab === "speeches"}
                onClick={() => changeMemberTab("speeches")}
              >
                {c.speeches}
              </button>
              <button className={(tab === "activities") ? "selected" : ""} aria-pressed={tab === "activities"} onClick={() => changeMemberTab("activities")}>{c.activities}</button>
              <button lang={ui.language} className={(tab==='votes') ? 'selected' : ''} aria-pressed={tab==='votes'} onClick={()=>changeMemberTab('votes')}><UiMessage id="dossieractivity.votes"/></button>
              {publicAmendmentsEnabled&&<button lang={ui.language} className={(tab === "amendments") ? "selected" : ""} aria-pressed={tab === "amendments"} onClick={() => changeMemberTab("amendments")}><UiMessage id="legislation.amendments.900866"/></button>}
            </nav>
            <div className="explorer-profile-body">
              {outsideRoster&&<FormerMemberNotice member={member} language={lang}/>}
              {(outsideRoster && (tab==='activities')) ? null : ((tab === "speeches") ? <Speeches
                  key={member}
                  id={member}
                  lang={lang}
                  initialSpeech={speechLink}
                  onOpen={setSpeechLink}
                /> : ((tab==='votes') ? (votes.journey.invalid ? <section lang={ui.language} role="alert"><h2><UiMessage id="app.invalid_voting_records_link"/></h2><p><UiMessage id="membervotes.tsx.these.voting.records.are.unavailable"/></p></section> : <Suspense fallback={<p className="member-votes-loading" role="status" lang={ui.language}><UiMessage id="membervotes.tsx.loading.voting.records"/></p>}>
                    <MemberVotes key={member} memberId={member} memberName={memberName} language={lang} state={votes.journey.state} onStateChange={votes.onStateChange}
                      renderContext={request=><Suspense fallback={<p className="member-votes-loading" role="status" lang={ui.language}><UiMessage id="app.loading_document_context"/></p>}>
                        <DocumentContextReader request={request} language={lang} selectedDocumentId={votes.journey.adoptedId} onSelectedDocumentIdChange={votes.onSelectedDocumentIdChange}/>
                      </Suspense>}/>
                  </Suspense>) : ((publicAmendmentsEnabled && (tab === "amendments")) ? <Amendments key={member} member={member} language={lang} onMember={openInsightMember} heading={ui.t("app.amendments_tabled")}/> : ((tab === "activities") ? <Activities id={member} lang={lang} memberName={memberName} initialActivity={activityLink} onOpen={changeActivity} category={activityCategory} onCategory={changeActivityCategory} offset={activityOffset} onOffset={changeActivityOffset} motionQuery={motions.query} onMotionChange={motions.onJourneyChange} preserveScroll={motions.hasSavedScroll||dossierJourneyRestoring()} /> : <>
                  {profile.loading && <p role="status" lang={ui.language}><UiMessage id="app.loading_profile"/></p>}
                  {profile.error && <ErrorView message={profile.error} retry={profile.retry} />}{" "}
                  {profile.data && <>
                      <h2 lang={lang}>{c.profile}</h2>
                      <ParliamentaryService profile={profile.data} lang={lang} date={date}/>
                      {profile.data.birthDate && <p lang={ui.language}>{profile.data.birthPlace ? <UiMessage id="app.bornWithPlace" values={{date: <span lang={lang}>{date(profile.data.birthDate, lang)}</span>, place: <span lang="">{profile.data.birthPlace}</span>}}/> : <UiMessage id="app.born" values={{date: <span lang={lang}>{date(profile.data.birthDate, lang)}</span>}}/>}</p>}
                      {profile.data.email && <p>
                          <a lang="" href={`mailto:${profile.data.email}`}>
                            {profile.data.email}
                          </a>
                        </p>}
                      {!(profile.data.committeeMemberships?.complete && !profile.data.committeeMemberships.items.length) && <>
                        <h2 lang={ui.language}>{(profile.data.currentAffiliation?.status==='matched') ? c.committee : ui.t("app.committee_records")}</h2>
                        <CommitteeMemberships profile={profile.data} committees={directory?.committees||[]} lang={lang} roleName={roleName} date={date} retry={profile.retry} onOrganization={openOrganization}/>
                      </>}
                      <ProfileMemberships profile={profile.data} lang={lang} roleName={roleName} date={date} retry={profile.retry} onOrganization={openOrganization}/>
                    </>}
                </>))))}
            </div>
          </section> : null)}
          <section className="explorer-wall" hidden={!wallVisible}>
            <h1 lang={lang}>{c.title}</h1>
            {organization&&<p className="explorer-organization-filter"><strong>{organizationName||organization}</strong> <button type="button" onClick={()=>{setOrganization('');setOrganizationName('');}}><UiMessage id="app.clear_filter"/></button></p>}
            <div className="explorer-filters">
              <label lang={lang}>
                {c.committee}
                <select
                  value={committee}
                  onChange={(e) => setCommittee(e.target.value)}
                >
                  <option value="">{c.all}</option>
                  {committee && !directory?.committees.some(b => b.id === committee) && <option lang={ui.language} value={committee}><UiMessage id="app.checkingCommittee" values={{committee: committee}}/></option>}
                  {directory?.committees.map((b) => {
                    const name=selectLanguageText(b.names,lang,ui.t("insightshared.name_unavailable"), ui.messageLocale("insightshared.name_unavailable"));
                    return <option lang={name.language} key={b.id} value={b.id}><>{b.code} · {name.text}</></option>;
                  })}
                </select>
              </label>
              <div className="explorer-filter-line">
                <label lang={ui.language}>
                   <UiMessage id="app.membership"/> <select
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
                  {label("country", ui.t("interfaceLabels.country"))}
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  >
                    <option lang={ui.language} value=""><UiMessage id="dossieractivity.all"/></option>
                    {Array.from(
                      new Set(directory?.members.map((m) => filterCountry(m.countryCode))),
                    )
                      .filter(Boolean)
                      .sort((a,b) => compareCountries(lang,a,b, ui))
                      .map((v) => {
                        const name=countryName(lang,v, ui);
                        return <option lang={(name===v) ? '' : lang} key={v} value={v}>{name}</option>;
                      })}
                  </select>
                </label>
                <label lang={lang}>
                  {label("political_group", ui.t("groupvoices.political_group.c2db1f"))}
                  <select
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                  >
                    <option lang={ui.language} value=""><UiMessage id="dossieractivity.all"/></option>
                    {Array.from(
                      new Set(directory?.members.map((m) => m.groupCode).filter((code): code is string => typeof code === 'string' && Boolean(code))),
                    )
                      .filter((v): v is string => Boolean(v))
                      .sort((a,b) => a.localeCompare(b,lang))
                      .map((v) => <option lang="" key={v}>{v}</option>)}
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
            <Status scope={JSON.stringify([lang,committee,organization,country,group,search,role])} pending={directoryState.loading} oncePerScope message={(() => {
              if(!directory||error)return null;
              const resultMessage=partialCommittee
                ? filtered.length ? ui.t("app.knownMepMatchMany",{count:filtered.length}) : ui.t("app.no_matches_in_the_loaded_memberships_yet")
                : filtered.length ? ui.t("app.mepMatchMany",{count:filtered.length}) : ui.t("app.no_meps_match_these_filters");
              return directory.index.complete ? resultMessage : ui.t("app.directoryResultStatus",{resultMessage});
            })()}/>
            {error && <ErrorView
                message={error}
                retry={directoryState.retry}
              />}{" "}
            {!directory && !error && <p role="status" lang={ui.language}><UiMessage id="app.loading_current_meps_and_committees"/></p>}
            {directory && <>
                <div className="explorer-results">
                  <strong>{partialCommittee ? (filtered.length ? (`${filtered.length}+`) : "—") : filtered.length}</strong>
                  <span lang={lang}>
                    {partialCommittee && !filtered.length ? <UiMessage id="app.mepCountUnknownUnit"/> : <UiMessage id="app.mepCountUnit" counts={{count:filtered.length}}/>}{" "}
                    <small lang={ui.language}><UiMessage id="app.currentAt" values={{date: <time lang={lang} dateTime={directory.day}>{date(directory.day, lang)}</time>}}/></small>
                  </span>
                  <button
                    lang={lang}
                    onClick={() => {
                      setOrganization("");setOrganizationName("");
                      setCommittee("");
                      setCountry("");
                      setGroup("");
                      setSearch("");
                      setRole("both");
                    }}
                  >
                    {label("reset_filters", ui.t("interfaceLabels.reset_filters"))}
                  </button>
                </div>
                {directory.sync?.error && <div className="explorer-index" role="status" lang={ui.language}><UiMessage id="app.feedUnavailable" values={{lastSuccess: <span lang={directory.sync.lastSuccess ? "" : ui.language}>{directory.sync.lastSuccess || ui.t("app.not_yet_completed")}</span>}}/></div>}
                {directory.committeeDetails && (!directory.committeeDetails.complete || directory.committeeDetails.error) && <div className="explorer-index" role="status" lang={ui.language}>
                    {directory.committeeDetails.error || ui.t("app.loading_committee_names")}
                    {directory.committeeDetails.error && <button onClick={() => {void api("directory?retry=committee-details", undefined, undefined, ui).catch(() => {}).finally(directoryState.retry);}}><UiMessage id="app.retry_committee_details"/></button>}
                  </div>}
                {!directory.index.complete && <div className="explorer-index" role="status" lang={ui.language}>
                    {directory.index.error ||
                      ui.t("app.loadingMemberships", {loaded: String(directory.index.loaded), total: String(directory.index.total)})}
                    {directory.index.error && <button onClick={directoryState.retry}><UiMessage id="app.retry_membership_index"/></button>}
                  </div>}
                <div className="explorer-portraits" data-portrait-scroll-root onScroll={event=>{if(wallVisible)wallScroll.current.portraits=event.currentTarget.scrollTop;}}>
                    {filtered.map((m, index) => <div className="explorer-portrait-item" lang="" key={m.id} data-member-id={m.id}>
                        <Portrait
                          member={{
                            ...m,
                            imageUrl: `${API_ROOT}/portrait/${m.id}`,
                          }}
                          labelled
                          eager={index < 8}
                          onClick={() => {
                            memberOpener.current=m.id;
                            pendingDestination.current={view:null,member:m.id};
                            memberStep.current=true;setMember(m.id);
                            setSpeechLink(null);
                            setActivityLink(null);
                            setActivityCategory('');
                            setActivityOffset(0);
                            setTab("speeches");
                          }}
                        />
                        <div className="explorer-portrait-follow">
                          <SaveButton compact item={{kind:'mep',id:String(m.id),title:[m.firstName,m.lastName].filter(Boolean).join(' ')}}/>
                        </div>
                        {committee && <small>
                            {m.memberships
                              ?.filter((v) => v.current && v.id === committee)
                              .map((v,index) => <span key={index} lang={['MEMBER_SUBSTITUTE','MEMBER','CHAIR','CHAIR_VICE'].includes(v.role) ? lang : ''}>{(index>0) ? " · " : ""}{roleName(v.role)}</span>)}
                          </small>}
                      </div>)}
                    {!filtered.length && <p lang={ui.language}>{partialCommittee ? <UiMessage id="app.no_matches_yet"/> : <UiMessage id="app.no_meps_match_these_filters"/>}</p>}
                  </div>
              </>}
          </section>
        <footer className="explorer-footer" lang={ui.language}>
          <label>
             <UiMessage id="app.language"/> <select
              aria-label={ui.t("app.interface_language")}
              value={lang}
              onChange={(e) => {votes.remember();motions.remember();const language=e.target.value,url=new URL(location.href);if(language==='en')url.searchParams.delete('lang');else url.searchParams.set('lang',language);history.replaceState(history.state,'',url);startTransition(()=>setLang(language));}}
            >
              {interfaceLanguages.map((code) => <option lang={code} key={code} value={code}>
                  {languageName(code)}
                </option>)}
            </select>
          </label>
          <DataNotice/>
        </footer>
    </main>;
  }}/></Suspense></ErrorBoundary></PersonNamesProvider></UiI18nProvider>;
}
