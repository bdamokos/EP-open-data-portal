import {defaultUi} from './uiDefault.mjs';
// Accept the common ways people copy a procedure reference and return Parliament's canonical form.
const pattern=/^(\d{4})\s*[/-]\s*(\d{4}[A-Z]?)(?:\s*\(\s*|\s*[/-]\s*|\s+)([A-Z]{2,8})\s*\)?$/;
export function parseProcedureReference(input, ui = defaultUi) {
  let value=String(input||'').trim();
  if(!value)return {error:ui.t("procedureReference.empty")};
  try{value=new URL(value).searchParams.get('reference')||value;}catch{}
  const match=pattern.exec(value.trim().toUpperCase());
  return match?{reference:`${match[1]}/${match[2]}(${match[3]})`}:{error:ui.t("procedureReference.invalid")};
}
