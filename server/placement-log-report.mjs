import {existsSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {absolutePathFromEnvironment} from './config.mjs';

const OURS='withheld-pipeline';
const counts=value=>JSON.parse(value||'{}');
const weekOf=value=>{const date=new Date(Date.parse(value));date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);return date.toISOString().slice(0,10);};
const share=(placed,unplaced)=>placed+unplaced?(100*placed/(placed+unplaced)).toFixed(1)+'%':'-';
const table=rows=>{
  const widths=rows[0].map((_,index)=>Math.max(...rows.map(row=>String(row[index]).length)));
  const numeric=rows[1]?.map(cell=>typeof cell==='number'||/%$|^-$/.test(cell))||[];
  return rows.map(row=>row.map((cell,index)=>numeric[index]?String(cell).padStart(widths[index]):String(cell).padEnd(widths[index])).join('  ').trimEnd());
};

// Everything is read from one read-only connection; no route or writer is involved.
export function placementLogReport(db,{since}) {
  const lines=[`Placement log, new since ${since}`];
  const ready=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='placement_log_failures'").get();
  if(!ready)return [...lines,'The log has not started: no writer has opened this database yet.'].join('\n');
  const lists=db.prepare('SELECT * FROM placement_log_lists WHERE first_seen>=? ORDER BY first_seen,list_id').all(since).filter(list=>list.state!=='baseline');
  const older=db.prepare("SELECT COUNT(*) n FROM placement_log_lists WHERE state='baseline'").get().n;
  const stateCount=state=>lists.filter(list=>list.state===state).length;
  lines.push(`Lists first seen: ${lists.length} (evaluated ${stateCount('evaluated')}, waiting ${stateCount('pending')}, could not evaluate ${stateCount('failed')}). Older lists not logged: ${older}.`);
  const failures=db.prepare('SELECT * FROM placement_log_failures WHERE first_seen>=? ORDER BY list_id,reason,amendment_id').all(since);
  const ours=failures.filter(row=>row.outcome===OURS),others=failures.filter(row=>row.outcome!==OURS);
  const summary=rows=>{
    const groups=new Map();
    for(const row of rows){const group=groups.get(row.reason)||{outcome:row.outcome,reason:row.reason,lists:new Set(),open:0,stopped:0};group.lists.add(row.list_id);row.stopped_at?group.stopped++:group.open++;groups.set(row.reason,group);}
    return [...groups.values()].sort((a,b)=>b.open+b.stopped-a.open-a.stopped||a.reason.localeCompare(b.reason,'en'));
  };
  lines.push('','New placement failures, by reason');
  if(ours.length)lines.push(...table([['reason','open','stopped','lists'],...summary(ours).map(group=>[group.reason,group.open,group.stopped,group.lists.size])]).map(line=>'  '+line));
  else lines.push('  None.');
  lines.push('','New placement failures, by list');
  if(!ours.length)lines.push('  None.');
  const byList=new Map();for(const row of ours){const list=byList.get(row.list_id)||[];list.push(row);byList.set(row.list_id,list);}
  for(const [listId,rows] of byList) {
    const saved=db.prepare('SELECT document_id,counts FROM placement_log_lists WHERE list_id=?').get(listId);
    lines.push(`  ${listId} (${saved?.document_id??rows[0].document_id}): ${rows.filter(row=>!row.stopped_at).length} open of ${counts(saved?.counts).amendments??rows.length} amendments`);
    const reasons=new Map();for(const row of rows){const reason=reasons.get(row.reason)||[];reason.push(row);reasons.set(row.reason,reason);}
    for(const [reason,entries] of reasons)lines.push(`    ${reason}: ${entries.map(row=>row.amendment_id+(row.language?'/'+row.language:'')+(row.stopped_at?' (stopped '+row.stopped_at.slice(0,10)+')':'')).join(' ')}`);
  }
  lines.push('','Not placement failures: source or wording not available');
  if(others.length)lines.push(...table([['outcome','reason','open','stopped','lists'],...summary(others).map(group=>[group.outcome,group.reason,group.open,group.stopped,group.lists.size])]).map(line=>'  '+line));
  else lines.push('  None.');
  const failed=lists.filter(list=>list.state==='failed');
  if(failed.length)lines.push('','Could not evaluate',...failed.map(list=>`  ${list.list_id}: ${list.error}`));
  const dropped=db.prepare('SELECT COALESCE(SUM(dropped),0) n FROM placement_log_lists').get().n;
  if(dropped)lines.push('',`The log reached its row limit: ${dropped} failures were counted but not recorded.`);
  // Every evaluated list, not only those in the window: a percentage over time.
  const weeks=new Map();
  for(const list of db.prepare("SELECT first_evaluated,first_counts,counts FROM placement_log_lists WHERE state='evaluated' AND first_evaluated IS NOT NULL").all()) {
    const week=weekOf(list.first_evaluated),entry=weeks.get(week)||{lists:0,amendments:0,placed:0,na:0,unplaced:0,notHeld:0,firstPlaced:0,firstUnplaced:0};
    const now=counts(list.counts),first=counts(list.first_counts);
    entry.lists++;entry.amendments+=now.amendments||0;entry.placed+=now.placed||0;entry.na+=now['not-applicable']||0;entry.unplaced+=now[OURS]||0;entry.notHeld+=(now['acquisition-unavailable']||0)+(now['withheld-source']||0);
    entry.firstPlaced+=first.placed||0;entry.firstUnplaced+=first[OURS]||0;
    weeks.set(week,entry);
  }
  lines.push('','Placed and unplaced, by the week a list was first evaluated');
  if(weeks.size)lines.push(...table([['week of','lists','amendments','placed','n/a','unplaced','not held','placed now','at first sight'],...[...weeks].sort(([a],[b])=>a<b?1:-1).map(([week,entry])=>[week,entry.lists,entry.amendments,entry.placed,entry.na,entry.unplaced,entry.notHeld,share(entry.placed,entry.unplaced),share(entry.firstPlaced,entry.firstUnplaced)])]).map(line=>'  '+line));
  else lines.push('  None yet.');
  return lines.join('\n');
}

export function reportOptions(args,{clock=Date.now}={}) {
  const options={since:new Date(clock()-7*86400_000).toISOString().slice(0,10),directory:absolutePathFromEnvironment('ACTIVITY_INDEX_DIR')||null};
  for(let index=0;index<args.length;index+=2) {
    const [name,value]=[args[index],args[index+1]];
    if(name==='--since'&&/^\d{4}-\d{2}-\d{2}$/.test(value||''))options.since=value;
    else if(name==='--index-dir'&&value)options.directory=path.resolve(value);
    else throw new Error('Usage: node server/placement-log-report.mjs [--since YYYY-MM-DD] [--index-dir DIR]');
  }
  if(!options.directory)throw new Error('Set ACTIVITY_INDEX_DIR or pass --index-dir.');
  return options;
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href) {
  try {
    const {since,directory}=reportOptions(process.argv.slice(2));
    const filename=path.join(directory,'activities-v1.sqlite');
    if(!existsSync(filename))throw new Error('No activity index at '+directory+'.');
    const db=new DatabaseSync(filename,{readOnly:true});
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=250;');
    console.log(placementLogReport(db,{since}));
    db.close();
  }catch(error){console.error(error.message);process.exitCode=1;}
}
