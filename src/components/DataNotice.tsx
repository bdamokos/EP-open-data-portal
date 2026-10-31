import {UiMessage, useUiI18n} from '../UiI18nReact';
import {useEffect,useRef,useState} from 'react';
import './DataNotice.css';

const links={
  openData:'https://data.europarl.europa.eu/',
  ccBy:'https://creativecommons.org/licenses/by/4.0/',
  legalNotice:'https://www.europarl.europa.eu/legal-notice/en/',
  commissionReuse:'https://eur-lex.europa.eu/eli/dec/2011/833/oj',
};
const DISMISSED='ep.data-notice.dismissed.v1';
let storage:Storage|null=null;
try{storage=window.localStorage;}catch{}
const readDismissed=()=>{try{return storage?.getItem(DISMISSED)==='1';}catch{return false;}};

// Attribution and reuse terms for the public sources listed in docs/PUBLIC_DATA.md.
// Hiding the notice keeps a compact "About this site" toggle with the same terms.
export function DataNotice({className=''}:{className?:string}) {
  const ui = useUiI18n();
  const [dismissed,setDismissed]=useState(readDismissed),[moveFocus,setMoveFocus]=useState(false),summary=useRef<HTMLElement>(null),details=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{if(moveFocus&&dismissed){summary.current?.focus();setMoveFocus(false);}},[moveFocus,dismissed]);
  const dismiss=()=>{if(details.current)details.current.open=false;try{storage?.setItem(DISMISSED,'1');}catch{}setDismissed(true);setMoveFocus(true);};
  return <div className={`data-notice${dismissed?' data-notice--dismissed':''} ${className}`} lang={ui.language}>
    <details ref={details}>
      <summary ref={summary}>{dismissed?<UiMessage id="components.datanotice.tsx.about.this.site"/>:<UiMessage id="components.datanotice.tsx.independent.site.not.an.official.parliament.service"/>}</summary>
      <div className="data-notice__body">
        <p><UiMessage id="components.datanotice.tsx.parliament.open.data.european.union.source.european.parliament.fr" values={{openDataLink: <a href={links.openData}><UiMessage id="components.datanotice.tsx.open.data.portal"/></a>, licenceLink: <a href={links.ccBy}><UiMessage id="components.datanotice.tsx.cc.by.4.0"/></a>}}/></p>
        <p><UiMessage id="components.datanotice.tsx.portraits.procedure.summaries.documents.and.recordings.come.from." values={{legalNoticeLink: <a href={links.legalNotice}><UiMessage id="components.datanotice.tsx.legal.notice"/></a>, reusePolicyLink: <a href={links.commissionReuse}><UiMessage id="components.datanotice.tsx.reuse.policy"/></a>}}/></p>
        <p><UiMessage id="components.datanotice.tsx.independent.site.counts.and.groupings.are.its.own.and.may.be.inco"/></p>
      </div>
    </details>
    {!dismissed&&<button type="button" className="data-notice__dismiss" aria-label={ui.t("components.datanotice.tsx.hide.site.notice")} title={ui.t("components.datanotice.tsx.hide.site.notice")} onClick={dismiss}>×</button>}
  </div>;
}
