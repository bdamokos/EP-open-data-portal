import path from 'node:path';
import {retainBaseSelection} from './base-source-store.mjs';
import {committeeDraftId,committeeDocumentEndpoint,committeeDocumentKind} from './committee-amendments.mjs';
import {CellarDocuments,cellarGraph,CELLAR_WORK_PATTERN,CELLAR_LIMITS,cellarTransportUrl,councilCelex} from './cellar-documents.mjs';
import {languageCode} from './ep-links.mjs';
import {odp,odpLanguage} from './odp.mjs';
import {sharedRequest,waitForRequest,isLocalRequestFailure} from './request-budget.mjs';

const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const unique=values=>[...new Set(values)];
const unresolved=(gap,evidence=[])=>({status:'unresolved',items:[],gaps:[gap],evidence});
export function reportCouncilReference(report,{reportId,language='en',documentReferences=[]}={}) {
  if(!committeeDraftId(reportId)&&!/^A-\d{1,2}-\d{4}-\d{4}$/.test(reportId||'')||!['eli/dl/doc/'+reportId,'https://data.europarl.europa.eu/eli/dl/doc/'+reportId].includes(report?.id)||String(report.work_type?.id||report.work_type).replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'')!=='def/ep-document-types/REPORT_PLENARY'&&!(committeeDraftId(reportId)&&committeeDocumentKind(report)))return unresolved('report-identity');
  const texts=[...array(report.is_realized_by).flatMap(e=>array(e.title_alternative?.[language])),...documentReferences.filter(r=>r.field==='DocRef').map(r=>r.raw)].filter(t=>typeof t==='string');
  const references=texts.flatMap(raw=>[...raw.matchAll(/\b(\d{4,5})\/(\d{1,2})\/((?:19|20)\d{2})\b/g)].map(m=>({raw:m[0],number:m[1],revision:m[2],year:m[3],alias:`http://publications.europa.eu/resource/consil/ST_${m[1]}_${m[3]}_REV_${Number(m[2])}`})));
  const procedures=unique(texts.flatMap(raw=>[...raw.matchAll(/\b(\d{4})\/(\d{4})\s*\(COD\)/g)].map(m=>`${m[1]}/${m[2]}(COD)`)));
  const aliases=unique(references.map(r=>r.alias)),evidence=[{kind:'report-council-reference',reportId,references,procedures}];
  if(aliases.length!==1||procedures.length!==1)return unresolved(aliases.length>1||procedures.length>1?'ambiguous-council-reference':'missing-council-reference',evidence);
  const procedure=procedures[0],linked=unique(array(report.inverse_created_a_realization_of).map(v=>typeof v==='string'?v:v?.id).map(v=>v?.replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'')));
  if(linked.length!==1||linked[0]!==`eli/dl/proc/${procedure.slice(0,4)}-${procedure.slice(5,9)}`)return unresolved('report-procedure-mismatch',evidence);
  return {status:'resolved',alias:aliases[0],procedure,evidence,gaps:[]};
}
export function councilCandidatesSparql({alias,procedure}) {
  if(!/^http:\/\/publications\.europa\.eu\/resource\/consil\/ST_\d{4,5}_\d{4}_REV_\d{1,2}$/.test(alias)||!/^\d{4}\/\d{4}\(COD\)$/.test(procedure))throw new Error('invalid-council-reference');
  return `PREFIX cdm:<http://publications.europa.eu/ontology/cdm#>
PREFIX xsd:<http://www.w3.org/2001/XMLSchema#>
PREFIX owl:<http://www.w3.org/2002/07/owl#>
SELECT DISTINCT ?work ?celex ?dossier WHERE {
 ?dossier cdm:procedure_code_interinstitutional_reference_procedure "${procedure.replace('(COD)','/COD')}"^^xsd:string.
 ?work cdm:work_part_of_dossier ?dossier;
 cdm:work_is_another_publication_of_work ?original;
 cdm:work_created_by_agent <http://publications.europa.eu/resource/authority/corporate-body/CONSIL>;
 cdm:work_has_resource-type <http://publications.europa.eu/resource/authority/resource-type/POSIT>;
 cdm:resource_legal_id_celex ?celex.
 ?original owl:sameAs <${alias}>.
} LIMIT 3`;
}
export function resolveCouncilTree(xml,{celex,language,alias,procedure}) {
  councilCelex(celex);const graph=cellarGraph(xml),ids=unique([...graph.graph.keys()].filter(id=>CELLAR_WORK_PATTERN.test(id)&&graph.values(id,'resource_legal_id_celex').includes(celex)));
  if(ids.length!==1)return unresolved('ambiguous-council-work');
  const workId=ids[0],values=name=>graph.values(workId,name);
  const expectedDossier=`http://publications.europa.eu/resource/procedure/${procedure.slice(0,4)}_${Number(procedure.slice(5,9))}`;
  const evidence=[{kind:'council-cellar-identity',workId,celex,alias,procedure}];
  if(values('resource_legal_id_celex').some(id=>id!==celex)||values('work_has_resource-type').join()!=='http://publications.europa.eu/resource/authority/resource-type/POSIT'||!values('work_created_by_agent').includes('http://publications.europa.eu/resource/authority/corporate-body/CONSIL')||!values('work_is_another_publication_of_work').includes(alias)||!values('work_part_of_dossier').some(id=>graph.aliases(id).includes(expectedDossier))||!values('work_part_of_event_legal').some(id=>id.startsWith(expectedDossier.replace('/procedure/','/procedure-event/')+'.')&&/_ADP_R1_POS_byCONSIL$/.test(id)))return unresolved('council-identity-conflict',evidence);
  const expressions=unique([...graph.graph.keys()].filter(id=>id.startsWith(workId+'.')&&/^\d{4,8}$/.test(id.slice(workId.length+1))&&graph.values(id,'expression_belongs_to_work').some(v=>graph.aliases(workId).includes(v))&&graph.values(id,'expression_uses_language').some(v=>languageCode(v)===language)));
  if(expressions.length!==1)return {...unresolved(expressions.length?'ambiguous-language-expression':'language-unavailable',evidence),status:expressions.length?'unresolved':'language-unavailable'};
  const expressionId=expressions[0],languages=graph.values(expressionId,'expression_uses_language');
  if(languages.length!==1)return unresolved('ambiguous-language-expression',evidence);
  const manifestations=unique([...graph.graph.keys()].filter(id=>id.startsWith(expressionId+'.')&&graph.values(id,'manifestation_manifests_expression').some(v=>graph.aliases(expressionId).includes(v))&&graph.values(id,'manifestation_type').includes('xhtml')));
  if(manifestations.length!==1)return unresolved('xhtml-manifestation-unavailable',evidence);
  const manifestationId=manifestations[0],items=unique([...graph.graph.keys()].filter(id=>id.startsWith(manifestationId+'/')&&graph.values(id,'item_belongs_to_manifestation').some(v=>graph.aliases(manifestationId).includes(v))));
  if(items.length!==1)return unresolved('ambiguous-xhtml-item',evidence);
  cellarTransportUrl(items[0],{redirect:true});
  return {status:'resolved',celex,workId,language,evidence,gaps:[],items:[{kind:'act',index:1,format:'XHTML',itemId:items[0],expressionId,manifestationId,languageUri:languages[0]}]};
}
export function createCouncilPositionBaseline({documents=new CellarDocuments(),request=odp}={}) {
  return options=>waitForRequest(sharedRequest(async()=>{
    const {reportId,language='en',documentReferences=[]}=options;odpLanguage(language);
    let evidence=[];
    const unavailable=gap=>({status:'unavailable',celex:null,workId:null,language,items:[],gaps:[gap],evidence});
    try {
      const report=await request(committeeDocumentEndpoint(reportId)||'/plenary-documents/'+reportId,{}, {staleWhileRevalidate:true});
      const identity=reportCouncilReference(report.payload?.data?.length===1?report.payload.data[0]:null,{reportId,language,documentReferences});
      evidence=[...identity.evidence,{kind:'report-source',url:report.url,fetchedAt:new Date(report.fetchedAt).toISOString(),stale:Boolean(report.stale)}];
      if(identity.status!=='resolved')return {...unavailable(identity.gaps[0]),status:identity.status};
      const url=new URL('https://publications.europa.eu/webapi/rdf/sparql');url.searchParams.set('query',councilCandidatesSparql(identity));url.searchParams.set('format','application/sparql-results+json');
      const candidates=await documents.sources.get(url.href,{freshMs:CELLAR_LIMITS.metadataFreshMs,validate:record=>{if(!Array.isArray(record.data?.results?.bindings)||record.data.results.bindings.length>=3)throw new Error('council-candidates-incomplete');}});
      const rows=candidates.data.results.bindings,choices=unique(rows.map(row=>JSON.stringify([row.work?.value,row.celex?.value])));
      evidence.push({kind:'council-candidates',url:url.href,fetchedAt:candidates.fetchedAt,rows});
      if(choices.length!==1)return unavailable(choices.length?'ambiguous-council-position':'council-position-unavailable');
      const [workId,celex]=JSON.parse(choices[0]);if(!CELLAR_WORK_PATTERN.test(workId))return unavailable('council-work-unverified');
      const metadata=await documents.metadata(celex),resolved=resolveCouncilTree(metadata.xml,{...identity,celex,language});evidence.push(...resolved.evidence,{kind:'cellar-source',url:metadata.url,fetchedAt:metadata.fetchedAt});
      if(resolved.status!=='resolved'||resolved.workId!==workId)return unavailable(resolved.gaps[0]||'council-work-conflict');
      const items=[];for(const item of resolved.items)items.push({...item,...await documents.content({celex,...item,language:item.languageUri})});
      const gaps=[];if(report.stale||metadata.viewCache?.stale||candidates.viewCache?.stale)gaps.push('stale-metadata');if(items.some(item=>item.source.stale))gaps.push('stale-content');
      return {status:gaps.length?'partial':'available',celex,workId,language,items,gaps,evidence};
    }catch(error){if(isLocalRequestFailure(error))throw error;return unavailable(error.code||error.message||'council-source-unavailable');}
  },60_000).then(result=>retainBaseSelection('council',options,result,{directory:documents.directory&&path.dirname(documents.directory)})));
}
let defaultBaseline;
export function councilPositionBaseline(options){defaultBaseline??=createCouncilPositionBaseline();return defaultBaseline(options);}
