import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {dataGapAudit} from '../server/data-gap-audit.mjs';

export function auditOptions(args,env=process.env) {
  const options={indexFile:env.ACTIVITY_INDEX_DIR&&path.join(env.ACTIVITY_INDEX_DIR,'activities-v1.sqlite'),corpusFile:env.CORPUS_DIR&&path.join(env.CORPUS_DIR,'corpus-v1.sqlite'),pressFile:env.ACTIVITY_INDEX_DIR&&path.join(env.ACTIVITY_INDEX_DIR,'press-v1.sqlite')};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--reconcile'){options.reconcile=true;continue;}
    const key={'--index':'indexFile','--corpus':'corpusFile','--press':'pressFile'}[args[i]];
    if(!key||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Use --index FILE --corpus FILE --press FILE [--reconcile].');
    options[key]=path.resolve(args[++i]);
  }
  return options;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {console.log(JSON.stringify(dataGapAudit(auditOptions(process.argv.slice(2))),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
