import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const observations=JSON.parse(readFileSync(new URL('./fixtures/amendment-rejection-oracle.json',import.meta.url)));
const normal=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
// Independent native XML assertion: complete source paragraph, frozen body hash,
// exact amendment identity and language. No runtime recognizer or vocabulary.
export function verifyRejection({id,language,buffer,wording,placement}) {
  const expected=observations.find(row=>row.id===id&&row.language===language);
  if(!expected)return placement?.status==='document-operation'?{status:'unverified',reason:'rejection-source-not-calibrated'}:null;
  const sha256=createHash('sha256').update(buffer).digest('hex');
  if(sha256!==expected.sha256)return {status:'failed',reason:'rejection-source-hash-mismatch'};
  const paragraphs=JSON.parse(execFileSync('python3',['-c',`import sys,io,zipfile,json,xml.etree.ElementTree as E
r=E.fromstring(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).read('word/document.xml'))
n={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
print(json.dumps([''.join(t.text or '' for t in p.findall('.//w:t',n)) for p in r.findall('.//w:p',n)]))`],{input:buffer,maxBuffer:4*1024*1024}));
  const attested=paragraphs[expected.paragraph]===expected.text&&wording.originalText===''&&normal(wording.proposedText)===normal(expected.text);
  if(!attested)return {status:'failed',reason:'rejection-native-wording-mismatch'};
  const observed=placement?.status==='document-operation'&&placement.operation==='reject'&&placement.scope===expected.scope&&!['span','splice','insertAfter','insertBefore'].some(key=>Object.hasOwn(placement,key));
  return {status:observed?'verified':'unverified',reason:observed?'source-attested-rejection':'rejection-not-observed',scope:expected.scope,source:{sha256,path:'word/document.xml',paragraph:expected.paragraph}};
}
