// An alternative manifestation is useful for a bad file, not for bypassing a
// transport failure, source cooldown, request budget or cancelled operation.
export function pdfFallbackEligible(error) {
  return Boolean(error && (['invalid_docx','empty_document','unexpected_document_format'].includes(error.code)
    || [404,410].includes(error.status)));
}

export function invalidDocx(error) {
  return Object.assign(new Error(String(error?.message || 'Invalid DOCX archive.').slice(0,250),{cause:error}),{code:'invalid_docx'});
}
