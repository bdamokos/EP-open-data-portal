import {execFileSync} from 'node:child_process';

// Each measurement gets a fresh connection. CLI stats also expose full-scan steps
// without requiring SQLite's optional scanstatus build feature.
export function measureRead(file,sql,attach='') {
  const started=performance.now();
  const output=execFileSync('sqlite3',['-batch','-bail',file],{
    input:`PRAGMA cache_size=-2048; PRAGMA mmap_size=0; ${attach}
.mode json
.explain off
EXPLAIN QUERY PLAN ${sql};
.print --RESULT--
.stats on
${sql};
`,encoding:'utf8',maxBuffer:4*1024*1024,
  });
  const [planOutput,resultOutput]=output.split('--RESULT--\n');
  // PRAGMA mmap_size emits a value before JSON mode is enabled.
  const plan=JSON.parse(planOutput.slice(planOutput.indexOf('['))).map(row=>row.detail);
  const stat=name=>{
    const value=new RegExp(`${name}:\\s+(\\d+)`).exec(resultOutput)?.[1];
    if(value===undefined)throw new Error(`Missing SQLite metric: ${name}`);
    return Number(value);
  };
  const rows=resultOutput.slice(0,resultOutput.indexOf('Memory Used:')).trim();
  const largeTables=new Set(['sources','items','texts','question_files','question_file_sources','question_discovery']);
  const aliases=new Map();
  for(const match of sql.matchAll(/\b(?:FROM|JOIN)\s+(?:\w+\.)?(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)) {
    aliases.set(match[1],match[1]);
    if(match[2])aliases.set(match[2],match[1]);
  }
  const fullScanTables=[...new Set(plan.flatMap(detail=>{
    const table=/^SCAN (?:\w+\.)?(\w+)/.exec(detail)?.[1];
    const resolved=aliases.get(table)??table;
    return largeTables.has(resolved)?[resolved]:[];
  }))].sort();
  return {pageFetches:stat('Page cache misses'),rowsReturned:rows?JSON.parse(rows).length:0,
    fullScanSteps:stat('Fullscan Steps'),plan,fullScanTables,fullScanLargeTable:fullScanTables.length>0,
    wallClockMs:Math.round((performance.now()-started)*100)/100};
}
