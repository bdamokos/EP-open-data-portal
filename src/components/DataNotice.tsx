import './DataNotice.css';

const links={
  openData:'https://data.europarl.europa.eu/',
  ccBy:'https://creativecommons.org/licenses/by/4.0/',
  legalNotice:'https://www.europarl.europa.eu/legal-notice/en/',
  commissionReuse:'https://eur-lex.europa.eu/eli/dec/2011/833/oj',
};

// Attribution and reuse terms for the public sources listed in docs/PUBLIC_DATA.md.
export function DataNotice({className=''}:{className?:string}) {
  return <details className={`data-notice ${className}`} lang="en">
    <summary>Public European Parliament data · Not an official Parliament service</summary>
    <div className="data-notice__body">
      <p>Parliament open data: © European Union – Source: European Parliament, from the <a href={links.openData}>Open Data Portal</a>, licensed under <a href={links.ccBy}>CC BY 4.0</a>.</p>
      <p>Portraits, procedure summaries, documents and recordings come from Parliament websites and are reused under the Parliament’s <a href={links.legalNotice}>legal notice</a>, which allows reuse with the source acknowledged. Some items carry third-party rights. EuroVoc and country terms come from the EU Publications Office under the Commission’s <a href={links.commissionReuse}>reuse policy</a>.</p>
      <p>This site is independent. Counts, charts, word clouds and groupings are its own and may be incomplete or out of date. Check the linked original before relying on it, and check its terms before reusing material.</p>
    </div>
  </details>;
}
