import {oracleAddress} from './amendment-oracle-grammar.mjs';
import {assertRecastReading} from './amendment-recast-oracle.mjs';
const clean=s=>String(s??'').normalize('NFC').replace(/\s+/gu,' ').trim();
const body=s=>clean(s).replace(/^\d+\.\s+/u,'');
// Read printed Word paragraph starts directly; no parsed unit or placement
// evidence participates in the address proof. Native recast runs must agree.
export function assertSequentialParagraph({items,placement,wording,nativeQuoted}) {
 const proposal=items?.[placement?.itemIndex]?.proposal;
 if(proposal?.sourceKind!=='docx'||placement.status!=='placed')return null;
 const address=oracleAddress(wording.targetLabel,wording.language);
 if(address?.length!==2||address[0].kind!=='article'||address[1].kind!=='paragraph'||address[1].suffix||address[1].isNew)return null;
 const rows=proposal.paragraphs,headings=rows.filter(p=>p.properties?.styleId==='Titrearticle'&&new RegExp('^Article '+address[0].value+'$','u').test(clean(p.text)));
 if(headings.length!==1)return null;
 const start=headings[0].index,end=rows.find(p=>p.index>start&&p.properties?.styleId==='Titrearticle'&&/^Article \d+/u.test(clean(p.text)))?.index;
 if(end===undefined)return null;
 const frame=rows.slice(start+1,end),peers=frame.filter(p=>/^\d+\.\s/u.test(p.text)),numbers=peers.map(p=>Number(/^\d+/u.exec(p.text)[0]));
 if(numbers.length<3||numbers.length>64||numbers[0]!==1||new Set(numbers).size===numbers.length||numbers.some((n,i)=>i&&(n<numbers[i-1]||n>numbers[i-1]+1)))return null;
 const ordinal=Number(address[1].value),selected=peers[ordinal-1];if(!selected||numbers[ordinal-1]===ordinal)return null;
 const stop=peers[ordinal]?.index??end,source=rows.slice(selected.index,stop),original=body(wording.originalText);
 if(!['replace','delete'].includes(placement.operation)||!original||body(source.map(r=>r.text).join(' '))!==original||rows.map(r=>body(r.text)).join(' ').split(original).length!==2)return null;
 const fail=()=>({status:'failed',reason:'oracle-sequential-paragraph-coordinate-mismatch'}),s=placement.splice;
 if(placement.span?.start!==selected.index||placement.span?.end!==stop-1||s?.start.paragraph!==selected.index||s.start.offset!==0||s.end.paragraph!==stop-1||s.end.offset!==source.at(-1).text.length)return fail();
 if(frame.some(r=>!r.complete||r.source?.complete!==true||r.source.container!=='body'))return null;
 const native=assertRecastReading({proposal,placement:{...placement,span:{start:start+1,end:end-1}},nativeQuoted});
 if(native?.status!=='verified')return native??{status:'unverified',reason:'oracle-sequential-native-reading-unavailable'};
 return {status:'verified',reason:'native-word-sequential-paragraph'};
}
