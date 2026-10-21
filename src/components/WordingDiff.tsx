import {Fragment,useMemo,useState,type ReactNode} from 'react';
import {textDiff,type TextDiffSegment} from '../textDiff.mjs';
import './WordingDiff.css';

type Props={
  original:string|null;proposed:string|null;language:string|null;
  emptySemantics:'insertion-deletion'|'not-supplied';
  // UTF-16 offsets count only original-side equal/deleted text, never insertions.
  renderOriginal?:(text:string,start:number)=>ReactNode;
  labels?:{original?:string;proposed?:string;emptyOriginal?:string;emptyProposed?:string};
};
function Passage({segments,language,renderOriginal}:{segments:TextDiffSegment[];language:string|null;renderOriginal?:Props['renderOriginal']}) {
  let offset=0;
  return <p className="wording-diff__passage" lang={language||''}>{segments.map((segment,index)=>{
    const start=offset;
    if(segment.type!=='insert')offset+=segment.text.length;
    const content=segment.type!=='insert'&&renderOriginal?renderOriginal(segment.text,start):segment.text;
    if(segment.type==='equal')return <Fragment key={index}>{content}</Fragment>;
    const Tag=segment.type==='delete'?'del':'ins';
    return <Tag key={index}><span className="wording-diff__sr" lang="en">{segment.type==='delete'?'Deleted text: ':'Inserted text: '}</span>{content}<span className="wording-diff__sr" lang="en"> end</span></Tag>;
  })}</p>;
}
function Comparison({original,proposed,language,emptySemantics,labels={},renderOriginal}:Props) {
  const comparable=original!==null&&proposed!==null&&(original!==''||proposed!=='')&&
    (emptySemantics==='insertion-deletion'||original!==''&&proposed!=='');
  const diff=useMemo(()=>comparable?textDiff(original!,proposed!,language):null,[comparable,original,proposed,language]);
  const mostlyRewritten=diff?.status==='ok'&&diff.similarity<0.3;
  const [mode,setMode]=useState<'changes'|'sides'>(mostlyRewritten?'sides':'changes');
  const columns=([
    {side:'original',text:original,label:labels.original||'Original text',empty:labels.emptyOriginal??(emptySemantics==='insertion-deletion'?'No original text (insertion).':'The source supplies no original wording.')},
    {side:'proposed',text:proposed,label:labels.proposed||'Proposed text',empty:labels.emptyProposed??(emptySemantics==='insertion-deletion'?'Text deleted.':'The source supplies no proposed wording.')},
  ] as const);
  return <div className="wording-diff" lang="en">
    {diff?.status==='ok'&&<>
      <div className="wording-diff__toggle" role="group" aria-label="Wording view">
        <button type="button" aria-pressed={mode==='changes'} onClick={()=>setMode('changes')}>Changes</button>
        <button type="button" aria-pressed={mode==='sides'} onClick={()=>setMode('sides')}>Side by side</button>
      </div>
      {mostlyRewritten&&<p className="wording-diff__note">Mostly rewritten</p>}
      <p className="wording-diff__legend"><span>Deleted text: <s>struck through</s></span><span>Inserted text: <u>underlined</u></span></p>
    </>}
    {diff?.status==='too-large'&&<p className="wording-diff__note">Wording is too long or too extensively changed to highlight. Showing side by side.</p>}
    {diff?.status==='ok'&&mode==='changes'?<>
      {columns.filter(column=>column.text==='').map(column=><p key={column.side}>{column.empty}</p>)}
      <Passage segments={diff.segments} language={language} renderOriginal={renderOriginal}/>
    </>:<div className="wording-diff__columns">{columns.map(column=><section key={column.side}>
      <h5>{column.label}</h5>
      {column.text===null?<p>{column.side==='original'?'Original wording is unavailable.':'Proposed wording is unavailable.'}</p>:
        column.text===''?<p>{column.empty}</p>:
        <Passage language={language} renderOriginal={column.side==='original'?renderOriginal:undefined} segments={diff?.status==='ok'?diff.segments.filter(segment=>segment.type!==(column.side==='original'?'insert':'delete')):[{type:'equal',text:column.text}]}/>}
    </section>)}</div>}
    {diff?.status==='ok'&&<p className="wording-diff__note">Changes highlighted by this explorer by comparing the published original and proposed wording. The official document is authoritative.</p>}
  </div>;
}
export function WordingDiff(props:Props) {
  // A new exact wording selection gets its own default; choices never persist outside this instance.
  return <Comparison key={JSON.stringify([props.original,props.proposed,props.language,props.emptySemantics])} {...props}/>;
}
