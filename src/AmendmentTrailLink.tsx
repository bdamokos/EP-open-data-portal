import type {ReactNode} from 'react';
import {amendmentHref,supportedAmendmentTarget} from './amendmentModel.mjs';

export function AmendmentTrailLink({document,procedure,member,language='en',children}:{document?:string|null;procedure?:string|null;member?:string|number|null;language?:string;children?:ReactNode}) {
  if(document&&!supportedAmendmentTarget(document))return null;
  return <a className="explorer-amendment-trail-link" href={amendmentHref(window.location.pathname,{document,procedure,member,language})}>{children||'Explore amendments'} <span aria-hidden="true">→</span></a>;
}
