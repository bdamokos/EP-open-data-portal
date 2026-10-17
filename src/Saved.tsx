import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Status} from './Status';
import {api,expireActivityReads} from './data';
import {createSavedStore,savedKey,savedLinks,type SavedItem,type SavedStates} from './bookmarks.mjs';
import {humanDate} from './InsightCharts';
import {interfaceTerm,compoundLanguage} from './terms.mjs';
const listeners=new Set<()=>void>();let storage:Storage|null=null;
try{storage=window.localStorage;}catch{}
const store=createSavedStore(storage,()=>listeners.forEach(listener=>listener()));
window.addEventListener('storage',event=>{if(event.key==='ep.bookmarks.v1'||event.key===null)store.reload();});
export function useSaved(){return useSyncExternalStore(callback=>{listeners.add(callback);return()=>listeners.delete(callback);},store.snapshot);}
type SavedCheck={data:SavedStates;requestedKey:string};
const requestedKeys=new WeakMap<Promise<unknown>,string>();
let pending:Promise<SavedCheck>|null=null,lastCheck=0;
export function checkSaved(language:string,force=false) {
  if(pending)return pending;
  if(!force&&Date.now()-lastCheck<5*60_000)return Promise.resolve();
  const items=store.snapshot().items;if(!items.length)return Promise.resolve();
  const params=new URLSearchParams({lang:language});for(const [kind,key] of [['question','questions'],['mep','members']] as const){const ids=items.filter(item=>item.kind===kind).map(item=>item.id);if(ids.length)params.set(key,ids.join(','));}
  const requestedKey=items.map(savedKey).sort().join(',');const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12_000);
  pending=api<SavedStates>('insights/saved?'+params,ctrl.signal).then(data=>{expireActivityReads();store.observe(data);lastCheck=Date.now();return {data,requestedKey};}).finally(()=>{clearTimeout(timer);pending=null;if(store.snapshot().items.map(savedKey).sort().join(',')!==requestedKey)void checkSaved(language,true).catch(()=>{});});requestedKeys.set(pending,requestedKey);return pending;
}
function savedCheckMessage(items:SavedItem[],data:SavedStates) {
  const unread=items.filter(item=>item.updated).length;
  const unavailable=items.filter(item=>!(item.kind==='question'?data.questions:data.members).some(state=>state.id===item.id&&state.status==='available')).length;
  return ['Check finished.',unread?`${unread} followed ${unread===1?'item has':'items have'} unread updates.`:'No unread updates are currently recorded.',unavailable?`Update information is unavailable for ${unavailable} followed ${unavailable===1?'item':'items'}.`:'',data.coverage?.indexComplete===true?'':'The saved index is incomplete.'].filter(Boolean).join(' ');
}
export function useSavedChecks(language:string) {
  const {items}=useSaved(),key=items.map(savedKey).sort().join(',');
  useEffect(()=>{void checkSaved(language,true).catch(()=>{});const check=()=>{if(document.visibilityState==='visible')void checkSaved(language).catch(()=>{});};window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);return()=>{window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};},[key,language]);
}
export function SaveButton({item,compact=false,language='en'}:{item:SavedItem;compact?:boolean;language?:string}) {
  const {items}=useSaved(),saved=items.some(x=>savedKey(x)===savedKey(item)),[error,setError]=useState('');
  const label=item.kind==='mep'?{text:saved?'Following':'Follow',language:'en'}:interfaceTerm(saved?'saved-question':'save-question',language);
  const name=item.kind==='mep'?label.text+' MEP':label.text;
  const tooltip=item.kind==='mep'?(saved?'Saved in this browser':'Save in this browser'):interfaceTerm(saved?'saved-in-browser':'save-in-browser',language).text;
  return <><button className={'explorer-save-button'+(saved?' is-saved':'')} lang={item.title?compoundLanguage(label.language,item.titleLanguage):label.language} aria-label={`${name}${item.title?' · '+item.title:''}`} aria-pressed={saved} title={tooltip} onClick={()=>{try{store.toggle(item);setError('');}catch(e){setError((e as Error).message);}}}><span aria-hidden="true">{saved?'★':'☆'}</span>{!compact&&<span lang={label.language}>{label.text}</span>}</button>{error&&<small role="alert" lang="en">{error}</small>}</>;
}
export function SavedNav({onClick,current=false}:{onClick:()=>void;current?:boolean}) {
  const saved=useSaved(),items=saved.items,updates=items.filter(item=>item.updated).length;
  return <button onClick={onClick} lang="en" aria-current={current?'page':undefined}>Following{updates>0?<span className="explorer-saved-count">{updates} new</span>:items.length>0?<small> {items.length}</small>:null}</button>;
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
