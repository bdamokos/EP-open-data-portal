import {useEffect,useRef,useState} from 'react';
import {Status} from './Status';
import {savedKey,savedLinks,type SavedItem,type SavedStates} from './bookmarks.mjs';
import {humanDate} from './InsightCharts';
import {SaveButton,useSaved,checkSaved,savedStore as store,requestedKeys,openSavedMember} from './SavedControls';

function savedCheckMessage(items:SavedItem[],data:SavedStates) {
  const unread=items.filter(item=>item.updated).length;
  const unavailable=items.filter(item=>item.availability!=='available'||item.legacy).length;
  const state=store.snapshot();
  if(items.some(item=>item.kind==='mep')&&state.checkState!=='available')return [state.checkState==='unavailable'?'Update checks are not available yet for MEPs.':'MEP updates could not be checked.',items.some(item=>item.kind==='question')&&state.questionCheckState==='available'?'Question answers were checked.':'','Saved items are still shown.'].filter(Boolean).join(' ');
  return ['Check finished.',unread?`${unread} followed ${unread===1?'item has':'items have'} unread updates.`:'No unread updates are currently recorded.',unavailable?`Update information is unavailable for ${unavailable} followed ${unavailable===1?'item':'items'}.`:'',data.coverage?.indexComplete===true?'':'The saved index is incomplete.'].filter(Boolean).join(' ');
}
export function Saved({language,onBack,onMember}:{language:string;onBack:()=>void;onMember:(id:number,sourceId?:string)=>void}) {
  const saved=useSaved(),items=saved.items,[checking,setChecking]=useState(false),[error,setError]=useState(''),[opened,setOpened]=useState<Set<string>>(new Set()),[opening,setOpening]=useState('');
  const open=async(item:SavedItem)=>{setOpening(item.id);setError('');try{await openSavedMember(item,language);setOpened(previous=>new Set([...previous,item.id]));}catch(e){setError((e as Error).message);}finally{setOpening('');}};
  const key=items.map(item=>savedKey(item)+':'+(item.savedAt??'')).sort().join(','),context=language+':'+key,request=useRef(0),active=useRef(false);
  const [attempt,setAttempt]=useState(0),[completion,setCompletion]=useState<{items:SavedItem[];message:string}|null>(null);
  const displayed=useRef<SavedItem[]>([]),visit=useRef(0);
  useEffect(()=>{if(document.visibilityState!=='hidden')displayed.current=items;},[items]);
  useEffect(()=>{
    const epoch=++visit.current;
    const visible=()=>{if(document.visibilityState==='visible')displayed.current=store.snapshot().items;};
    const leave=()=>store.markVisitRead(displayed.current);
    document.addEventListener('visibilitychange',visible);window.addEventListener('pagehide',leave);
    return()=>{
      document.removeEventListener('visibilitychange',visible);window.removeEventListener('pagehide',leave);
      // StrictMode remounts effects; only a real departure acknowledges this visit.
      queueMicrotask(()=>{if(visit.current===epoch)leave();});
    };
  },[]);
  useEffect(()=>{active.current=true;setChecking(false);setError('');setCompletion(null);return()=>{active.current=false;request.current++;};},[context]);
  const check=()=>{
    if(checking)return;
    const token=++request.current;setAttempt(token);setChecking(true);setError('');setCompletion(null);
    const current=()=>active.current&&request.current===token&&store.snapshot().items.map(item=>savedKey(item)+':'+(item.savedAt??'')).sort().join(',')===key;
    void (async()=>{
      while(current()){
        const checked=checkSaved(language,true),matches=requestedKeys.get(checked)===key;
        try{
          const result=await checked;if(!current())return;
          // A changed follow set already queues its matching refresh in checkSaved.
          // Keep this deliberate attempt attached to that result, including errors.
          if(!matches)continue;
          if(result){const settled=store.snapshot().items;setCompletion({items:settled,message:savedCheckMessage(settled,result.data)});}return;
        }catch(e){if(!current())return;if(!matches)continue;setError((e as Error).message);setCompletion({items:store.snapshot().items,message:store.snapshot().questionCheckState==='available'?'Question answers were checked. Other updates could not be checked. Saved items are still shown.':'Could not check for updates. Saved items are still shown.'});return;}
      }
    })().finally(()=>{if(current())setChecking(false);});
  };
  return <section className="explorer-saved-view" lang="en">
    <Status scope={`saved-check:${context}:${attempt}`} message={completion?.items===items?completion.message:null} pending={checking}/>
    <button onClick={onBack}>← Back</button>
    <div className="explorer-saved-heading"><h1>Following</h1><button onClick={check} disabled={!items.length} aria-disabled={checking||undefined} style={checking?{opacity:.45,cursor:'default'}:undefined}>{checking?'Checking…':'Check for updates'}</button></div>
    <p className="explorer-saved-caption">Changes to MEPs and questions you follow on this device since your last visit. Displayed updates are marked as seen when you leave Following.</p>
    {!saved.persistent&&<p>Browser storage is unavailable. Follows last only for this tab.</p>}
    {saved.storageError&&<p role="alert" className="explorer-storage-error">Changes since {new Date(saved.unsavedSince||Date.now()).toLocaleTimeString()} could not be saved in this browser and will be lost on reload. <button onClick={()=>store.retryStorage()}>Retry saving</button></p>}
    {saved.restarted&&<p>Update tracking restarted. Previously unread items are kept.</p>}
    {items.some(item=>item.kind==='mep')&&saved.checkState==='unavailable'&&<p>Update checks are not available yet for MEPs. <button onClick={check}>Retry</button></p>}
    {items.some(item=>item.kind==='mep')&&saved.checkState==='error'&&<p>Couldn't check for MEP updates. <button onClick={check}>Retry</button></p>}
    {items.some(item=>item.kind==='question')&&saved.questionCheckState==='error'&&<p>Couldn't check for question answers. <button onClick={check}>Retry</button></p>}
    {error&&<p>{error}</p>}
    {!items.length&&<p>Follow a MEP or save a question to see new activity and answers here.</p>}
    <div className="explorer-saved-items">{items.map(item=><article key={savedKey(item)}>
      <div className="explorer-saved-heading"><h3 lang={item.titleLanguage||''}>{item.title}</h3><SaveButton item={item} language={language} compact/></div>
      {item.updated&&<strong className="explorer-update-label">{item.unresolved?'New activity — open to see':item.legacyUpdated?'Updated before the upgrade':item.newAnswer?(item.newActivity?'New activity and new answer':'New answer'):item.newActivity?'New activity':'Updated'}</strong>}
      {item.availability==='outside-roster'&&<p>No longer on the current roster.</p>}
      {item.kind==='question'&&<p>{item.current?.answerIds?.length?'Answer available.':item.availability==='available'?'No answer available in the indexed data yet.':'Answer availability has not been checked.'}</p>}
      {item.legacy&&<p>Update check pending. <button onClick={check}>Retry</button></p>}
      {!item.updated&&(item.kind==='question'?saved.questionCheckState:saved.checkState)==='available'&&!item.legacy&&<p>{item.availability==='available'?'No new updates since your last visit.':item.checkedAt?'Update information is unavailable.':'Checking will establish a starting point for future updates.'}</p>}
      {item.kind==='question'&&item.updated&&!item.newAnswer&&!item.newActivity&&<p>Question details changed.</p>}
      {!item.indexComplete&&<small>The index is incomplete; more updates may be available.</small>}
      {(item.kind==='mep'||item.memberId)&&<button onClick={()=>{if(item.kind==='mep')void openSavedMember(item,language).catch(()=>{});onMember(Number(item.kind==='mep'?item.id:item.memberId),item.kind==='question'?item.id:undefined);}}>{item.kind==='mep'?'Profile':item.current?.answerIds?.length?'Read question and answers':'Read question'}</button>}
      {item.kind==='question'&&item.availability==='not-saved'&&<p>Question metadata is not available yet.</p>}
      {item.kind==='mep'&&<button onClick={()=>void open(item)} aria-disabled={opening===item.id||undefined}>{opening===item.id?'Opening…':opened.has(item.id)?'Refresh updates':'Open updates'}</button>}
      {item.kind==='mep'&&item.updated&&<button onClick={()=>store.markRead(savedKey(item))}>Mark all read</button>}
      {Boolean(item.unreadOmitted)&&<p>+{item.unreadOmitted} more not listed. <a href={'?lang='+language+'&member='+item.id+'&module=activities'} onClick={event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();onMember(Number(item.id));}}>See MEP activity</a></p>}
      {(item.kind==='mep'||item.memberId)&&savedLinks(item).map(activity=><a key={(activity.kind||activity.recordKind||'activity')+':'+activity.id} href={'?lang='+language+'&member='+(item.kind==='mep'?item.id:item.memberId)+'&module=activities&activity='+encodeURIComponent(activity.id)} onClick={event=>{activity.recordKind==='answer'?store.markAnswerRead(savedKey(item),activity.id):store.markActivityRead(savedKey(item),activity.id);if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();onMember(Number(item.kind==='mep'?item.id:item.memberId),activity.id);}}>{activity.recordKind==='answer'?'New answer: ':'New activity: '}<span lang={activity.titleLanguage||''}>{activity.title}</span><small lang={activity.date?language:'en'}>{activity.date?humanDate(activity.date,language):'Date unavailable'}</small></a>)}
    </article>)}</div>
  </section>;
}
