import {useMemo,type ReactNode} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {voteCountryName as countryName} from './voteCountryName';
import {countryTallies,decodeCountryOrder,encodeCountryOrder,orderCountries,sideTurn,type CountryOrderKey} from './voteSeatsModel.mjs';
import {groupLead} from './votePagePresentation.mjs';
import {headMessageId,TallyNumbers} from './VoteRow';
import {VoteMark} from './VoteMark';
import {useExplorerParam} from './explorerUrl';
import {votePositionKeys,type VotePosition} from './votePositions';
import type {VoteMetricRow} from './voteGroupMetrics.mjs';

type Props={rows:VoteMetricRow[];language:string;country:string|null;outcome:string|null;onChoose:(country:string|null)=>void};
const column={for:'f',against:'a',abstaining:'x'} as const;
const countKey={for:'for',against:'against',abstaining:'abstain'} as const;
// Name reads A to Z, every other order largest first, until reversed.
const natural=(key:CountryOrderKey)=>key==='name'?'ascending':'descending';

// For, Against and Abstain as one bar, in the order of the columns beside it. The numbers carry the values.
function SplitBar({counts}:{counts:Record<VotePosition,number>}) {
  return <span className="sb" role="cell"><span className="sbar" aria-hidden="true">{votePositionKeys.filter(position=>counts[position]>0).map(position=><i key={position} className={'b-'+position} style={{flexGrow:counts[position]}}/>)}</span></span>;
}

// One row per country of election on the group table's three columns. By default the countries run from the
// largest share for the winning side to the smallest, with a dashed rule where their majority turns the other way.
// Every head sorts on wide screens; on phones the name and the share do. A country opens Members filtered to it;
// pressing the chosen country again clears the filter.
export function VoteCountries({rows,language,country,outcome,onChoose}:Props) {
  const ui=useUiI18n();
  const [raw,setRaw]=useExplorerParam<string>('vote-country-order','');
  const order=decodeCountryOrder(raw),winning=outcome==='REJECTED'?'against':'for';
  const tallies=useMemo(()=>orderCountries(countryTallies(rows),decodeCountryOrder(raw),{winning,nameOf:code=>countryName(code,language),locale:language}),[rows,raw,winning,language]);
  if(!tallies.length)return null;
  const turn=order.key==='share'?sideTurn(tallies,winning):-1;
  const sorted=(key:CountryOrderKey)=>order.key!==key?'none':order.reversed?(natural(key)==='ascending'?'descending':'ascending'):natural(key);
  const sortBy=(key:CountryOrderKey)=>setRaw(encodeCountryOrder({key,reversed:order.key===key&&!order.reversed}));
  const head=(key:CountryOrderKey,label:ReactNode,className:string)=>{
    const state=sorted(key);
    return <span role="columnheader" aria-sort={state} className={className}><button type="button" className="word" onClick={()=>sortBy(key)}>{label}{state!=='none'&&<span aria-hidden="true">{state==='ascending'?' ↑':' ↓'}</span>}</button></span>;
  };
  return <div className="countries" role="table" aria-label={ui.t('votepage.countries')} lang={ui.language}>
    <div className="heads static" role="row">
      {head('name',<UiMessage id="votegroups.countries.country"/>,'hn')}
      {head('share',<UiMessage id="votegroups.countries.share"/>,'hs')}
      {votePositionKeys.map(position=>{
        const label=<><VoteMark position={position}/><UiMessage id={headMessageId(position)}/></>;
        return <span key={position} role="columnheader" aria-sort={sorted(countKey[position])} className={'n hd '+column[position]}>
          <button type="button" className="word on-wide" onClick={()=>sortBy(countKey[position])}>{label}{sorted(countKey[position])!=='none'&&<span aria-hidden="true">{sorted(countKey[position])==='ascending'?' ↑':' ↓'}</span>}</button>
          <span className="on-narrow">{label}</span>
        </span>;
      })}
    </div>
    {tallies.map((tally,index)=><div key={tally.country} role="row" className={'row tight crow'+(index===turn-1?' turn':'')}>
      <span className="main" role="rowheader"><button type="button" className="t" lang={language} aria-pressed={country===tally.country} onClick={()=>onChoose(country===tally.country?null:tally.country)}>{countryName(tally.country,language)}</button></span>
      <SplitBar counts={tally.counts}/>
      <TallyNumbers totals={tally.counts} bold={groupLead(tally.counts)} cells/>
    </div>)}
  </div>;
}
