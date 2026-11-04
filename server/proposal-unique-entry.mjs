import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {docxParts} from './document-text.mjs';
import {proposalCandidates} from './proposal-structure.mjs';
import {nativeInlineRowsComplete} from './proposal-inline-guard.mjs';
const fold=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim(),flatten=units=>units.flatMap(unit=>[unit,...flatten(unit.children)]);
// Count even hidden or unsupported paragraphs/cells. The retained projection
// alone cannot prove uniqueness when source content was omitted during parsing.
function uniqueNativeEntry(buffer,hash,original){
 if(!Buffer.isBuffer(buffer)||createHash('sha256').update(buffer).digest('hex')!==hash)return false;
 try{
  const xml=docxParts(buffer).get('word/document.xml');if(!xml||/<!DOCTYPE|<!ENTITY/u.test(xml)||XMLValidator.validate(xml)!==true)return false;
  const tree=new XMLParser({ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml),paragraphs=[],cells=[];
  const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?Object.entries(node).filter(([key])=>!key.startsWith('@_')).map(([key,value])=>key==='w:tab'?'\t':['w:br','w:cr'].includes(key)?'\n':text(value)).join(''):'';
  const visit=node=>{if(!node||typeof node!=='object')return;for(const [key,value] of Object.entries(node)){if(key==='w:p')paragraphs.push(...(Array.isArray(value)?value:[value]));if(key==='w:tc')cells.push(...(Array.isArray(value)?value:[value]));if(typeof value==='object')visit(value);}};visit(tree);
  return paragraphs.filter(p=>fold(text(p))===fold(original)).length===1&&cells.filter(c=>fold(text(c))===fold(original)).length===1;
 }catch{return false;}
}
export function uniqueAnnexEntryPlacement(items,wording,nativeProposalInputs){
 const {targetLabel,targetPath,originalText,proposedText,language,baseline}=wording;
 const label=/^Annex ([IVXLC]+) – point ([1-9]\d*)\n(Regulation \(EU\) \d{4}\/\d+) — Annex ([IVXLC]+) – point ([1-9]\d*) – table titled ‘[^’\n]+’$/u.exec(targetLabel??'');
 if(language!=='en'||baseline!=='commission-proposal'||proposedText!=='deleted'||!label||label[1]!==label[4]||label[2]===label[5])return null;
 const fail=reason=>({operation:'delete',status:'unresolved',reason,evidence:[]});
 if(typeof originalText!=='string'||originalText.length<30||/[\n\t\u2026\uFFFC]|\.{3}/u.test(originalText)||targetPath?.proposal?.length>1||targetPath?.underlying?.length>1||targetPath?.proposal?.length===1&&targetPath.proposal[0].raw!==targetLabel.split('\n')[0]||targetPath?.underlying?.length===1&&(targetPath.underlying[0].document!==label[3]||targetPath.underlying[0].raw!==targetLabel.split(' — ')[1]))return fail('conflicting_target_evidence');
 const acts=items.map((item,itemIndex)=>({item,itemIndex})).filter(({item})=>item.kind==='act');if(acts.length!==1)return fail('target_reference_unavailable');
 const act=acts[0],leads=act.item.proposal.paragraphs.filter(p=>fold(p.text)===label[3]+' is amended as follows:');
 if(leads.length!==1||!nativeInlineRowsComplete(nativeProposalInputs?.[act.itemIndex],act.item.proposal.sourceHash,leads))return fail('source_passage_incomplete');
 const candidates=[];
 for(const [itemIndex,item] of items.entries()){
  if(item.kind!=='annex'||item.proposal.sourceKind!=='docx')continue;const proposal=item.proposal;
  const roots=proposalCandidates(proposal,'Annex '+label[1]);if(roots.length!==1||roots[0].pathConflict||!roots[0].complete)continue;
  const root=roots[0],lead=root.children.filter(c=>c.kind!=='title');
  const address='Annex '+label[1]+' – '+(lead.length===1&&lead[0].kind==='paragraph'&&lead[0].implicit?'paragraph 1 – ':'')+'point '+label[5],owners=proposalCandidates(proposal,address);
  if(owners.length!==1||owners[0].pathConflict||!owners[0].complete)continue;
  const rows=proposal.paragraphs.filter(p=>fold(p.text)===fold(originalText));if(rows.length!==1)continue;const row=rows[0],owner=owners[0];
  if(row.index<owner.extent.start||row.index>=owner.extent.end||!row.complete||row.source?.complete!==true||row.source.container!=='table-cell')continue;
  const tables=flatten(owner.children).filter(unit=>unit.table?.complete&&unit.extent.start<=row.index&&unit.extent.end>row.index);
  const cells=tables.flatMap(unit=>unit.table.rows.flatMap(tr=>tr.cells)).filter(cell=>cell.paragraphs?.includes(row.index));
  if(cells.length!==1||cells[0].paragraphs.length!==1||(cells[0].colSpan??1)!==1||cells[0].horizontalMerge||cells[0].verticalMerge||!uniqueNativeEntry(nativeProposalInputs?.[itemIndex],proposal.sourceHash,originalText))continue;
  candidates.push({itemIndex,row});
 }
 if(candidates.length!==1)return fail('conflicting_target_evidence');
 const {itemIndex,row}=candidates[0];return {operation:'delete',status:'placed',itemIndex,span:{start:row.index,end:row.index},splice:{start:{paragraph:row.index,offset:0},end:{paragraph:row.index,offset:row.text.length}},originalText:row.text,evidence:[{basis:'unique-entry-label-disagreement',label:targetLabel.split('\n')[0],reference:'Annex '+label[1]+' – point '+label[5]}]};
}
