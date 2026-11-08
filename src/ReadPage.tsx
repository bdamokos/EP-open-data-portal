import {useEffect,Fragment} from 'react';
import {RecordTopics} from './RecordTopics';
import {useData} from './data';
import {PersonName} from './PersonName';
import {amendmentOutcomeLabel} from './amendmentModel.mjs';
import {DocumentContextReader,type DocumentReaderLeadInfo} from './DocumentContextReader';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {dossierBackHref,dossierLinkClick} from './dossierJourney';
import {useExplorerParam} from './explorerUrl';
import {InsightShell,insightMemberHref} from './InsightShared';
import type {InsightProps} from './InsightTypes';
import {plenaryModeTitlesUi} from './plenaryModes';
import {publicUrl} from './publicUrl';
import {amendmentNumber,documentReferenceLabel,provisionLabel,readHref,readRoute} from './readRoute.mjs';
import {selectLanguageText} from './language.mjs';
import {splitRuns} from './splitRuns.mjs';
import {SplitKey,SplitText,type SplitKeyRow} from './SplitText';
import {voteHref} from './votePagePresentation.mjs';
import './VoteSystem.css';
import './ReadPage.css';

const backHref=()=>dossierBackHref()||(history.state?.dossierOrigin as string|undefined)||null;
const dayText=(day:string,language:string)=>new Intl.DateTimeFormat(language==='en'?'en-GB':language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));

type Neighbour={id:string;number:number};
type Neighbours={amendmentId:string;listId:string|null;outcome:string|null;authors:{name:string;displayName:string|null;personId:string|null}[];committeeProposer:string|null;proposerLanguage:string|null;onBehalfOf:string|string[]|null;splitParts?:{number:number|string|null;descriptions:Record<string,string>}[];decisions?:{id:string;partNumber:number|string|null;outcome:string|null;method:string|null;ballotStatus:string|null;totals:{for:number|null;against:number|null;abstaining:number|null}|null}[];previous:Neighbour|null;next:Neighbour|null};
// Names beyond these open on request, so a long list of signatories doesn't push the amendment off the screen.
const AUTHORS_SHOWN=3;

function Step({neighbour,label,glyph,info,language,wordingLanguage,listId}:{neighbour:Neighbour|null|undefined;label:string;glyph:string;info:DocumentReaderLeadInfo;language:string;wordingLanguage?:string|null;listId?:string|null}) {
  if(!neighbour)return <span className="read-page-step" role="link" aria-disabled="true" aria-label={label} title={label}>{glyph}</span>;
  return <a className="read-page-step" aria-label={label} title={label} href={publicUrl(readHref({documentId:info.documentId,amendmentId:neighbour.id,listId,wordingLanguage,language}))} onClick={dossierLinkClick}>{glyph}</a>;
}
function Tabled({data,language}:{data:Neighbours;language:string}) {
  const ui=useUiI18n();
  const person=(author:Neighbours['authors'][number])=>{
    const name=<span lang=""><PersonName id={author.personId} label={author.displayName||author.name}/></span>;
    return /^[1-9]\d*$/.test(author.personId||'')?<a href={insightMemberHref(author.personId!,language)} onClick={dossierLinkClick}>{name}</a>:name;
  };
  const names=(authors:Neighbours['authors'])=>authors.map((author,index)=><Fragment key={(author.personId||author.name)+':'+index}>{index?', ':''}{person(author)}</Fragment>);
  const group=Array.isArray(data.onBehalfOf)?data.onBehalfOf.join(', '):data.onBehalfOf,behalf=group?.replace(/^on behalf of\s+/i,'');
  const extra=data.authors.length-AUTHORS_SHOWN;
  const line=data.authors.length?<UiMessage id="amendments.tabled_by_authors.b76b76" values={{authors:<>{names(data.authors.slice(0,extra>0?AUTHORS_SHOWN:undefined))}{extra>0?' +'+extra.toLocaleString(ui.locale):''}</>}}/>:data.committeeProposer?<UiMessage id="amendments.tabled_by_proposer.0bb4e6" values={{proposer:<span lang={data.proposerLanguage??''}>{data.committeeProposer}</span>}}/>:behalf?<UiMessage id="amendments.tabled_on_behalf_of_onbehalfof.4943fa" values={{group:<span lang="">{behalf}</span>}}/>:null;
  if(!line)return null;
  const onBehalf=behalf&&(data.authors.length||data.committeeProposer)?<> · <UiMessage id="batch4.speechinterventions.tsx.on.behalf.of.group" values={{group:<span lang="">{behalf}</span>}}/></>:null;
  return <>{' · '}{extra>0?<details className="read-page-authors"><summary>{line}{onBehalf}</summary><p>{names(data.authors)}</p></details>:<>{line}{onBehalf}</>}</>;
}

const neighboursRoute=(amendmentId:string,listId?:string)=>'amendment-neighbours?'+new URLSearchParams({amendment:amendmentId,...(listId?{list:listId}:{})});
const partOrder=(value:number|string|null)=>/^\d+$/.test(String(value))?Number(value):Number.MAX_SAFE_INTEGER;
// The amendment as a whole: every part marked and none stressed, each with its result and vote.
function VotedInParts({amendmentId,listId,variant,language}:{amendmentId:string;listId?:string;variant:NonNullable<DocumentReaderLeadInfo['variant']>;language:string}) {
  const neighbours=useData<Neighbours>(neighboursRoute(amendmentId,listId),{automatic:false});
  const data=neighbours.data?.amendmentId===amendmentId?neighbours.data:null;
  const parts=[...(data?.splitParts??[])].sort((a,b)=>partOrder(a.number)-partOrder(b.number));
  if(parts.length<2)return null;
  const wordingLanguage=variant.language??'',inLanguage=parts.map(part=>({number:part.number,description:part.descriptions[wordingLanguage]??''}));
  const match=typeof variant.proposedText==='string'&&inLanguage.every(part=>part.description.trim())?splitRuns(variant.proposedText,inLanguage):null;
  const keyParts=parts.map((part):SplitKeyRow=>{
    const chosen=match?{text:part.descriptions[wordingLanguage],language:wordingLanguage}:selectLanguageText(part.descriptions,language);
    const decision=data?.decisions?.find(row=>String(row.partNumber)===String(part.number))??null;
    return {number:part.number,description:chosen.text??null,language:chosen.language??'',result:decision,seeVote:decision?voteHref(decision.id,language):null};
  });
  return <section className="vs read-page-parts">
    <h3><UiMessage id="votepage.voted_in_parts"/></h3>
    {match&&<SplitText runs={match.runs} language={wordingLanguage} emphasis="none"/>}
    <SplitKey parts={keyParts} match={match}/>
  </section>;
}

function AmendmentLead({info,language,listId,wordingLanguage}:{info:DocumentReaderLeadInfo;language:string;listId?:string;wordingLanguage?:string|null}) {
  const ui=useUiI18n();
  const neighbours=useData<Neighbours>(info.amendmentId?neighboursRoute(info.amendmentId,listId):null,{automatic:false});
  const data=neighbours.data?.amendmentId===info.amendmentId?neighbours.data:null,list=listId??data?.listId??undefined,pin=wordingLanguage!==undefined?{wordingLanguage}:{};
  const number=amendmentNumber(info.amendmentId),provision=provisionLabel(info.variant?.targetLabel),back=backHref(),reference=documentReferenceLabel(info.documentId);
  useEffect(()=>{window.document.title=ui.t('legislation.pagetitle_european_parliament_data_explorer.42a26b',{pageTitle:provision?ui.t('reader.header',{number:number??'',provision}):ui.t('reader.header_number',{number:number??''})});},[number,provision]);
  return <>
    <header className="read-page-bar">
      {back&&<a className="read-page-back" href={back} onClick={dossierLinkClick} aria-label={ui.t('dossieractivity.back_to_where_you_were')} title={ui.t('dossieractivity.back_to_where_you_were')}>←</a>}
      <h1 tabIndex={-1} title={info.variant?.targetLabel||undefined}>{provision?<UiMessage id="reader.header" values={{number:number??'',provision:<span lang={info.variant?.targetLabelLanguage??info.variant?.language??''}>{provision}</span>}}/>:<UiMessage id="reader.header_number" values={{number:number??''}}/>}</h1>
      <Step neighbour={data?.previous} label={ui.t('reader.previous_amendment')} glyph="‹" info={info} language={language} listId={list} {...pin}/>
      <Step neighbour={data?.next} label={ui.t('reader.next_amendment')} glyph="›" info={info} language={language} listId={list} {...pin}/>
    </header>
    <div className="read-page-line"><a href={publicUrl(readHref({documentId:info.documentId,language}))} onClick={dossierLinkClick} lang="">{reference}</a>{data&&<Tabled data={data} language={language}/>}{data?.outcome&&<> · <strong>{amendmentOutcomeLabel(data.outcome,ui)}</strong></>}</div>
  </>;
}

function DocumentLead({info,language}:{info:DocumentReaderLeadInfo;language:string}) {
  const ui=useUiI18n();
  const back=backHref(),reference=documentReferenceLabel(info.documentId);
  const titled=Object.values(info.document?.titles||{}).some(Boolean)?info.title:null;
  useEffect(()=>{window.document.title=ui.t('legislation.pagetitle_european_parliament_data_explorer.42a26b',{pageTitle:titled?.text||reference});},[titled?.text,reference]);
  return <header className="read-page-document">
    {back&&<a className="dossier-back" href={back} onClick={dossierLinkClick}><UiMessage id="dossieractivity.back_to_where_you_were"/></a>}
    <h1 tabIndex={-1} lang={titled?.language??''}>{titled?.text||reference}</h1>
    {titled&&<p className="read-page-line"><span lang="">{reference}</span>{info.document?.date&&<> · <time dateTime={info.document.date} lang={language}>{dayText(info.document.date,language)}</time></>}</p>}
  </header>;
}

export function ReadPage({language}:{language:string}) {
  const ui=useUiI18n();
  const [documentId]=useExplorerParam<string>('read-doc',''),[amendmentId]=useExplorerParam<string>('read-amendment','');
  const [listId]=useExplorerParam<string>('read-list',''),[textLanguage,setTextLanguage]=useExplorerParam<string>('read-lang','');
  const route=readRoute(new URLSearchParams({'read-doc':documentId,'read-amendment':amendmentId,'read-list':listId,'read-lang':textLanguage}));
  if(!route)return <section className="read-page" data-read-page={documentId+':'+amendmentId} lang={ui.language}><h1 tabIndex={-1}><UiMessage id="batch6.documentcontextreader.document.unavailable.here.171"/></h1></section>;
  const {documentId:id,amendmentId:amendment,listId:list,wordingLanguage}=route;
  const request={documentId:id,view:'document' as const,onBack:()=>{},...(amendment?{amendmentId:amendment}:{}),...(list?{listId:list}:{}),...(wordingLanguage!==undefined?{wordingLanguage}:{})};
  return <div className="read-page" data-read-page={documentId+':'+amendmentId}>
    {route.staleAmendment&&<p className="document-context-notice" role="status" lang={ui.language}><UiMessage id="reader.amendment_not_found"/></p>}
    <DocumentContextReader request={request} language={language} showBackButton={false} passageFirst textLanguage={amendment?undefined:route.textLanguage} onTextLanguageChange={amendment?undefined:setTextLanguage}
      lead={info=>info.amendmentId?<AmendmentLead info={info} language={language} listId={list} wordingLanguage={wordingLanguage}/>:<DocumentLead info={info} language={language}/>}
      amendmentFooter={amendment?variant=><VotedInParts amendmentId={amendment} listId={list} variant={variant} language={language}/>:undefined}/>
    {!amendment&&<RecordTopics id={id} full language={language}/>}
  </div>;
}
export function ReadView(props:InsightProps) {
  const ui=useUiI18n();
  return <InsightShell {...props} view="legislation" title={plenaryModeTitlesUi(ui).read} hideTitle><ReadPage language={props.language||'en'}/></InsightShell>;
}
