import {buildExactTopicStories,storyFactsRoute,storyRecord} from './exactTopicStories.mjs';
import {useInsightData} from './InsightData';
import {GROUP_VOICE_GROUPSUi} from './groupVoiceTerms.mjs';
import {useEffect,useRef,useState,useId,type ReactNode} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {useExplorerParam} from './explorerUrl';
import {buildReferenceTopicStories,storyNumber,normalizeReferenceStoryFacts,type StoryRecord,type StoryFacts,type StoryReference,type StorySelection,type StoryValue} from './topicStoryModel.mjs';
import {topicsHref} from './topicPresentation.mjs';
import {recordHref} from './TopicsLinks';
import {sourcePageUrl} from './SourceLink';
import {dossierLinkClick,navigateDossier,useDossierReaderState} from './dossierJourney';
import {InsightQuestionReader,InsightSpeechReader} from './InsightReaders';
export function TopicStories({selection,fallback,facts:provided,onRecords}:{selection:StorySelection;fallback?:ReactNode;facts?:StoryFacts;onRecords?:(period?:string)=>void}){
 const ui=useUiI18n(),panel=useId(),[selected,setSelected]=useExplorerParam<string>('t-story',''),[reading,setReading]=useExplorerParam<string>('t-story-read',''),[,setQuarter]=useExplorerParam<string>('t-q','');
 const response=useInsightData<any>(provided?null:storyFactsRoute({...selection,period:undefined}));
 const facts=provided?normalizeReferenceStoryFacts(provided):null;
 const [shown,setShown]=useState(20);
 const lines=provided?buildReferenceTopicStories(facts,{...selection,language:ui.language,proseLanguage:ui.messageLocale('topics.story.ordinal.other')}):buildExactTopicStories(response.data,{...selection,language:ui.language}),heading=useRef<HTMLHeadingElement>(null),opener=useRef<HTMLAnchorElement|null>(null);
 useEffect(()=>{setShown(20);if(selected&&heading.current){heading.current.focus({preventScroll:true});heading.current.scrollIntoView({block:'start'});}else if(!selected&&opener.current?.isConnected){opener.current.focus({preventScroll:true});opener.current=null;}},[selected,Boolean(lines.length)]);
 const questionGap=selection.excludeOwn&&selection.unknownQuestions&&selection.mode!=='d';
 if(!lines.length)return <>{response.data?.ready&&questionGap?<p className="topic-muted"><UiMessage id="topics.story.questionsUnavailable"/></p>:response.error||response.data?.ready===false||!response.data?fallback:null}</>;
 const refs=new Map<string,StoryReference>();
 const hrefFor=(key:string,record='',period=selection.period)=>{const filters={'t-q':period||'','t-mode':selection.mode||'q','t-own':selection.excludeOwn?'1':'0','t-zoom':selection.zoom||'world','t-story':key,...(record?{'t-story-read':record}:{})};return selection.place||selection.topic?topicsHref(selection.place?'place:'+selection.place:selection.topic!,filters):'?'+new URLSearchParams({view:'topics','t-tab':'places',...filters});};
 const renderValues=(values:Record<string,StoryValue>,path:string):Record<string,ReactNode>=>Object.fromEntries(Object.entries(values).map(([key,value])=>[key,render(value,path+'-'+key)]));
 const render=(value:StoryValue,path:string):ReactNode=>{
  if(value===null||typeof value==='string')return value;
  if(Array.isArray(value))return new Intl.ListFormat(ui.locale,{style:'long',type:'conjunction'}).formatToParts(value.map((_,i)=>String(i))).map((part,i)=>part.type==='element'?<span key={i}>{render(value[Number(part.value)],path+'-'+part.value)}</span>:part.value);
  if('message' in value)return <UiMessage id={value.message} values={renderValues(value.values,path)} counts={value.counts}/>;
  refs.set(path,value);
  const label=typeof value.text==='string'?value.text:render(value.text,path+'-label');
  return <a href={value.target||hrefFor(path,'',value.period||selection.period)+'#'+(value.pageRecords?'topic-records':panel)} onClick={e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;if(value.target){dossierLinkClick(e);return;}e.preventDefault();opener.current=e.currentTarget;setReading('');if(value.pageRecords){if(onRecords){onRecords(value.period||selection.period);return;}navigateDossier(topicsHref(selection.place?'place:'+selection.place:selection.topic!,{'t-q':value.period||selection.period||''})+'#topic-records');const target=document.getElementById('topic-records')?.querySelector('h2');if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});}}else if(value.period){setQuarter(value.period);setSelected('');}else setSelected(selected===path?'':path);}} aria-expanded={selected===path} aria-controls={selected===path?panel:undefined}>{value.italic?<i lang="en">{label}</i>:label}</a>;
 };
 const sentences=lines.map((line,i)=><span key={line.id+'-'+i}><UiMessage id={line.id} values={renderValues(line.values,String(i))} counts={line.counts}/>{' '}</span>),active=refs.get(selected);
 const num=(n:number)=>storyNumber(n,ui.language);
 const renderRecord=(r:StoryRecord)=>{
  const inline=['document','question','speech'].includes(r.kind),source=r.kind==='press'?sourcePageUrl(r.url):null,href=inline?hrefFor(selected,r.id):source||recordHref(r.id,r.kind),o=r.outcome;
  return <article key={r.kind+':'+r.id}><small>{r.date||<UiMessage id="topics.story.dateUnavailable"/>}</small><a href={href} onClick={e=>{if(inline&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();setReading(reading===r.id?'':r.id);}else if(!source)dossierLinkClick(e);}}>{r.title}</a>{r.groups?.length? <p><UiMessage id="topics.story.records.groups" values={{groups:new Intl.ListFormat(ui.locale,{type:'conjunction'}).format(r.groups.map(g=>(GROUP_VOICE_GROUPSUi(ui) as Record<string,string>)[g.replace('S-D','S_D').replace('VERTS-ALE','VERTS_ALE').replace('THE-LEFT','THE_LEFT')]||g))}}/></p>:null}{o&&['ADOPTED','REJECTED'].includes(o.outcome)&&<p><UiMessage id={'topics.story.records.'+(o.outcome==='REJECTED'?(o.for!=null&&o.against!=null?'rejectedTally':'rejected'):o.for!=null&&o.against!=null?'passed':/VOTE_HAND/.test(o.method||o.decision_method||'')?'showOfHands':'adopted')} values={{for:o.for==null?'':num(o.for),against:o.against==null?'':num(o.against)}}/></p>}{reading===r.id&&(r.kind==='speech'?<InsightSpeechReader id={r.id} language={ui.language}/>:<InsightQuestionReader id={r.id} language={ui.language} heading={ui.t('topics.kind.'+r.kind)}/>)}</article>;
 };
 return <div className="topic-stories"><p className="topic-story">{sentences}</p>{selection.mode==='d'&&<p className="topic-muted"><UiMessage id="topics.story.jointOnce"/></p>}{(questionGap||selection.mode!=='d'&&selection.excludeOwn&&selection.unknownHistory)&&<p className="topic-muted"><UiMessage id={questionGap?'topics.story.questionsUnavailable':'topics.story.comparisonsUnavailable'}/></p>}{active&&!active.pageRecords&&<section id={panel} className="topic-story-records" aria-label={ui.t('topics.story.records')}><h3 ref={heading} tabIndex={-1}>{active.browse?.periods?<UiMessage id="topics.story.exact.periods"/>:typeof active.text==='string'?active.text:render(active.text,'record-heading')}</h3>{active.browse?<StoryBrowse key={selected} selection={selection} browse={active.browse} renderRecord={renderRecord}/>:active.records.slice(0,shown).map(renderRecord)}{active.records.length>shown&&<button onClick={()=>setShown(n=>n+20)}><UiMessage id="topics.more"/></button>}{!active.browse&&!active.records.length&&<p><UiMessage id="topics.empty"/></p>}</section>}</div>;
}

function StoryBrowse({selection,browse,renderRecord}:{selection:StorySelection;browse:Record<string,string>;renderRecord:(record:any)=>ReactNode}){
 const ui=useUiI18n();
 const saved='story-browse:'+JSON.stringify([selection,browse]),periods=browse.periods?.split(',')||[];
 const [browsePeriod,setBrowsePeriod]=useDossierReaderState<string>(saved+':period',periods[0]||''),[cursor,setCursor]=useDossierReaderState<string>(saved+':cursor',''),[items,setItems]=useDossierReaderState<StoryRecord[]>(saved+':items',[]),[reload,setReload]=useState(false);
 const scope={...selection,...(browsePeriod?{period:browsePeriod}:{}),...(Object.hasOwn(browse,'period')?{period:browse.period||undefined}:{}),...(browse.place?{place:browse.place,topic:undefined}:{})};
 const query={list:browse.list,cursor,...(browse.askers?{askers:browse.askers}:{})};
 const response=useInsightData<any>(storyFactsRoute(scope,query)),data=response.data;
 useEffect(()=>{if(reload){setReload(false);response.retry();}},[reload,cursor,response.retry]);
 useEffect(()=>{if(data?.ready&&data.page){const evidence=new Map([...data.debates.map((r:any)=>[r.id,storyRecord(r,'debate')]),...data.docs.map((r:any)=>[r.id,storyRecord(r,'document')]),...data.questions.filter((r:any)=>!scope.place||!scope.excludeOwn||!r.home.includes(scope.place)).map((r:any)=>[r.id,storyRecord(r,'question')])]);const next=data.page.items.map((r:any)=>{const record=evidence.get(r.id);return record?{...record,date:r.date||undefined}:null;}).filter(Boolean);setItems(old=>cursor?[...new Map([...old,...next].map(r=>[r.id,r])).values()]:next);}},[data,cursor]);
 return <>{periods.length>0&&<nav aria-label={ui.t('topics.story.exact.periods')}>{periods.map(p=><button key={p} aria-pressed={browsePeriod===p} onClick={()=>{setCursor('');setItems([]);setBrowsePeriod(p);}}>{p.replace('-',' ')}</button>)}</nav>}{items.map(renderRecord)}{data?.ready&&data.page&&!response.loading&&!items.length&&<p><UiMessage id={data.page.nextCursor?'topics.story.pageEmpty':'topics.empty'}/></p>}{response.loading&&<p><UiMessage id="insightshared.loading"/></p>}{(response.error||data?.ready===false)&&<p><UiMessage id="topics.unavailable"/> <button onClick={()=>{setCursor('');setItems([]);setReload(true);}}><UiMessage id="insightshared.reload.cce715"/></button></p>}{data?.page?.nextCursor&&<button disabled={response.loading} onClick={()=>setCursor(data.page.nextCursor)}><UiMessage id="topics.more"/></button>}</>;
}
