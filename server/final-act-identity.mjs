import {createHash} from 'node:crypto';
import {CellarDocuments,cellarGraph,CELLAR_WORK_PATTERN,cellarTransportUrl} from './cellar-documents.mjs';
import {languageCode} from './ep-links.mjs';
import {parsePublicLegalXhtml} from './public-legal-xhtml.mjs';
import {requestSignal} from './request-budget.mjs';

export const FINAL_ACT_IDENTITY_VERSION=1;
const unique=values=>[...new Set(values)];
const authority='http://publications.europa.eu/resource/authority/';
const missing=(gap,evidence=[])=>({status:'unavailable',items:[],gaps:[gap],evidence});
const sha=value=>createHash('sha256').update(value).digest('hex');

export function finalActCelex(value) {
  return typeof value==='string'&&/^3(?:19|20)\d{2}[RLD]\d{4}$/.test(value)?value:null;
}

/** Only a published correspondence statement selects an act. Ordinary citations
 * to other legislation, placeholder numbers and consolidations are not targets. */
export function finalActCorrespondence(text,{language,source,documentId}={}) {
  if(language!=='en'||!source?.contentHash)return missing('final-act-correspondence-unavailable');
  const matches=[];
  for(const [paragraph,raw] of (text?.paragraphs||[]).entries()) {
    if(text.paragraphSources?.[paragraph]?.complete===false||text.documentObjects?.some(object=>object.paragraph===paragraph))continue;
    const normalized=raw.normalize('NFC').replace(/[\u00a0\u202f]/gu,' ').replace(/\s+/gu,' ').trim();
    const m=/^\(As an agreement was reached between Parliament and Council, Parliament['’]s position corresponds to the final legislative act, (Regulation|Directive|Decision) \(EU\) ((?:19|20)\d{2})\/(\d{1,4})\.\)$/u.exec(normalized);
    if(!m)continue;
    const celex=`3${m[2]}${{Regulation:'R',Directive:'L',Decision:'D'}[m[1]]}${m[3].padStart(4,'0')}`;
    matches.push({kind:'published-final-act-correspondence',documentId,celex,paragraph,text:raw,source});
  }
  return matches.length===1?{status:'available',celex:matches[0].celex,evidence:matches,gaps:[]}:
    missing(matches.length?'competing-final-act-correspondence':'final-act-correspondence-unavailable',matches);
}

/** Resolve the original OJ act, never an as-of-date consolidation. All WEMI
 * edges come from the metadata tree, including explicit owl:sameAs aliases. */
export function resolveFinalActTree(xml,{celex,procedure,language}={}) {
  if(!finalActCelex(celex)||!/^\d{4}\/\d{4}\(COD\)$/.test(procedure||''))return missing('final-act-identity-unavailable');
  const graph=cellarGraph(xml),works=unique([...graph.graph.keys()].filter(id=>CELLAR_WORK_PATTERN.test(id)&&graph.values(id,'resource_legal_id_celex').includes(celex)));
  if(works.length!==1)return missing('competing-final-act-work');
  const workId=works[0],values=name=>graph.values(workId,name),dossier=`http://publications.europa.eu/resource/procedure/${procedure.slice(0,4)}_${Number(procedure.slice(5,9))}`;
  const evidence=[{kind:'final-act-cellar-identity',workId,celex,procedure,language,metadataHash:sha(xml)}];
  const expectedType={R:'REG',L:'DIR',D:'DEC'}[celex[5]],creators=values('work_created_by_agent');
  if(values('resource_legal_id_celex').join()!==celex||values('work_has_resource-type').join()!==authority+'resource-type/'+expectedType||creators.length!==2||!['EP','CONSIL'].every(id=>creators.includes(authority+'corporate-body/'+id))||values('act_consolidated_based_on_resource_legal').length)return missing('final-act-institution-or-type-conflict',evidence);
  const dossiers=values('work_part_of_dossier');
  if(dossiers.length!==1||!graph.aliases(dossiers[0]).includes(dossier))return missing('final-act-procedure-conflict',evidence);
  // When metadata also declares a full reference, it must agree on the type.
  const references=graph.values(dossiers[0],'procedure_code_interinstitutional_reference_procedure');
  if(references.length&&references.join()!==procedure.replace(/\(([^)]+)\)$/u,'/$1'))return missing('final-act-procedure-conflict',evidence);
  const expressions=unique([...graph.graph.keys()].filter(id=>id.startsWith(workId+'.')&&/^\d{4,8}$/.test(id.slice(workId.length+1))&&graph.values(id,'expression_belongs_to_work').some(v=>graph.aliases(workId).includes(v))&&graph.values(id,'expression_uses_language').some(v=>languageCode(v)===language)));
  if(expressions.length!==1)return missing(expressions.length?'competing-final-act-language':'final-act-language-unavailable',evidence);
  const expressionId=expressions[0],languages=graph.values(expressionId,'expression_uses_language');
  if(languages.length!==1)return missing('competing-final-act-language',evidence);
  const manifestations=unique([...graph.graph.keys()].filter(id=>id.startsWith(expressionId+'.')&&graph.values(id,'manifestation_manifests_expression').some(v=>graph.aliases(expressionId).includes(v))&&graph.values(id,'manifestation_type').includes('xhtml')));
  if(manifestations.length!==1)return missing('competing-or-missing-final-act-xhtml',evidence);
  const manifestationId=manifestations[0],items=unique([...graph.graph.keys()].filter(id=>id.startsWith(manifestationId+'/')&&graph.values(id,'item_belongs_to_manifestation').some(v=>graph.aliases(manifestationId).includes(v))));
  if(graph.values(manifestationId,'manifestation_type').join()!=='xhtml')return missing('final-act-format-conflict',evidence);
  if(items.length!==1)return missing('competing-or-missing-final-act-item',evidence);
  const itemId=items[0];cellarTransportUrl(itemId,{redirect:true});
  const date=values('work_date_document'),ojDate=values('official-journal-act_date_publication');
  if(date.length!==1||!/^\d{4}-\d{2}-\d{2}$/.test(date[0]))return missing('final-act-date-unavailable',evidence);
  return {status:'available',celex,workId,procedure,language,date:date[0],ojDate:ojDate.length===1?ojDate[0]:null,items:[{kind:'act',index:1,format:'XHTML',expressionId,manifestationId,itemId,languageUri:languages[0]}],evidence,gaps:[]};
}

export function createFinalActReader({documents=new CellarDocuments({directory:null}),metadataBytes=1024*1024,bodyBytes=2*1024*1024}={}) {
  return async ({correspondence,procedure,language})=>{
    if(correspondence?.status!=='available'||!finalActCelex(correspondence.celex))return missing('final-act-correspondence-unavailable');
    const metadata=await documents.metadata(correspondence.celex);requestSignal()?.throwIfAborted();
    if(Buffer.byteLength(metadata.xml)>metadataBytes)return missing('final-act-metadata-budget');
    const resolved=resolveFinalActTree(metadata.xml,{celex:correspondence.celex,procedure,language});
    const evidence=[...correspondence.evidence,...resolved.evidence,{kind:'cellar-metadata',url:metadata.url,fetchedAt:metadata.fetchedAt,contentHash:sha(metadata.xml)}];
    if(resolved.status!=='available')return {...resolved,evidence};
    if(metadata.stale||metadata.viewCache?.stale)return missing('stale-final-act-metadata',evidence);
    const declaration=resolved.items[0],url=cellarTransportUrl(declaration.itemId,{redirect:true});
    // Read the exact declared item with this comparison's byte cap. There is
    // no persistent final-body or comparison cache to outlive source versions.
    let item;
    if(typeof documents.request==='function') {
      const response=await documents.request(url,{accept:'application/xhtml+xml',language:declaration.languageUri.split('/').at(-1).toLowerCase(),maximum:bodyBytes});
      if(response.status!==200)return missing('final-act-content-unavailable',evidence);
      item={buffer:response.buffer,source:{url,resolvedSourceUrl:response.url,celex:resolved.celex,language:declaration.languageUri,itemId:declaration.itemId,expressionId:declaration.expressionId,manifestationId:declaration.manifestationId,sha256:sha(response.buffer),format:'XHTML',fetchedAt:new Date().toISOString(),stale:false}};
    } else item=await documents.content({celex:resolved.celex,...declaration,language:declaration.languageUri});
    requestSignal()?.throwIfAborted();
    if(item.buffer.length>bodyBytes)return missing('final-act-body-budget',evidence);
    if(item.source.stale||item.source.refreshError||sha(item.buffer)!==item.source.sha256||item.source.url!==cellarTransportUrl(declaration.itemId,{redirect:true}))return missing('final-act-content-unverified',evidence);
    const html=item.buffer.toString('utf8').match(/<html\b[^>]*>/u)?.[0]||'',declaredLanguages=[...html.matchAll(/(?:^|\s)(?:xml:)?lang\s*=\s*["']([^"']+)["']/gu)].map(match=>languageCode(match[1]));
    if(declaredLanguages.some(declared=>declared!==language))return missing('final-act-body-language-conflict',evidence);
    const proposal=parsePublicLegalXhtml(item.buffer,{language,sourceUrl:item.source.url,identity:{work:resolved.workId,expression:declaration.expressionId,item:declaration.itemId,celex:resolved.celex}});
    return {...resolved,evidence,items:[{...declaration,proposal,source:item.source}],source:item.source};
  };
}
