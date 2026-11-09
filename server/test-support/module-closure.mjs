import {readFileSync} from 'node:fs';
import path from 'node:path';

// Static import closure of a module: every relative file its static and
// literal dynamic imports reach, plus the packages and built-ins on the way.
// Worker entry points loaded through `new URL(..., import.meta.url)` are other
// isolates and are not part of the closure.
const pattern=/(?:^|[;\s}])(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
export function moduleClosure(entry) {
  const files=new Set(),packages=new Set(),builtins=new Set();
  const visit=file=>{
    if(files.has(file))return;
    files.add(file);
    const source=readFileSync(file,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/.*$/gm,'$1');
    for(const match of source.matchAll(pattern)) {
      const specifier=match[1]??match[2];
      if(specifier.startsWith('node:')){builtins.add(specifier);continue;}
      if(specifier.startsWith('.')){visit(path.resolve(path.dirname(file),specifier));continue;}
      packages.add(specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0]);
    }
  };
  visit(path.resolve(entry));
  return {files:[...files],packages:[...packages],builtins:[...builtins]};
}
if(process.argv[1]&&import.meta.url===new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const result=moduleClosure(process.argv[2]);
  console.log(JSON.stringify({modules:result.files.length,packages:result.packages},null,1));
}
