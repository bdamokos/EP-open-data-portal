import {useEffect,useState} from 'react';
import {api} from './data';
import {SourceLink,sourcePageUrl} from './SourceLink';
import {WordingDiff} from './components/WordingDiff';
import type {FinalTextSelection,FinalTextResponse,FinalTextStage} from './FinalTextCheckTypes';
import './FinalTextCheck.css';

export type {FinalTextSelection,FinalTextResponse} from './FinalTextCheckTypes';
const labels={
  'same-wording':'Same wording','some-wording-matches':'Some wording matches',
  'different-wording':'Different wording','change-retained':'Change retained','unavailable':'Unavailable',
};
const destinationName=(kind:string)=>kind==='final-eu-act'?'Final EU act':'Parliament’s adopted text';
const pinned=(data:FinalTextResponse,selection:FinalTextSelection)=>data?.version===1&&data.comparisonVersion===1&&
  (['documentId','amendmentId','listId','wordingLanguage','language'] as const).every(key=>data.selection?.[key]===selection[key]);

function Stage({stage,source}:{stage:FinalTextStage;source:FinalTextResponse['selection']['source']}) {
  const {destination,wording}=stage,name=destinationName(destination.kind);
  const readable=destination.sourceUrls.find(url=>sourcePageUrl(url,{language:destination.language}));
  const date=destination.date&&/^\d{4}-\d{2}-\d{2}$/.test(destination.date)&&Number.isFinite(Date.parse(destination.date))?new Intl.DateTimeFormat('en-GB',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(destination.date)):null;
  return <section className="final-text-check__stage">
    <h5>{name}</h5>
    {(date||wording.mapping?.to)&&<p className="final-text-check__address">{date&&<time dateTime={destination.date!}>{date}</time>}{date&&wording.mapping?.to?' · ':null}{wording.mapping?.to}</p>}
    <p className="final-text-check__result">{labels[wording.status]||'Unavailable'}</p>
    {wording.passages&&<details className="final-text-check__comparison">
      <summary>Compare wording</summary>
      <WordingDiff original={wording.passages.proposed} proposed={wording.passages.destination.text} language={destination.language} emptySemantics="not-supplied" presentation="context" highlightChanges={wording.status!=='same-wording'} labels={{original:'Proposed wording',proposed:name}}/>
      {source&&sourcePageUrl(source.url,{language:destination.language})&&<SourceLink url={source.url} language={destination.language}>Amendment</SourceLink>}
    </details>}
    {readable&&<SourceLink url={readable} language={destination.language}>Read text</SourceLink>}
  </section>;
}

function Session({selection}:{selection:FinalTextSelection}) {
  const [open,setOpen]=useState(false),[retry,setRetry]=useState(0);
  const [state,setState]=useState<{data:FinalTextResponse|null;loading:boolean;error:boolean}>({data:null,loading:false,error:false});
  const params=new URLSearchParams({lang:selection.language,amendment:selection.amendmentId,list:selection.listId,'wording-lang':selection.wordingLanguage??'unknown','final-text':'1'});
  if(selection.amendmentId.startsWith('committee:'))params.set('scope','committee');
  const route='document-context/'+encodeURIComponent(selection.documentId)+'?'+params;
  useEffect(()=>{
    if(!open)return;
    let active=true;const controller=new AbortController();
    setState(previous=>({...previous,loading:true,error:false}));
    api<FinalTextResponse>(route,controller.signal).then(data=>{
      if(!pinned(data,selection))throw new Error('Selection changed');
      if(active)setState({data,loading:false,error:false});
    }).catch(()=>{if(active)setState(previous=>({...previous,loading:false,error:true}));});
    return ()=>{active=false;controller.abort();};
  // The keyed session pins every selection field for this disclosure's lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open,retry,route]);
  const data=state.data;
  const availableStages=data?.stages.filter(stage=>stage.wording.status!=='unavailable')||[];
  const shownStages=availableStages.length?availableStages:data?.stages.filter(stage=>stage.destination.kind===data.destination?.kind&&stage.destination.id===data.destination?.id)||[];
  return <details className="final-text-check" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>In the final text?</summary>
    {open&&<div className="final-text-check__body" aria-busy={state.loading}>
      {state.loading&&!data&&<p role="status">Loading…</p>}
      {data?.vote.status==='available'&&data.vote.scope==='individual-amendment'&&data.vote.outcome&&<p className="final-text-check__vote">{data.vote.stage==='committee'?'Committee vote':data.vote.stage==='plenary'?'Plenary vote':'Vote'}: {data.vote.outcome.toLowerCase().replaceAll('_',' ')}</p>}
      {data&&(shownStages.length?shownStages.map(stage=><Stage key={stage.destination.kind+':'+stage.destination.id} stage={stage} source={data.selection.source}/>):<p>Unavailable</p>)}
      {state.error&&<p role="status">{data?'Could not refresh comparison.':'Could not load comparison.'}</p>}
      {(state.error||data)&&<button type="button" disabled={state.loading} onClick={()=>setRetry(value=>value+1)}>{state.error?'Try again':'Check again'}</button>}
    </div>}
  </details>;
}

export function FinalTextCheck(selection:FinalTextSelection) {
  return <Session key={JSON.stringify([selection.documentId,selection.amendmentId,selection.listId,selection.wordingLanguage,selection.language])} selection={selection}/>;
}
export default FinalTextCheck;
