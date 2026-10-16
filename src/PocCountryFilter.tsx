import {europeMap} from './pocEuropeMap';
import {countryName} from './PocCountryMap';

/** Election country filters people and their activity, never the subject of a document. */
export function CountryFilter({country,onChange,language}:{country:string|null;onChange:(country:string|null)=>void;language:string}) {
  return <label lang="en">MEPs elected in<select lang={language} value={country||''} onChange={event=>onChange(event.target.value||null)}><option lang="en" value="">All EU countries</option>{[...europeMap].sort((a,b)=>countryName(a.code,language).localeCompare(countryName(b.code,language),language)).map(item=><option lang={language} key={item.code} value={item.code}>{countryName(item.code,language)}</option>)}</select></label>;
}
