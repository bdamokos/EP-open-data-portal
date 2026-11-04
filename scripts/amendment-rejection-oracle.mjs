import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
const observations=JSON.parse(readFileSync(new URL('./fixtures/amendment-rejection-oracle.json',import.meta.url)));
// Independent, complete sentence assertions. The production recognizer must
// not import this vocabulary or this native-cell reader.
const sentences=JSON.parse(readFileSync(new URL('./fixtures/amendment-rejection-sentences.json',import.meta.url)));
const normal=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
const children=(nodes,name)=>nodes.flatMap(node=>node[name]?[node[name]]:[]);
const descendants=(nodes,name)=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>key===name?[value]:Array.isArray(value)?descendants(value,name):[]));
const nativeText=nodes=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>key==='w:t'?value.map(v=>v['#text']??''):Array.isArray(value)?[nativeText(value)]:[])).join('');
export function nativeRejectionCell(buffer,id,language='en') {
  const identity=/^A-(\d+)-(\d{4})-(\d{4})-AM-([1-9]\d*)$/u.exec(id||'');
  if(!identity)return null;
  let body;try{body=quotedWordBody(buffer);}catch{return null;}
  const [,term,year,report,number]=identity;
  const starts=body.flatMap((row,index)=>row.kind==='paragraph'&&row.text.includes('<Amend>')&&row.text.includes(`<ANo>A${term}-${report}</ANo>`)&&row.text.includes(`<NumAm>${number}</NumAm>`)?[index]:[]);
  if(starts.length!==1)return null;
  const start=starts[0],end=body.findIndex((row,index)=>index>start&&row.kind==='paragraph'&&row.text.includes('</Amend>'));
  if(end<0)return null;
  const rows=body.slice(start,end+1),paragraphs=rows.filter(row=>row.kind==='paragraph');
  // EP's identity/template tags are hidden runs. They bind identity, while
  // the comparison table itself must contain only visible legal wording.
  const reportToken=new RegExp(`(?:^|>|\\s)A${term}-${report}/${year}(?:$|<|\\s)`,'u');
  if(paragraphs.some(row=>row.unsafe)||paragraphs.slice(1).some(row=>row.text.includes('<Amend>'))||!paragraphs.some(row=>reportToken.test(row.text)))return null;
  const tables=rows.filter(row=>row.kind==='other');
  if(tables.length!==1||tables[0].hidden||!tables[0].nodes['w:tbl'])return null;
  const table=tables[0].nodes['w:tbl'];
  if(descendants(table,'w:tbl').length||['w:vMerge','w:hMerge','w:del','w:moveFrom','w:vanish','w:webHidden','w:instrText','w:fldChar','w:drawing','w:object','w:pict','m:oMath'].some(name=>descendants(table,name).length))return null;
  const tableRows=children(table,'w:tr');
  // The template's empty, full-width first row is layout only. It may not
  // hide any wording or absorb either comparison column.
  const first=tableRows[0],firstCells=first&&children(first,'w:tc');
  if(firstCells?.length===1&&!nativeText(first).trim()&&descendants(first,'w:gridSpan').length===1&&firstCells[0].some(node=>node['w:tcPr']?.some(prop=>prop['w:gridSpan']&&prop[':@']?.['@_w:val']==='2')))tableRows.shift();
  if(tableRows.some(row=>descendants(row,'w:gridSpan').length))return null;
  const grid=tableRows.map(row=>children(row,'w:tc').map(cell=>children(cell,'w:p').map(nativeText).join('\n')));
  if(grid.length<2||grid.some(row=>row.length!==2))return null;
  const rejectionHeadings={en:'Proposal for rejection',cs:'Návrh na zamítnutí',fr:'Proposition de rejet',it:'Proposta di reiezione'};
  const heading=grid[0].map(normal);
  if(!heading[1]||!heading[0]&&heading[1]!==rejectionHeadings[language])return null;
  return {original:normal(grid.slice(1).map(row=>row[0]).join('\n')),proposed:normal(grid.slice(1).map(row=>row[1]).join('\n')),path:paragraphs[0].path};
}
function verifySentence({id,language,buffer,wording,placement}) {
  const index=typeof wording?.proposedText==='string'?sentences[language]?.indexOf(normal(wording.proposedText)):-1;
  if(index===undefined||index<0)return null;
  const scope=index>=2?'council-position':'commission-proposal',cell=nativeRejectionCell(buffer,id,language);
  if(!cell||cell.original!==''||wording.originalText!==''||cell.proposed!==normal(wording.proposedText))return {status:'unverified',reason:'rejection-native-cell-unverified'};
  const observed=placement?.status==='document-operation'&&placement.operation==='reject'&&placement.scope===scope&&!['span','splice','insertAfter','insertBefore'].some(key=>Object.hasOwn(placement,key));
  return {status:observed?'verified':'unverified',reason:observed?'source-attested-rejection':'rejection-not-observed',scope,source:{sha256:createHash('sha256').update(buffer).digest('hex'),path:'word/document.xml',amendmentPath:cell.path,assertion:'complete-native-comparison-cells',originalText:cell.original,proposedText:cell.proposed}};
}
// Independent native XML assertion: complete source paragraph, frozen body hash,
// exact amendment identity and language. No runtime recognizer or vocabulary.
export function nativeRejectionParagraphs(buffer,{temporaryRoot=tmpdir()}={}) {
  const directory=mkdtempSync(join(temporaryRoot,'ep-rejection-native-'));
  try {
    const filename=join(directory,'source.docx');
    writeFileSync(filename,buffer,{flag:'wx',mode:0o600});
    return JSON.parse(execFileSync('python3',['-c',`import sys,zipfile,json,xml.etree.ElementTree as E
with zipfile.ZipFile(sys.argv[1]) as source: r=E.fromstring(source.read('word/document.xml'))
n={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
print(json.dumps([''.join(t.text or '' for t in p.findall('.//w:t',n)) for p in r.findall('.//w:p',n)]))`,filename],{maxBuffer:4*1024*1024,timeout:30_000,stdio:['ignore','pipe','pipe']}));
  } finally {rmSync(directory,{recursive:true,force:true});}
}
export function verifyRejection({id,language,buffer,wording,placement}) {
  const expected=observations.find(row=>row.id===id&&row.language===language);
  if(!expected)return verifySentence({id,language,buffer,wording,placement})??(placement?.status==='document-operation'?{status:'unverified',reason:'rejection-source-not-calibrated'}:null);
  const sha256=createHash('sha256').update(buffer).digest('hex');
  if(sha256!==expected.sha256)return {status:'failed',reason:'rejection-source-hash-mismatch'};
  const paragraphs=nativeRejectionParagraphs(buffer);
  const attested=paragraphs[expected.paragraph]===expected.text&&wording.originalText===''&&normal(wording.proposedText)===normal(expected.text);
  if(!attested)return {status:'failed',reason:'rejection-native-wording-mismatch'};
  const observed=placement?.status==='document-operation'&&placement.operation==='reject'&&placement.scope===expected.scope&&!['span','splice','insertAfter','insertBefore'].some(key=>Object.hasOwn(placement,key));
  return {status:observed?'verified':'unverified',reason:observed?'source-attested-rejection':'rejection-not-observed',scope:expected.scope,source:{sha256,path:'word/document.xml',paragraph:expected.paragraph}};
}
