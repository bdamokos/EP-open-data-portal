import {createHash} from 'node:crypto';
import {docxContent} from './document-text.mjs';
export const VOTING_LISTS_VERSION=3;
export const VOTING_LIST_PAGE='https://www.europarl.europa.eu/plenary/en/votes.html';
export const votingDocumentId=value=>{const m=/^([ABC])(\d+)-(\d{4})\/(\d{4})$/.exec(value||'');return m?`${m[1]}-${Number(m[2])}-${m[4]}-${m[3]}`:null;};
const lines=value=>value.split(/\n/).map(s=>s.trim()).filter(Boolean);
function amendments(value){
  if(!value||!/^[\d\sDcp=,–-]+$/.test(value))return [];
  const result=[];
  for(const token of value.replace(/(\d)[ \t]*[–-][ \t]*(?=\d)/g,'$1-').split(/[\s,=]+/).filter(Boolean)){
    const range=/^(\d+)[–-](\d+)$/.exec(token),one=/^(\d+)(D|cp(\d+))?$/.exec(token);
    if(range){const a=+range[1],b=+range[2];if(b<a||b-a>500)return [];for(let n=a;n<=b;n++)result.push({number:n,cp:null,deleting:false});}
    else if(one)result.push({number:+one[1],cp:one[3]?+one[3]:null,deleting:one[2]==='D'});else return [];
  }return result;
}
function falls(text,motionReferences){
  const m=/^(?:adoption(?: \d+)?|ad\.)\s*=\s*(.*?)\s+falls?$/.exec(text);
  if(/^(?:adoption|ad\.)\s*=\s*MRs replaced$/.test(text))return {amendments:[],motions:[],replacesMotions:true};
  if(!m)return null;
  const fallback={amendments:[],motions:[],replacesMotions:false,text};
  const targets=m[1].replace(/\band\b/g,',');
  if(/^B\d+-/.test(targets)){
    const refs=targets.split(/,\s*/).map(s=>s.trim());
    const motions=refs.map(ref=>{const matches=motionReferences.get(ref);return matches?.size===1?[...matches][0]:null;});
    return motions.every(Boolean)?{amendments:[],motions,replacesMotions:false}:fallback;
  }
  const am=amendments(targets);return am.length?{amendments:am.map(({number,cp})=>({number,cp})),motions:[],replacesMotions:false}:fallback;
}
// Expand physical cells into grid columns; merged continuations remain empty.
function tableRows(table,paragraphs){
  const spans=[];return table.rows.map(cells=>{const row=[];let column=0;
    for(const cell of cells){while(spans[column]>0){row[column]='';column++;}
      const width=cell.colSpan||1;row[column]=paragraphs.slice(cell.start,cell.end).join('\n');
      for(let k=0;k<width;k++){if(k)row[column+k]='';if(cell.rowSpan)spans[column+k]=cell.rowSpan;}column+=width;
    }
    for(let k=0;k<spans.length;k++){if(spans[k]>0){row[k]??='';spans[k]--;}}return row;
  });
}
function parseNotes(raw){
  const notes={withdrawn:[],inadmissible:[],requests:[],votingScheme:[],misc:[],raw};
  let type=null,by=null,request=null,scheme=false,target=null;
  const targets=text=>{
    const out=[];let mode=null;
    for(const token of text.matchAll(/final vote|§\s*\d+|ams?\s*\d+(?:cp\d+)?|\d+(?:cp\d+)?/gi)){
      const s=token[0];if(s==='final vote'){out.push({amendment:null,cp:null,text:null,final:true});continue;}
      if(s.startsWith('§')){mode='text';out.push({amendment:null,cp:null,text:s,final:false});continue;}
      if(/^am/i.test(s))mode='am';const m=/(\d+)(?:cp(\d+))?/.exec(s);
      if(mode)out.push({amendment:mode==='am'?+m[1]:null,cp:m[2]?+m[2]:null,text:mode==='text'?`§ ${m[1]}`:null,final:false});
    }return out;
  };
  for(const line of raw){
    if(/withdrawn|inadmissible/.test(line)){const m=/^Amendments? ([\d, and]+) (?:have|has) been/.exec(line);if(m)notes[/withdrawn/.test(line)?'withdrawn':'inadmissible'].push(...m[1].match(/\d+/g).map(Number));}
    const header=/^Requests for (roll-call|separate|split) votes$/.exec(line);
    if(header){type=header[1];scheme=false;by=null;request=null;continue;}
    if(/^Voting scheme/i.test(line)){scheme=true;type=null;target=null;continue;}
    if(/^Miscellaneous/i.test(line)){type=null;scheme=false;}
    const part=/^(\d+)(?:st|nd|rd|th) part\s*:\s*([\s\S]*)$/.exec(line);
    if(part){if(scheme&&target){target.parts.push({index:+part[1],text:part[2],rollCall:/\[ROLL-CALL VOTE\]/.test(part[2])});}else if(request)request.parts.push(part[2]);continue;}
    if(scheme){const t=targets(line)[0];if(t){target={target:{amendment:t.amendment,cp:t.cp,text:t.text},parts:[]};notes.votingScheme.push(target);}continue;}
    if(type){const colon=line.indexOf(':');if(colon>=0){by=line.slice(0,colon).trim();request={type,by,targets:targets(line.slice(colon+1)),parts:[]};notes.requests.push(request);}
      else if(/^(?:Am\b|§)/i.test(line)&&by){request={type,by,targets:targets(line),parts:[]};notes.requests.push(request);}
      else {const m=/^(MEPs)(am\s.*)$/i.exec(line);if(m){request={type,by:m[1],targets:targets(m[2]),parts:[]};notes.requests.push(request);}else {by=line;request=null;}}}
    else notes.misc.push(line);
  }return notes;
}
export function parseVotingList(buffer,{sourceUrl=null,observedAt=new Date().toISOString()}={}){
  const content=docxContent(buffer),table=content.tables[0];if(!table)throw new Error('Voting list table unavailable.');
  const grid=tableRows(table,content.paragraphs),start=Math.min(...table.rows[0].map(c=>c.start)),end=Math.max(...table.rows.flat().map(c=>c.end));
  const pre=content.paragraphs.slice(0,start).map(s=>s.replace(/\t/g,' ').trim()),header=pre.join('\n');
  const primary=grid.flat().find(s=>/^Motion for a resolution /.test(s));
  const reference=(header.match(/\b[ABC]\d+-\d{4}\/\d{4}\b/)||primary?.match(/\b[ABC]\d+-\d{4}\/\d{4}\b/))?.[0]||null;
  const documentId=/RC[- ]/.test(header+' '+primary)?null:votingDocumentId(reference),gaps=[];if(!documentId)gaps.push({code:'unparsed-reference',message:'Document reference unavailable.'});
  const kind=/Report:/.test(header)?'report':/Resolutions:/.test(header)?'resolutions':/Proposal:/.test(header)?'proposal':'other';
  const h=pre.findIndex(s=>/^(Report|Resolutions|Proposal):/.test(s));
  const rows=[];let subject=[],parent=null,competing=false;
  for(const cells of grid.slice(1)){
    const row=rows.length+1,first=cells[0]||'',short=cells.length===4;
    const am=short?'':cells[1]||'',author=short?'':cells[2]||'',rcv=cells[short?1:3]||'',remarks=cells[short?3:5]||null;
    if(first)subject=lines(first);
    let kind='unrecognised',label=null,part=null,parentRow=null,ams=amendments(am),authors=lines(author),motion=null;
    if(table.rows[row].length===1){kind='heading';label=first;competing=/Motions for resolutions by political groups/.test(first);parent=null;}
    else if(!am&&/^oral amendment$/i.test(remarks||'')){kind='oral';label=remarks;parent=null;}
    else if(/^single vote$/i.test(first)){kind='final';label=first;parent=null;}
    else if(/^(?:Rejection|Procedural motion)$/i.test(first)){kind='procedural';label=first;parent=null;}
    else if(/^vote:/i.test(first)){kind=/referral back|urgent decision|reject/i.test(first)?'procedural':'final';label=first;parent=null;}
    else if(competing&&(motion=votingDocumentId(first.trim()))){kind='motion';parent=null;}
    else if(am==='§'&&author==='original text')kind='text';
    else if(ams.length)kind=/block vote/i.test(first)?'block':'amendment';
    else if(!am&&!author&&/^\d+(?:\s+RCV)?$/.test(rcv)&&parent){kind=parent.kind;ams=parent.amendments;authors=parent.authors;part=+rcv.match(/^\d+/)[0];parentRow=parent.row;}
    if(kind==='unrecognised')gaps.push({code:'unrecognised-row',message:`Row ${row} could not be classified.`});
    const result={row,kind,subject:[...subject],amendments:ams,identical:am.includes('=')||Boolean(part&&parent?.identical),authors,vote:{rollCall:/\bRCV\b/.test(rcv),split:rcv==='split',separate:rcv==='separate'},part,parentRow,motion,label,falls:null,remarks,cells};
    rows.push(result);if(result.vote.split)parent=result;else if(!part)parent=null;
  }
  // Short fall-rule references must resolve to a full motion in this table.
  const motionReferences=new Map();
  for(const row of rows.filter(row=>row.kind==='motion'))for(const ref of [row.cells[0].trim(),row.cells[0].trim().split('/')[0]]){
    if(!motionReferences.has(ref))motionReferences.set(ref,new Set());motionReferences.get(ref).add(row.motion);
  }
  for(const row of rows)if(row.remarks)row.falls=falls(row.remarks,motionReferences);
  const versionLabel=pre.find(s=>/^(FINAL VERSION(?:\/\d+)?|initial)$/.test(s))||null;
  return {sittingId:null,documentId,documentReference:reference,agendaItemId:null,heading:{kind,rapporteur:kind==='report'?pre[h].replace(/^Report:\s*/,'').split('(')[0].trim():null,procedureMark:header.match(/\[([^\]]+)\]/)?.[1]||null,title:kind==='resolutions'?pre[h].replace(/^Resolutions:\s*/,''):pre[h+1]||null,committee:pre.find(s=>s.startsWith('Committee:'))?.replace(/^Committee:\s*/,'')||null},versionLabel,revision:{sha256:createHash('sha256').update(buffer).digest('hex'),observedAt,etag:null,lastModified:null,sourceUrl,pageUrl:VOTING_LIST_PAGE,linkVersion:null},revisions:[],rows,notes:parseNotes(content.paragraphs.slice(end)),gaps};
}
