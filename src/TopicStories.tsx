import {defaultUi} from './uiDefault.mjs';
import {storyLinkClick,focusStoryLink} from './storyLinkNavigation';
import {buildExactTopicStories,storyFactsRoute,storyRecord} from './exactTopicStories.mjs';
import {useInsightData} from './InsightData';
import {useEffect,useRef,useState,type ReactNode,type MouseEvent,type Ref} from 'react';
import {UiI18nProvider,UiMessage,useUiI18n} from './UiI18nReact';
import {updateExplorerQuery,useExplorerParam} from './explorerUrl';
import {buildReferenceTopicStories,normalizeReferenceStoryFacts,type StoryRecord,type StoryFacts,type StorySelection,type StoryValue,type StoryReference} from './topicStoryModel.mjs';
import {storyLinkClaims,storySetKey,parseStorySetKey} from './storyLinkModel.mjs';
import {topicsHref,monthRangeLabel,quarterBounds} from './topicPresentation.mjs';
import {recordHref,storyInterfaceHref} from './TopicsLinks';
import {dossierLinkClick,dossierJourneyRestoring} from './dossierJourney';
import {InsightQuestionReader} from './InsightReaders';
import {sourcePageUrl} from './SourceLink';
function storyHref(s:StorySelection){const filters={'t-q':s.period||'','t-mode':s.mode||'q','t-own':s.excludeOwn?'1':'0','t-zoom':s.zoom||'world'};return s.place||s.topic?topicsHref(s.place?'place:'+s.place:s.topic!,filters):'?'+new URLSearchParams({view:'geopolitics',...filters});}
function storyBackClick(e:MouseEvent<HTMLAnchorElement>){if(e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey&&history.state?.storyReturn){e.preventDefault();history.back();}else dossierLinkClick(e);}
function setHref(ref:StoryReference,s:StorySelection){const u=new URL(storyHref(s),location.href);u.searchParams.set('t-records',ref.setKey||storySetKey(ref,s));return u.pathname+u.search;}
function recordTarget(r:StoryRecord,locale:string){if(r.kind==='document'){const u=new URL(location.href);u.searchParams.delete('t-records');u.searchParams.set('t-record',r.id);return storyInterfaceHref(u.pathname+u.search,locale);}return r.kind==='press'?sourcePageUrl(r.url)||'':storyInterfaceHref(recordHref(r.id,r.kind==='answer'?'question':r.kind,undefined,undefined,r.speechId),locale);}
export function TopicStories({selection,fallback,facts:provided,onRecords}:{selection:StorySelection;fallback?:ReactNode;facts?:StoryFacts;onRecords?:(period?:string,claim?:string,linkId?:string)=>void}){
 const ui=useUiI18n(),[,setQuarter]=useExplorerParam<string>('t-q',''),[selected]=useExplorerParam<string>('t-records','');
 const response=useInsightData<any>(provided?null:storyFactsRoute({...selection,language:ui.language,period:undefined}));
 // While a changed filter loads, keep showing the story built from the previous facts and selection.
 const kept=useRef<{data:any;selection:StorySelection}|null>(null);if(response.data?.ready)kept.current={data:response.data,selection};
 const view=!provided&&!response.data?.ready&&response.loading&&kept.current?kept.current:{data:response.data,selection};
 // Prose, links and browsing all use the displayed selection; only the quarter follows the request at once.
 const display:StorySelection={...view.selection,period:selection.period};
 const facts=provided?normalizeReferenceStoryFacts(provided):null;
 const build=(locale:string)=>provided?storyLinkClaims(buildReferenceTopicStories(facts,{...display,language:locale,proseLanguage:locale}),display):buildExactTopicStories(view.data,{...display,language:locale,hasMessage:(id:string)=>{const i=locale===ui.locale?ui:defaultUi;return i.messageLocale(id)===i.locale;}});
 const nativeValue=(value:StoryValue):boolean=>value==null||typeof value==='string'||(Array.isArray(value)?value.every(nativeValue):'message'in value?ui.messageLocale(value.message)===ui.locale&&Object.values(value.values).every(nativeValue):nativeValue(value.text));
 const candidate=build(ui.locale),proseUi=candidate.every(line=>ui.messageLocale(line.id)===ui.locale&&Object.values(line.values).every(nativeValue))?ui:defaultUi;
 const lines=proseUi===ui?candidate:build(proseUi.locale),proseI18n={sourceLocale:'en',forLocale:()=>proseUi};
 const heading=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(!selected)focusStoryLink();},[selected,lines.length]);
 if(selected)return <TopicStoryRecords key={selected} selection={display}/>;
 if(!lines.length)return <>{response.error||response.data?.ready===false||!response.data?fallback:null}</>;
 const text=(v:StoryValue):string=>v==null?'':typeof v==='string'?v:Array.isArray(v)?new Intl.ListFormat(proseUi.language==='en'?'en-GB':proseUi.locale,{type:'conjunction'}).format(v.map(text)):'text'in v?text(v.text):proseUi.t(v.message,Object.fromEntries(Object.entries(v.values).map(([k,x])=>[k,text(x)])),v.counts);
 const renderValues=(values:Record<string,StoryValue>,path:string):Record<string,ReactNode>=>Object.fromEntries(Object.entries(values).map(([k,v])=>[k,render(v,path+'-'+k)]));
 const render=(v:StoryValue,path:string):ReactNode=>{
  if(v==null||typeof v==='string')return v;
  if(Array.isArray(v))return new Intl.ListFormat(proseUi.language==='en'?'en-GB':proseUi.locale,{type:'conjunction'}).formatToParts(v.map((_,i)=>String(i))).map((p,i)=>p.type==='element'?<span key={i}>{render(v[Number(p.value)],path+'-'+p.value)}</span>:p.value);
  if('text'in v&&v.labelLanguage&&!v.browse&&!v.pageRecords&&!v.records?.length)return <span lang={v.labelLanguage}>{typeof v.text==='string'?v.text:render(v.text,path+'-label')}</span>;
  if('message'in v)return <UiMessage id={v.message} values={renderValues(v.values,path)} counts={v.counts}/>;
  const label=typeof v.text==='string'?v.text:render(v.text,path+'-label'),single=!v.browse&&!v.pageRecords&&v.records.length===1;
  const href=v.target||(v.pageRecords?storyHref({...display,period:v.period||display.period})+'#topic-records':v.period?storyHref({...display,period:v.period}):single?recordTarget(v.records[0],ui.locale):setHref(v,display));
  const id='story-link-'+encodeURIComponent(v.setKey||storySetKey(v,{...display,period:v.period||display.period}));
  const visible=text(v.text),count=(typeof v.text==='object'?v.text.counts?.count:undefined)??v.expected,b=v.browse,placeName=b?.places?new Intl.ListFormat(proseUi.language==='en'?'en-GB':proseUi.locale,{type:'conjunction'}).format(b.places.split(',').map(p=>display.labels?.[p]||p)):display.labels?.[b?.place||display.place||'']||b?.place||display.place;
  const pageName=count!=null&&b&&placeName?proseUi.t(b.places?'topics.story.links.tieHeading':'topics.story.links.heading',{count,kind:proseUi.t('topics.story.links.kind.'+b.list,{count},{count}),place:placeName,places:placeName}):'';
  const accessible=pageName?(pageName.toLocaleLowerCase().includes(visible.toLocaleLowerCase())?pageName:visible+', '+pageName)+(display.period?', '+monthRangeLabel(display.period,proseUi.language):''):undefined;
  return <a id={id} lang={v.labelLanguage||undefined} href={storyInterfaceHref(href,ui.locale)} aria-label={accessible} onClick={e=>{
   if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
   if(v.pageRecords&&onRecords){e.preventDefault();onRecords(v.period||display.period,text(v.text),id);return;}
   if(v.period){e.preventDefault();setQuarter(v.period);requestAnimationFrame(()=>{heading.current?.focus();});return;}
   storyLinkClick(e,id);
  }}>{v.italic?<i lang={v.titleLanguage===undefined?'en':v.titleLanguage||''}>{label}</i>:label}</a>;
 };
 return <div className="topic-stories"><p className="topic-story" lang={proseUi.language} ref={heading} tabIndex={-1}><UiI18nProvider i18n={proseI18n}>{lines.map((line,i)=><span key={line.id+'-'+i}><UiMessage id={line.id} values={renderValues(line.values,String(i))} counts={line.counts}/>{' '}</span>)}</UiI18nProvider></p>{display.mode==='d'&&<p className="topic-muted" lang={ui.messageLocale('topics.story.jointOnce')}><UiMessage id="topics.story.jointOnce"/></p>}</div>;
}
// Remember the old length until appended rows mount, including the final page.
function useRevealedRowFocus(count:number){
 const pending=useRef<number|null>(null),target=useRef<HTMLAnchorElement>(null);
 useEffect(()=>{if(pending.current!==null&&count>pending.current){target.current?.focus();pending.current=null;}},[count]);
 return {target,index:pending.current,prepare:()=>{pending.current=count;}};
}
function RecordRow({record:r,children,focusRef}:{record:StoryRecord;children?:ReactNode;focusRef?:Ref<HTMLAnchorElement>}){
 const ui=useUiI18n(),o=r.outcome,date=r.date?new Intl.DateTimeFormat(ui.language==='en'?'en-GB':ui.locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(r.date+'T12:00:00Z')):ui.t('topics.story.dateUnavailable');
 const kindId=/^JOINT MOTION FOR A RESOLUTION/i.test(r.title)?'jointMotion':/^MOTION FOR A RESOLUTION/i.test(r.title)?'motion':/^(?:INTERIM )?REPORT/i.test(r.title)?'report':/^RECOMMENDATION/i.test(r.title)?'recommendation':null;
 const title=r.title.replace(/^(?:(?:JOINT )?MOTION FOR A RESOLUTION|(?:INTERIM )?REPORT|RECOMMENDATION)\s*(?:on\s+)?/i,'')||ui.t('topics.untitled');
 return <article><small>{ui.t(kindId?'topics.story.links.row.'+kindId:'topics.kind.'+r.kind)} · {date}</small><a ref={focusRef} lang={r.title.trim()?(r.titleLanguage===undefined?'en':r.titleLanguage||''):ui.messageLocale('topics.untitled')} href={recordTarget(r,ui.locale)} onClick={event=>{dossierLinkClick(event);if(event.defaultPrevented&&r.kind==='document')history.replaceState({...history.state,storyReturn:true},'');}}>{title}</a>{o&&['ADOPTED','REJECTED'].includes(o.outcome)&&<p><UiMessage id={'topics.story.records.'+(o.outcome==='REJECTED'?(o.for!=null?'rejectedTally':'rejected'):o.for!=null?'passed':/VOTE_HAND/.test(o.method||'')?'showOfHands':'adopted')} values={{for:o.for??'',against:o.against??''}}/></p>}{Boolean(children||r.supporting?.length)&&<div className="story-supporting">{children||r.supporting?.map(child=><RecordRow key={child.id} record={child}/>)}</div>}</article>;
}
export function StoryBrowse({selection,browse,onTotal,singleRecord=false}:{selection:StorySelection;browse:Record<string,string>;onTotal?:(total:number|null)=>void;singleRecord?:boolean}){
 const ui=useUiI18n(),[cursor,setCursor]=useState(''),[items,setItems]=useState<StoryRecord[]>([]),[total,setTotal]=useState<number|null>(null),[reload,setReload]=useState(false),[missing,setMissing]=useState(false);
 const focus=useRevealedRowFocus(items.length);
 const scope={...selection,...(browse.place?{place:browse.place,topic:undefined}:{}),...(Object.hasOwn(browse,'period')?{period:browse.period||undefined}:{})};
 const response=useInsightData<any>(storyFactsRoute({...scope,language:ui.language},{list:browse.list,cursor,askers:browse.askers||'all'})),data=response.data;
 // An expired cursor names an obsolete snapshot. Navigate to page one rather
 // than retrying that rejected cursor or dropping the rows already displayed.
 useEffect(()=>{if(cursor&&response.status===409&&response.code==='story_cursor'){setCursor('');setReload(true);}},[cursor,response.status,response.code]);
 useEffect(()=>{if(reload){setReload(false);response.retry();}},[reload,cursor,response.retry]);
 useEffect(()=>{if(data?.ready&&data.page){setTotal(data.page.total);onTotal?.(data.page.total);const evidence=new Map([...data.debates.map((r:any)=>[r.id,storyRecord(r,'debate')]),...data.docs.map((r:any)=>[r.id,storyRecord(r,'document')]),...data.questions.map((r:any)=>[r.id,storyRecord(r,'question')])]);const next=data.page.items.map((r:any)=>{const record=evidence.get(r.id);return record?{...record,date:r.date||undefined,supporting:(data.debates.find((d:any)=>d.id===r.id)?.docs||[]).map((id:string)=>data.docs.find((d:any)=>d.id===id)).filter(Boolean).map((d:any)=>storyRecord(d,'document')).concat((data.questions.find((q:any)=>q.id===r.id)?.answers||[]).map((a:any)=>({...a,kind:'answer',title:a.title||ui.t('textsearch.answer')})))}:null;}).filter(Boolean);const incomplete=next.length!==data.page.items.length;setMissing(incomplete);if(incomplete){setTotal(null);onTotal?.(null);}if(!incomplete&&singleRecord&&data.page.total===1&&next.length===1)updateExplorerQuery(url=>{url.href=new URL(recordTarget(next[0],ui.locale),location.href).href;},true);setItems(old=>cursor?[...new Map([...old,...next].map(r=>[r.id,r])).values()]:next);}},[data,cursor]);
 return <>{items.map((r,i)=><RecordRow key={r.id} record={r} focusRef={i===focus.index?focus.target:undefined}/>)}{total!==null&&total>0&&<p><UiMessage id="topics.story.links.showing" values={{shown:items.length,total}}/></p>}{data?.ready&&data.page&&!response.loading&&!items.length&&<p><UiMessage id="topics.story.links.empty"/></p>}{response.loading&&<p><UiMessage id="insightshared.loading"/></p>}{(missing||response.error||data?.ready===false)&&<p><UiMessage id="topics.story.links.unavailable"/> </p>}{data?.page?.nextCursor&&<button disabled={response.loading} onClick={()=>{focus.prepare();setCursor(data.page.nextCursor);}}><UiMessage id="topics.story.links.more" values={{count:Math.min(20,Math.max(1,(total||0)-items.length))}} counts={{count:Math.min(20,Math.max(1,(total||0)-items.length))}}/></button>}</>;
}
export function TopicStoryRecords({selection}:{selection:StorySelection}){
 const ui=useUiI18n(),[key]=useExplorerParam<string>('t-records',''),parsed=parseStorySetKey(key),heading=useRef<HTMLHeadingElement>(null),[total,setTotal]=useState<number|null>(null),[shown,setShown]=useState(20),[tieCounts,setTieCounts]=useState<Record<string,number>>({});
 const resolvedSelection={...selection,zoom:parsed?.zoom||selection.zoom||'world',mode:parsed?.mode||selection.mode||'q',excludeOwn:parsed?parsed.askers==='not-home':selection.excludeOwn};
 const data=useInsightData<any>(parsed&&['records','urgency-debates','places'].includes(parsed.list)?storyFactsRoute({...resolvedSelection,language:ui.language,period:parsed.period==='term'?undefined:parsed.period}):null);
 const scope=parsed?.scope||'',places=scope.split(','),periods=parsed?.period.split(',')||[],period=parsed?.period==='term'?undefined:parsed?.period,baseline=periods.length>1;
 const policy=/^(?:oeil|eurovoc):/.test(scope),single=scope&&scope!=='map'&&!scope.includes(',');
 const names=useInsightData<any>(single&&(policy||!selection.labels?.[scope]||selection.labels?.[scope]===scope)?'topics/detail?'+new URLSearchParams({key:/^[A-Z]{3}$/.test(scope)?'place:'+scope:scope,lang:ui.language}):null);
 const adoptedPlaces=Object.keys(data.data?.series||{}).filter(p=>period?(data.data.series[p]?.[period]?.adoptedTexts||0)>0:Object.values(data.data.series[p]).some((v:any)=>(v.adoptedTexts||0)>0));
 const needed=scope==='map'?(parsed?.list==='places'?adoptedPlaces:[]):places.filter(Boolean),needsOverview=!single&&needed.some(p=>!selection.labels?.[p]||selection.labels?.[p]===p);
 const overview=useInsightData<any>(needsOverview?'topics/overview?'+new URLSearchParams({role:policy?'topic':'place',lang:ui.language}):null);
 const labels=new Map<string,{label:string;labelLanguage?:string}>(Object.entries(selection.labels||{}).map(([key,label])=>[key,{label,labelLanguage:selection.labelLanguages?.[key]||undefined}]));
 for(const item of overview.data?.items||[])labels.set(item.id||item.key.replace(/^place:/,''),item);
 if(data.data?.topic)labels.set(data.data.topic.key,data.data.topic);
 if(names.data?.concept)labels.set(scope,names.data.concept);
 const name=(p:string)=>labels.get(p)?.label||'',named=(p:string)=><span lang={labels.get(p)?.labelLanguage||undefined}>{name(p)}</span>;
 const labelsReady=needed.every(p=>Boolean(name(p)&&name(p)!==p));
 const labelsUnavailable=!labelsReady&&Boolean(names.error||overview.error||names.data?.ready===false||overview.data?.ready===false||single&&names.data?.ready||needsOverview&&overview.data?.ready);
 const label=scope==='map'?ui.t('topics.places'):new Intl.ListFormat(ui.language==='en'?'en-GB':ui.locale,{type:'conjunction'}).formatToParts(places.map((_,i)=>String(i))).map((part,i)=>part.type==='element'?<span key={i}>{named(places[Number(part.value)])}</span>:part.value);
 const idKinds=parsed?.ids?.split(',').map(v=>v.split('~')[0])||[],knownKind=idKinds.includes('debate')?'debates':idKinds.length&&idKinds.every(k=>k==='document')?'documents':idKinds.length&&idKinds.every(k=>k==='question')?'questions':'records';
 const kind=parsed?.list==='urgency-debates'?'debates':parsed?.list==='records'?parsed.kind||knownKind:parsed?.list||'records',kindLabel=(count:number)=><UiMessage id={'topics.story.links.kind.'+kind} values={{count}} counts={{count}}/>;
 const tieTotal=places.length>1&&places.every(p=>tieCounts[p]>0)?tieCounts[places[0]]:null;
 const comparedBounds=quarterBounds(selection.period||''),beforeMonth=comparedBounds?new Intl.DateTimeFormat(ui.locale,{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(comparedBounds.from+'T12:00:00Z')):'';
 const title=parsed?.list==='places'&&total?<UiMessage id="topics.story.links.placesHeading" values={{count:total}} counts={{count:total}}/>:parsed?.list==='urgency-debates'&&total?<UiMessage id="topics.story.links.urgencyHeading" values={{count:total}} counts={{count:total}}/>:tieTotal?<UiMessage id="topics.story.links.tieHeading" values={{count:tieTotal,kind:kindLabel(tieTotal),places:label}}/>:baseline?<UiMessage id={'topics.story.links.before.'+kind} values={{place:label,period:beforeMonth}}/>:total?<UiMessage id="topics.story.links.heading" values={{count:total,kind:kindLabel(total),place:label}}/>:<UiMessage id="topics.story.records"/>;
 const headingReady=labelsReady&&(!parsed||baseline||(places.length>1?places.every(p=>Object.hasOwn(tieCounts,p)):total!==null));
 useEffect(()=>{if(headingReady&&!dossierJourneyRestoring()){heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'start'});}},[key,headingReady]);
 const back=storyHref({...selection,mode:resolvedSelection.mode,zoom:resolvedSelection.zoom,excludeOwn:new URLSearchParams(location.search).has('t-own')?selection.excludeOwn:resolvedSelection.excludeOwn}),meta=period?(monthRangeLabel(parsed!.period,ui.language)):ui.t('topics.thisTerm');
 const ids=parsed?.ids?.split(',').map(x=>x.split('~')[1])||[];
 const found:StoryRecord[]=parsed?.list==='urgency-debates'?(data.data?.sets?.urgencyDebates?.[period||'']||[]).map((id:string)=>data.data.debates.find((r:any)=>r.id===id)).filter(Boolean).map((r:any)=>storyRecord(r,'debate')):ids.map(id=>{const r=data.data?.debates?.find((r:any)=>r.id===id)||data.data?.docs?.find((r:any)=>r.id===id)||data.data?.questions?.find((r:any)=>r.id===id);return r?{...storyRecord(r,data.data?.debates?.includes(r)?'debate':data.data?.docs?.includes(r)?'document':'question'),speechId:parsed?.ids?.split(',').map(v=>v.split('~')).find(v=>v[1]===id)?.[2]}:null;}).filter(Boolean);
 const records=parsed?.list==='records'&&kind==='debates'?found.filter(r=>r.kind==='debate'):found;
 const requested=parsed?.list==='urgency-debates'?data.data?.sets?.urgencyDebates?.[period||'']||[]:ids,expected=parsed?.expected??(parsed?.list==='urgency-debates'?data.data?.counts?.urgencyDebates:undefined);
 const incomplete=Boolean(data.data?.ready&&['records','urgency-debates'].includes(parsed?.list||'')&&(requested.some((id:string)=>!found.some(r=>r.id===id))||expected!==undefined&&records.length!==expected));

 const sortedPlaces=[...adoptedPlaces].sort((a,b)=>new Intl.Collator(ui.locale).compare(name(a),name(b)));
 useEffect(()=>{if(data.data?.ready)setTotal(incomplete?null:parsed?.list==='places'?adoptedPlaces.length:records.length);},[data.data]);
 const browse=(p:string,q=period||'')=>({list:kind,place:/^[A-Z]{3}$/.test(p)?p:'',period:q,askers:parsed?.askers||'all'});
 return <section className="topic-story-records"><a href={storyInterfaceHref(back,ui.locale)} onClick={storyBackClick}><UiMessage id="topics.story.links.back"/></a>{headingReady&&<h1 ref={heading} tabIndex={-1}>{title}</h1>}<p>{meta}{kind==='questions'&&<> · <UiMessage id={parsed?.askers==='not-home'?'topics.leaveOwn':parsed?.askers==='elsewhere'?'topics.onlyElsewhere':'topics.story.links.allAuthors'}/></>}</p>{!parsed?<p><UiMessage id="topics.story.links.unavailable"/></p>:!labelsReady?<p><UiMessage id={labelsUnavailable?'topics.story.links.unavailable':'insightshared.loading'}/>{labelsUnavailable&&<> </>}</p>:parsed.list==='places'?<>{data.loading&&<p><UiMessage id="insightshared.loading"/></p>}{(data.error||data.data?.ready===false)&&<p><UiMessage id="topics.story.links.unavailable"/> </p>}{data.data?.ready&&!adoptedPlaces.length&&<p><UiMessage id="topics.story.links.empty"/></p>}{sortedPlaces.slice(0,shown).map(p=><ExpandableRecords key={p} selection={resolvedSelection} browse={{list:'adoptedTexts',place:p,period:period||'',askers:parsed.askers}} label={named(p)}/>)}{adoptedPlaces.length>0&&<p><UiMessage id="topics.story.links.showing" values={{shown:Math.min(shown,adoptedPlaces.length),total:adoptedPlaces.length}}/></p>}{adoptedPlaces.length>shown&&<button onClick={()=>setShown(n=>n+20)}><UiMessage id="topics.story.links.more" values={{count:Math.min(20,adoptedPlaces.length-shown)}} counts={{count:Math.min(20,adoptedPlaces.length-shown)}}/></button>}</>:baseline?<>{places.map(p=><section key={p}>{places.length>1&&<h2>{named(p)}</h2>}<Baseline selection={resolvedSelection} places={[p]} periods={periods} list={kind} askers={parsed.askers}/></section>)}</>:places.length>1?places.map(p=><section key={p}><h2>{tieCounts[p]?<UiMessage id="topics.story.links.heading" values={{count:tieCounts[p],kind:kindLabel(tieCounts[p]),place:named(p)}}/>:named(p)}</h2><StoryBrowse selection={resolvedSelection} browse={browse(p)} onTotal={n=>setTieCounts(old=>{if(n===null){const next={...old};delete next[p];return next;}return old[p]===n?old:{...old,[p]:n};})}/><a href={storyInterfaceHref(topicsHref('place:'+p),ui.locale)} onClick={dossierLinkClick}><UiMessage id="topics.story.links.onward" values={{place:named(p)}}/></a></section>):['records','urgency-debates'].includes(parsed.list)?<StaticStorySet data={data} records={records} incomplete={incomplete} shown={shown} showMore={()=>setShown(n=>n+20)}/>:<StoryBrowse selection={{...resolvedSelection,...(policy?{topic:scope,place:undefined}:{})}} browse={browse(scope)} onTotal={setTotal} singleRecord/>}{labelsReady&&places.length===1&&scope!=='map'&&<p><a href={storyInterfaceHref(topicsHref(/^[A-Z]{3}$/.test(scope)?'place:'+scope:scope),ui.locale)} onClick={dossierLinkClick}><UiMessage id="topics.story.links.onward" values={{place:label}}/></a></p>}</section>;
}
function Baseline({selection,places,periods,list,askers}:{selection:StorySelection;places:string[];periods:string[];list:string;askers:string}){
 const ui=useUiI18n(),facts=useInsightData<any>(storyFactsRoute({...selection,language:ui.language,place:/^[A-Z]{3}$/.test(places[0])?places[0]:undefined,topic:/^[A-Z]{3}$/.test(places[0])?undefined:places[0],period:undefined})),counts=periods.map(period=>facts.data?.periodCounts?.find((r:any)=>r.period===period)?.[list]),known=counts.every(n=>typeof n==='number'),total=known?counts.reduce((a,b)=>a+b,0):null;
 const compared={text:'',records:[],browse:{list,place:/^[A-Z]{3}$/.test(places[0])?places[0]:'',period:selection.period||'',askers}};
 return <>{total!==null&&<p><UiMessage id="topics.story.links.arithmetic" values={{total,kind:ui.t('topics.story.links.kind.'+list,{count:total},{count:total}),quarters:periods.length,mean:new Intl.NumberFormat(ui.locale,{maximumFractionDigits:1}).format(total/periods.length)}}/></p>}{periods.map((p,i)=><ExpandableRecords key={p} selection={selection} browse={{list,place:/^[A-Z]{3}$/.test(places[0])?places[0]:'',period:p,askers}} label={monthRangeLabel(p,ui.language)+(known?' · '+counts[i]:'')}/>)}{selection.period&&<p><a href={storyInterfaceHref(setHref(compared,selection),ui.locale)} onClick={dossierLinkClick}>{monthRangeLabel(selection.period,ui.language)}</a></p>}</>;
}

export function TopicStoryDocument({selection,id}:{selection:StorySelection;id:string}){const ui=useUiI18n(),facts=useInsightData<any>(storyFactsRoute({...selection,language:ui.language})),record=facts.data?.docs?.find((r:any)=>r.id===id),heading=useRef<HTMLHeadingElement>(null);useEffect(()=>{if(!dossierJourneyRestoring())heading.current?.focus();},[id]);return <section className="topic-story-records"><a href={storyInterfaceHref(storyHref(selection),ui.locale)} onClick={storyBackClick}><UiMessage id="topics.story.links.back"/></a><h1 lang={record?.titleLanguage===undefined?'en':record.titleLanguage||''} tabIndex={-1} ref={heading}>{record?.title||ui.t('topics.kind.document')}</h1>{record&&<RecordRow record={storyRecord(record,'document')}/>}<InsightQuestionReader id={id} language={ui.language} heading={ui.t('topics.kind.document')}/></section>;}

function ExpandableRecords({selection,browse,label}:{selection:StorySelection;browse:Record<string,string>;label:ReactNode}){const [open,setOpen]=useState(false);return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>{label}</summary>{open&&<StoryBrowse selection={selection} browse={browse}/>}</details>;}

function StaticStorySet({data,records,incomplete,shown,showMore}:{data:any;records:StoryRecord[];incomplete:boolean;shown:number;showMore:()=>void}){
 const ui=useUiI18n(),focus=useRevealedRowFocus(Math.min(shown,records.length));
 if(data.loading)return <p><UiMessage id="insightshared.loading"/></p>;
 if(incomplete||data.error||data.data?.ready===false)return <p><UiMessage id="topics.story.links.unavailable"/> </p>;
 if(!records.length)return <p><UiMessage id="topics.story.links.empty"/></p>;
 return <>{records.slice(0,shown).map((r,i)=><RecordRow key={r.id} record={r} focusRef={i===focus.index?focus.target:undefined}>{(data.data?.debates?.find((d:any)=>d.id===r.id)?.docs||[]).map((id:string)=>data.data.docs.find((d:any)=>d.id===id)).filter(Boolean).map((d:any)=><RecordRow key={d.id} record={storyRecord(d,'document')}/>)}</RecordRow>)}<p><UiMessage id="topics.story.links.showing" values={{shown:Math.min(shown,records.length),total:records.length}}/></p>{records.length>shown&&<button onClick={()=>{focus.prepare();showMore();}}><UiMessage id="topics.story.links.more" values={{count:Math.min(20,records.length-shown)}} counts={{count:Math.min(20,records.length-shown)}}/></button>}</>;
}
