import {reportUiError} from './errorDiagnostics.mjs';
import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {useEffect,useState} from 'react';
import {api} from './data';
import {SourceLink,sourcePageUrl} from './SourceLink';
import {WordingDiff} from './components/WordingDiff';
import {useDossierReaderState} from './dossierJourney';
import type {FinalTextSelection,FinalTextResponse,FinalTextStage} from './FinalTextCheckTypes';
import './FinalTextCheck.css';

export type {FinalTextSelection,FinalTextResponse} from './FinalTextCheckTypes';
const labels={
  'same-wording':'Same wording',
  'different-wording':'Different wording','unavailable':'Unavailable',
};
export const labelsUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof labels => ({
  'same-wording':ui.t("finalTextCheck.same_wording"),
  'different-wording':ui.t("finalTextCheck.different_wording"),'unavailable':ui.t("grouplabels.ts.unavailable"),
});

const destinationName=(kind:string, ui: import('./uiI18n.mjs').UiFormatter = defaultUi)=>(kind==='final-eu-act') ? ui.t("finalTextCheck.final_eu_act") : ui.t("finalTextCheck.parliament_s_adopted_text");
const selectionKey=(selection:FinalTextSelection)=>JSON.stringify([selection.documentId,selection.amendmentId,selection.listId,selection.wordingLanguage,selection.language]);
const pinned=(data:FinalTextResponse,selection:FinalTextSelection)=>data?.version===3&&data.comparisonVersion===3&&
  (['documentId','amendmentId','listId','wordingLanguage','language'] as const).every(key=>data.selection?.[key]===selection[key]);

function Stage({stage,source,readerKey}:{stage:FinalTextStage;source:FinalTextResponse['selection']['source'];readerKey:string}) {
  const ui = useUiI18n();
  const {destination,wording}=stage,name=destinationName(destination.kind, ui);
  const [comparisonOpen,setComparisonOpen]=useDossierReaderState('final-wording:'+JSON.stringify([readerKey,source?.contentHash||source?.sha256,destination.kind,destination.id,destination.language,destination.source.contentHash||destination.source.sha256]),false);
  const readable=destination.sourceUrls.find(url=>sourcePageUrl(url,{language:destination.language}));
  const date=((destination.date && /^\d{4}-\d{2}-\d{2}$/.test(destination.date)) && Number.isFinite(Date.parse(destination.date))) ? new Intl.DateTimeFormat(ui.locale==='en'?'en-GB':ui.locale,{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(destination.date)) : null;
  return <section className="final-text-check__stage">
    <h5>{name}</h5>
    {(date||wording.mapping?.to)&&<p className="final-text-check__address">{date&&<time dateTime={destination.date!}>{date}</time>}{(date && wording.mapping?.to) ? ' · ' : null}{wording.mapping?.to}</p>}
    <p className="final-text-check__result">{labelsUi(ui)[wording.status]||ui.t("grouplabels.ts.unavailable")}</p>
    {wording.passages&&<details className="final-text-check__comparison" open={comparisonOpen} onToggle={event=>setComparisonOpen(event.currentTarget.open)}>
      <summary><UiMessage id="finalTextCheck.compare_wording"/></summary>
      <WordingDiff original={wording.passages.proposed} proposed={wording.passages.destination.text} language={destination.language} emptySemantics="not-supplied" presentation="context" highlightChanges={wording.status!=='same-wording'} labels={{original:ui.t("membervotes.tsx.proposed.wording"),proposed:name}}/>
      {source&&sourcePageUrl(source.url,{language:destination.language})&&<SourceLink url={source.url} language={destination.language}><UiMessage id="motionamendments.amendment.664ccf"/></SourceLink>}
    </details>}
    {readable&&<SourceLink url={readable} language={destination.language}><UiMessage id="dossieractivity.read_text"/></SourceLink>}
  </section>;
}

export function VoteOutcome({outcome}:{outcome:string}) {
  const ui=useUiI18n();
  const keys:Record<string,string>={ADOPTED:'membervotespresentation.adopted',REJECTED:'membervotespresentation.rejected',LAPSED:'membervotespresentation.lapsed',WITHDRAWN:'membervotespresentation.withdrawn',CANCELLED:'membervotespresentation.cancelled'};
  return Object.hasOwn(keys,outcome) ? <span lang={ui.language}>{ui.t(keys[outcome])}</span> : <span lang="">{outcome}</span>;
}

function Session({selection}:{selection:FinalTextSelection}) {
  const ui = useUiI18n();
  const readerKey=selectionKey(selection);
  const [open,setOpen]=useDossierReaderState('final-text:'+readerKey,false),[retry,setRetry]=useState(0);
  const [state,setState]=useState<{data:FinalTextResponse|null;loading:boolean;error:boolean}>({data:null,loading:false,error:false});
  const params=new URLSearchParams({lang:selection.language,amendment:selection.amendmentId,list:selection.listId,'wording-lang':selection.wordingLanguage??'unknown','final-text':'1'});
  if(selection.amendmentId.startsWith('committee:'))params.set('scope','committee');
  const route='document-context/'+encodeURIComponent(selection.documentId)+'?'+params;
  useEffect(()=>{
    if(!open)return;
    let active=true;const controller=new AbortController();
    setState(previous=>({...previous,loading:true,error:false}));
    api<FinalTextResponse>(route,controller.signal, undefined, ui).then(data=>{
      if(!pinned(data,selection))throw new Error('Selection changed');
      if(active)setState({data,loading:false,error:false});
    }).catch(error=>{if(active){reportUiError(error,{request:'/api/'+route});setState(previous=>({...previous,loading:false,error:true}));}});
    return ()=>{active=false;controller.abort();};
  // The keyed session pins every selection field for this disclosure's lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open,retry,route]);
  const data=state.data;
  const availableStages=data?.stages.filter(stage=>stage.wording.status!=='unavailable')||[];
  const shownStages=availableStages.length ? availableStages : (data?.stages.filter(stage=>stage.destination.kind===data.destination?.kind&&stage.destination.id===data.destination?.id)||[]);
  return <details className="final-text-check" open={open} data-reader-pending={((open && (!state.data)) && (!state.error)) ? 'true' : undefined} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary><UiMessage id="finalTextCheck.in_the_final_text"/></summary>
    {open&&<div className="final-text-check__body" aria-busy={state.loading}>
      {state.loading&&!data&&<p role="status"><UiMessage id="insightshared.loading"/></p>}
      {data?.vote.status==='available'&&data.vote.scope==='individual-amendment'&&data.vote.outcome&&<p className="final-text-check__vote">{(data.vote.stage==='committee') ? <UiMessage id="finalTextCheck.committee_vote_outcome" values={{outcome: <VoteOutcome outcome={data.vote.outcome}/>}}/> : ((data.vote.stage==='plenary') ? <UiMessage id="finalTextCheck.plenary_vote_outcome" values={{outcome: <VoteOutcome outcome={data.vote.outcome}/>}}/> : <UiMessage id="finalTextCheck.vote_outcome" values={{outcome: <VoteOutcome outcome={data.vote.outcome}/>}}/>)}</p>}
      {data&&(shownStages.length ? shownStages.map(stage=><Stage key={stage.destination.kind+':'+stage.destination.id} stage={stage} source={data.selection.source} readerKey={readerKey}/>) : <p><UiMessage id="grouplabels.ts.unavailable"/></p>)}
      {state.error&&<p role="status">{data ? <UiMessage id="finalTextCheck.could_not_refresh_comparison"/> : <UiMessage id="finalTextCheck.could_not_load_comparison"/>}</p>}
      {(state.error||data)&&<button type="button" disabled={state.loading} onClick={()=>setRetry(value=>value+1)}>{state.error ? <UiMessage id="commissionfollowups.try_again"/> : <UiMessage id="batch6.procedureprogress.check.again.64"/>}</button>}
    </div>}
  </details>;
}

export function FinalTextCheck(selection:FinalTextSelection) {
  return <Session key={selectionKey(selection)} selection={selection}/>;
}
export default FinalTextCheck;
