import {test} from 'node:test';import assert from 'node:assert/strict';import {distributionOracle} from './amendment-distribution-oracle.mjs';
const xml=text=>'<w:document><w:body><w:p><w:r><w:t><![CDATA['+text+']]></w:t></w:r></w:p></w:body></w:document>';
test('independent oracle requires class, report token and complete native number range',()=>{
 const id='A-10-2026-0106-AM-019-020',block=n=>`<Amend>A10-0106/2026<TitreType>Report</TitreType><NumAm>${n}</NumAm></Amend>`,s=block(19)+block(20);
 assert(distributionOracle(xml(s),{id}));for(const bad of [block(19),s.replaceAll('Report','Motion for a resolution'),s.replaceAll('0106','0107'),s+block(21)])assert.equal(distributionOracle(xml(bad),{id}),false);
});
