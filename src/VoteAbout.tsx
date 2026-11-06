import {useLayoutEffect,useRef,useState} from 'react';
import {UiMessage} from './UiI18nReact';
import {useInsightData} from './InsightData';
import {aboutContent} from './voteAboutModel.mjs';
import './VoteAbout.css';

type Totals={for:number|null;against:number|null;abstaining:number|null};
type AboutVote={id:string;outcome:string;decidedDocumentIds?:string[];aggregateTotals:Totals};
type Context={language:string|null;summaries:{id:string;documentReference?:string|null}[];summary:null|{id:string;blocks:{kind:string;text:string}[]}};

// The official summary of the item's own procedure (Legislative Observatory), read through the same
// procedure-context request the dossier section uses. It loads on its own and shows nothing until it has text.
export function VoteAbout({reference,language,open,onToggle,votes,viewedId,onOpenVote}:{reference:string;language:string;open:boolean;onToggle:()=>void;votes:AboutVote[];viewedId:string|null;onOpenVote:(id:string)=>void}) {
  const {data}=useInsightData<Context>('insights/procedure-context?'+new URLSearchParams({reference,lang:language}));
  const [overflows,setOverflows]=useState(false),text=useRef<HTMLDivElement>(null);
  const documentReference=data?.summaries?.find(item=>item.id===data.summary?.id)?.documentReference;
  const {blocks,whole}=aboutContent({blocks:data?.summary?.blocks||[],votes,viewedId,documentReference});
  const totals=whole?.aggregateTotals,published=totals&&totals.for!==null&&totals.against!==null&&totals.abstaining!==null&&['ADOPTED','REJECTED'].includes(whole!.outcome);
  useLayoutEffect(()=>{
    const node=text.current;if(!node||open)return;
    // Without layout (nothing measurable) the text is offered in full rather than hidden.
    const measure=()=>setOverflows(node.scrollHeight>node.clientHeight+1||node.clientHeight===0);
    measure();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();
  },[blocks.length,open,reference]);
  if(!blocks.length)return null;
  return <section className="vote-about">
    <h3><UiMessage id="votegroups.about.heading"/></h3>
    <div ref={text} className={'vote-about-text'+(open?'':' is-clamped')} lang={data?.language??''}>{blocks.map((block,index)=>block.kind==='heading'?<h4 key={index}>{block.text}</h4>:<p key={index}>{block.text}</p>)}</div>
    {(overflows||open)&&<button type="button" className="insight-text-button" aria-expanded={open} onClick={onToggle}>{open?<UiMessage id="votegroups.about.less"/>:<UiMessage id="votegroups.about.more"/>}</button>}
    {whole&&published&&<p className="vote-about-whole"><UiMessage id={'votegroups.about.whole.'+whole.outcome} values={{for:totals!.for,against:totals!.against,abstaining:totals!.abstaining}}/> <button type="button" className="insight-text-button" onClick={()=>onOpenVote(whole.id)}><UiMessage id="votegroups.about.open"/></button></p>}
  </section>;
}
