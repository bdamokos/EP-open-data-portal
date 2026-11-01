// Missing public records may be published later. Keep probing, without a
// short fixed retry loop. attempts is the number of previous failures.
export const sourceMissing = error => error?.status === 404 || error?.status === 410;
export function missingSourceDelay(attempts) {
  return Math.min(7 * 86_400_000, 3_600_000 * 2 ** Math.min(Math.max(0, attempts), 8));
}

export const SOURCE_RECHECK_MS=30*86_400_000;
export const permanentSourceIssue=error=>['invalid_docx','empty_document','unexpected_document_format','source_parser_rejection'].includes(error?.code);
// Sustained transport failures stay recoverable, but stop consuming frequent starts.
export function transientSourceDelay(attempts,{base=60_000,cap=6*3_600_000}={}) {
  return attempts>=8?86_400_000:Math.min(cap,base*2**Math.min(Math.max(0,attempts),8));
}
export const sourceDescriptor=body=>JSON.stringify([body.url,body.edition??null,body.pdf??null]);
