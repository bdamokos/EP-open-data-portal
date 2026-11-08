import {useMemo} from 'react';
import {useUiI18n} from './UiI18nReact';
import {voteCountryName as countryName} from './voteCountryName';
import {countryTallies,sortCountriesByName} from './voteSeatsModel.mjs';
import {groupLead} from './votePagePresentation.mjs';
import {TallyHeads,TallyNumbers} from './VoteRow';
import {votePositionKeys,type VotePosition} from './votePositions';
import type {VoteMetricRow} from './voteGroupMetrics.mjs';

type Props={rows:VoteMetricRow[];language:string;country:string|null;onChoose:(country:string|null)=>void};

// For, Against and Abstain as one bar, in the order of the columns beside it. The numbers carry the
// values for assistive technology; the bar only shows the split.
function SplitBar({counts}:{counts:Record<VotePosition,number>}) {
  return <span className="sbar" aria-hidden="true">{votePositionKeys.filter(position=>counts[position]>0).map(position=><i key={position} className={'b-'+position} style={{flexGrow:counts[position]}}/>)}</span>;
}

// One row per country of election, A to Z in the page language, on the group table's three columns.
// A country opens Members filtered to it; pressing the chosen country again clears the filter.
export function VoteCountries({rows,language,country,onChoose}:Props) {
  const ui=useUiI18n();
  const tallies=useMemo(()=>sortCountriesByName(countryTallies(rows),code=>countryName(code,language),language),[rows,language]);
  if(!tallies.length)return null;
  return <div className="countries" lang={ui.language}>
    <TallyHeads heading={null}/>
    {tallies.map(tally=><div key={tally.country} className="row tight crow">
      <span className="main"><button type="button" className="t" lang={language} aria-pressed={country===tally.country} onClick={()=>onChoose(country===tally.country?null:tally.country)}>{countryName(tally.country,language)}</button></span>
      <SplitBar counts={tally.counts}/>
      <TallyNumbers totals={tally.counts} bold={groupLead(tally.counts)}/>
    </div>)}
  </div>;
}
