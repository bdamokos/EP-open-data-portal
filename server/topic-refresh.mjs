import {parseProcedureProgressPage} from './official-context.mjs';
const DAY=86400_000,values=v=>v==null?[]:Array.isArray(v)?v.flatMap(values):[typeof v==='object'?v.id||v.label||'':v];
export function procedurePageHints(html,reference,now=Date.now()){
 try{const p=parseProcedureProgressPage(html,reference,'en',{limit:Number.MAX_SAFE_INTEGER});return {status:p.status,lastActivity:p.events.map(e=>e.date).filter(d=>d&&Date.parse(d)<=now).sort().at(-1)||null};}catch{return {};}
}
export function procedureRefresh(metadata={},page={},now=Date.now()){
 const events=metadata.consists_of==null?[]:Array.isArray(metadata.consists_of)?metadata.consists_of:[metadata.consists_of];
 const latest=events.filter(e=>e.activity_date&&Date.parse(e.activity_date)<=now).sort((a,b)=>b.activity_date.localeCompare(a.activity_date))[0];
 const terminal=input=>{const codes=values(input).map(v=>String(v).split('/').at(-1));return codes.length>0&&codes.every(s=>['COMPLETED','CLOSED','PROCEDURE_COMPLETED','PROCEDURE_ENDED','Procedure completed'].includes(s));};
 const completed=page.status?.label==='Procedure completed'||terminal([metadata.process_status,metadata.procedure_status,metadata.status])||terminal([metadata.stage,metadata.process_stage,latest?.occured_at_stage]);
 const dates=[page.lastActivity,...events.map(e=>e.activity_date)].filter(d=>/^\d{4}-\d{2}-\d{2}/.test(d)&&Number.isFinite(Date.parse(d))&&Date.parse(d)<=now).sort(),last=dates.at(-1),four=new Date(now),year=new Date(now);four.setUTCMonth(four.getUTCMonth()-4);year.setUTCFullYear(year.getUTCFullYear()-1);
 const freshMs=completed?Infinity:!last?90*DAY:Date.parse(last)>four.getTime()?30*DAY:Date.parse(last)>year.getTime()?90*DAY:180*DAY;
 const read=Date.parse(page.source?.fetchedAt),changed=Boolean(last&&Number.isFinite(read)&&Date.parse(last)>read);
 return {completed,lastActivity:last||null,freshMs,changed,next:completed?null:Number.isFinite(read)?read+freshMs:now+freshMs};
}
