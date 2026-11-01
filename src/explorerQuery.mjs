import {committeeAmendmentList,committeeAmendmentTarget,supportedAmendmentTarget,validCommitteeCode} from './amendmentModel.mjs';
import {filterCountry} from './countries.mjs';
import {validAddresseeFilter} from '../server/question-addressees.mjs';
import {isMemberVotesParam} from './memberVotesJourney.mjs';

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
  if(['q-offset','am-offset'].includes(key)&&(!Number.isInteger(value)||value<0||value>(key==='am-offset'?1000000:5000)))return fallback;
  if(key==='q-addressee'&&raw&&!validAddresseeFilter(raw))return fallback;
  if(['am-scope'].includes(key)&&!['plenary','committee'].includes(raw))return fallback;
  if(key==='am-list'&&raw&&!committeeAmendmentList(raw))return fallback;
  if(['am-committee','dossier-committee'].includes(key)&&raw&&!validCommitteeCode(raw))return fallback;
  if(key==='dossier-stage'&&!['all','committee','plenary'].includes(raw))return fallback;
  if(key==='am-document'&&raw&&!supportedAmendmentTarget(raw)&&!(query.get('am-scope')==='committee'&&committeeAmendmentTarget(raw)))return fallback;
  if(key==='am-member'&&raw&&!/^[1-9]\d{0,12}$/.test(raw))return fallback;
  if(key.endsWith('-fts-offset')&&(!Number.isInteger(Number(value))||Number(value)<0||Number(value)>1000))return fallback;
  if(key.endsWith('-fts-page')&&(!Number.isInteger(Number(value))||Number(value)<0||Number(value)>50))return fallback;
  if(key==='global-fts-catalog-offset'&&(!Number.isInteger(value)||value<0||value>1000))return fallback;
  if(['global-fts-from','global-fts-to'].includes(key)&&raw&&!validDate(raw))return fallback;
  if(key==='q-range'&&raw){const [start,end,...extra]=raw.split('_');if(extra.length||!validDate(start)||!validDate(end)||start>end)return fallback;}
  if(key==='ov-person'&&!/^[1-9]\d{0,12}$/.test(raw))return fallback;
  if(key==='ov-month'&&!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(raw))return fallback;
  if(['agenda-period','hot-period','cloud-period'].includes(key)&&!(/^sitting:MTG-PL-\d{4}-\d{2}-\d{2}$/.test(raw)||raw.startsWith('week:')&&validDate(raw.slice(5))&&new Date(raw.slice(5)).getUTCDay()===1))return fallback;
  return value;
}

export function explorerParams(query,view,member) {
  const result=new URLSearchParams();
  const ownsMember=member===undefined||Boolean(member&&query.get('member')===String(member));
  const prefix=view==='topics'?/^(topic$|place$|t-)/:view==='questions'?/^q-/:view==='legislation'?/^(pl|agenda|hot|cloud|dossier|trend)-/:view==='outside'?/^ov-/:view==='amendments'?/^am-/:view==='groups'?/^gv-/:view===null&&ownsMember?/^mep-(speech|activity)-fts-/:null;
  for(const [key,value] of query)if(/^global-fts-(search|text-lang|page|offset|catalog-offset|from|to|read|kind|sort|closed)$/.test(key)||prefix?.test(key)||view===null&&ownsMember&&(key==='mep-speech-category'||isMemberVotesParam(key)||key.startsWith('ma-'))){
    if(key.endsWith('-country')){const country=readExplorerParam(query,key,null);if(country)result.set(key,country);}
    else result.set(key,value);
  }
  if(query.has('country')&&(view==='questions'||view==='legislation')){
    const key=view==='questions'?'q-country':'agenda-country',country=readExplorerParam(query,key,null);
    if(country&&!result.has(key))result.set(key,country);
  }
  return result;
}
