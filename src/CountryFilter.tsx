import {UiMessage, useUiI18n} from './UiI18nReact';
import {compareCountries} from './interfaceLabels.mjs';
import {europeMap} from './europeMap';
import {countryName} from './CountryMap';

/** Election country filters people and their activity, never the subject of a document. */
export function CountryFilter({country,onChange,language}:{country:string|null;onChange:(country:string|null)=>void;language:string}) {
  const ui = useUiI18n();
  return <label lang={ui.language}><UiMessage id="countryFilter.1"/><select lang={language} value={country||''} onChange={event=>onChange(event.target.value||null)}><option lang={ui.language} value=""><UiMessage id="countryFilter.2"/></option>{[...europeMap].sort((a,b)=>compareCountries(language,a.code,b.code, ui)).map(item=><option lang={language} key={item.code} value={item.code}>{countryName(item.code,language)}</option>)}</select></label>;
}
