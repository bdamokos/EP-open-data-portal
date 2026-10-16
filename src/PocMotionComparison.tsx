import {PocSourceLink} from './PocSourceLink';
import {useState} from 'react';
import {useData} from './pocData';
import {PocStatus} from './PocStatus';
import './PocMotionComparison.css';

type Stage='original-joint'|'original-adopted'|'joint-adopted';
type Block={index:number;kind:'paragraph'|'recital'|'citation'|'text'|'footnote';label:string;text:string};
type Segment={type:'equal'|'removed'|'added';text:string};
type Row={kind:'unchanged'|'changed'|'added'|'removed';before:Block|null;after:Block|null;referenceChanged:boolean;segments:Segment[]};
interface Comparison {
  status:'available'|'unavailable';stage:Stage;requestedLanguage:string;textLanguage:string|null;availableLanguages:string[];reason:string|null;
  summary:{changed:number;added:number;removed:number;unchanged:number;referenceChanged:number}|null;
  documents:{id:string;reference:string;title:string;date:string|null;sourceUrl:string|null;fetchedAt:string|null;language:string|null;translationType:string|null;stale:boolean;refreshError:string|null}[];
  sources:{url:string;fetchedAt:string;stale:boolean;refreshError:string|null}[];rows:Row[];
}
const names:Record<Stage,[string,string]>={'original-joint':['Original','Joint'],'original-adopted':['Original','Adopted'],'joint-adopted':['Joint','Adopted']};
const reference=(block:Block)=>block.kind==='paragraph'?`§ ${block.label}`:block.kind==='recital'?`Recital ${block.label}`:block.kind==='footnote'?`Note ${block.label}`:block.kind==='citation'?`Citation ${block.label}`:`Passage ${block.label}`;
const languageName=(code:string,locale:string)=>{try{const text=new Intl.DisplayNames([locale],{type:'language'}).of(code);return {text:text||code.toUpperCase(),language:text&&text!==code?locale:''};}catch{return {text:code.toUpperCase(),language:''};}};
function Wording({segments,side}:{segments:Segment[];side:'before'|'after'}) {
  return <>{segments.filter(part=>part.type!==(side==='before'?'added':'removed')).map((part,i)=>part.type==='removed'?<del key={i}>{part.text}</del>:part.type==='added'?<ins key={i}>{part.text}</ins>:<span key={i}>{part.text}</span>)}</>;
}
function Passage({row,side,name}:{row:Row;side:'before'|'after';name:string}) {
  const block=row[side];
  return <div className="poc-diff-passage" data-side={side}>
    <p className="poc-diff-reference" lang="en">{name}{block?` · ${reference(block)}`:''}</p>
    {block?<p><Wording segments={row.segments} side={side}/></p>:<p className="poc-diff-absent" lang="en">No matched passage</p>}
  </div>;
}
export function PocMotionComparison({originalId,jointId,language}:{originalId:string;jointId:string;language:string}) {
  const [stage,setStage]=useState<Stage>('original-joint'),[selectedLanguage,setLanguage]=useState(language),[showUnchanged,setShowUnchanged]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const state=useData<Comparison>(`motion-comparison/${encodeURIComponent(originalId)}?joint=${encodeURIComponent(jointId)}&stage=${stage}&lang=${selectedLanguage}`);
  const data=state.data,labels=names[stage],summary=data?.summary;
  const rows=data?.rows.filter(row=>showUnchanged || row.kind!=='unchanged' || row.referenceChanged) || [];
  const stale=data?.sources.some(source=>source.stale || source.refreshError) || data?.documents.some(doc=>doc.stale || doc.refreshError);
  const requestedName=languageName(selectedLanguage,language),actualName=languageName(data?.textLanguage||selectedLanguage,language);
  const comparisonName=`${labels[0]} to ${labels[1].toLowerCase()} comparison`;
  const status=state.error?`${comparisonName} ${data?'refresh failed. Showing saved comparison.':'could not be loaded.'}`:data?
    `${comparisonName} ${data.status==='unavailable'?'unavailable.':`available.${data.textLanguage?` Text language: ${data.textLanguage.toUpperCase()}.`:''}${summary?` ${summary.changed} changed, ${summary.removed} only in ${labels[0].toLowerCase()}, ${summary.added} only in ${labels[1].toLowerCase()}.`:' Comparison counts unavailable.'}`}${stale?' Showing saved sources.':''}`:null;
  const retry=()=>{setAttempt(value=>value+1);state.retry();};
  return <section className="poc-motion-comparison" lang="en" aria-label="Motion wording comparison">
    <h4>Compare wording</h4>
    <PocStatus scope={JSON.stringify([originalId,jointId,stage,selectedLanguage,attempt])} message={status} pending={state.loading} oncePerScope/>
    <div className="poc-diff-controls">
      <label>Stages<select value={stage} onChange={e=>{setStage(e.target.value as Stage);setShowUnchanged(false);}}>
        <option value="original-joint">Original → joint motion</option><option value="original-adopted">Original → adopted text</option><option value="joint-adopted">Joint motion → adopted text</option>
      </select></label>
      {Boolean(data?.availableLanguages.length)&&<label>Text language<select value={data?.textLanguage || selectedLanguage} onChange={e=>setLanguage(e.target.value)}>{data?.availableLanguages.map(code=>{const name=languageName(code,language);return <option lang={name.language} key={code} value={code}>{name.text}</option>;})}</select></label>}
    </div>
    <div>
      {state.loading&&!data&&<p role="status">Loading the linked texts…</p>}
      {state.error&&<p className="poc-diff-error">{state.error} <button type="button" onClick={retry}>Try again</button></p>}
      {data&&<>
        {data.textLanguage && data.textLanguage!==selectedLanguage&&<p className="poc-diff-notice"><span lang={requestedName.language}>{requestedName.text}</span> is unavailable in both texts. Showing <span lang={actualName.language}>{actualName.text}</span>.</p>}
        {data.documents.length===2&&<div className="poc-diff-documents">{data.documents.map((doc,i)=><div key={doc.id}><strong>{labels[i]} · {doc.reference}</strong>{doc.date&&<span lang={language}>{new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(doc.date))}</span>}{doc.sourceUrl&&<a href={doc.sourceUrl} target="_blank" rel="noreferrer">Source DOCX · {doc.language?.toUpperCase()} ↗</a>}</div>)}</div>}
        {stale&&<p className="poc-diff-notice">Showing saved sources while Parliament’s data refreshes. Retrieval dates are below.</p>}
        {data.status==='unavailable'?<p className="poc-diff-notice">{data.reason} <button type="button" onClick={retry}>Try again</button></p>:<>
          <p className="poc-diff-summary">{summary?.changed ?? '—'} changed · {summary?.removed ?? '—'} only in {labels[0].toLowerCase()} · {summary?.added ?? '—'} only in {labels[1].toLowerCase()}</p>
          <p className="poc-diff-explanation">Removed wording is struck through; new wording is underlined. Paragraph alignment is approximate where wording was rewritten or split. Punctuation differences can be editorial.</p>
          <label className="poc-diff-checkbox"><input type="checkbox" checked={showUnchanged} onChange={e=>setShowUnchanged(e.target.checked)}/> Show unchanged passages ({summary?.unchanged ?? '—'})</label>
          {!rows.length&&<p>{summary&&summary.changed===0&&summary.added===0&&summary.removed===0&&summary.referenceChanged===0?'No wording differences were found in the extracted resolution body and notes.':summary?'No comparison passages are available for these results.':'No changed passages are displayed. Comparison counts are unavailable.'}</p>}
          <div className="poc-diff-rows" lang={data.textLanguage || ''}>{rows.map((row,i)=><article key={i} className="poc-diff-row" data-kind={row.kind}>
            <p className="poc-diff-row-label" lang="en">{row.kind==='changed'?'Wording changed':row.kind==='removed'?`Only in ${labels[0].toLowerCase()}`:row.kind==='added'?`Only in ${labels[1].toLowerCase()}`:row.referenceChanged?'Same wording · different reference':'Same wording'}</p>
            <div className="poc-diff-columns"><Passage row={row} side="before" name={labels[0]}/><Passage row={row} side="after" name={labels[1]}/></div>
          </article>)}</div>
          <p className="poc-diff-explanation">Cover pages and author lists are excluded. Layout whitespace is normalised; wording, punctuation and footnotes are retained. A text comparison does not identify who negotiated a change.</p>
        </>}
        <details className="poc-diff-sources"><summary>Sources & retrieval dates</summary>{data.documents.map(doc=><p key={doc.id}>{doc.reference} · text retrieved {doc.fetchedAt || 'date unavailable'}{doc.translationType!=='original'?' · Translation method unspecified':''}</p>)}{data.sources.map(source=><p key={source.url}><PocSourceLink url={source.url} language={language}>Official source record ↗</PocSourceLink> · {source.fetchedAt}</p>)}</details>
      </>}
    </div>
  </section>;
}
