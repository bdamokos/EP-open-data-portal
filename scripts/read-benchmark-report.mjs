import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {compareReads} from './read-benchmark.mjs';

// Hidden marker used to find and update the existing PR comment.
export const reportMarker='<!-- read-benchmark-report -->';

const cell=value=>String(value).replaceAll('|','\\|');
const signed=value=>value>0?`+${value}`:String(value);

function delta(before,after) {
  if(before===undefined||after===undefined)return '—';
  const change=after-before;
  if(!change)return '0';
  return `${signed(change)} (${before?`${signed((change/before*100).toFixed(1))}%`:'new'})`;
}

function planStatus(before,after) {
  if(!before)return 'new scenario';
  if(!after)return 'removed';
  if(after.fullScanTables.some(table=>!before.fullScanTables.includes(table)))return '**new full scan**';
  return JSON.stringify(before.plan)===JSON.stringify(after.plan)?'unchanged':'changed';
}

export function readBenchmarkRows(before,after) {
  const previous=new Map((before?.scenarios??[]).map(row=>[row.name,row]));
  const rows=(after?.scenarios??[]).map(row=>({name:row.name,before:previous.get(row.name),after:row}));
  const current=new Set(rows.map(row=>row.name));
  for(const [name,row] of previous)if(!current.has(name))rows.push({name,before:row,after:undefined});
  return rows.map(row=>{
    const plan=planStatus(row.before,row.after);
    return {...row,plan,changed:plan!=='unchanged'||row.before.pageFetches!==row.after.pageFetches};
  });
}

function table(rows,{beforeLabel,afterLabel}) {
  const lines=[`| Scenario | ${beforeLabel} pages | ${afterLabel} pages | Δ pages | ${afterLabel} ms | Plan |`,'| --- | ---: | ---: | ---: | ---: | --- |'];
  for(const {name,before,after,plan} of rows)
    lines.push(`| ${cell(name)} | ${before?.pageFetches??'—'} | ${after?.pageFetches??'—'} | ${delta(before?.pageFetches,after?.pageFetches)} | ${after?.wallClockMs??'—'} | ${plan} |`);
  return lines.join('\n');
}

/**
 * Differences that a baseline refresh must not absorb: any page growth, a newly
 * scanned table, a toolchain change, or a scenario added or removed. Only
 * improvements and plan changes without growth may be refreshed automatically.
 */
export function baselineRegressions(before,after) {
  if(!before)return ['No committed baseline to compare with.'];
  if(!after)return ['The benchmark did not produce results.'];
  const regressions=[];
  for(const key of ['sqliteVersion','nodeSqliteVersion'])
    if(before[key]!==after[key])regressions.push(`Toolchain changed (${key}): ${before[key]??'missing'} → ${after[key]??'missing'}`);
  for(const {name,before:old,after:current} of readBenchmarkRows(before,after)) {
    if(!old)regressions.push(`${name}: scenario has no committed baseline`);
    else if(!current)regressions.push(`${name}: scenario missing from main`);
    else {
      if(current.pageFetches>old.pageFetches)regressions.push(`${name}: page fetches ${old.pageFetches} → ${current.pageFetches}`);
      const scans=current.fullScanTables.filter(table=>!old.fullScanTables.includes(table));
      if(scans.length)regressions.push(`${name}: new full scan of ${scans.join(', ')}`);
    }
  }
  return regressions;
}

/**
 * Markdown report comparing a reference read benchmark (usually main's committed
 * baseline) with a fresh run. `gateBaseline` adds the CI gate verdict;
 * `regressions` adds a list from baselineRegressions.
 */
export function renderReadBenchmarkReport({before,after,gateBaseline,regressions,beforeLabel='Before',afterLabel='After',title='Read benchmark',runUrl}) {
  const out=[reportMarker,`### ${title}`,''];
  const footer=runUrl?['',`[Workflow run](${runUrl})`]:[];
  if(!after) return [...out,'The benchmark did not produce results.',...footer].join('\n')+'\n';

  const gate=gateBaseline?compareReads(gateBaseline,after):undefined;
  const rows=readBenchmarkRows(before,after);
  const changed=rows.filter(row=>row.changed);
  const totals=rows.reduce((sum,row)=>({before:sum.before+(row.before?.pageFetches??0),after:sum.after+(row.after?.pageFetches??0)}),{before:0,after:0});
  const facts=[
    gate?(gate.failures.length?`**Gate failed** (${gate.failures.length})`:'**Gate passed**'):undefined,
    regressions?(regressions.length?`**Regressions** (${regressions.length})`:'**No regressions**'):undefined,
    `${rows.length} scenarios`,
    `${changed.length} changed`,
    before?`total pages ${totals.before} → ${totals.after}${totals.before&&totals.after!==totals.before?` (${signed(((totals.after-totals.before)/totals.before*100).toFixed(1))}%)`:''}`:undefined,
  ].filter(Boolean);
  out.push(facts.join(' · '),'');
  if(!before)out.push(`No ${beforeLabel} baseline was available.`,'');

  out.push(changed.length?table(changed,{beforeLabel,afterLabel}):'No page-count or query-plan changes.','');
  out.push(`<details><summary>All ${rows.length} scenarios</summary>`,'',table(rows,{beforeLabel,afterLabel}),'','</details>');
  if(gate?.failures.length)out.push('','**Gate failures**','',...gate.failures.map(message=>`- ${message}`));
  if(regressions?.length)out.push('','**Regressions**','',...regressions.map(message=>`- ${message}`));
  out.push('','Pages are SQLite page fetches and are deterministic. Times are from this run only and vary between runners.');
  return [...out,...footer].join('\n')+'\n';
}

function readJson(file) {
  if(!file||!existsSync(file))return undefined;
  const text=readFileSync(file,'utf8');
  return text.trim()?JSON.parse(text):undefined;
}

export function main(args=process.argv.slice(2)) {
  const options={},checkRegressions=args.includes('--check-regressions');
  args=args.filter(arg=>arg!=='--check-regressions');
  const known=new Set(['before','after','gate-baseline','before-label','after-label','title','run-url']);
  for(let index=0;index<args.length;index+=2) {
    const key=args[index]?.replace(/^--/,'');
    if(!args[index]?.startsWith('--')||!known.has(key)||args[index+1]===undefined)
      throw new Error('Usage: node scripts/read-benchmark-report.mjs --after RESULT.json [--before BASELINE.json] [--gate-baseline BASELINE.json] [--before-label TEXT] [--after-label TEXT] [--title TEXT] [--run-url URL] [--check-regressions]');
    options[key]=args[index+1];
  }
  const before=readJson(options.before),after=readJson(options.after);
  const regressions=checkRegressions?baselineRegressions(before,after):undefined;
  process.stdout.write(renderReadBenchmarkReport({
    before,
    after,
    regressions,
    gateBaseline:readJson(options['gate-baseline']),
    beforeLabel:options['before-label'],
    afterLabel:options['after-label'],
    title:options.title,
    runUrl:options['run-url'],
  }));
  // Exit 1 lets the weekly refresh fail instead of proposing a regressed baseline.
  if(regressions?.length)process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main();
