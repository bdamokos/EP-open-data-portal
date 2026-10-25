import {TextLanguagePicker,TextLanguageFallback} from './TextLanguagePicker';
import {useEffect,useRef,useState} from 'react';
import {useData} from './data';
import {Status} from './Status';
import './MotionComparison.css';

type Stage='original-joint'|'original-adopted'|'joint-adopted';
type View='inline'|'text'|'columns';
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
const documentNames:Record<Stage,[string,string]>={'original-joint':['Original motion','Joint motion'],'original-adopted':['Original motion','Adopted text'],'joint-adopted':['Joint motion','Adopted text']};
const reference=(block:Block)=>block.kind==='paragraph'?`§ ${block.label}`:block.kind==='recital'?`Recital ${block.label}`:block.kind==='footnote'?`Note ${block.label}`:block.kind==='citation'?`Citation ${block.label}`:`Passage ${block.label}`;

function Wording({segments,side}:{segments:Segment[];side?:'before'|'after'}) {
  return <>{segments.filter(part=>!side || part.type!==(side==='before'?'added':'removed')).map((part,i)=>part.type==='removed'?<del key={i}><span className="explorer-diff-sr" lang="en">Start removed wording: </span>{part.text}<span className="explorer-diff-sr" lang="en"> End removed wording. </span></del>:part.type==='added'?<ins key={i}><span className="explorer-diff-sr" lang="en">Start added wording: </span>{part.text}<span className="explorer-diff-sr" lang="en"> End added wording. </span></ins>:<span key={i}>{part.text}</span>)}</>;
}
const changeLabel=(row:Row,labels:[string,string])=>row.kind==='changed'?'Wording changed':row.kind==='removed'?`Only in ${labels[0].toLowerCase()}`:row.kind==='added'?`Only in ${labels[1].toLowerCase()}`:row.referenceChanged?'Same wording · different reference':'Same wording';
function InlinePassage({row,labels}:{row:Row;labels:[string,string]}) {
  const block=row.after || row.before!;
  return <div className="explorer-diff-passage explorer-diff-inline-passage">
    <p className="explorer-diff-reference" lang="en">{reference(block)}{row.referenceChanged&&row.before?` · was ${reference(row.before)}`:''}<span className="explorer-diff-change-label">{changeLabel(row,labels)}</span></p>
    <p className="explorer-diff-wording"><Wording segments={row.segments}/></p>
  </div>;
}
function Passage({row,side,name}:{row:Row;side:'before'|'after';name:string}) {
  const block=row[side];
  return <div className="explorer-diff-passage" data-side={side}>
    <p className="explorer-diff-reference" lang="en">{name}{block?` · ${reference(block)}`:''}</p>
    {block?<p><Wording segments={row.segments} side={side}/></p>:<p className="explorer-diff-absent" lang="en">No matched passage</p>}
  </div>;
}
export function MotionComparison({originalId,jointId,language}:{originalId:string;jointId:string;language:string}) {
  const [stage,setStage]=useState<Stage>('original-joint'),[selection,setSelection]=useState<{scope:string;value:string}|null>(null),[showUnchanged,setShowUnchanged]=useState(true);
  const selectionScope=JSON.stringify([originalId,jointId,language]);
  const selectedLanguage=selection?.scope===selectionScope?selection.value:language;
  const setLanguage=(value:string)=>setSelection({scope:selectionScope,value});
  const [view,setView]=useState<View>('inline'),[readSide,setReadSide]=useState<'before'|'after'>('after');
  const [attempt,setAttempt]=useState(0);
  const state=useData<Comparison>(`motion-comparison/${encodeURIComponent(originalId)}?joint=${encodeURIComponent(jointId)}&stage=${stage}&lang=${selectedLanguage}`);
  const data=state.data,labels=names[stage],summary=data?.summary;
  const languageScope=JSON.stringify([originalId,jointId,stage]);
  const languageCatalog=useRef<{scope:string;values:string[];shown:boolean}|null>(null);
  const previousLanguages=languageCatalog.current?.scope===languageScope?languageCatalog.current:null;
  const availableLanguages=data?.availableLanguages??previousLanguages?.values??[];
  const showLanguage=Boolean(availableLanguages.length||previousLanguages?.shown);
  useEffect(()=>{if(data)languageCatalog.current={scope:languageScope,values:data.availableLanguages,shown:showLanguage};},[data,languageScope,showLanguage]);
  const actualLanguage=data?.textLanguage;
  const languageValue=actualLanguage&&availableLanguages.includes(actualLanguage)?actualLanguage:availableLanguages.includes(selectedLanguage)?selectedLanguage:'';
  const rows=data?.rows.filter(row=>showUnchanged || row.kind!=='unchanged' || row.referenceChanged) || [];
  // Alignment follows the target text; moved matches need their own source order in a clean reader.
  const textBlocks=data?.rows.flatMap(row=>row[readSide]?[row[readSide]!]:[]).sort((a,b)=>a.index-b.index) || [];
  const fullNames=documentNames[stage],readIndex=readSide==='before'?0:1;
  const noDifferences=summary&&summary.changed===0&&summary.added===0&&summary.removed===0&&summary.referenceChanged===0;

  const comparisonName=`${labels[0]} to ${labels[1].toLowerCase()} comparison`;
  const status=state.error?`${comparisonName} ${data?'refresh failed. Showing saved comparison.':'could not be loaded.'}`:data?
    `${comparisonName} ${data.status==='unavailable'?'unavailable.':`available.${data.textLanguage?` Text language: ${data.textLanguage.toUpperCase()}.`:''}${summary?` ${summary.changed} changed, ${summary.removed} only in ${labels[0].toLowerCase()}, ${summary.added} only in ${labels[1].toLowerCase()}.`:' Comparison counts unavailable.'}`}`:null;
  const retry=()=>{setAttempt(value=>value+1);state.retry();};
  return <section className="explorer-motion-comparison" lang="en" aria-label="Motion wording comparison">
    <h4>Compare wording</h4>
    <Status scope={JSON.stringify([originalId,jointId,stage,selectedLanguage,attempt])} message={status} pending={state.loading} oncePerScope/>
    <div className="explorer-diff-controls">
      <label>Stages<select value={stage} onChange={e=>{setStage(e.target.value as Stage);setShowUnchanged(true);}}>
        <option value="original-joint">Original → joint motion</option><option value="original-adopted">Original → adopted text</option><option value="joint-adopted">Joint motion → adopted text</option>
      </select></label>
      {showLanguage&&<TextLanguagePicker available={availableLanguages} requested={language} value={languageValue} onChange={setLanguage} preserveFocus/>}
    </div>
    <div>
      {state.loading&&!data&&<p role="status">Loading the linked texts…</p>}
      {state.error&&<p className="explorer-diff-error">{state.error} <button type="button" onClick={retry}>Try again</button></p>}
      {data&&<>
        <TextLanguageFallback requested={selectedLanguage} actual={data.textLanguage} interfaceLanguage={language} comparison/>
        {data.documents.length===2&&<div className="explorer-diff-documents">{data.documents.map((doc,i)=><div key={doc.id}><strong>{labels[i]} · {doc.reference}</strong>{doc.date&&<span lang={language}>{new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(doc.date))}</span>}{doc.sourceUrl&&<a href={doc.sourceUrl} target="_blank" rel="noreferrer">Source DOCX · {doc.language?.toUpperCase()} ↗</a>}</div>)}</div>}
        {data.status==='unavailable'?<p className="explorer-diff-notice">{data.reason} <button type="button" onClick={retry}>Try again</button></p>:<>
          <p className="explorer-diff-summary">{summary?.changed ?? '—'} changed · {summary?.removed ?? '—'} only in {labels[0].toLowerCase()} · {summary?.added ?? '—'} only in {labels[1].toLowerCase()}</p>
          <div className="explorer-diff-views" role="group" aria-label="Reading view">{([['inline','Inline changes'],['text','Full text'],['columns','Side by side']] as const).map(([value,label])=><button key={value} type="button" aria-pressed={view===value} onClick={()=>setView(value)}>{label}</button>)}</div>
          {view==='text'?<>
            <label className="explorer-diff-read-control">Read<select value={readSide} onChange={e=>setReadSide(e.target.value as 'before'|'after')}><option value="before">{fullNames[0]}</option><option value="after">{fullNames[1]}</option></select></label>
            <div className="explorer-diff-reader" lang={data.textLanguage || ''}>
              <h5 lang="en">{fullNames[readIndex]}{data.documents[readIndex]?` · ${data.documents[readIndex].reference}`:''}</h5>
              {textBlocks.map(block=><div key={block.index} className="explorer-diff-text-passage" data-kind={block.kind}><p className="explorer-diff-reference" lang="en">{reference(block)}</p><p className="explorer-diff-wording">{block.text}</p></div>)}
              {!textBlocks.length&&<p lang="en">No extracted passages are available for this text.</p>}
            </div>
          </>:<>
            <p className="explorer-diff-legend"><span><del>Removed wording</del> · {fullNames[0]}</span><span><ins>Added wording</ins> · {fullNames[1]}</span></p>
            <label className="explorer-diff-checkbox"><input type="checkbox" checked={showUnchanged} onChange={e=>setShowUnchanged(e.target.checked)}/> Show unchanged passages ({summary?.unchanged ?? '—'})</label>
            {noDifferences&&<p>No wording differences.</p>}
            {!rows.length&&!noDifferences&&<p>{summary?'No comparison passages are available for these results.':'No comparison passages are available. Comparison counts are unavailable.'}</p>}
            <div className="explorer-diff-rows" data-view={view} lang={data.textLanguage || ''}>{rows.map((row,i)=><article key={i} className="explorer-diff-row" data-kind={row.kind}>
              {view==='inline'?<InlinePassage row={row} labels={labels}/>:<><p className="explorer-diff-row-label" lang="en">{changeLabel(row,labels)}</p><div className="explorer-diff-columns"><Passage row={row} side="before" name={labels[0]}/><Passage row={row} side="after" name={labels[1]}/></div></>}
            </article>)}</div>
          </>}
        </>}
      </>}
    </div>
  </section>;
}
