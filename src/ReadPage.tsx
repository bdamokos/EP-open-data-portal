import {useEffect} from 'react';
import {RecordTopics} from './RecordTopics';
import {DocumentContextReader,type DocumentReaderLeadInfo} from './DocumentContextReader';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {dossierBackHref,dossierLinkClick} from './dossierJourney';
import {useExplorerParam} from './explorerUrl';
import {InsightShell} from './InsightShared';
import type {InsightProps} from './InsightTypes';
import {plenaryModeTitlesUi} from './plenaryModes';
import {publicUrl} from './publicUrl';
import {amendmentNumber,documentReferenceLabel,provisionLabel,readHref,readRoute} from './readRoute.mjs';
import './ReadPage.css';

const backHref=()=>dossierBackHref()||(history.state?.dossierOrigin as string|undefined)||null;
const dayText=(day:string,language:string)=>new Intl.DateTimeFormat(language==='en'?'en-GB':language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));

function AmendmentLead({info,language}:{info:DocumentReaderLeadInfo;language:string}) {
  const ui=useUiI18n();
  const number=amendmentNumber(info.amendmentId),provision=provisionLabel(info.variant?.targetLabel),back=backHref(),reference=documentReferenceLabel(info.documentId);
  useEffect(()=>{window.document.title=ui.t('legislation.pagetitle_european_parliament_data_explorer.42a26b',{pageTitle:provision?ui.t('reader.header',{number:number??'',provision}):ui.t('reader.header_number',{number:number??''})});},[number,provision]);
  return <>
    <header className="read-page-bar">
      {back&&<a className="read-page-back" href={back} onClick={dossierLinkClick} aria-label={ui.t('dossieractivity.back_to_where_you_were')} title={ui.t('dossieractivity.back_to_where_you_were')}>←</a>}
      <h1 tabIndex={-1} title={info.variant?.targetLabel||undefined}>{provision?<UiMessage id="reader.header" values={{number:number??'',provision:<span lang={info.variant?.targetLabelLanguage??info.variant?.language??''}>{provision}</span>}}/>:<UiMessage id="reader.header_number" values={{number:number??''}}/>}</h1>
    </header>
    <p className="read-page-line"><a href={publicUrl(readHref({documentId:info.documentId,language}))} onClick={dossierLinkClick} lang="">{reference}</a></p>
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
      lead={info=>info.amendmentId?<AmendmentLead info={info} language={language}/>:<DocumentLead info={info} language={language}/>}/>
    {!amendment&&<RecordTopics id={id} full language={language}/>}
  </div>;
}
export function ReadView(props:InsightProps) {
  const ui=useUiI18n();
  return <InsightShell {...props} view="legislation" title={plenaryModeTitlesUi(ui).read} hideTitle><ReadPage language={props.language||'en'}/></InsightShell>;
}
