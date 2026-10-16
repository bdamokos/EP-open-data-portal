import {filterCountry} from './pocCountries.mjs';

const countries=new Set('AT BE BG HR CY CZ DK EE FI FR DE EL HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '));
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

export function readExplorerParam(query,key,fallback,allowed) {
  let raw=query.get(key);
  if(raw===null&&((key==='q-country'&&query.get('view')==='questions')||(key==='agenda-country'&&query.get('view')==='legislation'&&!query.has('pl-mode'))))raw=query.get('country');
  if(raw===null||raw.length>512)return fallback;
  const value=key.endsWith('-country')?filterCountry(raw):key.endsWith('-days')&&raw==='term'?raw:typeof fallback==='number'?Number(raw):raw;
  if(allowed&&!allowed.includes(value))return fallback;
  if(typeof value==='number'&&!Number.isFinite(value))return fallback;
  if(key.endsWith('-country')&&!countries.has(value))return fallback;
  if((key.endsWith('-until')||key==='trend-week')&&raw&&!validDate(raw))return fallback;
  if(key==='q-offset'&&(!Number.isInteger(value)||value<0||value>5000))return fallback;
  if(key==='q-range'&&raw){const [start,end,...extra]=raw.split('_');if(extra.length||!validDate(start)||!validDate(end)||start>end)return fallback;}
  if(key==='ov-person'&&!/^[1-9]\d{0,12}$/.test(raw))return fallback;
  if(key==='ov-month'&&!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(raw))return fallback;
  if(key==='hot-period'&&!(/^sitting:MTG-PL-\d{4}-\d{2}-\d{2}$/.test(raw)||raw.startsWith('week:')&&validDate(raw.slice(5))))return fallback;
  return value;
}

export function explorerParams(query,view) {
  const result=new URLSearchParams();
  const prefix=view==='questions'?/^q-/:view==='legislation'?/^(pl|agenda|hot|cloud|dossier|trend)-/:view==='outside'?/^ov-/:null;
  if(prefix)for(const [key,value] of query)if(prefix.test(key)){
    if(key.endsWith('-country')){const country=readExplorerParam(query,key,null);if(country)result.set(key,country);}
    else result.set(key,value);
  }
  if(query.has('country')&&(view==='questions'||view==='legislation')){
    const key=view==='questions'?'q-country':'agenda-country',country=readExplorerParam(query,key,null);
    if(country&&!result.has(key))result.set(key,country);
  }
  return result;
}
