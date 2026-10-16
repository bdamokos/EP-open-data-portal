import {useState} from 'react';
import {useData} from './pocData';
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
const languageName=(code:string,locale:string)=>{try{return new Intl.DisplayNames([locale],{type:'language'}).of(code) || code.toUpperCase();}catch{return code.toUpperCase();}};
function Wording({segments,side}:{segments:Segment[];side:'before'|'after'}) {
  return <>{segments.filter(part=>part.type!==(side==='before'?'added':'removed')).map((part,i)=>part.type==='removed'?<del key={i}>{part.text}</del>:part.type==='added'?<ins key={i}>{part.text}</ins>:<span key={i}>{part.text}</span>)}</>;
}
function Passage({row,side,name}:{row:Row;side:'before'|'after';name:string}) {
  const block=row[side];
  return <div className="poc-diff-passage" data-side={side}>
    <p className="poc-diff-reference">{name}{block?` · ${reference(block)}`:''}</p>
    {block?<p><Wording segments={row.segments} side={side}/></p>:<p className="poc-diff-absent">No matched passage</p>}
  </div>;
}
export function PocMotionComparison({originalId,jointId,language}:{originalId:string;jointId:string;language:string}) {
  const [stage,setStage]=useState<Stage>('original-joint'),[selectedLanguage,setLanguage]=useState(language),[showUnchanged,setShowUnchanged]=useState(false);
  const state=useData<Comparison>(`motion-comparison/${encodeURIComponent(originalId)}?joint=${encodeURIComponent(jointId)}&stage=${stage}&lang=${selectedLanguage}`);
  const data=state.data,labels=names[stage],summary=data?.summary;
  const rows=data?.rows.filter(row=>showUnchanged || row.kind!=='unchanged' || row.referenceChanged) || [];
  const stale=data?.sources.some(source=>source.stale || source.refreshError) || data?.documents.some(doc=>doc.stale || doc.refreshError);
  return <section className="poc-motion-comparison" aria-label="Motion wording comparison">
    <h4>Compare wording</h4>
    <div className="poc-diff-controls">
      <label>Stages<select value={stage} onChange={e=>{setStage(e.target.value as Stage);setShowUnchanged(false);}}>
        <option value="original-joint">Original → joint motion</option><option value="original-adopted">Original → adopted text</option><option value="joint-adopted">Joint motion → adopted text</option>
      </select></label>
      {Boolean(data?.availableLanguages.length)&&<label>Text language<select value={data?.textLanguage || selectedLanguage} onChange={e=>setLanguage(e.target.value)}>{data?.availableLanguages.map(code=><option key={code} value={code}>{languageName(code,language)}</option>)}</select></label>}
    </div>
    <div aria-live="polite">
      {state.loading&&!data&&<p role="status">Loading the linked texts…</p>}
      {state.error&&<p role="alert">{state.error} <button type="button" onClick={state.retry}>Try again</button></p>}
      {data&&<>
        {data.textLanguage && data.textLanguage!==selectedLanguage&&<p className="poc-diff-notice">{languageName(selectedLanguage,language)} is unavailable in both texts. Showing {languageName(data.textLanguage,language)}.</p>}
        {data.documents.length===2&&<div className="poc-diff-documents">{data.documents.map((doc,i)=><div key={doc.id}><strong>{labels[i]} · {doc.reference}</strong>{doc.date&&<span>{new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(doc.date))}</span>}{doc.sourceUrl&&<a href={doc.sourceUrl} target="_blank" rel="noreferrer">Source DOCX · {doc.language?.toUpperCase()} ↗</a>}</div>)}</div>}
        {stale&&<p className="poc-diff-notice">Showing saved sources while Parliament’s data refreshes. Retrieval dates are below.</p>}
        {data.status==='unavailable'?<p className="poc-diff-notice">{data.reason} <button type="button" onClick={state.retry}>Try again</button></p>:<>
          <p className="poc-diff-summary">{summary?.changed || 0} changed · {summary?.removed || 0} only in {labels[0].toLowerCase()} · {summary?.added || 0} only in {labels[1].toLowerCase()}</p>
          <p className="poc-diff-explanation">Removed wording is struck through; new wording is underlined. Paragraph alignment is approximate where wording was rewritten or split. Punctuation differences can be editorial.</p>
          <label className="poc-diff-checkbox"><input type="checkbox" checked={showUnchanged} onChange={e=>setShowUnchanged(e.target.checked)}/> Show unchanged passages ({summary?.unchanged || 0})</label>
          {!rows.length&&<p>No wording differences were found in the extracted resolution body and notes.</p>}
          <div className="poc-diff-rows" lang={data.textLanguage || undefined}>{rows.map((row,i)=><article key={i} className="poc-diff-row" data-kind={row.kind}>
            <p className="poc-diff-row-label">{row.kind==='changed'?'Wording changed':row.kind==='removed'?`Only in ${labels[0].toLowerCase()}`:row.kind==='added'?`Only in ${labels[1].toLowerCase()}`:row.referenceChanged?'Same wording · different reference':'Same wording'}</p>
            <div className="poc-diff-columns"><Passage row={row} side="before" name={labels[0]}/><Passage row={row} side="after" name={labels[1]}/></div>
          </article>)}</div>
          <p className="poc-diff-explanation">Cover pages and author lists are excluded. Layout whitespace is normalised; wording, punctuation and footnotes are retained. A text comparison does not identify who negotiated a change.</p>
        </>}
        <details className="poc-diff-sources"><summary>Sources & retrieval dates</summary>{data.documents.map(doc=><p key={doc.id}>{doc.reference} · text retrieved {doc.fetchedAt || 'date unavailable'}{doc.translationType!=='original'?' · Translation method unspecified':''}</p>)}{data.sources.map(source=><p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">Official source record ↗</a> · {source.fetchedAt}</p>)}</details>
      </>}
    </div>
  </section>;
}
