import type {ReactNode} from 'react';
import {amendmentHref} from './pocAmendmentModel.mjs';

export function AmendmentTrailLink({document,procedure,member,language='en',children}:{document?:string|null;procedure?:string|null;member?:string|number|null;language?:string;children?:ReactNode}) {
  return <a className="poc-amendment-trail-link" href={amendmentHref(location.pathname,{document,procedure,member,language})}>{children||'Explore amendments'} <span aria-hidden="true">→</span></a>;
}
