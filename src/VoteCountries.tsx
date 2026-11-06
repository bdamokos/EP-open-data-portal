import {useMemo,useState} from 'react';
import {useNarrow} from './useNarrow';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {groupShortLabel} from './groupShort';
import {voteCountryName as countryName} from './voteCountryName';
import {groupLabel,groupLabelLanguage} from './groupLabels';
import {countryGroupBreakdown,allCountriesBreakdown,sortCountryRows,encodeMatrixSort,decodeMatrixSort,defaultMatrixSort,countryFilterPressed,type MatrixSort,type CountryBreakdownRow} from './voteSeatsModel.mjs';
import {votePositionKeys,type VotePosition} from './votePositions';
import type {VoteMetricRow} from './voteGroupMetrics.mjs';
import {useExplorerParam} from './explorerUrl';
import './VoteBreakdown.css';

type Row=VoteMetricRow&{id?:string};
type Props={rows:Row[];language:string;country:string|null;group:string|null;position:VotePosition|'all'|null;onChoose:(country:string|null,group:string|null,position:VotePosition)=>void};
const allKey='*';

export function VoteCountries({rows,language,country,group,position,onChoose}:Props) {
  const ui=useUiI18n(),narrow=useNarrow();
  const [rawSort,setRawSort]=useExplorerParam<string>('agenda-country-sort','');
  const sort=decodeMatrixSort(rawSort)||{...defaultMatrixSort} as MatrixSort;
  const [open,setOpen]=useState<string|null>(null);
  const breakdown=useMemo(()=>countryGroupBreakdown(rows),[rows]);
  const all=useMemo(()=>allCountriesBreakdown(rows),[rows]);
  const groups=useMemo(()=>[...new Set(breakdown.flatMap(row=>[...row.groups.keys()]))].sort((a,b)=>breakdown.reduce((n,row)=>n+(row.cells.get(b)?.count||0)-(row.cells.get(a)?.count||0),0)||a.localeCompare(b)),[breakdown]);
  const ordered=useMemo(()=>sortCountryRows(breakdown,sort,row=>countryName(row.country!,language),language),[breakdown,rawSort,language]);
  if(!breakdown.length||!all)return null;
  const choose=(code:string|null,groupCode:string|null,preferred?:VotePosition)=>{
    const source=code===null?all:breakdown.find(row=>row.country===code);
    const counts=groupCode?source?.groups.get(groupCode):source?.counts;
    const best=preferred||votePositionKeys.reduce((a,b)=>(counts?.[b]||0)>(counts?.[a]||0)?b:a,votePositionKeys[0]);
    onChoose(code,groupCode,best);
  };
  const pressed=(rowCountry:string|null,groupCode:string|null,cellPosition?:VotePosition)=>countryFilterPressed({country,group,position},{country:rowCountry,group:groupCode,position:cellPosition});
  const sortBy=(kind:MatrixSort['kind'],key?:string)=>{
    const same=sort.kind===kind&&(sort.kind!=='group'||sort.key===key);
    const dir=same?(sort.dir==='asc'?'desc':'asc'):(kind==='country'?'asc':'desc');
    setRawSort(encodeMatrixSort(kind==='group'?{kind,key:key!,dir}:{kind,dir}));
  };
  const heading=<div className="vote-countries-head"><h4><UiMessage id="votegroups.countries.heading"/></h4>{encodeMatrixSort(sort)!==''&&<button type="button" className="insight-text-button" onClick={()=>setRawSort('')}><UiMessage id="votegroups.countries.reset"/></button>}</div>;
  const totalsText=(counts:Record<VotePosition,number>)=><span className="vote-country-totals">{votePositionKeys.map((p,i)=><span key={p} className={'vote-'+p}>{i?' · ':''}{counts[p]}</span>)}</span>;
  const label=(row:CountryBreakdownRow)=>row.country===null?ui.t('votegroups.countries.clear'):countryName(row.country,language);
  const labelLang=(row:CountryBreakdownRow)=>row.country===null?ui.language:language;
  const shortGroup=(code:string)=>groupShortLabel(code,ui);
  const everyone=[all,...ordered];
  if(narrow)return <section className="vote-countries" lang={ui.language}>{heading}
    <ul className="vote-country-list">{everyone.map(row=>{
      const key=row.country??allKey,expanded=open===key;
      return <li key={key} className={row.country===null?'vote-country-all':undefined} data-voter-anchor={'country:'+key}>
        <button type="button" className="vote-country-row" aria-expanded={expanded} onClick={()=>setOpen(expanded?null:key)} aria-label={ui.t('votegroups.countries.country_row',{country:label(row),for:String(row.counts.for),against:String(row.counts.against),abstaining:String(row.counts.abstaining)})}>
          <span className="vote-country-row-head"><span className="vote-chevron" aria-hidden="true"/><span className="vote-country-name" lang={labelLang(row)}>{label(row)}</span>{totalsText(row.counts)}</span>
        </button>
        {expanded&&<ul className="vote-country-groups">
          {groups.filter(code=>row.groups.has(code)).map(code=>{const counts=row.groups.get(code)!;return <li key={code}><button type="button" aria-pressed={pressed(row.country,code)} aria-label={ui.t('votegroups.countries.group_row',{group:groupLabel(code,ui),for:String(counts.for),against:String(counts.against),abstaining:String(counts.abstaining)})} onClick={()=>choose(row.country,code)}><span lang={groupLabelLanguage(code,ui)}>{groupLabel(code,ui)}</span>{totalsText(counts)}</button></li>;})}
        </ul>}
        <div data-voter-host={'country:'+key}/>
      </li>;
    })}</ul>
  </section>;
  const sorted=(kind:MatrixSort['kind'],key?:string)=>sort.kind===kind&&(sort.kind!=='group'||sort.key===key)?(sort.dir==='asc'?'ascending':'descending'):'none';
  const majorityCell=(row:CountryBreakdownRow)=>{
    const id=row.majority?'votegroups.position.'+row.majority:'votegroups.split';
    return <td className="vote-majority"><span className={'vote-'+(row.majority||'split')} lang={ui.messageLocale(id)}>{ui.t(id)}</span></td>;
  };
  const tableRow=(row:CountryBreakdownRow)=><tr key={row.country??allKey} className={row.country===null?'vote-country-all':undefined}>
    <th scope="row"><button type="button" className="insight-text-button" aria-pressed={pressed(row.country,null)} onClick={()=>choose(row.country,null)} lang={labelLang(row)}>{label(row)}</button></th>
    <td>{totalsText(row.counts)}</td>
    {majorityCell(row)}
    {groups.map(code=>{
      const cell=row.cells.get(code);
      if(!cell)return <td key={code} className="vote-none" aria-label={ui.t('votegroups.countries.none')}>–</td>;
      const text=ui.t('votegroups.countries.cell.split',{country:label(row),group:groupLabel(code,ui),for:String(cell.counts.for),against:String(cell.counts.against),abstaining:String(cell.counts.abstaining)});
      return <td key={code}><button type="button" className={'vote-'+(cell.position||'tied')} aria-pressed={pressed(row.country,code,cell.position||cell.tied![0])} aria-label={text} title={text} onClick={()=>choose(row.country,code,cell.position||cell.tied![0])}><span>{cell.count}</span>{cell.other>0&&<small className="vote-cell-more"><UiMessage id="votegroups.countries.more" values={{count:cell.other}}/></small>}</button></td>;
    })}
  </tr>;
  return <section className="vote-countries" lang={ui.language}>{heading}
    <table className="vote-country-table"><colgroup><col className="vote-col-country"/><col className="vote-col-total"/><col className="vote-col-majority"/>{groups.map(code=><col key={code}/>)}</colgroup>
      <thead><tr>
        <th scope="col" aria-sort={sorted('country')}><button type="button" onClick={()=>sortBy('country')}><UiMessage id="votegroups.countries.country"/></button></th>
        <th scope="col" aria-sort={sorted('total')}><button type="button" onClick={()=>sortBy('total')}><UiMessage id="votegroups.countries.total"/></button></th>
        <th scope="col" aria-sort={sorted('majority')}><button type="button" onClick={()=>sortBy('majority')}><UiMessage id="votegroups.countries.majority"/></button></th>
        {groups.map(code=><th scope="col" key={code} aria-sort={sorted('group',code)}><button type="button" lang={groupLabelLanguage(code,ui)} aria-label={ui.t('votegroups.countries.sort',{column:groupLabel(code,ui)})} title={groupLabel(code,ui)} onClick={()=>sortBy('group',code)}>{shortGroup(code)}</button></th>)}
      </tr></thead>
      <tbody>{everyone.map(tableRow)}</tbody>
    </table>
  </section>;
}
