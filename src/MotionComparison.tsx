import {defaultUi} from './uiDefault.mjs';
import {UiAnnotatedMessage, UiMessage, useUiI18n} from './UiI18nReact';
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
export const namesUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof names => ({'original-joint':[ui.t("speechplayer.original.c0a806"),ui.t("MotionComparison.joint")],'original-adopted':[ui.t("speechplayer.original.c0a806"),ui.t("membervotespresentation.adopted")],'joint-adopted':[ui.t("MotionComparison.joint"),ui.t("membervotespresentation.adopted")]});

const documentNames:Record<Stage,[string,string]>={'original-joint':['Original motion','Joint motion'],'original-adopted':['Original motion','Adopted text'],'joint-adopted':['Joint motion','Adopted text']};
export const documentNamesUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof documentNames => ({'original-joint':[ui.t("MotionComparison.original_motion"),ui.t("batch6.documentcontextreader.joint.motion.40")],'original-adopted':[ui.t("MotionComparison.original_motion"),ui.t("batch6.documentcontextreader.adopted.text.40")],'joint-adopted':[ui.t("batch6.documentcontextreader.joint.motion.40"),ui.t("batch6.documentcontextreader.adopted.text.40")]});

const reference=(block:Block, ui: import('./uiI18n.mjs').UiFormatter = defaultUi)=>(block.kind==='paragraph') ? ui.t("MotionComparison.paragraph", {label: String(block.label)}) : ((block.kind==='recital') ? ui.t("MotionComparison.recital", {label: String(block.label)}) : ((block.kind==='footnote') ? ui.t("batch6.references.note.label.178", {label: String(block.label)}) : ((block.kind==='citation') ? ui.t("MotionComparison.citation", {label: String(block.label)}) : ui.t("MotionComparison.passage", {label: String(block.label)}))));

function Wording({segments,side}:{segments:Segment[];side?:'before'|'after'}) {
  return <>{segments.filter(part=>!side||part.type!==((side==='before') ? 'added' : 'removed')).map((part,i)=>(part.type==='removed') ? <del key={i}><UiAnnotatedMessage id="MotionComparison.removedWording" values={{text:<span>{part.text}</span>}} srClassName="explorer-diff-sr"/></del> : ((part.type==='added') ? <ins key={i}><UiAnnotatedMessage id="MotionComparison.addedWording" values={{text:<span>{part.text}</span>}} srClassName="explorer-diff-sr"/></ins> : <span key={i}>{part.text}</span>))}</>;
}

const changeLabel=(row:Row,labels:[string,string], ui: import('./uiI18n.mjs').UiFormatter = defaultUi)=>(row.kind==='changed') ? ui.t("MotionComparison.wording_changed") : ((row.kind==='removed') ? ui.t("MotionComparison.onlyIn", {stage: String(labels[0].toLowerCase())}) : ((row.kind==='added') ? ui.t("MotionComparison.onlyIn", {stage: String(labels[1].toLowerCase())}) : (row.referenceChanged ? ui.t("MotionComparison.same_wording_different_reference") : ui.t("finalTextCheck.same_wording"))));
function InlinePassage({row,labels}:{row:Row;labels:[string,string]}) {
  const ui = useUiI18n();
  const block=row.after || row.before!;
  return <div className="explorer-diff-passage explorer-diff-inline-passage">
    <p className="explorer-diff-reference" lang={ui.language}>{reference(block, ui)}{(row.referenceChanged && row.before) ? (` · was ${reference(row.before, ui)}`) : ''}<span className="explorer-diff-change-label">{changeLabel(row,labels, ui)}</span></p>
    <p className="explorer-diff-wording"><Wording segments={row.segments}/></p>
  </div>;
}
function Passage({row,side,name}:{row:Row;side:'before'|'after';name:string}) {
  const ui = useUiI18n();
  const block=row[side];
  return <div className="explorer-diff-passage" data-side={side}>
    <p className="explorer-diff-reference" lang={ui.language}>{name}{block ? (` · ${reference(block, ui)}`) : ''}</p>
    {block ? <p><Wording segments={row.segments} side={side}/></p> : <p className="explorer-diff-absent" lang={ui.language}><UiMessage id="MotionComparison.no_matched_passage"/></p>}
  </div>;
}
export function MotionComparison({originalId,jointId,language}:{originalId:string;jointId:string;language:string}) {
  const ui = useUiI18n();
  const [stage,setStage]=useState<Stage>('original-joint'),[selection,setSelection]=useState<{scope:string;value:string}|null>(null),[showUnchanged,setShowUnchanged]=useState(true);
  const selectionScope=JSON.stringify([originalId,jointId,language]);
  const selectedLanguage=(selection?.scope===selectionScope) ? selection.value : language;
  const setLanguage=(value:string)=>setSelection({scope:selectionScope,value});
  const [view,setView]=useState<View>('inline'),[readSide,setReadSide]=useState<'before'|'after'>('after');
  const [attempt,setAttempt]=useState(0);
  const state=useData<Comparison>(`motion-comparison/${encodeURIComponent(originalId)}?joint=${encodeURIComponent(jointId)}&stage=${stage}&lang=${selectedLanguage}`);
  const data=state.data,labels=namesUi(ui)[stage],summary=data?.summary;
  const languageScope=JSON.stringify([originalId,jointId,stage]);
  const languageCatalog=useRef<{scope:string;values:string[];shown:boolean}|null>(null);
  const previousLanguages=(languageCatalog.current?.scope===languageScope) ? languageCatalog.current : null;
  const availableLanguages=data?.availableLanguages??previousLanguages?.values??[];
  const showLanguage=Boolean(availableLanguages.length||previousLanguages?.shown);
  useEffect(()=>{if(data)languageCatalog.current={scope:languageScope,values:data.availableLanguages,shown:showLanguage};},[data,languageScope,showLanguage]);
  const actualLanguage=data?.textLanguage;
  const languageValue=(actualLanguage && availableLanguages.includes(actualLanguage)) ? actualLanguage : (availableLanguages.includes(selectedLanguage) ? selectedLanguage : '');
  const rows=data?.rows.filter(row=>showUnchanged || row.kind!=='unchanged' || row.referenceChanged) || [];
  // Alignment follows the target text; moved matches need their own source order in a clean reader.
  const textBlocks=data?.rows.flatMap(row=>row[readSide] ? ([row[readSide]!]) : ([])).sort((a,b)=>a.index-b.index) || [];
  const fullNames=documentNamesUi(ui)[stage],readIndex=(readSide==='before') ? 0 : 1;
  const noDifferences=summary&&summary.changed===0&&summary.added===0&&summary.removed===0&&summary.referenceChanged===0;

  const comparisonName=ui.t("MotionComparison.name", {fromStage: String(labels[0]), toStage: String(labels[1].toLowerCase())});
  const status=state.error ? (data ? ui.t("MotionComparison.refreshFailed", {comparisonName: String(comparisonName)}) : ui.t("MotionComparison.loadFailed", {comparisonName: String(comparisonName)})) : (data ? ((data.status==='unavailable') ? ui.t("MotionComparison.unavailable", {comparisonName: String(comparisonName)}) : ui.t("MotionComparison.available", {comparisonName: String(comparisonName), languageStatus: String(data.textLanguage ? ui.t("MotionComparison.textLanguage", {language: String(data.textLanguage.toUpperCase())}) : ''), countStatus: String(summary ? ui.t("MotionComparison.statusCounts", {changed: String(summary.changed), removed: String(summary.removed), fromStage: String(labels[0].toLowerCase()), added: String(summary.added), toStage: String(labels[1].toLowerCase())}) : ui.t("MotionComparison.countsUnavailable"))})) : null);
  const retry=()=>{setAttempt(value=>value+1);state.retry();};
  return <section className="explorer-motion-comparison" lang={ui.language} aria-label={ui.t("MotionComparison.motion_wording_comparison")}>
    <h4><UiMessage id="finalTextCheck.compare_wording"/></h4>
    <Status scope={JSON.stringify([originalId,jointId,stage,selectedLanguage,attempt])} message={status} pending={state.loading} oncePerScope/>
    <div className="explorer-diff-controls">
      <label><UiMessage id="MotionComparison.stages"/><select value={stage} onChange={e=>{setStage(e.target.value as Stage);setShowUnchanged(true);}}>
        <option value="original-joint"><UiMessage id="MotionComparison.original_joint_motion"/></option><option value="original-adopted"><UiMessage id="MotionComparison.original_adopted_text"/></option><option value="joint-adopted"><UiMessage id="MotionComparison.joint_motion_adopted_text"/></option>
      </select></label>
      {showLanguage&&<TextLanguagePicker available={availableLanguages} requested={language} value={languageValue} onChange={setLanguage} preserveFocus/>}
    </div>
    <div>
      {state.loading&&!data&&<p role="status"><UiMessage id="MotionComparison.loading_the_linked_texts"/></p>}
      {state.error&&<p className="explorer-diff-error">{state.error} <button type="button" onClick={retry}><UiMessage id="commissionfollowups.try_again"/></button></p>}
      {data&&<>
        <TextLanguageFallback requested={selectedLanguage} actual={data.textLanguage} interfaceLanguage={language} comparison/>
        {data.documents.length===2&&<div className="explorer-diff-documents">{data.documents.map((doc,i)=><div key={doc.id}><strong><>{labels[i]} · {doc.reference}</></strong>{doc.date&&<span lang={language}>{new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(doc.date))}</span>}{doc.sourceUrl&&<a href={doc.sourceUrl} target="_blank" rel="noreferrer"><UiMessage id="MotionComparison.sourceDocx" values={{language: doc.language?.toUpperCase()}}/></a>}</div>)}</div>}
        {(data.status==='unavailable') ? <p className="explorer-diff-notice">{data.reason} <button type="button" onClick={retry}><UiMessage id="commissionfollowups.try_again"/></button></p> : <>
          <p className="explorer-diff-summary"><UiMessage id="MotionComparison.summary" values={{changed: (summary?.changed ?? '—'), removed: (summary?.removed ?? '—'), fromStage: labels[0].toLowerCase(), added: (summary?.added ?? '—'), toStage: labels[1].toLowerCase()}}/></p>
          <div className="explorer-diff-views" role="group" aria-label={ui.t("MotionComparison.reading_view")}>{([['inline',ui.t("MotionComparison.inline_changes")],['text',ui.t("MotionComparison.full_text")],['columns',ui.t("WordingDiff.side_by_side")]] as const).map(([value,label])=><button key={value} type="button" aria-pressed={view===value} onClick={()=>setView(value)}>{label}</button>)}</div>
          {(view==='text') ? <>
            <label className="explorer-diff-read-control"><UiMessage id="MotionComparison.read"/><select value={readSide} onChange={e=>setReadSide(e.target.value as 'before'|'after')}><option value="before">{fullNames[0]}</option><option value="after">{fullNames[1]}</option></select></label>
            <div className="explorer-diff-reader" lang={data.textLanguage || ''}>
              <h5 lang={ui.language}>{fullNames[readIndex]}{data.documents[readIndex] ? (` · ${data.documents[readIndex].reference}`) : ''}</h5>
              {textBlocks.map(block=><div key={block.index} className="explorer-diff-text-passage" data-kind={block.kind}><p className="explorer-diff-reference" lang={ui.language}>{reference(block, ui)}</p><p className="explorer-diff-wording">{block.text}</p></div>)}
              {!textBlocks.length&&<p lang={ui.language}><UiMessage id="batch5.dossiervotetext.tsx.24.50"/></p>}
            </div>
          </> : <>
            <p className="explorer-diff-legend"><span><del><UiMessage id="MotionComparison.removedLegend" values={{documentName:fullNames[0]}}/></del></span><span><ins><UiMessage id="MotionComparison.addedLegend" values={{documentName:fullNames[1]}}/></ins></span></p>
            <label className="explorer-diff-checkbox"><input type="checkbox" checked={showUnchanged} onChange={e=>setShowUnchanged(e.target.checked)}/> <UiMessage id="MotionComparison.unchanged" values={{count:summary?.unchanged??'—'}}/></label>
            {noDifferences&&<p><UiMessage id="MotionComparison.no_wording_differences"/></p>}
            {!rows.length&&!noDifferences&&<p>{summary ? <UiMessage id="MotionComparison.nothing_to_compare"/> : <UiMessage id="MotionComparison.comparison_unavailable"/>}</p>}
            <div className="explorer-diff-rows" data-view={view} lang={data.textLanguage || ''}>{rows.map((row,i)=><article key={i} className="explorer-diff-row" data-kind={row.kind}>
              {(view==='inline') ? <InlinePassage row={row} labels={labels}/> : <><p className="explorer-diff-row-label" lang={ui.language}>{changeLabel(row,labels, ui)}</p><div className="explorer-diff-columns"><Passage row={row} side="before" name={labels[0]}/><Passage row={row} side="after" name={labels[1]}/></div></>}
            </article>)}</div>
          </>}
        </>}
      </>}
    </div>
  </section>;
}
