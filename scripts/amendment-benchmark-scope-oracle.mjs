import {readFileSync} from 'node:fs';

// Independently transcribed COMPLETE published cells, with native XML paths or
// a visually checked PDF page. No production recognizer, vocabulary or regex.
// Printed labels remain in the keys; only Unicode/whitespace normalization is
// permitted. A sentence containing a note is still legal replacement wording.
const sources=JSON.parse(readFileSync(new URL('./fixtures/amendment-language-scope-oracle.json',import.meta.url),'utf8'));
const key=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
const forms=new Map();
for(const row of sources.forms) {
  const language=forms.get(row.language)||new Set();
  language.add(key(row.cell));forms.set(row.language,language);
}
export function expectedLanguageScope({language,originalText,proposedText}={}) {
  if(typeof originalText!=='string'||typeof proposedText!=='string')return null;
  const vocabulary=forms.get(language);
  if(!vocabulary)return null;
  const fields=Object.entries({originalText,proposedText}).filter(([,value])=>vocabulary.has(key(value))).map(([field])=>field);
  return fields.length?{status:'not-applicable',language,fields}:null;
}

export function verifyLanguageScope(placement,scope) {
  if(!scope)return placement?.status==='not-applicable'
    ?{status:'failed',reason:'oracle-language-scope-mismatch'}:null;
  if(placement?.status==='placed')return {status:'failed',reason:'oracle-language-scope-placement',expectedOperation:'not-applicable',actualOperation:placement.operation};
  // An arbitrary withholding reason does not prove that runtime understood the
  // note. Only an explicit no-change result with no editing coordinates does.
  if(placement?.status==='not-applicable'&&placement.operation===null&&placement.reason==='language_version_unaffected'
    &&!['span','splice','insertBefore','insertAfter'].some(field=>Object.hasOwn(placement,field)))return {status:'verified',reason:'oracle-language-version-unaffected',scope};
  return {status:'unverified',reason:'oracle-language-scope-not-observed',scope};
}
