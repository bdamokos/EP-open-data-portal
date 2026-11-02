import path from 'node:path';
import {createErrorLog} from './error-log.mjs';
import {projectRoot} from './config.mjs';
import {validDay} from './source-availability.mjs';

const integer=value=>Number.isSafeInteger(value)&&value>=0?value:undefined;
const label=value=>typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,120}$/.test(value)?value:undefined;
const day=value=>validDay(value)?value:undefined;
export function indexErrorEvent(task,error) {
  if(error?.name==='AbortError')return null;
  const body=task.body||{};
  const category=task.kind==='outside-roster'?'speaker-list':task.kind==='outside-detail'||task.kind==='speeches'&&body.recoveryId?'speech-record':task.kind==='speeches'?'speech-list':null;
  if(!category)return null;
  const id=body.recoveryId||body.id;
  const sourceId=category==='speech-record'&&typeof id==='string'&&/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(id)?id:undefined;
  const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:undefined;
  return {source:'activity-index',kind:'task-failure',category,taskKind:task.kind,
    generation:integer(task.generation),attempt:integer(task.attempts+1),sourceId,
    start:day(body.date||body.params?.['sitting-date']||sourceId?.slice(7,17)),
    end:day(body.date||body.params?.['sitting-date-end']||sourceId?.slice(7,17)),
    offset:integer(body.offset),language:label(body.language),status,code:label(error?.code),name:label(error?.name)};
}

// The sole index writer owns its own rotation files, separate from API requests.
let log;
export const indexErrorLog={
  write(event) {
    log??=createErrorLog({directory:path.join(process.env.ERROR_LOG_DIR||path.join(projectRoot,'var','diagnostics'),'activity-index')});
    return log.write(event);
  },
  flush:()=>log?.flush(),
};
