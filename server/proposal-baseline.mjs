import {CellarDocuments,proposalCelex,CELLAR_LIMITS} from './cellar-documents.mjs';
import {reportProposalReference,resolveProposalTree,resolveProposalCandidates} from './commission-proposal-identity.mjs';
import {odp,odpLanguage} from './odp.mjs';
import {HttpError} from './http-utils.mjs';
import {docxParts} from './document-text.mjs';
import {sharedRequest,waitForRequest,isLocalRequestFailure} from './request-budget.mjs';

export function createProposalBaseline({documents=new CellarDocuments(),request=odp}={}) {
  return function proposalBaseline({reportId,celex,language='en',documentReferences=[]}={}) {
    odpLanguage(language);
    if(reportId!=null&&!/^A-\d{1,2}-\d{4}-\d{4}$/.test(reportId))throw new HttpError(400,'invalid_report','Choose an exact A-report identifier.');
    if(celex!=null)proposalCelex(celex);
    if(!reportId&&!celex)throw new HttpError(400,'missing_proposal','Choose a report or proposal CELEX identifier.');
    return waitForRequest(sharedRequest(async()=>{
      let evidence=[],procedure,sourceCelex=celex,metadataStale=false;
      const unavailable=(status,gaps,extra={})=>({status,celex:sourceCelex??null,workId:null,language,items:[],gaps,evidence,...extra});
      try {
        if(reportId) {
          const source=await request(`/plenary-documents/${reportId}`,{}, {staleWhileRevalidate:true});
          if(!Array.isArray(source.payload?.data)||source.payload.data.length!==1)return unavailable('unresolved',['report-identity']);
          const identity=reportProposalReference(source.payload.data[0],{reportId,documentReferences});
          evidence=[...identity.evidence,{kind:'report-source',url:source.url,fetchedAt:new Date(source.fetchedAt).toISOString(),stale:Boolean(source.stale),refreshError:source.refreshError||null}];
          if(identity.status!=='resolved')return unavailable(identity.status,identity.gaps);
          if(sourceCelex&&sourceCelex!==identity.celex)return unavailable('unresolved',['report-celex-conflict']);
          sourceCelex=identity.celex;procedure=identity.procedure;metadataStale=Boolean(source.stale);
        }
        const candidates=await documents.candidates(sourceCelex),candidate=resolveProposalCandidates(candidates.data,{celex:sourceCelex});
        evidence.push({kind:'candidate-source',url:candidates.url,fetchedAt:candidates.fetchedAt,stale:Boolean(candidates.viewCache?.stale),refreshError:candidates.viewCache?.refreshError||null},...candidate.evidence);
        if(candidate.status!=='resolved')return unavailable(candidate.status,candidate.gaps);
        metadataStale ||= Boolean(candidates.viewCache?.stale);
        const metadata=await documents.metadata(sourceCelex),identity=resolveProposalTree(metadata.xml,{celex:sourceCelex,language,procedure});
        evidence.push({kind:'cellar-source',url:metadata.url,resolvedSourceUrl:metadata.resolvedSourceUrl,fetchedAt:metadata.fetchedAt,stale:Boolean(metadata.viewCache?.stale),refreshError:metadata.viewCache?.refreshError||null},...identity.evidence);
        if(identity.status!=='resolved')return unavailable(identity.status,identity.gaps,{workId:identity.workId});
        if(identity.workId!==candidate.workId)return unavailable('unresolved',['proposal-work-conflict']);
        const items=[],gaps=[];let bytes=0;
        for(const item of identity.items) {
          try {
            const content=await documents.docx({celex:sourceCelex,language:item.languageUri,...item});
            docxParts(content.buffer);bytes+=content.buffer.length;
            if(bytes>CELLAR_LIMITS.bundleBytes){gaps.push({code:'bundle-too-large',itemId:item.itemId});break;}
            items.push({...item,source:content.source,buffer:content.buffer});
            if(content.source.stale)gaps.push({code:'stale-content',itemId:item.itemId,refreshError:content.source.refreshError});
          }catch(error){if(isLocalRequestFailure(error))throw error;gaps.push({code:error.code||'docx-unavailable',itemId:item.itemId});}
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
export const proposalBaseline=createProposalBaseline();
