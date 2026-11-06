import {countryName} from './CountryMap';

// Intl.DisplayNames is costly to construct; the vote views label hundreds of
// seats and cells, so names are resolved once per language and code.
const names=new Map<string,string>();
export function voteCountryName(code:string,language:string) {
  const key=language+'|'+code;
  let name=names.get(key);
  if(name===undefined){name=countryName(code,language);names.set(key,name);}
  return name;
}
