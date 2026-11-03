import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {canonical} from './amendment-adopted-snapshot.mjs';
const norm=s=>String(s??'').replace(/\s+/gu,' ').trim();
const result=(status,reason,extra={})=>({status,reason,...extra});
const unknown=reason=>result('inconclusive',reason);
const children=(node,tag)=>node?.children?.filter(n=>n.tag===tag)??[];
const text=node=>norm(node?.text??node?.children?.filter(n=>!['FOOTNOTE','NO.P'].includes(n.tag)).map(text).join(' ')??'');
// Independent TA reader: no production label parser, placement or matcher.
export function readCalibrationXml(bytes,id) {
  const xml=bytes.toString('utf8');
  if(bytes.length>4*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('Invalid calibration XML');
  const convert=nodes=>nodes.filter(n=>!Object.keys(n)[0].startsWith('?')).map(n=>Object.hasOwn(n,'#text')?{text:String(n['#text'])}:{tag:Object.keys(n).find(k=>k!==':@'),children:convert(n[Object.keys(n).find(k=>k!==':@')]??[])});
  const roots=convert(new XMLParser({preserveOrder:true,parseTagValue:false,trimValues:false,maxNestedTags:64}).parse(xml));
  const root=roots[0];if(roots.length!==1||root.tag!=='SDOCTA'||text(children(root,'IDENT')[0])!==id.replace(/^TA-10-(\d{4})-(\d+)$/,'P10_TA($1)$2'))throw new Error('TA identity mismatch');
  const amendments=[],units=[];let hasList=false,negotiated=false;
  const walk=(node,path='')=>{
    const here=path+'/'+node.tag;
    if(node.tag==='AMDLST')hasList=true;
    if(node.tag==='TCONSOLID'&&text(node).includes('▌'))negotiated=true;
    if(node.tag==='AMEND') {
      const title=text(children(node,'TI.AMD')[0]);
      // Collective titles preserve every explicitly named AM, never just the first.
      const numbers=/^Amendments?\s+[\d,\sand]+$/.test(title)?[...title.matchAll(/\d+/g)].map(m=>Number(m[0])):[];
      amendments.push({numbers,title,headings:children(node,'STI.AMD').map(text),ordinal:amendments.length});
    }
    if(['CONS','ACTION','PARAG'].includes(node.tag))units.push({text:text(node),kind:node.tag,path:here,ordinal:units.length});
    for(const c of node.children??[])if(c.tag)walk(c,here);
  };walk(root);return {amendments,units,hasList,negotiated};
}
export function calibrationPath(raw) {
  const parts=norm(raw).replace(/[–—]/g,'-').split(/\s*-\s+(?=[A-Za-z])/),path=[];
  for(const part of parts) {
    const m=/^(Recital|Article|Paragraph|Subparagraph|Point|Annex)\s+(-?\d+\s*[a-z]*|[A-Z]+|[a-z]+)\s*(\(new\))?$/i.exec(part);
    if(!m)return null;
    path.push({kind:m[1].toLowerCase(),value:m[2].replace(/\s/g,''),isNew:Boolean(m[3])});
  }
  return path.length?path:null;
}
const pathKey=p=>p.map(s=>s.kind+':'+s.value).join('/');
const flatten=units=>(units??[]).flatMap(u=>[u,...flatten(u.children)]);
export function compareFinalPath({headings,placement,items,text:source,language}) {
  if(placement?.status!=='placed')return unknown('pipeline-withheld');
  if(language!=='en')return unknown('source-language-not-en');
  // Count structural headings before parsing: unsupported inner-law labels
  // must never disappear and leave only the outer amending instruction.
  const structural=headings.filter(h=>/^(?:Recital|Article|Paragraph|Subparagraph|Point|Annex)\b/i.test(norm(h)));
  if(structural.length>1)return unknown('amended-act-path-requires-mapping');
  const paths=structural.map(calibrationPath).filter(Boolean);
  if(paths.length!==1)return unknown(paths.length?'amended-act-path-requires-mapping':'final-path-unparsed');
  const path=paths[0],leaf=path.at(-1),expected=path.map(s=>({...s}));
  if(leaf.isNew) {
    const base=/^(-?\d+|[A-Z]+)[a-z]+$/.exec(leaf.value)?.[1];
    if(!base)return unknown('new-unit-anchor-unavailable');expected.at(-1).value=base;
  }
  let candidates=[];
  if(items?.length) {
    const proposal=items[placement.itemIndex??0]?.proposal;
    candidates=flatten(proposal?.units).filter(u=>u.scope==='proposal'&&!u.pathConflict&&pathKey(u.path)===pathKey(expected)).map(u=>({start:u.extent.start,end:u.extent.end-1}));
  }else {
    // A printed number establishes the start only. Continuations, subpoints
    // and section boundaries need an independent full-extent proof; until
    // that exists, raw resolution paragraphs cannot establish this check.
    return unknown('resolution-unit-extent-unavailable');
  }
  if(candidates.length!==1)return unknown('source-path-unavailable-or-ambiguous');
  const target=candidates[0],matches=leaf.isNew?placement.operation==='insert'&&placement.insertAfter===target.end:placement.operation!=='insert'&&placement.span?.start===target.start&&placement.span?.end===target.end;
  return result(matches?'agree':'disagree','final-structural-path',{finalPath:path,expectedSource:target,observedPlacement:placement});
}
// Exact wording only. No renumbering guess and no walking past an amended or
// absent immediate neighbour; those observations remain inconclusive.
export function compareConsolidated({ta,wording,placement,text:source,language}) {
  if(placement?.status!=='placed')return unknown('pipeline-withheld');
  if(ta.negotiated)return unknown('negotiated-position');
  if(language!=='en'||!wording?.proposedText||!source?.paragraphs)return unknown('content-input-unavailable');
  const clean=s=>norm(s).replace(/^(?:\(?[A-Z]{1,2}|\(?\d+)\)?[.\t]\s*/,'');
  const proposed=clean(wording.proposedText);if(proposed.length<40)return unknown('wording-too-short');
  const matches=ta.units.filter(u=>clean(u.text)===proposed);
  if(matches.length!==1)return unknown('adopted-content-absent-or-ambiguous');
  const unit=matches[0],i=ta.units.indexOf(unit),prev=ta.units[i-1],next=ta.units[i+1];
  const locate=u=>!u||u.kind!==unit.kind?[]:source.paragraphs.flatMap((p,index)=>clean(p)===clean(u.text)?[index]:[]);
  const before=locate(prev),after=locate(next);
  if(before.length!==1||after.length!==1||after[0]<=before[0])return unknown('neighbour-amended-absent-or-ambiguous');
  const agrees=placement.operation==='insert'?placement.insertAfter===before[0]&&placement.insertBefore===after[0]:placement.span?.start>before[0]&&placement.span?.end<after[0];
  return result(agrees?'agree':'disagree','consolidated-content-and-neighbours',{taUnit:unit.ordinal,expectedNeighbours:{after:before[0],before:after[0]},observedPlacement:placement});
}
export class AdoptedCalibration {
  constructor(sealed){this.sealed=sealed;this.rows=[];this.parsed=new Map();}
  observe({row,wording,placement,items,text}) {
    const decisions=(row.decisions??[]).filter(d=>d.outcome==='ADOPTED'&&(d.amendmentIds??[]).includes(row.id));
    if(!decisions.length)return;
    const dates=[...new Set(decisions.map(d=>d.date?.slice(0,10)))];
    const works=this.sealed.works.filter(w=>(w.adopts??[]).some(v=>canonical(v)==='eli/dl/doc/'+row.targetDocumentId)&&dates.includes(w.document_date));
    let observation=unknown(works.length?'ta-binding-ambiguous':'ta-binding-unavailable'),taId=null,ordinal=null,mode=null,headings=null;
    if(works.length===1) {
      taId=canonical(works[0].id).replace('eli/dl/doc/','');const body=this.sealed.bodies.get(taId+'_en.xml');
      if(body) {
        if(!this.parsed.has(taId))this.parsed.set(taId,readCalibrationXml(body,taId));
        const ta=this.parsed.get(taId),matches=ta.amendments.filter(a=>a.numbers.includes(Number(row.number)));
        mode=ta.hasList?'amendment-list':'consolidated';
        if(ta.hasList) {
          if(matches.length===1){ordinal=matches[0].ordinal;headings=matches[0].headings;observation=compareFinalPath({headings:matches[0].headings,placement,items,text,language:wording?.language});}
          else observation=unknown(matches.length?'am-number-ambiguous':'am-not-in-ta');
        }else observation=compareConsolidated({ta,wording,placement,text,language:wording?.language});
      }else observation=unknown('ta-xml-unavailable');
    }
    const coordinate=placement?.operation==='insert'?placement.insertBefore:placement?.span?.start;
    // Coordinates are comparable only inside the same captured source bytes.
    // Replay items expose provenance on proposal, not item.source.
    const sourceHash=items?.[placement?.itemIndex??0]?.proposal?.sourceHash;
    const coordinateSpace=sourceHash?'sha256:'+sourceHash:null;
    this.rows.push({id:row.id,decisionIds:decisions.map(d=>d.id),decisionDates:dates,language:wording?.language??row.language,coordinateSpace:coordinateSpace??null,finalHeadings:headings,observedPlacement:placement,taSource:this.sealed.snapshot.inputs?.find(i=>i.file===taId+'_en.xml')??null,documentId:row.targetDocumentId,taId,ordinal,mode,placed:placement?.status==='placed',itemIndex:placement?.itemIndex??0,coordinate,...observation,order:unknown('order-not-comparable')});
  }
  report() {
    // Equal gaps do not establish runtime insertion order. Report them explicitly
    // instead of treating AM number or label suffix as the observed order.
    for(const row of this.rows)row.order=unknown('order-not-comparable');
    // An unmapped amended-act path cannot establish an outer document order.
    for(const row of this.rows.filter(r=>r.mode==='amendment-list'&&r.status==='agree'&&r.coordinateSpace&&r.placed&&r.ordinal!==null&&Number.isInteger(r.coordinate))) {
      const peers=this.rows.filter(p=>p!==row&&p.status==='agree'&&p.placed&&p.documentId===row.documentId&&p.taId===row.taId&&p.itemIndex===row.itemIndex&&p.language===row.language&&p.coordinateSpace===row.coordinateSpace&&p.ordinal!==null&&Number.isInteger(p.coordinate));
      const inversion=peers.find(p=>(row.ordinal-p.ordinal)*(row.coordinate-p.coordinate)<0);
      row.order=inversion?result('disagree','document-order-inversion',{other:inversion.id}):peers.some(p=>p.coordinate===row.coordinate&&p.ordinal!==row.ordinal)?unknown('same-gap-order-not-exposed'):peers.length?result('agree','document-order'):unknown('no-comparable-peer');
    }
    const counts={agree:0,disagree:0,inconclusive:0};
    for(const row of this.rows){row.verdict=row.status==='disagree'||row.order.status==='disagree'?'disagree':row.status==='agree'&&(row.mode!=='amendment-list'||row.order.status==='agree')?'agree':'inconclusive';counts[row.verdict]++;}
    return {schemaVersion:1,measureOnly:true,snapshotId:this.sealed.snapshot.snapshotId,requests:0,counts,rows:this.rows,placedDisagreements:this.rows.filter(r=>r.placed&&r.verdict==='disagree')};
  }
}
