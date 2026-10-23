import {compareCountries} from './interfaceLabels.mjs';
import {europeMap} from './europeMap';
import {countryName} from './CountryMap';

/** Election country filters people and their activity, never the subject of a document. */
export function CountryFilter({country,onChange,language}:{country:string|null;onChange:(country:string|null)=>void;language:string}) {
  return <label lang="en">MEPs elected in<select lang={language} value={country||''} onChange={event=>onChange(event.target.value||null)}><option lang="en" value="">All EU countries</option>{[...europeMap].sort((a,b)=>compareCountries(language,a.code,b.code)).map(item=><option lang={language} key={item.code} value={item.code}>{countryName(item.code,language)}</option>)}</select></label>;
}
