import {amendmentJustification,type JustificationRecord} from '../amendmentJustification.mjs';
import './AmendmentJustification.css';

export function AmendmentJustification({record}:{record?:JustificationRecord|null}) {
  const value=amendmentJustification(record);
  if(!value)return null;
  return <section className="amendment-justification" aria-label="Justification" lang="en">
    <h5>Justification</h5>
    <p lang={value.language??''}>{value.text}</p>
  </section>;
}
