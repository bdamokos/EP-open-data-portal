import {HttpError} from './http-utils.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {procedureSteps} from './procedure-steps.mjs';
import {statusIndexEvents} from './dossier-status.mjs';

export const DOSSIER_STATUSES_VERSION=1;
// One page of topic groups.
export const DOSSIER_STATUSES_LIMIT=20;
const validId=value=>/^\d{4}-\d{4}[A-Z]?$/.test(value||'');

export function dossierStatusesQuery(search) {
  for(const key of search.keys())if(key!=='procedures'||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated procedure parameter.');
  const ids=(search.get('procedures')||'').split(',');
  if(ids.length>DOSSIER_STATUSES_LIMIT||ids.some(id=>!validId(id))||new Set(ids).size!==ids.length)throw new HttpError(400,'invalid_procedures','Choose up to '+DOSSIER_STATUSES_LIMIT+' exact procedure identifiers.');
  return {ids:[...ids].sort()};
}

/** Where ordinary legislative files stand, for many files at once. Each file
 * is read from the saved procedure and uses the same steps as `dossier-status`
 * without the Council, signature and Journal events that page reads later.
 * Other files and files not saved here are absent, not unknown.
 */
export function dossierStatuses(activity,{ids},{clock=Date.now}={}) {
  const asOf=brusselsDay(clock()),items=[];
  for(const id of ids) {
    const held=activity.heldProcedure(id,'en');
    if(!held)continue;
    const {reference}=held.procedure,{family,stage}=procedureSteps({reference,indexEvents:statusIndexEvents(held.work),asOf});
    if(family==='COD'&&stage!=='unknown')items.push({id,reference,stage});
  }
  return {version:DOSSIER_STATUSES_VERSION,items};
}
