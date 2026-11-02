// Raw proposal rows only (no parsed units or placement evidence): in an
// article's numbered paragraph, the lead row and its points form the first
// subparagraph, and each later unlabelled row starts the next one. A new
// "subparagraph N a" follows subparagraph N.
const pointRow=text=>/^\(?(?:[a-z]{1,2}|[ivx]+)\)\s/u.test(text.trim());
export function assertSubparagraphOrdinal({proposal,target,placement}){
 const unknown=()=>({status:'unverified',reason:'oracle-subparagraph-ordinal-unavailable'});
 const [article,paragraph,label]=target?.segments??[];
 if(!proposal||placement.operation!=='insert'||target.segments.length!==3||article?.kind!=='article'||article.isNew||paragraph?.kind!=='paragraph'||paragraph.isNew||paragraph.suffix
  ||label?.kind!=='subparagraph'||!label.isNew||!/^[a-z]$/u.test(label.suffix??'')||!(label.number>=1))return unknown();
 // A heading row may carry its title on a second line ("Article 22\nSanctions").
 const firstLine=p=>p.text.trim().split(/\r?\n/u)[0].replace(/\s+/gu,' ').trim();
 const rows=proposal.paragraphs.filter(p=>p.source?.container==='body');
 // Rows inside a quotation (from a leading ‘ to a closing ’) belong to an
 // amended act, never to the proposal's own article.
 const quoted=new Set();let open=false;
 for(const row of rows){
  const text=row.text.trim();if(/^‘/u.test(text))open=true;
  if(open)quoted.add(row);
  if(open&&/’[;.,]?\s*$/u.test(text))open=false;
 }
 // A proposal's own articles run 1, 2, 3, … in order. A quoted article of an
 // amended act (Article 21 inside Article 1) breaks that sequence however its
 // quotation marks are printed, so any break leaves the address unverified.
 const numbers=rows.flatMap(p=>{const m=/^Article (\d+)([a-z]*)$/u.exec(firstLine(p));return m?[m[2]?NaN:Number(m[1])]:[];});
 if(!numbers.length||numbers.some((n,i)=>n!==i+1))return unknown();
 const heads=rows.filter(p=>firstLine(p)==='Article '+article.value);
 if(heads.length!==1||quoted.has(heads[0]))return unknown();
 let body=rows.slice(rows.indexOf(heads[0])+1);
 // A heading is the whole first line: a number, optionally a dash and an
 // upper-case title. "CHAPTER II shall apply …" is prose.
 const structural=p=>/^Article \d+[a-z]*$/u.test(firstLine(p))
  ||/^(?:CHAPTER|TITLE|SECTION|PART|ANNEX|Chapter|Title|Section|Part|Annex)(?:\s+[IVXLC\d]+[A-Za-z]?)?(?:\s*[–-]\s*[\p{Lu}\d][\p{Lu}\d\s,'’()-]*)?$/u.test(firstLine(p));
 const next=body.findIndex(structural);if(next>=0)body=body.slice(0,next);
 if(body.some(p=>quoted.has(p)))return unknown();
 const leads=body.filter(p=>new RegExp(`^${paragraph.value}\\.\\s`,'u').test(p.text.trim()));
 if(leads.length!==1)return unknown();
 let block=body.slice(body.indexOf(leads[0]));
 const after=block.findIndex((p,i)=>i&&/^\d+[a-z]*\.\s/u.test(p.text.trim()));if(after>=0)block=block.slice(0,after);
 if(block.some((p,i)=>p.complete===false||p.source?.complete===false||i&&p.index!==block[i-1].index+1))return unknown();
 const starts=block.flatMap((p,i)=>!i||!pointRow(p.text)?[i]:[]);
 // Points after a later subparagraph would make its extent depend on layout.
 if(starts.slice(1).some((start,k)=>block.slice(start+1,starts[k+2]??block.length).some(p=>pointRow(p.text))))return unknown();
 if(label.number>starts.length)return unknown();
 // No quotation may open between Article 1 and the end of the target block:
 // a row that opens more ‘ than it closes (’ not followed by a letter) starts an
 // amended act's text, wherever on the row it is printed. Balanced defined
 // terms pass; possessive apostrophes only add closings.
 // From the enacting formula to the end of the target block, every opening
 // quotation mark must close on its own row within a defined-term span, and
 // straight double quotes must pair. Anything left open is quoted amended
 // text, wherever it opens and whatever apostrophes precede it.
 const first=rows.findIndex(p=>firstLine(p)==='Article 1'),endIndex=block.at(-1).index;
 // Each opening needs its own closing on the row, and the span must read as a
 // defined term: short, one line, no nested opening and no article heading.
 const term=span=>span.length<=120&&!/[\n\r]/u.test(span)&&!/Article\s+\d/u.test(span);
 const leftOpen=text=>{
  for(const [open,close] of [['‘','’'],['“','”'],['«','»']]){
   for(let at=text.indexOf(open);at>=0;at=text.indexOf(open,at+1)){
    const end=text.indexOf(close,at+1),span=end<0?'':text.slice(at+1,end);
    if(end<0||span.includes(open)||!term(span))return true;
   }
  }
  const straight=text.split('"');
  return straight.length%2===0||straight.some((span,i)=>i%2===1&&!term(span));
 };
 // Also the earlier count from Article 1: a row opening more ‘ than it closes.
 const opensMore=p=>(p.text.match(/‘/gu)??[]).length>(p.text.match(/’(?!\p{L})/gu)??[]).length;
 // The enacting terms start after the one enacting formula; the explanatory
 // memorandum and recitals before it are not scanned.
 const formulas=proposal.paragraphs.filter(p=>/^HA(?:VE|S) ADOPTED THIS\b/u.test(p.text.trim()));
 if(formulas.length!==1||formulas[0].index>=heads[0].index||first<0||first>rows.indexOf(heads[0])
  ||rows.slice(first,rows.indexOf(block.at(-1))+1).some(opensMore)
  ||proposal.paragraphs.some(p=>p.index>=formulas[0].index&&p.index<=endIndex&&leftOpen(p.text)))return unknown();
 // An article printed after an ANNEX heading in the same item is annex text.
 if(rows.slice(0,rows.indexOf(heads[0])).some(p=>/^ANNEX\b/iu.test(firstLine(p))))return unknown();
 // A row after a list starts a subparagraph only after a full stop, with a capital.
 const listEnd=starts[1]&&pointRow(block[starts[1]-1].text);
 if(listEnd&&(!/\.\s*$/u.test(block[starts[1]-1].text)||!/^\p{Lu}/u.test(block[starts[1]].text.trim())))return unknown();
 const before=label.number<starts.length?block[starts[label.number]].index:block.at(-1).index+1;
 return placement.insertBefore===before&&placement.insertAfter===before-1
  ?{status:'verified',reason:'oracle-subparagraph-ordinal-boundary'}:{status:'failed',reason:'oracle-subparagraph-ordinal-mismatch',expectedBefore:before};
}
