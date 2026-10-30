import {UiMessage, useUiI18n} from '../UiI18nReact';
import {amendmentJustification,type JustificationRecord} from '../amendmentJustification.mjs';
import './AmendmentJustification.css';

export function AmendmentJustification({record}:{record?:JustificationRecord|null}) {
  const ui = useUiI18n();
  const value=amendmentJustification(record);
  if(!value)return null;
  return <section className="amendment-justification" aria-label={ui.t("amendmentjustification.justification")} lang={ui.language}>
    <h5><UiMessage id="amendmentjustification.justification"/></h5>
    <p lang={value.language??''}>{value.text}</p>
  </section>;
}
