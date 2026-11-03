import iso2 from '../server/topic-country-iso2.json' with {type:'json'};

// Server labels already include the authority overlay. Only missing local labels
// reach CLDR; exact held authority identifiers provide ISO region codes.
export function placeLabel(id,requested,existing={}, {notations=iso2.notations,DisplayNames=Intl.DisplayNames}={}) {
 const language=String(requested||'en').toLowerCase().split('-')[0];
 if(existing.labelLanguage===language&&existing.label)return existing;
 const codes=notations[id];
 if(codes?.length===1&&DisplayNames)try{
  if(DisplayNames.supportedLocalesOf([language]).length){
   const names=new DisplayNames([language],{type:'region',fallback:'none'}),actual=names.resolvedOptions().locale.split('-')[0],label=names.of(codes[0]);
   if(actual===language&&label&&label!==codes[0])return {label,labelLanguage:actual};
  }
 }catch{/* Unavailable locale or region: keep the source language. */}
 return existing.label?existing:{label:id,labelLanguage:null};
}

// Topic concepts can occur in overviews, records, detail facets and story payloads.
export function localizePlaceLabels(value,language){
 if(Array.isArray(value))return value.map(v=>localizePlaceLabels(v,language));
 if(!value||typeof value!=='object')return value;
 const result=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,localizePlaceLabels(v,language)]));
 if(typeof result.key==='string'&&result.key.startsWith('place:')&&typeof result.label==='string')Object.assign(result,placeLabel(result.key.slice(6),language,result));
 return result;
}
