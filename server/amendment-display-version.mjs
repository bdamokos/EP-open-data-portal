import {AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';

// Raise only when retained output is known to be wrong, not for added coverage.
// Version 9 and earlier could lose comparison-grid content.
export const MINIMUM_AMENDMENT_DISPLAY_VERSION=10;
export function displayableAmendmentVersion(version) {
  return typeof version==='string'&&/^[1-9]\d*$/.test(version)&&Number(version)>=MINIMUM_AMENDMENT_DISPLAY_VERSION&&Number(version)<=Number(AMENDMENT_EXTRACTION_VERSION);
}
