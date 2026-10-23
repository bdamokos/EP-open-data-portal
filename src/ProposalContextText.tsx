import {useId,useRef,type ReactNode} from 'react';
import type {DocumentContextResponse} from './DocumentContextTypes';
import type {DocumentLink,NoteAnchor,DocumentNote} from './explorerTypes';
import type {ProposalDocument,ProposalTable,ProposalUnit} from './proposalTypes';
import {DocumentNotes,ReferenceScope,ReferenceText,readerTexts} from './References';
import {InsightQuestionReader} from './InsightReaders';
import {ProposalMath} from './ProposalMath';
import {WordingDiff} from './components/WordingDiff';
import {FindInText} from './TextSearch';

const units=(list:ProposalUnit[]):ProposalUnit[]=>list.flatMap(unit=>[unit,...units(unit.children)]);
const safeHref=(raw:string|undefined|null)=>{try{const url=new URL(raw||'');return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
export const proposalPlacementReasons:Record<string,string>={
  amends_existing_law:'This amendment changes existing law.',
  council_position_unavailable:'The Council position is unavailable here.',
  baseline_unknown:'The source does not identify the text this amendment changes.',
  proposal_baseline_unavailable:'The Commission proposal is unavailable here.',
  math_comparison_unavailable:'The equations could not be compared.',
  parent_target_not_found:'The provision that would contain the new text could not be found.',
  conflicting_target_evidence:'The published location and original wording do not agree.',
  duplicate_target_label:'A provision with the proposed label already exists.',
  relative_target_not_found:'The preceding provision could not be found.',
  multiple_published_targets:'The published location matches more than one passage.',
  target_not_found:'The passage this amendment changes could not be found.',
  target_reference_unavailable:'The proposal location is not specified clearly enough.',
  insertion_reference_unavailable:'The insertion location is not specified clearly enough.',
  source_structure_unavailable:'The source does not establish the complete boundaries of this provision.',
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
    for(const object of objects){nodes.push(textPart(from,object.offset));nodes.push(object.kind==='math'?<ProposalMath key={'o'+object.offset} object={object}/>:<span className="document-context-object" key={'o'+object.offset}>[Content in original]{safeHref(object.sourceUrl)&&<> <a href={safeHref(object.sourceUrl)!} target="_blank" rel="noreferrer">View original ↗</a></>}</span>);from=object.offset+1;const after=selectedAnchors.filter(a=>a.offset===from);if(after.length)nodes.push(<ReferenceText key={'n'+from} text="" start={from} anchors={after} links={[]} final notePrefix={prefix}/>);}
    nodes.push(textPart(from,end));return nodes;
  }
  const row=(index:number)=>{
    const splice=active?placement.splice:undefined;
    if(splice&&index>=splice.start.paragraph&&index<=splice.end.paragraph){
      const nodes:ReactNode[]=[];
      if(index===splice.start.paragraph){if(splice.start.offset>0)nodes.push(<p key={'before'+index} data-source-paragraph={index}>{sourceSlice(index,0,splice.start.offset)}</p>);nodes.push(block(true,proposal));}
      if(index===splice.end.paragraph&&splice.end.offset<proposal.paragraphs[index].text.length)nodes.push(<p key={'after'+index} data-source-paragraph={index}>{sourceSlice(index,splice.end.offset)}</p>);
      return nodes;
    }
    const p=<p key={index} data-source-paragraph={index}>{sourceSlice(index)}</p>;
    return active&&placement.operation==='insert'&&placement.insertAfter===index?[p,block(true,proposal)]:[p];
  };
  const topTables=units(proposal.units).filter(u=>u.kind==='table'&&u.table).map(u=>u.table!);
  function tableNode(table:ProposalTable):ReactNode {
    const nested=table.nestedTables??[],children=nested.filter(t=>!nested.some(parent=>parent!==t&&t.sourcePath.startsWith(parent.sourcePath+'/')));
    const nestedParagraphs=new Set(children.flatMap(t=>t.paragraphs));
    const cellContent=(indices:number[])=>indices.flatMap(index=>{
      const child=children.find(t=>t.paragraphs[0]===index);
      if(child)return [tableNode({...child,nestedTables:nested.filter(t=>t.sourcePath.startsWith(child.sourcePath+'/'))})];
      return nestedParagraphs.has(index)?[]:row(index);
    });
    return <div className="proposal-table-scroll" key={table.sourcePath}><table className="proposal-table"><tbody>{table.rows.map((tr,ri)=><tr key={ri}>{tr.cells.map((cell,ci)=>{
      if(cell.verticalMerge==='continue'||cell.horizontalMerge==='continue')return null;
      let rowSpan=1;if(cell.verticalMerge==='start')while(table.rows[ri+rowSpan]?.cells[ci]?.verticalMerge==='continue')rowSpan++;
      let colSpan=cell.colSpan;if(cell.horizontalMerge==='start'){let after=ci+1;while(tr.cells[after]?.horizontalMerge==='continue')colSpan+=tr.cells[after++].colSpan;}
      const merged=[...cell.paragraphs];
      if(cell.horizontalMerge==='start'){let after=ci+1;while(tr.cells[after]?.horizontalMerge==='continue')merged.push(...tr.cells[after++].paragraphs);}
      for(let after=1;after<rowSpan;after++)merged.push(...table.rows[ri+after].cells[ci].paragraphs);
      return <td key={ci} colSpan={colSpan} rowSpan={rowSpan}>{cellContent([...new Set(merged)].sort((a,b)=>a-b))}</td>;
    })}</tr>)}</tbody></table></div>;
  }
  const tableParagraphs=new Set(topTables.flatMap(t=>t.paragraphs));
  return <>{proposal.paragraphs.flatMap((p,index)=>{
    const table=topTables.find(t=>t.paragraphs[0]===index);
    const empty=topTables.filter(t=>!t.paragraphs.length&&t.anchor===index).map(tableNode);
    return [...empty,...(table?[tableNode(table)]:tableParagraphs.has(index)?[]:row(p.index))];
  })}{topTables.filter(t=>!t.paragraphs.length&&t.anchor===proposal.paragraphs.length).map(tableNode)}<DocumentNotes notes={proposal.notes as DocumentNote[]} prefix={prefix}/></>;
}

export function ProposalContextText({data,wording,amendmentId,language}:{data:DocumentContextResponse;wording:Variant|null;amendmentId?:string;language:string}) {
  const reader=useRef<HTMLDivElement>(null),prefix='proposal-'+useId().replace(/[^A-Za-z0-9_-]/g,''),baseline=data.baseline!,items=data.proposal!.items;
  const placement=data.placement,placed=placement?.status==='placed'&&!!wording&&placement.itemIndex!==undefined&&!!items[placement.itemIndex]&&baseline.language===wording.language;
  const effective=placed?placement:null;
  const number=amendmentId?.match(/-AM-(\d+[a-z]*)$/i)?.[1].replace(/^0+(?=\d)/,'');
  const com=baseline.celex?.match(/^5(\d{4})PC(\d{4})$/),identity=com?`Commission proposal · COM(${com[1]})${com[2]}`:'Commission proposal';
  const official=baseline.celex?`https://eur-lex.europa.eu/legal-content/${baseline.language.toUpperCase()}/TXT/?uri=CELEX:${baseline.celex}`:null;
  const report=`https://www.europarl.europa.eu/doceo/document/${data.documentId}_${baseline.language.toUpperCase()}.html`;
  const showAmendment=()=>{const node=reader.current?.querySelector<HTMLElement>('[data-context-target="true"]');node?.scrollIntoView({block:'center'});node?.focus({preventScroll:true});};
  const amendmentBlock=(inPlace:boolean,proposal?:ProposalDocument)=>{
    const original=inPlace&&placement?.originalText!==undefined?placement.originalText:wording?.originalText??null;
    let renderOriginal:((value:string,start:number)=>ReactNode)|undefined;
    if(inPlace&&proposal&&placement?.splice){
      const splice=placement.splice,anchors:NoteAnchor[]=[],links:DocumentLink[]=[];let base=0;
      for(let index=splice.start.paragraph;index<=splice.end.paragraph;index++){
        const start=index===splice.start.paragraph?splice.start.offset:0,end=index===splice.end.paragraph?splice.end.offset:proposal.paragraphs[index].text.length;
        for(const a of proposal.anchors as NoteAnchor[])if(a.paragraph===index&&(a.offset>start||start===0&&a.offset===0)&&a.offset<=end)anchors.push({...a,offset:base+a.offset-start});
        for(const l of proposal.links as DocumentLink[])if(l.paragraph===index&&l.end>start&&l.start<end)links.push({...l,start:base+Math.max(l.start,start)-start,end:base+Math.min(l.end,end)-start});
        base+=end-start+1;
      }
      renderOriginal=(value,start)=>{const end=start+value.length;return <ReferenceText text={value} start={start} anchors={anchors.filter(a=>a.offset>start&&a.offset<=end||start===0&&a.offset===0)} links={links.map(l=>({...l,start:Math.max(l.start,start),end:Math.min(l.end,end)})).filter(l=>l.end>l.start)} final notePrefix={prefix+'-'+placement.itemIndex}/>;};
    }
    return <section key="amendment" className="document-context-amendment" data-amendment-block="true" data-context-target={inPlace?'true':undefined} tabIndex={inPlace?-1:undefined} aria-label={'Amendment'+(number?' '+number:'')}><h4 lang="en">Amendment{number?' '+number:''}</h4>{wording&&<WordingDiff original={placement?.operation==='insert'?'':original} proposed={placement?.operation==='delete'?'':wording.proposedText} language={wording.language} emptySemantics="insertion-deletion" presentation="context" renderOriginal={renderOriginal}/>}</section>;
  };
  return <>
    <p className="proposal-context-summary">{official?<a href={official} target="_blank" rel="noreferrer">{identity} ↗</a>:identity} · <a href={report} target="_blank" rel="noreferrer">Parliament {data.documentId.startsWith('A-')?'report':'document'} ↗</a></p>
    <p className="document-context-language">Text language: {baseline.language.toUpperCase()}</p>
    <div className="document-context-tools"><FindInText target={reader} label="Find in proposal"/></div>
    {placed?<div className="document-context-passage"><button type="button" onClick={showAmendment}>Go to amendment</button></div>:<p className="document-context-notice" role="status">{proposalPlacementReasons[placement?.reason||'']||'The amendment’s location could not be determined.'}</p>}
    {baseline.status!=='available'&&<p className="document-context-notice">Some proposal content is unavailable.</p>}
    {baseline.items.some(item=>item.source.stale||item.source.refreshError)&&<p className="document-context-notice">{baseline.items.some(item=>item.source.refreshError)?'Couldn’t update the proposal. Showing saved text.':'Showing saved proposal text.'}</p>}
    <div className="document-context-text proposal-context-text" ref={reader} lang={baseline.language}>{!placed&&amendmentBlock(false)}{items.map((item,index)=>{
      const p=item.proposal,notes=p.notes as DocumentNote[],links=p.links as DocumentLink[];
      return <section key={index} data-proposal-item={item.kind+'-'+item.index}><h4 className="proposal-item-heading">{item.kind==='act'?'Proposal':'Annexes'}{item.index>1?' · part '+item.index:''}</h4>
        {p.gaps.length>0&&<p className="document-context-notice">{p.gaps.some(gap=>gap.code==='excerpted-source')?'This view contains source excerpts.':p.contentComplete===false?'Some source content is unavailable.':'Some source structure could not be read.'}</p>}
        <ReferenceScope texts={readerTexts(p.paragraphs.map(p=>p.text),notes,links)} notes={notes} notePrefix={prefix+'-'+index} language={language} textLanguage={baseline.language} renderQuestion={question=><InsightQuestionReader id={question} language={language} heading="Referenced question" includeAnswers/>}>
          <ItemText proposal={p} itemIndex={index} placement={effective} block={amendmentBlock} prefix={prefix+'-'+index}/>
        </ReferenceScope>
        {safeHref(baseline.items[index]?.source.url)&&<p className="document-context-source"><a href={safeHref(baseline.items[index].source.url)!} target="_blank" rel="noreferrer">Open original {item.kind==='act'?'proposal':'annex'} DOCX ↗</a></p>}
      </section>;
    })}</div>
    <p className="document-context-source">{baseline.attribution}</p>
  </>;
}
