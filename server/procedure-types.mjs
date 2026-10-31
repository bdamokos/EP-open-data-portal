// Bundled ProcessType concepts, not ProcessSubtype or grouping concepts, from
// https://data.europarl.europa.eu/def/ep-procedure-types.ttl (20260131_1).
// Retrieved 2026-10-31; SHA-256 fd333da7643093d650e79c3d19f3a96aceb1fad5b72b217f2f2facc104e66e90.
// Families describe procedures, never whether an act was enacted. Consent alone
// does not establish legislative nature; an Article 225 initiative is separate.
export const procedureTypes=Object.freeze(Object.fromEntries([
  ['ACI','Interinstitutional agreement procedure','non-legislative'],
  ['APP','Consent procedure','consent'],
  ['AVC','Assent procedure','consent',true],
  ['BUD','Budgetary procedure','budgetary'],
  ['BUI','Budgetary initiative','budgetary'],
  ['CNS','Consultation procedure','legislative'],
  ['COD','Ordinary legislative procedure','legislative'],
  ['COS','Procedure on a strategy paper','non-legislative',true],
  ['DCE','Written declaration','non-legislative',true],
  ['DEA','Delegated acts','non-legislative'],
  ['DEC','Discharge procedure','budgetary'],
  ['GBD','Budget management procedure','budgetary'],
  ['IMM',"Members' immunity",'non-legislative'],
  ['INI','Own-initiative procedure','non-legislative'],
  ['INL','Legislative initiative procedure','legislative-initiative'],
  ['INS','Institutional procedure','non-legislative'],
  ['NLE','Non-legislative enactments','non-legislative'],
  ['REG',"Parliament's Rules of Procedure",'non-legislative'],
  ['RPS','Implementing acts','non-legislative',true],
  ['RSO','Organisation of Parliament','non-legislative'],
  ['RSP','Resolution on topical subjects','non-legislative'],
  ['SYN','Cooperation procedure','legislative',true],
].map(([code,label,classification,deprecated=false])=>[code,Object.freeze({label,classification,deprecated})])));

const values=value=>Array.isArray(value)?value:value==null||value===''?[]:[value];
const typeCode=value=>typeof value==='string'?value.match(/(?:^|\/)([A-Z]{2,8})$/)?.[1]||null:null;
const identityCodes=value=>{
  if(typeof value!=='object'||value===null)return [typeCode(value)];
  const keys=['id','@id'].filter(key=>Object.hasOwn(value,key));
  return keys.length?keys.map(key=>typeCode(value[key])):[null];
};
export function procedureClassification(work) {
  const observations=['process_type','procedure_type','had_procedure_type'].flatMap(field=>values(work?.[field]).map(value=>({field,value,codes:identityCodes(value)})));
  const declarations=observations.map(({field,value,codes})=>({field,value,code:codes.every(code=>code===codes[0])?codes[0]:null}));
  // A canonical suffix checks declarations; it never replaces a missing type
  // observation. Titles and bare procedure IDs supply no type.
  const reference=typeof work?.label==='string'&&/^\d{4}\/\d{4}[A-Z]?\([A-Z]{2,8}\)$/.test(work.label)?work.label:null;
  const referenceCode=reference?.match(/\(([A-Z]{2,8})\)$/)[1]||null;
  const declaredCodes=observations.flatMap(row=>row.codes).filter(Boolean);
  const codes=[...new Set([...declaredCodes,...(declaredCodes.length&&referenceCode?[referenceCode]:[])])];
  const malformed=observations.some(row=>row.codes.includes(null));
  const status=codes.length>1||malformed&&codes.length?'conflicting':codes.length?(Object.hasOwn(procedureTypes,codes[0])?'known':'unknown'):declarations.length?'unknown':'missing';
  const code=status==='conflicting'?null:codes[0]||null;
  const type=status==='known'?procedureTypes[code]:null;
  return {code,codes,status,classification:type?.classification||'unresolved',
    label:type?.label||(status==='missing'?'Procedure type not supplied':status==='conflicting'?'Conflicting procedure types':'Unknown procedure type'),
    deprecated:type?.deprecated??null,reference,declaredReference:reference,referenceCode,declarations};
}
