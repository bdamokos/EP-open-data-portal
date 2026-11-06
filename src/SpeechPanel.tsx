import {useEffect,useRef,useState,type RefObject} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {InsightSpeechReader} from './InsightReaders';
import {humanDate} from './InsightShared';
import {groupColor,groupLabel,groupLabelLanguage} from './groupLabels';
import {speechPanelCounts,speechPanelDate} from './debateSpeeches.mjs';
import type {LegislationResponse} from './LegislationTypes';
import type {SpeechSpeaker} from './legislationContributors.mjs';

type Speech=NonNullable<LegislationResponse['detail']>['speeches'][number];
const narrow='(max-width: 680px)';
const reducedMotion='(prefers-reduced-motion: reduce)';

export function SpeechPanel({top,speeches,current,onSelect,language,speakerName,speakerText,positionText,time,onSpeakers}:{top:RefObject<HTMLElement|null>;speeches:Speech[];current:string|null;onSelect:(id:string)=>void;language:string;speakerName:(person:Speech['people'][number])=>string|null;speakerText:(speech:Speech)=>string;positionText:(speech:Speech)=>string;time:(speech:Speech)=>string|null;onSpeakers:(people:(SpeechSpeaker&{name:string})[],speechId?:string)=>void}) {
  const ui=useUiI18n();
  const position=useRef<HTMLDivElement>(null),list=useRef<HTMLOListElement>(null);
  const [open,setOpen]=useState(()=>typeof window.matchMedia==='function'&&!window.matchMedia(narrow).matches);
  const index=speeches.findIndex(speech=>speech.sourceId===current),currentSpeech=speeches[index],first=currentSpeech?.people[0];
  // Keep the selected row inside the list's own scroll area without moving the page.
  useEffect(()=>{
    const row=list.current?.querySelector<HTMLElement>('[aria-current=true]');
    if(!list.current||!row)return;
    const box=list.current,top=row.offsetTop-box.offsetTop;
    if(top<box.scrollTop||top+row.offsetHeight>box.scrollTop+box.clientHeight)box.scrollTop=top-(box.clientHeight-row.offsetHeight)/2;
  },[current,open]);
  const counts=speechPanelCounts(speeches),date=speechPanelDate(speeches);
  function reveal(smooth:boolean,focus:boolean){
    requestAnimationFrame(()=>{
      if(focus)position.current?.focus({preventScroll:true});
      top.current?.scrollIntoView({block:'start',behavior:smooth&&!window.matchMedia(reducedMotion).matches ? 'smooth' : 'instant'});
    });
  }
  function choose(id:string){
    onSelect(id);
    if(window.matchMedia(narrow).matches)setOpen(false);
    reveal(false,true);
  }
  function page(offset:number,scroll=false){
    const next=speeches[index+offset];
    if(index<0||!next)return;
    onSelect(next.sourceId);
    if(scroll)reveal(true,false);
  }
  const previous=(scroll:boolean)=>page(-1,scroll),next=(scroll:boolean)=>page(1,scroll);
  return <section className="insight-speech-panel">
    <h3>{date ? <UiMessage id="speechpanel.debate_of_date" values={{date:<span lang={language}>{humanDate(date,language)}</span>}}/> : ui.t("dossieractivity.speeches")}</h3>
    <p className="insight-speech-counts">
      {counts.speeches>0&&<UiMessage id="speechcloud.transcripts_speeches.851fc7" values={{transcripts:counts.speeches}} counts={{transcripts:counts.speeches}}/>}
      {counts.statements>0&&<>{counts.speeches>0&&' · '}<UiMessage id="legislation.statements_written_statements.7e4375" values={{statements:counts.statements}} counts={{statements:counts.statements}}/></>}
      {counts.speakers>0&&<> · <UiMessage id="groupvoices.count_speakers.47ae64" values={{count:counts.speakers}} counts={{count:counts.speakers}}/></>}
    </p>
    <details className="insight-speech-jump" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
      <summary><UiMessage id="speechpanel.all_speakers_count" values={{count:speeches.length}}/></summary>
      <ol ref={list}>{speeches.map(speech=>{
        const clock=time(speech),groups=[...new Set(speech.people.map(person=>person.contributionGroup).filter((group):group is string=>Boolean(group)))];
        return <li key={speech.sourceId}><button lang="" aria-current={(speech.sourceId===current) ? 'true' : undefined} onClick={()=>choose(speech.sourceId)}>
          <span className="insight-speech-time">{clock}</span>
          <span className="insight-speech-speaker">{speakerText(speech)}{speech.kind==='PLENARY_DEBATE_WRITTEN_STATEMENT'&&<small lang={ui.language}>{ui.t("insightshared.written_statement")}</small>}</span>
          <span className="insight-speech-group">{groups.map(group=><span key={group} lang={groupLabelLanguage(group,ui)}><i style={{background:groupColor(group)}}/>{groupLabel(group,ui)}</span>)}</span>
        </button></li>;
      })}</ol>
    </details>
    <nav className="insight-speech-pager" aria-label={ui.t("dossieractivity.speeches")} ref={top}>
      <button aria-label={ui.t("legislation.previous_speech.52d5e7")} aria-disabled={index<=0} onClick={()=>previous(false)}><span aria-hidden="true">‹</span></button>
      <div className="insight-speech-position" ref={position} tabIndex={-1}><strong aria-live="polite" aria-atomic="true"><UiMessage id="legislation.speech_speechnumber_of_count.73b64d" values={{speechNumber:index+1,count:speeches.length}}/></strong>{currentSpeech&&<span lang="">{positionText(currentSpeech)}</span>}</div>
      <button aria-label={ui.t("legislation.next_speech.4ed12e")} aria-disabled={index<0||index===speeches.length-1} onClick={()=>next(false)}><span aria-hidden="true">›</span></button>
    </nav>
    {currentSpeech&&<><InsightSpeechReader key={current} id={currentSpeech.sourceId} language={language} onSpeakers={onSpeakers} fallbackSpeaker={first ? {id:first.id,name:speakerName(first)} : undefined}/>
      <nav className="insight-speech-pager insight-speech-pager-bottom" aria-label={ui.t("legislation.speeches_bottom.166999")}>
        <button aria-label={ui.t("legislation.previous_speech.52d5e7")} aria-disabled={index<=0} onClick={()=>previous(true)}><span aria-hidden="true">‹</span>  <UiMessage id="textsearch.previous"/></button>
        <span>{index+1} / {speeches.length}</span>
        <button aria-label={ui.t("legislation.next_speech.4ed12e")} aria-disabled={index===speeches.length-1} onClick={()=>next(true)}><UiMessage id="textsearch.next"/> <span aria-hidden="true">›</span></button>
      </nav></>}
  </section>;
}
