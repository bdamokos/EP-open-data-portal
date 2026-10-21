import {languageCode} from './ep-links.mjs';
import {CELLAR_WORK_PATTERN,CELLAR_LIMITS,cellarGraph,cellarTransportUrl,proposalCelex} from './cellar-documents.mjs';

const list=value=>value==null?[]:Array.isArray(value)?value:[value];
const unique=values=>[...new Set(values)];
const unresolved=(status,gaps,evidence=[],extra={})=>({status,celex:null,workId:null,items:[],gaps,evidence,...extra});
export function commissionReferences(raw) {
  if(typeof raw!=='string')return [];
  return [...raw.matchAll(/\bCOM\s*\(\s*((?:19|20)\d{2})\s*\)\s*(\d{1,4})(?:\s*(final(?:\s*\/\s*\d+)?|\/\s*\d+))?/giu)].map(m=>({raw:m[0],year:Number(m[1]),number:Number(m[2]),qualifier:m[3]?.replace(/\s+/g,'').toLowerCase()||null,celex:`5${m[1]}PC${m[2].padStart(4,'0')}`}));
}
export function reportProposalReference(report,{reportId,documentReferences=[]}={}) {
  if(!report||report.id!==`eli/dl/doc/${reportId}`&&report.id!==`https://data.europarl.europa.eu/eli/dl/doc/${reportId}`)return unresolved('unresolved',['report-identity']);
  if(report.work_type&&report.work_type!=='def/ep-document-types/REPORT_PLENARY')return unresolved('unresolved',['report-type']);
  // Alternative titles carry the explicit COM/procedure reference. The report
  // title itself names amended laws and cannot establish proposal identity.
  const texts=list(report.is_realized_by).flatMap(e=>Object.values(e.title_alternative||{}).flatMap(list));
  const reportRefs=texts.flatMap(commissionReferences),docRefs=documentReferences.filter(r=>r.field==='DocRef'||/^DocAmend\d?$/.test(r.field)).flatMap(r=>commissionReferences(r.raw));
  const refs=[...reportRefs,...docRefs],celexes=unique(refs.map(r=>r.celex));
  const procedures=unique(texts.flatMap(t=>typeof t==='string'?[...t.matchAll(/\b(\d{4})\/(\d{4})\s*\(COD\)/g)].map(m=>`${m[1]}/${m[2]}(COD)`):[]));
  const linked=list(report.inverse_created_a_realization_of).map(v=>typeof v==='string'?v:v?.id).filter(Boolean);
  const evidence=[{kind:'report-reference',reportId,references:refs,procedures,procedureIds:linked}];
  if(celexes.length!==1||procedures.length!==1)return unresolved('unresolved',[celexes.length>1||procedures.length>1?'ambiguous-report-reference':'missing-report-reference'],evidence);
  const procedure=procedures[0],expected=`eli/dl/proc/${procedure.slice(0,4)}-${procedure.slice(5,9)}`;
  if(!linked.length||linked.some(id=>id!==expected&&id!==`https://data.europarl.europa.eu/${expected}`))return unresolved('unresolved',['report-procedure-mismatch'],evidence);
  const qualifiers=unique(refs.map(r=>r.qualifier).filter(Boolean));
  if(qualifiers.some(q=>q!=='final'))return unresolved('unresolved',['proposal-version-unresolved'],evidence,{celex:celexes[0]});
  return {status:'resolved',celex:celexes[0],procedure,evidence,gaps:[]};
}

export function resolveProposalTree(xml,{celex,language,procedure}={}) {
  proposalCelex(celex);const graph=cellarGraph(xml),evidence=[];
  const works=[...graph.graph.keys()].filter(id=>CELLAR_WORK_PATTERN.test(id)&&graph.values(id,'resource_legal_id_celex').includes(celex));
  if(works.length!==1)return unresolved('unresolved',[works.length?'ambiguous-proposal-work':'proposal-work-missing'],evidence,{celex,language});
  const workId=works[0],values=name=>graph.values(workId,name),aliases=graph.aliases(workId);
  const creators=values('work_created_by_agent'),types=values('work_has_resource-type'),versions=unique([...values('work_version'),...values('version')]);
  const dossiers=unique([...values('act_preparatory_initiates_dossier'),...values('work_part_of_dossier')]).flatMap(uri=>{const m=uri.match(/^http:\/\/publications\.europa\.eu\/resource\/procedure\/(\d{4})_(\d+)$/);return m?[`${m[1]}/${m[2].padStart(4,'0')}(COD)`]:[];});
  const gaps=[];
  if(!creators.includes('http://publications.europa.eu/resource/authority/corporate-body/COM'))gaps.push('commission-author-unverified');
  if(types.length!==1||!/^http:\/\/publications\.europa\.eu\/resource\/authority\/resource-type\/PROP_(REG|DIR|DEC)$/.test(types[0]))gaps.push('proposal-type-unverified');
  if(versions.length!==1||versions[0]!=='final')gaps.push('proposal-version-unresolved');
  if(values('resource_legal_id_celex').some(value=>value!==celex))gaps.push('proposal-celex-conflict');
  const year=celex.slice(1,5),number=String(Number(celex.slice(7))),comnat=`http://publications.europa.eu/resource/comnat/COM_${year}_${number.padStart(4,'0')}_FIN`;
  if(!aliases.includes(comnat)||values('resource_legal_internal_number_prefix').some(value=>value!=='COM')||!values('resource_legal_internal_number_year').includes(year)||!values('resource_legal_internal_number_sequential_number').includes(number))gaps.push('com-reference-unverified');
  if(dossiers.length!==1||procedure&&dossiers[0]!==procedure)gaps.push('proposal-procedure-mismatch');
  evidence.push({kind:'cellar-identity',workId,celex,aliases,creators,types,versions,procedures:dossiers});
  if(gaps.length)return unresolved('unresolved',gaps,evidence,{celex,workId,language});
  const expressions=[...graph.graph.keys()].filter(id=>new RegExp('^'+workId.replaceAll('.','\\.')+'\\.\\d{4,8}$').test(id)&&graph.values(id,'expression_belongs_to_work').some(v=>graph.aliases(workId).includes(v)));
  const matching=expressions.filter(id=>graph.values(id,'expression_uses_language').some(v=>languageCode(v)===language));
  if(matching.length!==1)return unresolved(matching.length?'unresolved':'language-unavailable',[matching.length?'ambiguous-language-expression':'language-unavailable'],evidence,{celex,workId,language});
  const expressionId=matching[0],languageUris=graph.values(expressionId,'expression_uses_language');
  if(languageUris.length!==1)return unresolved('unresolved',['ambiguous-language-expression'],evidence,{celex,workId,language});
  const manifestations=[...graph.graph.keys()].filter(id=>new RegExp('^'+expressionId.replaceAll('.','\\.')+'\\.\\d{2,8}$').test(id)&&graph.values(id,'manifestation_manifests_expression').some(v=>graph.aliases(expressionId).includes(v))&&graph.values(id,'manifestation_type').some(v=>v==='docx'||v==='http://publications.europa.eu/resource/authority/file-type/DOCX'));
  if(manifestations.length!==1)return unresolved(manifestations.length?'unresolved':'format-unavailable',[manifestations.length?'ambiguous-docx-manifestation':'docx-unavailable'],evidence,{celex,workId,language});
  const manifestationId=manifestations[0];
  const itemIds=[...graph.graph.keys()].filter(id=>id.startsWith(manifestationId+'/')&&graph.values(id,'item_belongs_to_manifestation').some(v=>graph.aliases(manifestationId).includes(v)));
  if(!itemIds.length||itemIds.length>CELLAR_LIMITS.items)return unresolved('unresolved',['item-manifest-incomplete'],evidence,{celex,workId,language});
  const items=[];
  for(const itemId of itemIds) {
    try{cellarTransportUrl(itemId,{redirect:true});}catch{return unresolved('unresolved',['invalid-item-url'],evidence,{celex,workId,language});}
    const itemAliases=graph.aliases(itemId),roles=[];
    for(const alias of itemAliases) {
      const m=alias.match(/_(ACT|annexe_proposition)_part(\d+)(?:_v\d+)?\.docx$/i);
      if(m)roles.push({kind:m[1].toLowerCase()==='act'?'act':'annex',index:Number(m[2])});
    }
    const choices=unique(roles.map(r=>JSON.stringify(r)));
    if(choices.length!==1||!roles[0].index||roles[0].index>32)return unresolved('unresolved',['item-role-unresolved'],evidence,{celex,workId,language});
    items.push({...roles[0],itemId,expressionId,manifestationId,languageUri:languageUris[0],aliases:itemAliases});
  }
  items.sort((a,b)=>a.kind===b.kind?a.index-b.index:a.kind==='act'?-1:1);
  for(const kind of ['act','annex']) {
    const parts=items.filter(i=>i.kind===kind);
    if(kind==='act'&&!parts.length||parts.some((p,i)=>p.index!==i+1))gaps.push('item-manifest-incomplete');
  }
  if(gaps.length)return unresolved('unresolved',unique(gaps),evidence,{celex,workId,language});
  evidence.push({kind:'cellar-manifest',expressionId,manifestationId,language:languageUris[0],items:items.map(({kind,index,itemId,aliases})=>({kind,index,itemId,aliases}))});
  return {status:'resolved',celex,workId,language,procedure:dossiers[0],items,gaps:[],evidence};
}

export function resolveProposalCandidates(data,{celex}={}) {
  proposalCelex(celex);const rows=data?.results?.bindings;
  const evidence=[{kind:'com-candidates',celex,rows:Array.isArray(rows)?rows.map(row=>({workId:row.work?.value??null,celex:row.celex?.value??null,version:row.version?.value??null})):[]}];
  if(!Array.isArray(rows)||rows.length>=65)return unresolved('unresolved',['proposal-candidates-incomplete'],evidence,{celex});
  const works=unique(rows.map(row=>row.work?.value));
  if(works.length!==1||!CELLAR_WORK_PATTERN.test(works[0]))return unresolved('unresolved',[works.length?'ambiguous-com-candidates':'proposal-work-missing'],evidence,{celex});
  if(rows.some(row=>row.celex?.value!==celex||row.version?.value!=='final'))return unresolved('unresolved',['proposal-version-unresolved'],evidence,{celex});
  return {status:'resolved',celex,workId:works[0],gaps:[],evidence};
}
