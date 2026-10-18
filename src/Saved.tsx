import {useEffect,useRef,useState} from 'react';
import {Status} from './Status';
import {savedKey,savedLinks,type SavedItem,type SavedStates} from './bookmarks.mjs';
import {humanDate} from './InsightCharts';
import {SaveButton,useSaved,checkSaved,savedStore as store,requestedKeys} from './SavedControls';

function savedCheckMessage(items:SavedItem[],data:SavedStates) {
  const unread=items.filter(item=>item.updated).length;
  const unavailable=items.filter(item=>!(item.kind==='question'?data.questions:data.members).some(state=>state.id===item.id&&state.status==='available')).length;
  return ['Check finished.',unread?`${unread} followed ${unread===1?'item has':'items have'} unread updates.`:'No unread updates are currently recorded.',unavailable?`Update information is unavailable for ${unavailable} followed ${unavailable===1?'item':'items'}.`:'',data.coverage?.indexComplete===true?'':'The saved index is incomplete.'].filter(Boolean).join(' ');
}
export function Saved({language,onBack,onMember}:{language:string;onBack:()=>void;onMember:(id:number,sourceId?:string)=>void}) {
  const saved=useSaved(),items=saved.items,[checking,setChecking]=useState(false),[error,setError]=useState('');
  const key=items.map(savedKey).sort().join(','),context=language+':'+key,request=useRef(0),active=useRef(false);
  const [attempt,setAttempt]=useState(0),[completion,setCompletion]=useState<{items:SavedItem[];message:string}|null>(null);
  useEffect(()=>{active.current=true;setChecking(false);setError('');setCompletion(null);return()=>{active.current=false;request.current++;};},[context]);
  const check=()=>{
    if(checking)return;
    const token=++request.current;setAttempt(token);setChecking(true);setError('');setCompletion(null);
    const current=()=>active.current&&request.current===token&&store.snapshot().items.map(savedKey).sort().join(',')===key;
    void (async()=>{
      while(current()){
        const checked=checkSaved(language,true),matches=requestedKeys.get(checked)===key;
        try{
          const result=await checked;if(!current())return;
          // A changed follow set already queues its matching refresh in checkSaved.
          // Keep this deliberate attempt attached to that result, including errors.
          if(!matches)continue;
          if(result){const settled=store.snapshot().items;setCompletion({items:settled,message:savedCheckMessage(settled,result.data)});}return;
        }catch(e){if(!current())return;if(!matches)continue;setError((e as Error).message);setCompletion({items:store.snapshot().items,message:'Could not check for updates. Saved items are still shown.'});return;}
      }
    })().finally(()=>{if(current())setChecking(false);});
  };
  return <section className="explorer-saved-view" lang="en">
    <Status scope={`saved-check:${context}:${attempt}`} message={completion?.items===items?completion.message:null} pending={checking}/>
    <button onClick={onBack}>← Back</button>
    <div className="explorer-saved-heading"><h1>Following</h1><button onClick={check} disabled={!items.length} aria-disabled={checking||undefined} style={checking?{opacity:.45,cursor:'default'}:undefined}>{checking?'Checking…':'Check for updates'}</button></div>
    <p className="explorer-saved-caption">MEPs and questions you follow on this device.</p>
    {!saved.persistent&&<p role="alert">Browser storage is unavailable. Your follows will last until this page closes.</p>}
    {error&&<p>{error}</p>}
    {!items.length&&<p>Follow a MEP or save a question to see new activity and answers here.</p>}
    <div className="explorer-saved-items">{items.map(item=><article key={savedKey(item)}>
      <div className="explorer-saved-heading"><h3 lang={item.titleLanguage||''}>{item.title}</h3><SaveButton item={item} language={language} compact/></div>
      {item.updated&&<strong className="explorer-update-label">{item.newAnswer?(item.newActivity?'New activity and new answer':'New answer'):item.newActivity?'New activity':'Updated'}</strong>}
      {item.availability==='outside-roster'&&<p>No longer on the current roster.</p>}
      {(item.kind==='mep'||item.memberId)&&<button onClick={()=>{item.kind==='mep'?store.markActivityRead(savedKey(item)):store.markRead(savedKey(item));onMember(Number(item.kind==='mep'?item.id:item.memberId),item.kind==='question'?item.id:undefined);}}>{item.kind==='mep'?'Profile':'Read question and answers'}</button>}
      {item.kind==='question'&&item.availability==='not-saved'&&<p>Question metadata is not available yet.</p>}
      {(item.kind==='mep'||item.memberId)&&savedLinks(item).map(activity=><a key={activity.id} href={'?lang='+language+'&member='+(item.kind==='mep'?item.id:item.memberId)+'&module=activities&activity='+encodeURIComponent(activity.id)} onClick={event=>{activity.recordKind==='answer'?store.markAnswerRead(savedKey(item),activity.id):store.markActivityRead(savedKey(item));if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();onMember(Number(item.kind==='mep'?item.id:item.memberId),activity.id);}}>{activity.recordKind==='answer'?'Answer: ':''}<span lang={activity.titleLanguage||''}>{activity.title}</span><small lang={activity.date?language:'en'}>{activity.date?humanDate(activity.date,language):'Date unavailable'}</small></a>)}
    </article>)}</div>
  </section>;
}
