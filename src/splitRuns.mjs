// Amendment wording marked with the parts Parliament voted on separately. Description and wording
// must be in one language; the caller passes that language's descriptions. No similarity anywhere:
// a quote is found exactly, or after normalising characters, and only when it occurs once.
const prefix=/^[^\t]{0,12}\t/u;
export const stripNumberPrefix=text=>String(text??'').replace(prefix,'');

const closers={'‘':'’','“':'”“','„':'“”','«':'»','”':'”','"':'"',"'":"'"};
// A straight apostrophe opens a quote only after whitespace, a colon or the start: l'insieme, l'exclusion.
const opening=/[‘“„«”"]|(?<=^|[\s:])'/u;
/** The quoted span of a part's description. `null` means no quote; `false` an opener with no closer. */
export function describePart(description) {
  const text=String(description??''),open=opening.exec(text);
  if(!open)return null;
  const from=open.index+1,accepted=closers[open[0]];
  let end=-1;
  for(let index=text.length-1;index>=from;index--)if(accepted.includes(text[index])){end=index;break;}
  if(end<0)return false;
  return {before:text.slice(0,open.index),quote:text.slice(from,end),after:text.slice(end+1)};
}

const singleQuotes=/[‘’‚‛′]/u,doubleQuotes=/[“”„‟«»″]/u,dashes=/[‐‑‒–—―−]/u;
// One output character per source segment, keeping each one's source offsets for the way back.
function normalised(text) {
  let out='';const map=[];
  for(const match of text.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
    const start=match.index,end=start+match[0].length,value=match[0].normalize('NFC');
    if(/^\s+$/u.test(value)) {
      if(out.endsWith(' ')){map[map.length-1].end=end;continue;}
      out+=' ';map.push({start,end});continue;
    }
    const styled=singleQuotes.test(value)?"'":doubleQuotes.test(value)?'"':dashes.test(value)?'-':value;
    for(let unit=0;unit<styled.length;unit++)map.push({start,end});
    out+=styled;
  }
  return {text:out,map};
}
function onlyOccurrence(text,needle) {
  const first=text.indexOf(needle);
  return first>=0&&text.indexOf(needle,first+1)<0?first:-1;
}
/** Exact characters occurring once, else normalised characters occurring once, mapped back to exact offsets. */
export function findQuote(text,quote) {
  const exact=quote.trim();
  if(!exact)return null;
  const at=onlyOccurrence(text,exact);
  if(at>=0)return {start:at,end:at+exact.length};
  const needle=normalised(exact).text.trim().replace(/[\s.,;:!?…]+$/u,'');
  if(!needle)return null;
  const source=normalised(text),found=onlyOccurrence(source.text,needle);
  if(found<0)return null;
  return {start:source.map[found].start,end:source.map[found+needle.length-1].end};
}
/**
 * `parts` are [{number,description}] in the wording's language. The wording's number prefix is not text.
 * Whole-without shape: one part has words before its quote and the other part has no quote; those words
 * are bracketed for the other part and the rest belongs to the whole part. Every part quoted: each is
 * bracketed, and words no part names stay plain. Anything else, overlaps and repeats included: null.
 * The runs concatenate to the stripped wording exactly.
 */
export function splitRuns(text,parts) {
  if(typeof text!=='string'||!Array.isArray(parts)||parts.length<2)return null;
  const wording=stripNumberPrefix(text);
  const rows=parts.map(part=>({number:String(part.number),read:describePart(part.description)}));
  if(rows.some(row=>row.read===false))return null;
  const quoted=rows.filter(row=>row.read);
  const shape=quoted.length===1&&rows.length===2&&quoted[0].read.before.trim();
  if(!shape&&quoted.length!==rows.length)return null;
  const spans=[];
  for(const row of quoted) {
    const span=findQuote(wording,row.read.quote);
    if(!span)return null;
    spans.push({...span,part:shape?rows.find(other=>other!==row).number:row.number});
  }
  spans.sort((a,b)=>a.start-b.start);
  if(spans.some((span,index)=>index&&spans[index-1].end>span.start))return null;
  const whole=shape?quoted[0]:null,runs=[],gap=(from,to)=>{if(to>from)runs.push({text:wording.slice(from,to),part:whole?whole.number:null,bracketed:false});};
  let at=0;
  for(const span of spans) {
    gap(at,span.start);
    runs.push({text:wording.slice(span.start,span.end),part:span.part,bracketed:true});
    at=span.end;
  }
  gap(at,wording.length);
  // The whole part's description shortens only when its quote ends it: nothing else would be lost.
  const lead=whole&&!whole.read.after.trim()?whole.read.before.replace(/[\s:]+$/u,''):null;
  return {runs,whole:whole?{number:whole.number,lead,other:spans[0].part}:null};
}
/** The parts' descriptions in one language, or null when any part lacks it: never across languages. */
export function partsInLanguage(parts,language) {
  const rows=(parts||[]).map(part=>({number:part.number,description:part.contentByLanguage?.[language]?.text??null}));
  return rows.length&&rows.every(row=>typeof row.description==='string'&&row.description.trim())?rows:null;
}
/** A part's result as one whole sentence, from the same fields on a vote row and an amendment row. */
export function partResult(result) {
  if(!result)return null;
  if(result.ballotStatus==='not-conducted'||result.outcome==='LAPSED')return {id:result.outcome==='LAPSED'?'votepage.key.lapsed':'votepage.key.not_held',values:{}};
  const outcome=result.outcome==='ADOPTED'?'adopted':result.outcome==='REJECTED'?'rejected':null;
  if(!outcome)return null;
  const totals=result.totals||{};
  if(['for','against','abstaining'].every(key=>Number.isFinite(totals[key])))return {id:'votepage.key.'+outcome+'.tally',values:{for:totals.for,against:totals.against,abstaining:totals.abstaining}};
  return {id:'votepage.key.'+outcome+(result.method==='VOTE_HAND'?'.hands':''),values:{}};
}
