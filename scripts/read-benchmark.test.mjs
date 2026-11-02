import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {benchmarkIdentity,benchmarkCacheKey,stageBenchmarkResult} from './read-benchmark-cache.mjs';
import {compareReads,measureReference,main} from './read-benchmark.mjs';
import {measureRead} from '../server/test-support/read-benchmark-metrics.mjs';

const row=(overrides={})=>({name:'example',pageFetches:100,plan:['SEARCH items USING INDEX lookup (mep=?)'],fullScanTables:[],wallClockMs:1,...overrides});
const profile={sqliteVersion:'pinned',nodeVersion:'v26.12.1',nodeSqliteVersion:'pinned'};
const compare=(old,current)=>compareReads({...profile,scenarios:[old]},{...profile,scenarios:[current]});
test('read gate tolerates slack, improvements, timing noise and non-scan plan changes',()=>{
  for(const overrides of [{pageFetches:130},{pageFetches:1},{wallClockMs:999999},{plan:['SEARCH items USING INDEX another (mep=?)']}])
    assert.deepEqual(compare(row(),row(overrides)).failures,[]);
  assert.match(compare(row(),row({pageFetches:80})).markdown,/-20/);
});
test('read gate catches page growth and newly scanned tables independently',()=>{
  assert.equal(compare(row(),row({pageFetches:131})).failures.length,1);
  assert.equal(compare(row(),row({fullScanTables:['items']})).failures.length,1);
  assert.equal(compare(row({fullScanTables:['items']}),row({fullScanTables:['items','sources']})).failures.length,1);
  assert.deepEqual(compare(row({fullScanTables:['items']}),row({fullScanTables:['items']})).failures,[]);
});
test('new and removed scenarios are informational, invalid scenarios fail',()=>{
  assert.equal(compareReads({...profile,scenarios:[row()]},{...profile,scenarios:[]}).failures.length,0);
  assert.equal(compareReads({...profile,scenarios:[]},{...profile,scenarios:[row()]}).failures.length,0);
  assert.throws(()=>compareReads({...profile,scenarios:[]},{...profile,scenarios:[row(),row()]}),/Duplicate/);
  assert.throws(()=>compare(row(),row({pageFetches:NaN})),/Invalid/);
});
test('CLI metrics detect an actual lost index without scanstatus support',t=>{
  try{execFileSync('sqlite3',['--version']);}catch(error){
    if(error.code==='ENOENT'){t.skip('sqlite3 CLI unavailable');return;}throw error;
  }
  const directory=mkdtempSync(path.join(tmpdir(),'read-metrics-test-')),file=path.join(directory,'fixture.sqlite');
  try {
    execFileSync('sqlite3',[file],{input:`CREATE TABLE items(mep TEXT,body TEXT);
      WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000)
      INSERT INTO items SELECT CAST(x AS TEXT),zeroblob(1000) FROM n;
      CREATE INDEX lookup ON items(mep);`});
    const sql="SELECT body FROM items entry WHERE entry.mep='42'";
    const indexed=measureRead(file,sql);
    execFileSync('sqlite3',[file,'DROP INDEX lookup']);
    const scanned=measureRead(file,sql);
    assert.equal(indexed.rowsReturned,1);
    assert.equal(indexed.fullScanLargeTable,false);
    assert.deepEqual(scanned.fullScanTables,['items']);
    assert.ok(scanned.pageFetches>indexed.pageFetches*1.2+10);
    assert.ok(scanned.fullScanSteps>0);
    assert.equal(compare({...indexed,name:'lost-index'},{...scanned,name:'lost-index'}).failures.length,2);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('toolchain differences and timings are informational',()=>{
  const result={...profile,scenarios:[row()]};
  assert.deepEqual(compareReads({...result,sqliteVersion:'other',nodeSqliteVersion:undefined},result).failures,[]);
  assert.match(compare(row(),row({wallClockMs:999999})).markdown,/999999/);
});

test('obsolete refresh arguments are rejected',async()=>{
  await assert.rejects(main(['--update-baseline']),/Usage/);
});

test('reference run accepts legacy non-zero results and cleans worktrees after failure',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'read-reference-test-'));
  const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8'});
  try {
    git(['init']);
    execFileSync('mkdir',['scripts'],{cwd:directory});
    writeFileSync(path.join(directory,'package.json'),'{}');
    writeFileSync(path.join(directory,'package-lock.json'),JSON.stringify({name:'fixture',lockfileVersion:3,requires:true,packages:{'':{}}}));
    const script=path.join(directory,'scripts/read-benchmark.mjs');
    writeFileSync(script,`import {writeFileSync} from 'node:fs';
      import {tmpdir} from 'node:os';
      writeFileSync(tmpdir()+'/read-benchmark-result.json',JSON.stringify({scenarios:[],sqliteVersion:'legacy',scratch:tmpdir()}));
      process.exitCode=1;`);
    git(['add','.']);
    git(['-c','user.name=Test','-c','user.email=test@example.test','commit','-m','fixture']);
    const result=measureReference('HEAD',{cwd:directory});
    assert.equal(result.result.sqliteVersion,'legacy');
    assert.equal(result.revision,git(['rev-parse','HEAD']).trim());
    assert.equal(git(['worktree','list','--porcelain']).match(/worktree /g).length,1);
    assert.equal(existsSync(result.result.scratch),false);
    writeFileSync(script,'process.exitCode=1;');
    git(['add','.']);
    git(['-c','user.name=Test','-c','user.email=test@example.test','commit','-m','no result']);
    assert.throws(()=>measureReference('HEAD',{cwd:directory}),/ENOENT/);
    assert.equal(git(['worktree','list','--porcelain']).match(/worktree /g).length,1);
    assert.equal(existsSync(result.result.scratch),false);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('cached comparison skips measurement, verifies benchmark inputs and preserves measurement identity',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'read-cached-test-'));
  const originalTmp=process.env.TMPDIR;
  try {
    process.env.TMPDIR=directory;
    const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    const {tree,inputHash}=benchmarkIdentity('HEAD');
    const cached=path.join(directory,'cached.json');
    writeFileSync(cached,JSON.stringify({...profile,commit:'measured-sha',tree:'different-docs-tree',inputHash,scenarios:[row()]}));
    await main(['--compare','HEAD','--cached-base',cached,'--cached-head',cached]);
    const result=JSON.parse((await import('node:fs')).readFileSync(path.join(directory,'read-benchmark-result.json'),'utf8'));
    assert.equal(result.commit,commit);
    assert.equal(result.tree,tree);
    assert.equal(result.measuredCommit,'measured-sha');
    const cli=execFileSync(process.execPath,['scripts/read-benchmark.mjs','--compare','HEAD','--cached-base',cached,'--cached-head',cached],{encoding:'utf8',env:process.env});
    assert.match(cli,/Gate passed/);
    assert.match(cli,/restored from cache/);
    writeFileSync(cached,JSON.stringify({...profile,inputHash:'wrong',scenarios:[row()]}));
    await assert.rejects(main(['--compare','HEAD','--cached-base',cached,'--cached-head',cached]),/inputs do not match/);
  } finally {
    if(originalTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=originalTmp;
    rmSync(directory,{recursive:true,force:true});
  }
});

test('benchmark content keys ignore docs and workflows but include code, fixtures, dependencies and CLI inputs',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'read-inputs-test-'));
  const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8'}).trim();
  const put=(file,text)=>{execFileSync('mkdir',['-p',path.dirname(file)],{cwd:directory});writeFileSync(path.join(directory,file),text);};
  const commit=()=>{git(['add','.']);git(['-c','user.name=bdamokos','-c','user.email=163609735+bdamokos@users.noreply.github.com','commit','-m','fixture']);return benchmarkIdentity('HEAD',{cwd:directory});};
  try {
    git(['init']);
    put('server/query.mjs','SELECT 1');
    const base=commit();
    put('docs/guide.md','documentation');put('README.md','readme');put('.github/workflows/checks.yml','workflow');
    const docs=commit();
    assert.notEqual(docs.commit,base.commit);
    assert.notEqual(docs.tree,base.tree);
    assert.equal(docs.inputHash,base.inputHash);
    const runtime={os:'Linux',nodeVersion:'v26.12.1',nodeSqliteVersion:'3.54.0',sqliteVersion:'3.45.1 build',scope:'main'};
    assert.equal(benchmarkCacheKey({...runtime,inputHash:docs.inputHash}),benchmarkCacheKey({...runtime,inputHash:base.inputHash}));
    let previous=docs.inputHash;
    for(const file of ['server/query.mjs','server/fixtures/input.json','src/model.ts','scripts/read-benchmark.mjs','package.json','package-lock.json','.github/actions/sqlite-cli/action.yml']) {
      put(file,'changed');
      const next=commit().inputHash;
      assert.notEqual(next,previous,file);
      previous=next;
    }
    const key=benchmarkCacheKey({...runtime,inputHash:previous});
    for(const [field,value] of Object.entries({nodeVersion:'v27.0.0',nodeSqliteVersion:'3.55.0',sqliteVersion:'3.46.0 build'}))
      assert.notEqual(benchmarkCacheKey({...runtime,[field]:value,inputHash:previous}),key,field);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('cache staging rejects missing, broken or incomplete results and removes stale destinations',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'read-stage-test-'));
  const source=path.join(directory,'source.json'),destination=path.join(directory,'cache/result.json');
  try {
    for(const content of [undefined,'{','{}','{"scenarios":null}','{"scenarios":[{}]}']) {
      execFileSync('mkdir',['-p',path.dirname(destination)]);
      writeFileSync(destination,'stale');
      if(content!==undefined)writeFileSync(source,content);
      assert.equal(stageBenchmarkResult(source,destination),false);
      assert.equal(existsSync(destination),false);
    }
    writeFileSync(source,JSON.stringify({...profile,scenarios:[row({pageFetches:9999})]}));
    assert.equal(stageBenchmarkResult(source,destination),true);
    assert.equal(existsSync(destination),true); // A complete gate-failing run is cacheable.
  } finally {rmSync(directory,{recursive:true,force:true});}
});
