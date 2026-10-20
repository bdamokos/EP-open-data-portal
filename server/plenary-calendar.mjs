import {CURRENT_TERM_START} from './analysis-period.mjs';
const relative=value=>String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
const tail=value=>String(value?.id||value||'').split('/').at(-1);
export const calendarYears=today=>Array.from({length:Number(today.slice(0,4))-Number(CURRENT_TERM_START.slice(0,4))+1},(_,index)=>Number(CURRENT_TERM_START.slice(0,4))+index);
export const calendarDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
export const calendarMonday=value=>{const day=new Date(value+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);return day.toISOString().slice(0,10);};
export const isPlenarySitting=node=>tail(node.had_activity_type)==='PLENARY_SITTING';
export const identifiedPlenarySitting=node=>/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(node.activity_id||'')&&relative(node.id)==='eli/dl/event/'+node.activity_id&&node.activity_date===node.activity_id.slice(7)&&calendarDate(node.activity_date);
export function currentTermSittings(nodes,today,{heldOnly=true,exactIdentity=true}={}) {return nodes.filter(node=>isPlenarySitting(node)&&(exactIdentity?identifiedPlenarySitting(node):calendarDate(node.activity_date))&&node.activity_date>=CURRENT_TERM_START&&(!heldOnly||node.activity_date<=today));}
export function calendarWeeks(nodes) {
  const weeks=new Map();for(const node of nodes){const week=calendarMonday(node.activity_date);if(!weeks.has(week))weeks.set(week,new Map());weeks.get(week).set(node.activity_id,{sittingId:node.activity_id,date:node.activity_date});}
  return [...weeks].sort(([a],[b])=>b.localeCompare(a)).map(([week,days])=>({week,sittings:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.sittingId.localeCompare(b.sittingId))}));
}
