import type {ReactNode} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {dossierLinkClick} from './dossierJourney';
import {partResult,type PartResultInput,type SplitMatch,type SplitRun} from './splitRuns.mjs';

export type SplitKeyRow={number:string|number|null;description:string|null;language:string;result?:PartResultInput|null;href?:string|null;seeVote?:string|null;current?:boolean};

function Bracketed({run}:{run:SplitRun}) {
  const ui=useUiI18n(),words=run.text.trim(),start=run.text.indexOf(words),cut=words.lastIndexOf(' ')+1;
  // The last word, bracket and subscript never part across a line.
  return <>{run.text.slice(0,start)}<span className="br">[</span>{words.slice(0,cut)}<span className="close-br">{words.slice(cut)}<span className="br">]</span><sub lang={ui.language}><UiMessage id="membervotes.tsx.part.number" values={{number:run.part??''}}/></sub></span>{run.text.slice(start+words.length)}</>;
}
// One running paragraph. On a part's own page that part's words stand out and the rest is quiet; an
// overview marks the parts and stresses none of them.
export function SplitText({runs,language,emphasis='none',current=[]}:{runs:SplitRun[];language:string;emphasis?:'none'|'part';current?:string[]}) {
  return <p className={'clause-text '+(emphasis==='part'?'marked':'plain')} lang={language}>{runs.map((run,index)=>{
    const body=run.bracketed?<Bracketed run={run}/>:run.text;
    return emphasis==='part'&&run.part!==null&&current.includes(run.part)?<span key={index} className="run-on">{body}</span>:<span key={index}>{body}</span>;
  })}</p>;
}
const sentenceEnd=/[\s.]+$/u;
// Parliament's words for each part with its result. Only the long quote the reader sees in brackets is shortened.
export function SplitKey({parts,match}:{parts:SplitKeyRow[];match:SplitMatch|null}) {
  const ui=useUiI18n();
  return <div className="clause-key">{parts.map((part,index)=>{
    const number=String(part.number??''),label=ui.t('membervotes.tsx.part.number',{number}),result=partResult(part.result);
    // The shortening is a sentence in the interface's language, so it never mixes into wording in another.
    const short=match?.whole?.number===number&&match.whole.lead&&part.language===ui.language?match.whole:null;
    const description:ReactNode=short?<UiMessage id="votepage.key.words_in_part" values={{description:<span lang={part.language}>{short.lead}</span>,n:short.other}}/>:part.description?<span lang={part.language}>{part.description.replace(sentenceEnd,'')}</span>:null;
    const name=<b>{part.href&&!part.current?<a href={part.href} onClick={dossierLinkClick}>{label}</a>:label}</b>;
    return <p key={number+':'+index} className={part.current?'clause-part this':'clause-part'}>
      {description?<UiMessage id="votepage.key.line" values={{part:name,description}}/>:<UiMessage id="votepage.key.line_bare" values={{part:name}}/>}
      {result&&<> <UiMessage id={result.id} values={result.values}/></>}
      {part.current&&<> <b><UiMessage id="votepage.key.this_vote"/></b></>}
      {part.seeVote&&<> <a href={part.seeVote} onClick={dossierLinkClick}><UiMessage id="votepage.see_the_vote"/></a></>}
    </p>;
  })}</div>;
}
