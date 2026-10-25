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
  const [dismissed,setDismissed]=useState(readDismissed),[moveFocus,setMoveFocus]=useState(false),summary=useRef<HTMLElement>(null),details=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{if(moveFocus&&dismissed){summary.current?.focus();setMoveFocus(false);}},[moveFocus,dismissed]);
  const dismiss=()=>{if(details.current)details.current.open=false;try{storage?.setItem(DISMISSED,'1');}catch{}setDismissed(true);setMoveFocus(true);};
  return <div className={`data-notice${dismissed?' data-notice--dismissed':''} ${className}`} lang="en">
    <details ref={details}>
      <summary ref={summary}>{dismissed?'About this site':'Independent site · Not an official Parliament service'}</summary>
      <div className="data-notice__body">
        <p>Parliament open data: © European Union – Source: European Parliament, from the <a href={links.openData}>Open Data Portal</a>, licensed under <a href={links.ccBy}>CC BY 4.0</a>.</p>
        <p>Portraits, procedure summaries, documents and recordings come from Parliament websites and are reused under the Parliament’s <a href={links.legalNotice}>legal notice</a>, which allows reuse with the source acknowledged. Some items carry third-party rights. EuroVoc and country terms come from the EU Publications Office under the Commission’s <a href={links.commissionReuse}>reuse policy</a>.</p>
        <p>Independent site. Counts and groupings are its own and may be incomplete or out of date; check the linked original.</p>
      </div>
    </details>
    {!dismissed&&<button type="button" className="data-notice__dismiss" aria-label="Hide site notice" title="Hide site notice" onClick={dismiss}>×</button>}
  </div>;
}
