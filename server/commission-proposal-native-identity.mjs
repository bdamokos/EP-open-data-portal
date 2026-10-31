import {createHash} from 'node:crypto';
import {docxContent,docxParts} from './document-text.mjs';
import {XMLParser} from 'fast-xml-parser';
import {parseLabelSegment} from './proposal-labels.mjs';

/** Match the declared English directive's visible legal heading, not its memo. */
export function nativeConsultationProcedure(buffer,{procedure,language}={}) {
  return nativeDecisionHeading(buffer,{procedure,language,type:'CNS',heading:'COUNCIL DIRECTIVE'});
}
export function nativeNleDecisionProcedure(buffer,{procedure,language}={}) {
  return nativeDecisionHeading(buffer,{procedure,language,type:'NLE',heading:'COUNCIL DECISION'});
}
function nativeDecisionHeading(buffer,{procedure,language,type,heading:requiredHeading}) {
  const unknown=reason=>({status:'unresolved',reason});
  const expected=new RegExp('^(\\d{4})/(\\d{4})\\('+type+'\\)$','u').exec(procedure??'');
  if(!expected||language!=='en')return unknown('native-procedure-language-unavailable');
  let content;try{content=docxContent(buffer,{includeParagraphProperties:true});}catch{return unknown('native-procedure-content-unavailable');}
  const rows=content.paragraphs,claims=[];
  for(let i=0;i<rows.length;i++) {
    const code=/^(\d{4})\/(\d{1,4})\s*\((COD|CNS|NLE)\)$/u.exec(rows[i]);
    if(!code)continue;
    const heading=rows.slice(i,i+3),sources=content.paragraphSources.slice(i,i+3),properties=content.paragraphProperties.slice(i,i+3);
    if(heading[1]!=='Proposal for a'||heading[2]!==requiredHeading)continue;
    if(properties.map(p=>p.styleId).join('|')!=='Rfrenceinterinstitutionnelle|Statut|Typedudocument')continue;
    if(sources.length!==3||sources.some(s=>s.container!=='body'||!s.complete)||sources.some((s,j)=>j&&s.ordinal!==sources[j-1].ordinal+1)
      ||properties.some(p=>p.numberingComplete===false||p.notesComplete===false))return unknown('native-procedure-heading-incomplete');
    claims.push({procedure:`${code[1]}/${code[2].padStart(4,'0')}(${code[3]})`,raw:rows[i],sourcePaths:sources.map(s=>s.path)});
  }
  if(claims.length!==1)return unknown('native-procedure-heading-ambiguous');
  if(claims[0].procedure!==procedure)return unknown('native-procedure-reference-conflict');
  return {status:'verified',...claims[0],language,sha256:createHash('sha256').update(buffer).digest('hex'),basis:'visible-native-proposal-heading'};
}

/** Read only an explicit native annex label supported by the existing grammar.
 * A declared part number or an unreadable cover cannot supply that label. */
export function nativeAnnexOrdinal(buffer,{language}={}) {
  const unresolved=reason=>({status:'unresolved',reason,ordinal:null});
  if(language!=='en')return unresolved('native-annex-language-unavailable');
  let content;try{content=docxContent(buffer,{includeParagraphProperties:true});}catch{return unresolved('native-annex-content-unavailable');}
  const labels=[];
  for(let i=0;i<content.paragraphs.length;i++) {
    if(!/Annexetitre/iu.test(content.paragraphProperties[i].styleId||''))continue;
    const label=parseLabelSegment(content.paragraphs[i],language),source=content.paragraphSources[i],properties=content.paragraphProperties[i];
    if(label?.kind!=='annex')continue;
    if(source.container!=='body'||!source.complete||properties.numberingComplete===false||properties.notesComplete===false)return unresolved('native-annex-heading-incomplete');
    labels.push({raw:content.paragraphs[i],ordinal:label.value||null,sourcePath:source.path});
  }
  if(labels.length!==1)return unresolved(labels.length?'native-annex-heading-ambiguous':'native-annex-heading-unavailable');
  if(labels[0].ordinal===null)return {...unresolved('native-annex-unnumbered'),...labels[0]};
  return {status:'verified',...labels[0],language,sha256:createHash('sha256').update(buffer).digest('hex'),basis:'visible-native-annex-label'};
}

const nativeReferences=new WeakSet();
export const isNativeNleReference=value=>value?.status==='verified'&&nativeReferences.has(value);

/** Supplied native bytes only. This helper neither discovers nor fetches an EP
 * distribution; the caller supplies its exact declared/observed identity. */
export function nativeNleReferencePair(sources,{reportId,language}={}) {
  const unknown=reason=>({status:'unresolved',reason});
  const number=/^A-(\d+)-(\d{4})-(\d{4,6})$/u.exec(reportId??'');
  if(language!=='en'||!number)return {report:unknown('native-reference-language-or-report'),list:unknown('native-reference-language-or-report')};
  const reportCode=`A${number[1]}-${number[3]}/${number[2]}`;
  const child=(nodes,key)=>nodes?.find(node=>Object.hasOwn(node,key))?.[key];
  const rawText=nodes=>(nodes||[]).flatMap(node=>Object.entries(node).flatMap(([key,value])=>key==='w:t'?value.filter(v=>'#text' in v).map(v=>String(v['#text'])):key==='w:noBreakHyphen'?['\u2011']:key==='w:softHyphen'?['\u00ad']:key==='w:tab'?['\t']:Array.isArray(value)?rawText(value):[])).join('');
  const inspect=kind=>{
    const input=sources?.[kind],source=input?.source;
    if(!Buffer.isBuffer(input?.buffer)||input.reportId!==reportId||source?.language!==language||typeof source.url!=='string'||!Number.isFinite(Date.parse(source.fetchedAt))||source.sha256!==createHash('sha256').update(input.buffer).digest('hex'))return unknown('native-reference-source-unavailable');
    const range=kind==='list'?new RegExp('^'+reportId+'-AM-(\\d{1,5})-(\\d{1,5})$').exec(input.listId??''):null;
    if(kind==='list'&&(!range||Number(range[1])>Number(range[2])))return unknown('native-reference-list-identity');
    let content,body;
    try {
      content=docxContent(input.buffer,{includeParagraphProperties:true});
      const parsed=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(docxParts(input.buffer).get('word/document.xml'));
      body=child(child(parsed,'w:document'),'w:body');
    }catch{return unknown('native-reference-content-unavailable');}
    if((body||[]).some(node=>node['w:tbl']&&/<(?:DocRef|ReferenceNo)>/u.test(rawText(node['w:tbl']))))return unknown('native-reference-outside-body-paragraph');
    const paragraphs=(body||[]).filter(node=>node['w:p']).map((node,i)=>({raw:rawText(node['w:p']),path:`/w:document[1]/w:body[1]/w:p[${i+1}]`}));
    const visibleRows=new Map(content.paragraphSources.map((s,i)=>[s.path,{source:s,text:content.paragraphs[i],properties:content.paragraphProperties[i]}]));
    const visible=row=>{
      const value=visibleRows.get(row.path);
      return value?.source.container==='body'&&value.source.complete?value:null;
    };
    const identity=kind==='report'?paragraphs.some(p=>p.raw.includes(`<NoDocSe>${reportCode}</NoDocSe>`)&&visible(p)?.text.includes(reportCode)):paragraphs.some(p=>p.raw.includes(reportCode)&&visible(p)?.text.includes(reportCode));
    if(!identity)return unknown('native-reference-report-identity');
    if(kind==='list') {
      const ranges=[];
      for(const p of paragraphs)for(const match of p.raw.matchAll(/<NumOfAM>(\d+)-(\d+)<\/NumOfAM>/gu)) {
        if(!visible(p)?.text.includes(match[1]+'-'+match[2]))return unknown('native-reference-incomplete-or-hidden');
        ranges.push(match);
      }
      const numbers=[...new Set(paragraphs.flatMap(p=>{const match=/^Amendment\s+(\d+)$/u.exec(visible(p)?.text??'');return match?[Number(match[1])]:[];}))].sort((a,b)=>a-b);
      const cover=ranges.length===1&&Number(ranges[0][1])===Number(range[1])&&Number(ranges[0][2])===Number(range[2]);
      const blocks=numbers.length===Number(range[2])-Number(range[1])+1&&numbers.every((n,i)=>n===Number(range[1])+i);
      if(ranges.length?!cover:!blocks)return unknown('native-reference-list-range');
    }
    const fields=kind==='report'?['DocRef']:['DocRef','ReferenceNo'],references=[];
    for(const p of paragraphs)for(const field of fields)for(const m of p.raw.matchAll(new RegExp('<'+field+'>([\\s\\S]*?)</'+field+'>','gu'))) {
      const v=visible(p),raw=m[1];
      if(!v?.text.includes(raw)||v.properties.numberingComplete===false||v.properties.notesComplete===false)return unknown('native-reference-incomplete-or-hidden');
      references.push({field,raw,sourcePath:p.path});
    }
    if(!references.length)return unknown('native-reference-missing');
    const evidence={status:'verified',reportId,...(kind==='list'?{listId:input.listId}:{}),language,references,source:{...source},basis:'visible-native-EP-reference'};
    nativeReferences.add(evidence);return evidence;
  };
  return {report:inspect('report'),list:inspect('list')};
}
