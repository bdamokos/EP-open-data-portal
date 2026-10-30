import {UiMessage, useUiI18n} from './UiI18nReact';
import type {ReactNode} from 'react';
import {amendmentHref,supportedAmendmentTarget} from './amendmentModel.mjs';
import {publicAmendmentsEnabled} from './publicFeatures';

export function AmendmentTrailLink({document,procedure,member,language='en',children}:{document?:string|null;procedure?:string|null;member?:string|number|null;language?:string;children?:ReactNode}) {
  const ui = useUiI18n();
  if(!publicAmendmentsEnabled)return null;
  if(document&&!supportedAmendmentTarget(document))return null;
  return <a className="explorer-amendment-trail-link" href={amendmentHref(window.location.pathname,{document,procedure,member,language})}>{children||ui.t("amendmentTrail.explore")} <span aria-hidden="true">→</span></a>;
}
