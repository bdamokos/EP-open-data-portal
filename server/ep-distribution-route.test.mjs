import {test} from 'node:test';import assert from 'node:assert/strict';
import {distributionCandidate,verifyDistributionText} from './ep-distribution-route.mjs';
import {distributionEvidenceFor,currentDocxDescriptor} from './amendments.mjs';
const list={identifier:'A-10-2026-0106-AM-019-020',work_type:'def/ep-document-types/AMENDMENT_LIST',is_realized_by:[]};
test('only exact typed no-file records yield a bounded retrieval candidate',()=>{
 const candidate=distributionCandidate(list);assert.equal(candidate.url,'https://data.europarl.europa.eu/distribution/reds_iPlRp_Amd/'+list.identifier+'/'+list.identifier+'_en.docx');
 assert.equal(distributionCandidate({...list,work_type:'REPORT_PLENARY'}),null);
 assert.equal(distributionCandidate({...list,is_realized_by:[{is_embodied_by:[{format:'PDF'}]}]}),null);
 assert.equal(distributionCandidate({...list,identifier:'A-10-2026-0106-AM-020-019'}),null);
 const evidence=distributionEvidenceFor(list,null);assert.equal(evidence.state,'empty');assert.deepEqual(currentDocxDescriptor({...list,distributionEvidence:evidence}),candidate);
});
test('identity requires native class and every amendment in the exact range',()=>{
 const block=n=>`<Amend>A10-0106/2026<TitreType>Report</TitreType><NumAm>${n}</NumAm></Amend>`,text=block(19)+block(20);
 assert(verifyDistributionText([text],list.identifier));for(const bad of [block(19),text.replaceAll('Report','Motion for a resolution'),text.replaceAll('0106','0107'),text+block(21)])assert.equal(verifyDistributionText([bad],list.identifier),false);
 assert(verifyDistributionText(['<NoDocSe>B10 0435/2026</NoDocSe><TitreType>MOTION FOR A RESOLUTION</TitreType>'],'B-10-2026-0435'));
});
