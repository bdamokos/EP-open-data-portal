import {UiAnnotatedMessage, UiMessage, useUiI18n} from '../UiI18nReact';
import {Fragment,useMemo,useState,type ReactNode} from 'react';
import {amendmentLanguageScope,amendmentMixedLanguageScope} from '../amendmentLanguageScope.mjs';
import {textDiff,type TextDiffSegment} from '../textDiff.mjs';
import './WordingDiff.css';
import {FormattedWording,formattingDiff,type WordingFormat} from './WordingFormatting';

type Props={
  original:string|null;proposed:string|null;language:string|null;
  originalFormatting?:WordingFormat[];proposedFormatting?:WordingFormat[];
  emptySemantics:'insertion-deletion'|'not-supplied';
  presentation?:'comparison'|'context';
  highlightChanges?:boolean;
  // UTF-16 offsets count only original-side equal/deleted text, never insertions.
  renderOriginal?:(text:string,start:number)=>ReactNode;
  labels?:{original?:string;proposed?:string;emptyOriginal?:string;emptyProposed?:string};
};
function Passage({segments,language,renderOriginal,originalFormatting=[],proposedFormatting=[],side='original'}:{segments:TextDiffSegment[];language:string|null;renderOriginal?:Props['renderOriginal'];originalFormatting?:WordingFormat[];proposedFormatting?:WordingFormat[];side?:'original'|'proposed'}) {
  const ui = useUiI18n();
  let originalOffset=0,proposedOffset=0;
  return <p className="wording-diff__passage" lang={language||''}>{segments.map((segment,index)=>{
    const proposed=segment.type==='insert'||segment.type==='equal'&&side==='proposed';
    const start=proposed?proposedOffset:originalOffset;
    if(segment.type!=='insert')originalOffset+=segment.text.length;
    if(segment.type!=='delete')proposedOffset+=segment.text.length;
    const content=<FormattedWording text={segment.text} start={start} formatting={proposed?proposedFormatting:originalFormatting} renderText={proposed?undefined:renderOriginal}/>;
    if(segment.type==='equal')return <Fragment key={index}>{content}</Fragment>;
    const Tag=segment.type==='delete'?'del':'ins';
    return <Tag key={index}><UiAnnotatedMessage id={segment.type==='delete'?'WordingDiff.deletedWording':'WordingDiff.insertedWording'} values={{text:<>{content}</>}} srClassName="wording-diff__sr"/></Tag>;
  })}</p>;
}
function Comparison({original,proposed,language,emptySemantics,presentation='comparison',highlightChanges=true,labels={},renderOriginal,originalFormatting=[],proposedFormatting=[],publishedOnly=false}:Props&{publishedOnly?:boolean}) {
  const ui = useUiI18n();
  const comparable=highlightChanges&&!publishedOnly&&original!==null&&proposed!==null&&(original!==''||proposed!=='')&&
    (emptySemantics==='insertion-deletion'||original!==''&&proposed!=='');
  const diff=useMemo(()=>comparable?textDiff(original!,proposed!,language):null,[comparable,original,proposed,language]);
  const segments=useMemo(()=>diff?.status==='ok'?formattingDiff(diff.segments,originalFormatting,proposedFormatting):[],[diff,originalFormatting,proposedFormatting]);
  const oneSided=comparable&&(original===''||proposed==='');
  const mostlyRewritten=!oneSided&&diff?.status==='ok'&&diff.similarity<0.3;
  const [mode,setMode]=useState<'changes'|'sides'>('sides');
  const columns=([
    {side:'original',text:original,label:labels.original||ui.t("textsearch.original_text"),empty:labels.emptyOriginal??((emptySemantics==='insertion-deletion')?ui.t("batch5.amendments.tsx.126.13"):ui.t("WordingDiff.no_original_wording"))},
    {side:'proposed',text:proposed,label:labels.proposed||ui.t("batch5.amendments.tsx.123.11"),empty:labels.emptyProposed??((emptySemantics==='insertion-deletion')?ui.t("batch5.amendments.tsx.123.9"):ui.t("WordingDiff.no_proposed_wording"))},
  ] as const);
  return <div className="wording-diff" lang={ui.language}>
    {publishedOnly&&<p className="wording-diff__note"><UiMessage id="WordingDiff.language_note_and_other_wording_shown_as_published"/></p>}
    {oneSided&&<p className="wording-diff__note">{(original==='')?<UiMessage id="WordingDiff.new_text"/>:<UiMessage id="WordingDiff.deleted_text_message12"/>}</p>}
    {diff?.status==='ok'&&<>
      <div className="wording-diff__toggle" role="group" aria-label={ui.t("WordingDiff.wording_view")}>
        <button type="button" aria-pressed={mode==='changes'} onClick={()=>setMode('changes')}><UiMessage id="WordingDiff.changes"/></button>
        <button type="button" aria-pressed={mode==='sides'} onClick={()=>setMode('sides')}><UiMessage id="WordingDiff.side_by_side"/></button>
      </div>
      {presentation!=='context'&&mostlyRewritten&&<p className="wording-diff__note"><UiMessage id="WordingDiff.mostly_rewritten"/></p>}
      {presentation!=='context'&&<p className="wording-diff__legend"><span><s><UiMessage id="WordingDiff.deleted_text_struck_through"/></s></span><span><u><UiMessage id="WordingDiff.inserted_text_underlined"/></u></span></p>}
    </>}
    {diff?.status==='too-large'&&<p className="wording-diff__note"><UiMessage id="WordingDiff.too_extensively_changed_to_highlight"/></p>}
    {diff?.status==='ok'&&mode==='changes'?<>
      <Passage segments={segments} language={language} renderOriginal={renderOriginal} originalFormatting={originalFormatting} proposedFormatting={proposedFormatting}/>
    </>:<div className="wording-diff__columns">{columns.map(column=><section key={column.side}>
      <h5>{column.label}</h5>
      {column.text===null?<p>{(column.side==='original')?<UiMessage id="motionamendments.original_wording_is_unavailable.bf182c"/>:<UiMessage id="motionamendments.proposed_wording_is_unavailable.18546e"/>}</p>:
        column.text===''?<p>{column.empty}</p>:
        <Passage language={language} side={column.side} originalFormatting={originalFormatting} proposedFormatting={proposedFormatting} renderOriginal={column.side==='original'?renderOriginal:undefined} segments={diff?.status==='ok'?segments.filter(segment=>segment.type!==(column.side==='original'?'insert':'delete')):[{type:'equal',text:column.text}]}/>}
    </section>)}</div>}
  </div>;
}
export function WordingDiff(props:Props) {
  const ui = useUiI18n();
  const mixedScope=amendmentMixedLanguageScope({originalText:props.original,proposedText:props.proposed,language:props.language});
  const scope=amendmentLanguageScope({originalText:props.original,proposedText:props.proposed,language:props.language});
  if(scope)return <div className="wording-diff" lang={ui.language}><p className="wording-diff__note"><UiMessage id="batch5.amendments.tsx.123.10"/></p><p className="wording-diff__scope" lang={scope.language}>{scope.note}</p></div>;
  // A new exact wording selection gets its own default; choices never persist outside this instance.
  return <Comparison key={JSON.stringify([props.original,props.proposed,props.originalFormatting,props.proposedFormatting,props.language,props.emptySemantics,props.presentation,props.highlightChanges])} {...props} publishedOnly={Boolean(mixedScope)} emptySemantics={mixedScope?'not-supplied':props.emptySemantics}/>;
}
