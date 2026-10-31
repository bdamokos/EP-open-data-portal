import {committeeDraftId,committeeDocumentEndpoint} from './committee-amendments.mjs';
import {CellarDocuments,proposalCelex,CELLAR_LIMITS} from './cellar-documents.mjs';
import {commissionReferences,commissionProcedures,reportProposalReference,resolveProposalTree,resolveProposalCandidates} from './commission-proposal-identity.mjs';
import {nativeConsultationProcedure,nativeNleDecisionProcedure,nativeAnnexOrdinal} from './commission-proposal-native-identity.mjs';
import {odp,odpLanguage} from './odp.mjs';
import {HttpError} from './http-utils.mjs';
import {docxParts} from './document-text.mjs';
import {sharedRequest,waitForRequest,isLocalRequestFailure} from './request-budget.mjs';
import {array,tail} from './activity-index-model.mjs';
import {languageCode} from './ep-links.mjs';

function matchesNativeDeclaration(work,native,language) {
  const declarations=array(work.is_realized_by).filter(e=>languageCode(e.language)===language).flatMap(e=>array(e.is_embodied_by).filter(m=>tail(m.format)==='DOCX').map(m=>({url:new URL(m.is_exemplified_by,'https://data.europarl.europa.eu/').href,expressionId:e.id??null,manifestationId:m.id??null,byteSize:m.byteSize==null?null:Number(m.byteSize),issued:m.issued??null})));
  const declared=declarations[0];
  return declarations.length===1&&declared.url===native?.url&&declared.expressionId===native.declaration?.expressionId&&declared.manifestationId===native.declaration?.manifestationId&&declared.byteSize===native.sourceVersion?.byteSize&&declared.issued===native.sourceVersion?.issued;
}

export function createProposalBaseline({documents=new CellarDocuments(),request=odp}={}) {
  return function proposalBaseline({reportId,celex,language='en',documentReferences=[],nativeReferencePair}={}) {
    odpLanguage(language);
    if(reportId!=null&&!committeeDraftId(reportId)&&!/^A-\d{1,2}-\d{4}-\d{4}$/.test(reportId))throw new HttpError(400,'invalid_report','Choose an exact A-report identifier.');
    if(celex!=null)proposalCelex(celex);
    if(!reportId&&!celex)throw new HttpError(400,'missing_proposal','Choose a report or proposal CELEX identifier.');
    return waitForRequest(sharedRequest(async()=>{
      let evidence=[],procedure,sourceCelex=celex,metadataStale=false;
      const unavailable=(status,gaps,extra={})=>({status,celex:sourceCelex??null,workId:null,language,items:[],gaps,evidence,...extra});
      try {
        if(reportId) {
          const source=await request(committeeDocumentEndpoint(reportId)||`/plenary-documents/${reportId}`,{}, {staleWhileRevalidate:true});
          if(!Array.isArray(source.payload?.data)||source.payload.data.length!==1)return unavailable('unresolved',['report-identity']);
          evidence=[{kind:'report-source',url:source.url,fetchedAt:new Date(source.fetchedAt).toISOString(),stale:Boolean(source.stale),refreshError:source.refreshError||null}];
          if(language!=='en'&&array(source.payload.data[0].is_realized_by).some(e=>Object.values(e.title_alternative||{}).flat().some(t=>commissionProcedures(t).some(p=>p.endsWith('(NLE)')))))return unavailable('language-unavailable',['native-procedure-language-unavailable']);
          if(nativeReferencePair?.report?.source) {
            if(!matchesNativeDeclaration(source.payload.data[0],nativeReferencePair.report.source,language))return unavailable('unresolved',['native-report-version-conflict']);
            if(nativeReferencePair.list?.source) {
              const linked=array(source.payload.data[0].inverse_foresees_change_of).filter(value=>String(value?.id||value).replace(/^https?:\/\/data\.europarl\.europa\.eu\//u,'')==='eli/dl/doc/'+nativeReferencePair.list.listId);
              if(linked.length!==1)return unavailable('unresolved',['native-list-relationship-conflict']);
              if(typeof linked[0]==='object'&&Object.hasOwn(linked[0],'is_realized_by')&&!matchesNativeDeclaration(linked[0],nativeReferencePair.list.source,language))return unavailable('unresolved',['native-list-version-conflict']);
            }
          }
          const identity=reportProposalReference(source.payload.data[0],{reportId,documentReferences,nativeReferencePair});
          evidence=[...identity.evidence,...evidence];
          if(identity.status!=='resolved')return unavailable(identity.status,identity.gaps);
          if(sourceCelex&&sourceCelex!==identity.celex)return unavailable('unresolved',['report-celex-conflict']);
          sourceCelex=identity.celex;procedure=identity.procedure;metadataStale=Boolean(source.stale);
          if(procedure.endsWith('(NLE)')) {
            evidence.push({kind:'native-reference-selection',listId:nativeReferencePair.list.listId,...nativeReferencePair.selection});
            metadataStale ||= [source,nativeReferencePair.selection?.reportMetadataSource,nativeReferencePair.selection?.listMetadataSource].some(s=>s?.stale||s?.refreshInProgress||s?.refreshError);
          }
        }
        const references=documentReferences.filter(r=>r.field==='DocRef'||/^DocAmend\d?$/.test(r.field)),hints=references.flatMap(r=>commissionReferences(r.raw));
        if(hints.some(h=>h.celex!==sourceCelex||h.qualifier&&h.qualifier!=='final'))return unavailable('unresolved',['amendment-proposal-reference-conflict']);
        const procedures=[...new Set(references.flatMap(r=>commissionProcedures(r.raw)))];
        if(procedures.length>1||procedure&&procedures.some(p=>p!==procedure))return unavailable('unresolved',['amendment-procedure-reference-conflict']);
        procedure??=procedures[0];
        const consultation=procedure?.endsWith('(CNS)');
        const nle=procedure?.endsWith('(NLE)'),nativeDecision=consultation||nle;
        if(consultation&&!reportId)return unavailable('unresolved',['consultation-report-reference-unavailable']);
        if(consultation&&language!=='en')return unavailable('language-unavailable',['native-procedure-language-unavailable']);
        if(nle&&!reportId)return unavailable('unresolved',['nle-report-reference-unavailable']);
        if(nle&&language!=='en')return unavailable('language-unavailable',['native-procedure-language-unavailable']);
        const candidates=await documents.candidates(sourceCelex),candidate=resolveProposalCandidates(candidates.data,{celex:sourceCelex});
        evidence.push({kind:'candidate-source',url:candidates.url,fetchedAt:candidates.fetchedAt,stale:Boolean(candidates.viewCache?.stale),refreshError:candidates.viewCache?.refreshError||null},...candidate.evidence);
        if(candidate.status!=='resolved')return unavailable(candidate.status,candidate.gaps);
        metadataStale ||= Boolean(candidates.viewCache?.stale);
        const metadata=nativeDecision?await documents.metadataByWork(candidate.workId,{celex:sourceCelex}):await documents.metadata(sourceCelex),identity=resolveProposalTree(metadata.xml,{celex:sourceCelex,language,procedure});
        evidence.push({kind:'cellar-source',url:metadata.url,resolvedSourceUrl:metadata.resolvedSourceUrl,fetchedAt:metadata.fetchedAt,stale:Boolean(metadata.viewCache?.stale),refreshError:metadata.viewCache?.refreshError||null},...identity.evidence);
        if(identity.status!=='resolved')return unavailable(identity.status,identity.gaps,{workId:identity.workId});
        if(identity.workId!==candidate.workId)return unavailable('unresolved',['proposal-work-conflict']);
        if(consultation&&identity.evidence.find(e=>e.kind==='cellar-identity')?.types?.[0]!=='http://publications.europa.eu/resource/authority/resource-type/PROP_DIR')return unavailable('unresolved',['native-procedure-type-unavailable'],{workId:identity.workId});
        if(nle&&identity.evidence.find(e=>e.kind==='cellar-identity')?.types?.[0]!=='http://publications.europa.eu/resource/authority/resource-type/PROP_DEC')return unavailable('unresolved',['native-procedure-type-unavailable'],{workId:identity.workId});
        const items=[],gaps=[];let bytes=0;
        for(const item of identity.items) {
          try {
            const content=await documents.docx({celex:sourceCelex,language:item.languageUri,...item});
            docxParts(content.buffer);bytes+=content.buffer.length;
            if(bytes>CELLAR_LIMITS.bundleBytes){gaps.push({code:'bundle-too-large',itemId:item.itemId});break;}
            items.push({...item,source:content.source,buffer:content.buffer});
            if(content.source.stale)gaps.push({code:'stale-content',itemId:item.itemId,refreshError:content.source.refreshError});
          }catch(error){if(isLocalRequestFailure(error))throw error;gaps.push({code:error.code||'docx-unavailable',itemId:item.itemId,...(error.code==='missing-declared-representation'?{source:error.source,request:error.request,negotiation:error.negotiation}:{})});}
        }
        if(nativeDecision) {
          const acts=items.filter(item=>item.kind==='act');
          if(acts.length!==1||identity.items.filter(item=>item.kind==='act').length!==1)return unavailable('unresolved',['native-procedure-act-unavailable'],{workId:identity.workId});
          const native=(nle?nativeNleDecisionProcedure:nativeConsultationProcedure)(acts[0].buffer,{procedure,language});
          evidence.push({kind:'native-procedure',itemId:acts[0].itemId,...native});
          if(native.status!=='verified')return unavailable('unresolved',[native.reason],{workId:identity.workId});
        }
        if(nle)for(const item of items.filter(item=>item.kind==='annex')) {
          const native=nativeAnnexOrdinal(item.buffer,{language});
          evidence.push({kind:'native-nle-annex-part',itemId:item.itemId,sha256:item.source.sha256,...native,legalPlacement:native.status==='verified'});
          if(native.status!=='verified')gaps.push({code:'native-annex-ordinal-unverified',itemId:item.itemId,reason:native.reason});
        }
        if(metadataStale||metadata.viewCache?.stale)gaps.push({code:'stale-metadata'});
        return {status:gaps.length?items.length?'partial':'unavailable':'available',celex:sourceCelex,workId:identity.workId,language,items,gaps,evidence};
      }catch(error) {
        if(isLocalRequestFailure(error))throw error;
        return unavailable('unavailable',[{code:error.code||'proposal-source-unavailable'}]);
      }
    },45_000));
  };
}
/** Internal, lazy source function. Buffers go directly to the existing DOCX pipeline. */
let defaultBaseline;
export function proposalBaseline(options){defaultBaseline??=createProposalBaseline();return defaultBaseline(options);}
