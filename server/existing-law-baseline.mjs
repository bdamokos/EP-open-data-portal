import {CellarDocuments,cellarGraph,CELLAR_WORK_PATTERN,CELLAR_LIMITS,cellarTransportUrl,existingLawCelex} from './cellar-documents.mjs';
import {languageCode} from './ep-links.mjs';
import {sharedRequest,waitForRequest,isLocalRequestFailure} from './request-budget.mjs';

const unique=values=>[...new Set(values)];
const unresolved=gap=>({status:'unresolved',items:[],gaps:[gap],evidence:[]});
const languageUris=Object.fromEntries('bg/BUL es/SPA cs/CES da/DAN de/DEU et/EST el/ELL en/ENG fr/FRA ga/GLE hr/HRV it/ITA lv/LAV lt/LIT hu/HUN mt/MLT nl/NLD pl/POL pt/POR ro/RON sk/SLK sl/SLV fi/FIN sv/SWE'.split(' ').map(pair=>pair.split('/')));
export const lawDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
// Complete statutory citations only. An unrecognised language remains a gap.
export function actCelex(raw) {
  const direct=/^\(?([3](?:19|20)\d{2}[RLD]\d{4})\)?$/.exec(raw?.trim()||'');
  if(direct)return direct[1];
  const m=/^(Regulation|Directive|Decision|Dyrektywa)\s*(?:\((?:EU|EC|EEC|UE|WE)\)\s*)?(?:No\s*)?(\d{1,4})\s*\/\s*(\d{1,4})(?:\s*\/\s*(?:EU|EC|EEC|UE|WE))?$/u.exec(raw?.trim()||'');
  if(!m)return null;
  const kind={Regulation:'R',Directive:'L',Dyrektywa:'L',Decision:'D'}[m[1]],first=Number(m[2]),second=Number(m[3]);
  const numbered=/\bNo\s*\d/u.test(raw),year=numbered?second:first>=1950?first:second>=1950?second:null,number=numbered?first:first>=1950?second:first;
  if(!year||year>2099||number<1)return null;
  return `3${year}${kind}${String(number).padStart(4,'0')}`;
}
export function existingLawReference({targetPath,documentReferences=[],documentDate,date,language}={}) {
  const inner=targetPath?.underlying;
  if(inner?.length!==1||!inner[0].document||!inner[0].raw)return unresolved('existing-law-target-unavailable');
  const baseCelex=actCelex(inner[0].document);
  if(!baseCelex)return unresolved('existing-law-identity-unavailable');
  const amendmentDate=documentDate||date;
  if(!lawDate(amendmentDate))return unresolved('existing-law-date-unavailable');
  const cited=unique(documentReferences.flatMap(r=>[...r.raw.matchAll(/\b0(?:19|20)\d{2}[RLD]\d{4}-\d{8}\b/g)].map(m=>m[0])));
  if(cited.length>1||cited.some(id=>'3'+id.slice(1,10)!==baseCelex))return unresolved('existing-law-version-conflict');
  const citedDate=cited[0]?.slice(-8).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
  if(citedDate&&(!lawDate(citedDate)||citedDate>amendmentDate))return unresolved('existing-law-prospective-version');
  return {status:'resolved',baseCelex,amendmentDate,language,citedCelex:cited[0]||null,target:inner[0].raw,evidence:[{kind:'existing-law-reference',document:inner[0].document,baseCelex,amendmentDate,citedCelex:cited[0]||null,target:inner[0].raw}],gaps:[]};
}
export function consolidationsSparql(baseCelex,language='en') {
  existingLawCelex(baseCelex);
  if(!baseCelex.startsWith('3')||!languageUris[language])throw new Error('invalid-basic-act');
  return `PREFIX cdm:<http://publications.europa.eu/ontology/cdm#>
PREFIX xsd:<http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?work ?celex ?date ?created ?version ?expression ?expressionVersion WHERE {
 ?base cdm:resource_legal_id_celex "${baseCelex}"^^xsd:string.
 ?work cdm:act_consolidated_based_on_resource_legal ?base; cdm:act_consolidated_date ?date.
 OPTIONAL {?work cdm:resource_legal_id_celex ?celex}
 OPTIONAL {?work cdm:work_date_creation_legacy ?created}
 OPTIONAL {?work cdm:act_consolidated_version ?version}
 OPTIONAL {?expression cdm:expression_belongs_to_work ?work;
 cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/${languageUris[language]}>.
 OPTIONAL {?expression cdm:expression_version ?expressionVersion}}
} ORDER BY ?date LIMIT 201`;
}
export function selectConsolidation(rows,identity) {
  if(!Array.isArray(rows)||rows.length>=201)return unresolved('existing-law-versions-incomplete');
  const candidates=[];
  for(const row of rows){
    const workId=row.work?.value,date=row.date?.value,celex=row.celex?.value||`0${identity.baseCelex.slice(1)}-${date?.replaceAll('-','')}`;
    if(!CELLAR_WORK_PATTERN.test(workId||'')||!lawDate(date)||celex!==`0${identity.baseCelex.slice(1)}-${date.replaceAll('-','')}`)return unresolved('existing-law-version-conflict');
    if(date<=identity.amendmentDate)candidates.push({workId,date,celex,family:Boolean(row.celex),created:row.created?.value??null,version:row.version?.value??null,expressionId:row.expression?.value??null,expressionVersion:row.expressionVersion?.value??null});
  }
  const selectedDate=identity.citedCelex?identity.citedCelex.slice(-8).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):candidates.map(r=>r.date).sort().at(-1);
  const sameDate=candidates.filter(r=>r.date===selectedDate),selected=unique(sameDate.filter(r=>r.family).map(r=>JSON.stringify(r))).map(r=>JSON.parse(r));
  if(selected.length!==1)return unresolved(selected.length?'existing-law-production-conflict':'existing-law-version-unavailable');
  const family=selected[0];
  if(!family.expressionId)return unresolved('existing-law-language-unavailable');
  const productions=unique(sameDate.filter(r=>!r.family&&r.expressionId).map(r=>JSON.stringify(r))).map(r=>JSON.parse(r));
  if(!productions.length||productions.some(r=>!/^\d{3}$/.test(r.version||'')||!lawDate(r.created)))return unresolved('existing-law-production-conflict');
  const applicable=productions.filter(r=>r.created<=identity.amendmentDate),latest=Math.max(...applicable.map(r=>Number(r.version))),matching=applicable.filter(r=>Number(r.version)===latest);
  if(matching.length!==1||family.expressionVersion!==matching[0].version)return unresolved('existing-law-production-conflict');
  if(!lawDate(family.created)||family.created>identity.amendmentDate)return unresolved('existing-law-production-after-amendment');
  return {...family,productionWorkId:matching[0].workId,productionExpressionId:matching[0].expressionId,productionVersion:matching[0].version,productionCreated:matching[0].created,status:'resolved',selectionBasis:identity.citedCelex?'explicit-citation':'latest-consolidation-at-amendment-date'};
}
export function resolveExistingLawTree(xml,{baseCelex,celex,workId,date,language,expressionId:expectedExpression,productionVersion}) {
  const graph=cellarGraph(xml),values=name=>graph.values(workId,name),evidence=[{kind:'existing-law-cellar-identity',baseCelex,celex,workId,date,modifiers:values('act_consolidated_consolidates_resource_legal'),productionVersion:values('act_consolidated_version'),creationDates:values('work_date_creation')}];
  if(!CELLAR_WORK_PATTERN.test(workId)||!values('resource_legal_id_celex').includes(celex)||values('resource_legal_id_celex').some(id=>id!==celex)||values('act_consolidated_date').join()!==date||values('work_has_resource-type').join()!=='http://publications.europa.eu/resource/authority/resource-type/CONS_TEXT'||!values('act_consolidated_based_on_resource_legal').some(id=>graph.aliases(id).includes('http://publications.europa.eu/resource/celex/'+baseCelex)))return unresolved('existing-law-metadata-conflict');
  const expressions=unique([...graph.graph.keys()].filter(id=>id.startsWith(workId+'.')&&/^\d{4,8}$/.test(id.slice(workId.length+1))&&graph.values(id,'expression_belongs_to_work').some(v=>graph.aliases(workId).includes(v))&&graph.values(id,'expression_uses_language').some(v=>languageCode(v)===language)));
  if(expressions.length!==1)return unresolved(expressions.length?'existing-law-language-conflict':'existing-law-language-unavailable');
  const expressionId=expressions[0],languages=graph.values(expressionId,'expression_uses_language');
  if(languages.length!==1)return unresolved('existing-law-language-conflict');
  if(expectedExpression&&expressionId!==expectedExpression||productionVersion&&graph.values(expressionId,'expression_version').join()!==productionVersion)return unresolved('existing-law-production-conflict');
  const manifestations=unique([...graph.graph.keys()].filter(id=>id.startsWith(expressionId+'.')&&graph.values(id,'manifestation_manifests_expression').some(v=>graph.aliases(expressionId).includes(v))&&graph.values(id,'manifestation_type').includes('xhtml')));
  if(manifestations.length!==1)return unresolved('existing-law-xhtml-unavailable');
  const manifestationId=manifestations[0],items=unique([...graph.graph.keys()].filter(id=>id.startsWith(manifestationId+'/')&&graph.values(id,'item_belongs_to_manifestation').some(v=>graph.aliases(manifestationId).includes(v))));
  if(items.length!==1)return unresolved('existing-law-item-conflict');
  cellarTransportUrl(items[0],{redirect:true});
  return {status:'resolved',evidence,gaps:[],items:[{kind:'act',index:1,format:'XHTML',itemId:items[0],expressionId,manifestationId,languageUri:languages[0]}]};
}
export function createExistingLawBaseline({documents=new CellarDocuments()}={}) {
  return options=>waitForRequest(sharedRequest(async()=>{
    const language=options.language,identity=existingLawReference(options);
    if(identity.status!=='resolved')return {...identity,language};
    let evidence=identity.evidence;
    const unavailable=gap=>({...unresolved(gap),language,baseCelex:identity.baseCelex,evidence});
    try {
      const url=new URL('https://publications.europa.eu/webapi/rdf/sparql');url.searchParams.set('query',consolidationsSparql(identity.baseCelex,language));url.searchParams.set('format','application/sparql-results+json');
      const versions=await documents.sources.get(url.href,{freshMs:CELLAR_LIMITS.metadataFreshMs,validate:record=>{if(!Array.isArray(record.data?.results?.bindings)||record.data.results.bindings.length>=201)throw new Error('existing-law-versions-incomplete');}});
      const selected=selectConsolidation(versions.data.results.bindings,identity);
      evidence=[...evidence,{kind:'existing-law-versions',url:url.href,fetchedAt:versions.fetchedAt,rows:versions.data.results.bindings,selected}];
      if(selected.status!=='resolved')return unavailable(selected.gaps[0]);
      const metadata=await documents.metadata(selected.celex),resolved=resolveExistingLawTree(metadata.xml,{...identity,...selected,language});
      evidence.push(...resolved.evidence,{kind:'cellar-source',url:metadata.url,fetchedAt:metadata.fetchedAt});
      if(resolved.status!=='resolved')return unavailable(resolved.gaps[0]);
      const items=[];for(const item of resolved.items)items.push({...item,...await documents.content({celex:selected.celex,...item,language:item.languageUri})});
      const gaps=[];if(versions.viewCache?.stale||metadata.viewCache?.stale)gaps.push('stale-metadata');if(items.some(item=>item.source.stale))gaps.push('stale-content');
      return {...selected,status:gaps.length?'partial':'available',baseCelex:identity.baseCelex,amendmentDate:identity.amendmentDate,language,items,gaps,evidence};
    }catch(error){if(isLocalRequestFailure(error))throw error;return unavailable(error.code||error.message||'existing-law-source-unavailable');}
  },60_000));
}
let defaultBaseline;
export function existingLawBaseline(options){defaultBaseline??=createExistingLawBaseline();return defaultBaseline(options);}
