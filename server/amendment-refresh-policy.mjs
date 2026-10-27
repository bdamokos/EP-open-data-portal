import {integerFromEnvironment} from './config.mjs';
import {validAmendmentDate} from './amendments.mjs';

export const AMENDMENT_SETTLE_GRACE_DAYS=60;
export const amendmentMetadataCheckDays=()=>integerFromEnvironment('AMENDMENT_SETTLED_METADATA_DAYS',90,1,3650);
export const amendmentGraceDays=()=>integerFromEnvironment('AMENDMENT_SETTLE_GRACE_DAYS',AMENDMENT_SETTLE_GRACE_DAYS,1,3650);
// Unknown documentary dates keep the weekly policy. Exact linked sitting dates
// extend the correction window; publication issue times never replace them.
export function amendmentListSettled(list,{now=Date.now(),graceDays=amendmentGraceDays(),sittingIds=[]}={}) {
  if(!validAmendmentDate(list?.document_date))return false;
  const dates=[list.document_date,...sittingIds.map(id=>id.match(/^MTG-PL-(\d{4}-\d{2}-\d{2})$/)?.[1]).filter(validAmendmentDate)];
  return now>Math.max(...dates.map(Date.parse))+graceDays*86400000;
}
