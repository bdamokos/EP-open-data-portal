import {mapWordingFormatting} from './contextAnnotations.mjs';
import {useId,useRef,type ReactNode} from 'react';
import type {DocumentContextResponse} from './DocumentContextTypes';
import type {DocumentLink,NoteAnchor,DocumentNote} from './explorerTypes';
import type {ProposalDocument,ProposalTable,ProposalUnit} from './proposalTypes';
import {ReferenceScope,ReferenceText,readerTexts} from './References';
import {InsightQuestionReader} from './InsightReaders';
import {ProposalMath} from './ProposalMath';
import {ProposalNotes} from './ProposalNotes';
import {WordingDiff} from './components/WordingDiff';
import {AmendmentJustification} from './components/AmendmentJustification';
import {FindInText} from './TextSearch';

const units=(list:ProposalUnit[]):ProposalUnit[]=>list.flatMap(unit=>[unit,...units(unit.children)]);
const safeHref=(raw:string|undefined|null)=>{try{const url=new URL(raw||'');return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
export const proposalPlacementReasons:Record<string,string>={
  language_version_unaffected:'No change in this language version.',
  language_scope_mixed:'This comparison is shown separately from the document.',
  amends_existing_law:'This amendment changes existing law.',
  council_position_unavailable:'The Council position is unavailable here.',
  baseline_unknown:'The text this amendment changes isn’t identified.',
  proposal_baseline_unavailable:'The Commission proposal is unavailable here.',
  proposal_note_scope_unavailable:'The footnotes in this amendment could not be placed.',
  math_comparison_unavailable:'The equations could not be compared.',
  parent_target_not_found:'The provision that would contain the new text could not be found.',
  conflicting_target_evidence:'The published location and original wording do not agree.',
  client_target_unconfirmed:'The amendment’s location could not be confirmed.',
  duplicate_target_label:'A provision with the proposed label already exists.',
  relative_target_not_found:'The preceding provision could not be found.',
  multiple_published_targets:'The published location matches more than one passage.',
  target_not_found:'The passage this amendment changes could not be found.',
  target_reference_unavailable:'The proposal location is not specified clearly enough.',
  insertion_reference_unavailable:'The insertion location is not specified clearly enough.',
  source_structure_unavailable:'The full extent of this provision is unclear.',
  source_passage_incomplete:'The source passage is incomplete.',
  different_text_languages:'The proposal and amendment wording are in different languages.',
  matching_budget:'The amendment’s location could not be determined.',
};

type Placement=NonNullable<DocumentContextResponse['placement']>;
type Variant=NonNullable<DocumentContextResponse['amendment']>['variants'][number];
function ItemText({proposal,itemIndex,placement,block,prefix}:{proposal:ProposalDocument;itemIndex:number;placement:Placement|null|undefined;block:(inPlace:boolean,proposal?:ProposalDocument)=>ReactNode;prefix:string}) {
  const anchors=proposal.anchors as NoteAnchor[],links=proposal.links as DocumentLink[],active=placement?.status==='placed'&&placement.itemIndex===itemIndex;
  function sourceSlice(index:number,start=0,end=proposal.paragraphs[index].text.length) {
    const paragraph=proposal.paragraphs[index],text=paragraph.text;
    const selectedAnchors=anchors.filter(a=>a.paragraph===index&&(a.offset>start||start===0&&a.offset===0)&&a.offset<=end);
    const selectedLinks=links.filter(l=>l.paragraph===index).map(l=>({...l,start:Math.max(start,l.start),end:Math.min(end,l.end)})).filter(l=>l.end>l.start);
    const objects=paragraph.objects.filter(o=>o.offset>=start&&o.offset<end&&text[o.offset]==='\uFFFC').sort((a,b)=>a.offset-b.offset);
    const nodes:ReactNode[]=[];let from=start;
    const textPart=(a:number,b:number)=><ReferenceText key={'t'+a} text={text.slice(a,b)} start={a} anchors={selectedAnchors.filter(n=>n.offset>a&&n.offset<=b||a===0&&n.offset===0)} links={selectedLinks.map(l=>({...l,start:Math.max(a,l.start),end:Math.min(b,l.end)})).filter(l=>l.end>l.start)} final={b===end} notePrefix={prefix}/>;
    for(const object of objects){nodes.push(textPart(from,object.offset));nodes.push(object.kind==='math'?<ProposalMath key={'o'+object.offset} object={object} linkUrl={selectedLinks.find(link=>link.start<=object.offset&&link.end>=object.offset+1)?.url}/>:<span className="document-context-object" key={'o'+object.offset}>[Content in original]{safeHref(object.sourceUrl)&&<> <a href={safeHref(object.sourceUrl)!} target="_blank" rel="noreferrer">View original ↗</a></>}</span>);from=object.offset+1;const after=selectedAnchors.filter(a=>a.offset===from);if(after.length)nodes.push(<ReferenceText key={'n'+from} text="" start={from} anchors={after} links={[]} final notePrefix={prefix}/>);}
    nodes.push(textPart(from,end));return nodes;
  }
  const topTables=units(proposal.units).filter(u=>u.kind==='table'&&u.table).map(u=>u.table!);
  const anchorId=placement?.evidence?.find(e=>e.basis==='preceding-sibling-subtree')?.anchor;
  const owner=units(proposal.units).find(unit=>unit.id===anchorId);
  const insertionTable=active&&placement.operation==='insert'&&owner
    ? topTables.flatMap(table=>[table,...(table.nestedTables??[])]).filter(table=>table.paragraphs.includes(placement.insertAfter!)&&!table.paragraphs.includes(owner.extent.start)).sort((a,b)=>a.sourcePath.length-b.sourcePath.length)[0]
    : undefined;
  const row=(index:number)=>{
    const splice=active?placement.splice:undefined;
    if(splice&&index>=splice.start.paragraph&&index<=splice.end.paragraph){
      const nodes:ReactNode[]=[];
      if(index===splice.start.paragraph){if(splice.start.offset>0)nodes.push(<p key={'before'+index} data-source-paragraph={index}>{sourceSlice(index,0,splice.start.offset)}</p>);nodes.push(block(true,proposal));}
      if(index===splice.end.paragraph&&splice.end.offset<proposal.paragraphs[index].text.length)nodes.push(<p key={'after'+index} data-source-paragraph={index}>{sourceSlice(index,splice.end.offset)}</p>);
      return nodes;
    }
    const p=<p key={index} data-source-paragraph={index}>{sourceSlice(index)}</p>;
    return active&&placement.operation==='insert'&&!insertionTable&&placement.insertAfter===index?[p,block(true,proposal)]:[p];
  };
  function tableNode(table:ProposalTable):ReactNode {
    const nested=table.nestedTables??[],children=nested.filter(t=>!nested.some(parent=>parent!==t&&t.sourcePath.startsWith(parent.sourcePath+'/')));
    const nestedParagraphs=new Set(children.flatMap(t=>t.paragraphs));
    const cellContent=(indices:number[])=>indices.flatMap(index=>{
      const child=children.find(t=>t.paragraphs[0]===index);
      if(child)return [tableNode({...child,nestedTables:nested.filter(t=>t.sourcePath.startsWith(child.sourcePath+'/'))})];
      return nestedParagraphs.has(index)?[]:row(index);
    });
    type GridCell={column:number;colSpan:number;rowSpan:number;paragraphs:number[]};
    let previous=new Map<string,GridCell>();
    const rows=table.rows.map(tr=>{
      const rendered:GridCell[]=[],continuing=new Map<string,GridCell>();let column=0;
      for(let ci=0;ci<tr.cells.length;ci++){
        const cell=tr.cells[ci],members=[cell];
        if(cell.horizontalMerge==='start')while(tr.cells[ci+1]?.horizontalMerge==='continue')members.push(tr.cells[++ci]);
        const colSpan=members.reduce((sum,member)=>sum+member.colSpan,0),range=column+':'+(column+colSpan);
        const paragraphs=members.flatMap(member=>member.paragraphs);
        const vertical=members.every(member=>member.verticalMerge===cell.verticalMerge)?cell.verticalMerge:null;
        const owner=vertical==='continue'?previous.get(range):undefined;
        if(owner){owner.rowSpan++;owner.paragraphs.push(...paragraphs);continuing.set(range,owner);}
        else {
          // An orphan or mismatched continuation still owns readable source content.
          const current={column,colSpan,rowSpan:1,paragraphs};rendered.push(current);
          if(vertical==='start')continuing.set(range,current);
        }
        column+=colSpan;
      }
      previous=continuing;return rendered;
    });
    const content=<div className="proposal-table-scroll" key={table.sourcePath}><table className="proposal-table"><tbody>{rows.map((cells,ri)=><tr key={ri}>{cells.map(cell=>
      <td key={cell.column} colSpan={cell.colSpan} rowSpan={cell.rowSpan}>{cellContent([...new Set(cell.paragraphs)].sort((a,b)=>a-b))}</td>
    )}</tr>)}</tbody></table></div>;
    return insertionTable?.sourcePath===table.sourcePath?[content,block(true,proposal)]:content;
  }
  const tableParagraphs=new Set(topTables.flatMap(t=>t.paragraphs));
  return <>{proposal.paragraphs.flatMap((p,index)=>{
    const table=topTables.find(t=>t.paragraphs[0]===index);
    const empty=topTables.filter(t=>!t.paragraphs.length&&t.anchor===index).map(tableNode);
    return [...empty,...(table?[tableNode(table)]:tableParagraphs.has(index)?[]:row(p.index))];
  })}{topTables.filter(t=>!t.paragraphs.length&&t.anchor===proposal.paragraphs.length).map(tableNode)}<ProposalNotes notes={proposal.notes} prefix={prefix}/></>;
}

export function ProposalContextText({data,wording,amendmentId,language,showOriginalLink=true}:{data:DocumentContextResponse;showOriginalLink?:boolean;wording:Variant|null;amendmentId?:string;language:string}) {
  const reader=useRef<HTMLDivElement>(null),prefix='proposal-'+useId().replace(/[^A-Za-z0-9_-]/g,''),baseline=data.baseline!,items=data.proposal!.items;
  const fileFailures=(baseline.gaps||[]).filter((gap):gap is {code:string;itemId:string}=>Boolean(gap&&typeof gap==='object'&&typeof (gap as {itemId?:unknown}).itemId==='string'&&!['stale-metadata','stale-content','bundle-too-large'].includes(String((gap as {code?:unknown}).code))));
  const missingFiles=new Set(fileFailures.map(gap=>gap.itemId)).size;
  const fileLimit=(baseline.gaps||[]).some(gap=>gap&&typeof gap==='object'&&(gap as {code?:unknown}).code==='bundle-too-large');
  const placement=data.placement,placed=placement?.status==='placed'&&!!wording&&placement.itemIndex!==undefined&&!!items[placement.itemIndex]&&baseline.language===wording.language;
  const effective=placed?placement:null;
  const number=amendmentId?.match(/-AM-(\d+[a-z]*)$/i)?.[1].replace(/^0+(?=\d)/,'');
  const existing=baseline.kind==='existing-act',council=baseline.kind==='council-position',com=baseline.celex?.match(/^5(\d{4})PC(\d{4})$/),position=baseline.celex?.match(/^5(\d{4})AG(\d{4})\(01\)$/),identity=existing?`Existing act${baseline.actLabel?' · '+baseline.actLabel:''}${baseline.consolidationDate?' · '+baseline.consolidationDate:''}`:council?`Council position${position?' · '+Number(position[2])+'/'+position[1]:''}`:com?`Commission proposal · COM(${com[1]})${com[2]}`:'Commission proposal';
  const official=baseline.celex?`https://eur-lex.europa.eu/legal-content/${baseline.language.toUpperCase()}/TXT/?uri=CELEX:${baseline.celex}`:null;
  const report=`https://www.europarl.europa.eu/doceo/document/${data.documentId}_${baseline.language.toUpperCase()}.html`;
  const showAmendment=()=>{const node=reader.current?.querySelector<HTMLElement>('[data-context-target="true"]');node?.scrollIntoView({block:'center'});node?.focus({preventScroll:true});};
  const amendmentBlock=(inPlace:boolean,proposal?:ProposalDocument)=>{
    const original=inPlace&&placement?.originalText!==undefined?placement.originalText:wording?.originalText??null;
    // A placed source span keeps its parsed provision number. When the amendment's
    // original column is exactly that span without the number, the number is shown
    // as source context and only the wording is compared; proposed text is never changed.
    const anchor=inPlace&&proposal&&placement?.operation==='replace'&&placement.splice?.start.offset===0?units(proposal.units).find(unit=>placement.evidence?.some(e=>e.anchor===unit.id)):undefined;
    const sourcePrefix=anchor?.label?.prefix&&anchor.content[0]===placement?.splice?.start.paragraph&&original?.startsWith(anchor.label.prefix)?anchor.label.prefix:undefined;
    const collapse=(text:string|null|undefined)=>(text??'').replace(/\s+/gu,' ').trim();
    let labelLength=sourcePrefix&&original!==null&&wording?.originalText&&collapse(original.slice(sourcePrefix.length))===collapse(wording.originalText)?sourcePrefix.length:0;
    let renderOriginal:((value:string,start:number)=>ReactNode)|undefined;
    if(inPlace&&proposal&&placement?.splice){
      const splice=placement.splice,anchors:NoteAnchor[]=[],links:DocumentLink[]=[];let base=0;
      for(let index=splice.start.paragraph;index<=splice.end.paragraph;index++){
        const start=index===splice.start.paragraph?splice.start.offset:0,end=index===splice.end.paragraph?splice.end.offset:proposal.paragraphs[index].text.length;
        for(const a of proposal.anchors as NoteAnchor[])if(a.paragraph===index&&(a.offset>start||start===0&&a.offset===0)&&a.offset<=end)anchors.push({...a,offset:base+a.offset-start});
        for(const l of proposal.links as DocumentLink[])if(l.paragraph===index&&l.end>start&&l.start<end)links.push({...l,start:base+Math.max(l.start,start)-start,end:base+Math.min(l.end,end)-start});
        base+=end-start+1;
      }
      // A note or link on the number itself stays inside the compared source text.
      if(anchors.some(a=>a.offset<=labelLength)||links.some(l=>l.start<labelLength))labelLength=0;
      renderOriginal=(value,offset)=>{const start=offset+labelLength,end=start+value.length;return <ReferenceText text={value} start={start} anchors={anchors.filter(a=>a.offset>start&&a.offset<=end||start===0&&a.offset===0)} links={links.map(l=>({...l,start:Math.max(l.start,start),end:Math.min(l.end,end)})).filter(l=>l.end>l.start)} final notePrefix={prefix+'-'+placement.itemIndex}/>;};
    }
    const comparisonOriginal=labelLength?original!.slice(labelLength):original;
    // Formatting offsets belong to the compared wording, before the source
    // annotation callback shifts them back past the separated provision label.
    const originalFormatting=mapWordingFormatting(wording?.originalText,comparisonOriginal,wording?.originalFormatting);
    // Placement also accepts punctuation/quotation normalization. If its source
    // span cannot carry the column offsets exactly, compare both published
    // columns with their own ranges; proposed wording is never modified.
    const useColumns=originalFormatting===null;
    return <section key="amendment" className="document-context-amendment" data-amendment-block="true" data-context-target={inPlace?'true':undefined} tabIndex={inPlace?-1:undefined} aria-label={'Amendment'+(number?' '+number:'')}><h4 lang="en">Amendment{number?' '+number:''}{council?' · Council position':''}</h4>{existing&&placed&&placement.instruction&&<p className="document-context-instruction">{placement.instruction.replace(/[‘“"„]\s*$/u,'').trim()}</p>}{labelLength>0&&<p className="document-context-provision-label" data-source-label="true">{sourcePrefix!.trim()}</p>}{wording&&<WordingDiff labels={existing?{original:'Existing act'}:council?{original:'Council position'}:undefined} originalFormatting={useColumns?wording.originalFormatting:originalFormatting} proposedFormatting={existing&&placed&&placement.proposedRange?wording.proposedFormatting?.filter(mark=>mark.end>placement.proposedRange!.start&&mark.start<placement.proposedRange!.end).map(mark=>({...mark,start:Math.max(mark.start,placement.proposedRange!.start)-placement.proposedRange!.start,end:Math.min(mark.end,placement.proposedRange!.end)-placement.proposedRange!.start})):wording.proposedFormatting} original={placement?.operation==='insert'?'':useColumns?wording.originalText:comparisonOriginal} proposed={placement?.operation==='delete'?'':existing&&placed?placement.proposedText??wording.proposedText:wording.proposedText} language={wording.language} emptySemantics="insertion-deletion" presentation="context" renderOriginal={useColumns?undefined:renderOriginal}/>}<AmendmentJustification record={wording}/></section>;
  };
  return <>
    <p className="proposal-context-summary">{showOriginalLink&&official?<a href={official} target="_blank" rel="noreferrer">{identity} ↗</a>:identity} {showOriginalLink&&<>· <a href={report} target="_blank" rel="noreferrer">Parliament {data.documentId.startsWith('A-')?'report':'document'} ↗</a></>}</p>
    <p className="document-context-language">Text language: {baseline.language.toUpperCase()}</p>
    <div className="document-context-tools"><FindInText target={reader} label={existing?'Find in existing act':council?'Find in Council position':'Find in proposal'}/></div>
    {placed?<div className="document-context-passage"><button type="button" onClick={showAmendment}>Go to amendment</button></div>:<p className="document-context-notice" role="status">{proposalPlacementReasons[placement?.reason||'']||'The amendment’s location could not be determined.'}</p>}
    {missingFiles>0&&<p className="document-context-notice">{missingFiles} document {missingFiles===1?'file':'files'} not loaded.</p>}
    {fileLimit&&<p className="document-context-notice">Document file limit reached.</p>}
    {baseline.items.some(item=>item.source.stale||item.source.refreshError)&&<p className="document-context-notice">{existing?'Saved text':baseline.items.some(item=>item.source.refreshError)?'Couldn’t update the proposal. Showing saved text.':'Showing saved proposal text.'}</p>}
    <div className="document-context-text proposal-context-text" ref={reader} lang={baseline.language}>{!placed&&amendmentBlock(false)}{items.map((item,index)=>{
      const p=item.proposal,notes=p.notes as DocumentNote[],links=p.links as DocumentLink[];
      return <section key={index} data-proposal-item={item.kind+'-'+item.index}><h4 className="proposal-item-heading">{item.kind==='act'?existing?'Existing act':council?'Council position':'Proposal':'Annexes'}{item.index>1?' · part '+item.index:''}</h4>
        {p.gaps.length>0&&<p className="document-context-notice">{p.gaps.some(gap=>gap.code==='excerpted-source')?'Excerpt.':p.contentComplete===false?'Some content unavailable.':'Some content could not be read.'}</p>}
        <ReferenceScope texts={readerTexts(p.paragraphs.map(p=>p.text),notes,links)} notes={notes} notePrefix={prefix+'-'+index} language={language} textLanguage={baseline.language} renderQuestion={question=><InsightQuestionReader id={question} language={language} heading="Referenced question" includeAnswers/>}>
          <ItemText proposal={p} itemIndex={index} placement={effective} block={amendmentBlock} prefix={prefix+'-'+index}/>
        </ReferenceScope>
        {showOriginalLink&&safeHref(council||existing?official:baseline.items[index]?.source.url)&&<p className="document-context-source"><a href={safeHref(council||existing?official:baseline.items[index].source.url)!} target="_blank" rel="noreferrer">{existing?'Open existing act':council?'Open Council position':'Open original '+(item.kind==='act'?'proposal':'annex')+' DOCX'} ↗</a></p>}
      </section>;
    })}</div>
    <p className="document-context-source">{baseline.attribution}</p>
  </>;
}
