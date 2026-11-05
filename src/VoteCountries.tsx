import {useMemo,useState} from 'react';
import {useNarrow} from './useNarrow';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {countryName} from './CountryMap';
import {groupLabel,groupLabelLanguage} from './groupLabels';
import {countryGroupBreakdown,encodeMatrixSort,decodeMatrixSort,type MatrixSort,type CountryBreakdownRow} from './voteSeatsModel.mjs';
import {positionsUi,votePositionKeys,type VotePosition} from './votePositions';
import {VoteBar} from './VoteResult';
import type {VoteMetricRow} from './voteGroupMetrics.mjs';
import {useExplorerParam} from './explorerUrl';
import './VoteBreakdown.css';

type Row=VoteMetricRow&{id?:string};
type Props={rows:Row[];language:string;country:string|null;group:string|null;position:VotePosition|null;onChoose:(country:string|null,group:string|null,position:VotePosition)=>void};
function sortRows(rows:CountryBreakdownRow[],sort:MatrixSort,language:string) {
  const name=(row:CountryBreakdownRow)=>countryName(row.country,language);
  const by=sort.kind==='country'
    ? (a:CountryBreakdownRow,b:CountryBreakdownRow)=>name(a).localeCompare(name(b),language)
    : (a:CountryBreakdownRow,b:CountryBreakdownRow)=>{
      // Countries without ballots for the group always sort last.
      const x=a.cells.get(sort.key)?.count||0,y=b.cells.get(sort.key)?.count||0;
      if(!x||!y)return (x?0:1)-(y?0:1)||name(a).localeCompare(name(b),language);
      return (x-y)*(sort.dir==='asc'?1:-1)||name(a).localeCompare(name(b),language);
    };
  return [...rows].sort((a,b)=>sort.kind==='country'&&sort.dir==='desc'?by(b,a):by(a,b));
}

export function VoteCountries({rows,language,country,group,position,onChoose}:Props) {
  const ui=useUiI18n(),positions=positionsUi(ui),narrow=useNarrow();
  const [rawSort,setRawSort]=useExplorerParam<string>('agenda-country-sort','');
  const sort=decodeMatrixSort(rawSort)||{kind:'country',dir:'asc'} as MatrixSort;
  const [open,setOpen]=useState<string|null>(null);
  const breakdown=useMemo(()=>countryGroupBreakdown(rows),[rows]);
  const groups=useMemo(()=>[...new Set(breakdown.flatMap(row=>[...row.groups.keys()]))].sort((a,b)=>breakdown.reduce((n,row)=>n+(row.cells.get(b)?.count||0)-(row.cells.get(a)?.count||0),0)||a.localeCompare(b)),[breakdown]);
  const ordered=useMemo(()=>sortRows(breakdown,sort,language),[breakdown,rawSort,language]);
  if(!breakdown.length)return null;
  const choose=(code:string,groupCode:string|null,preferred?:VotePosition)=>{
    const counts=groupCode?breakdown.find(row=>row.country===code)?.groups.get(groupCode):breakdown.find(row=>row.country===code)?.counts;
    const best=preferred||votePositionKeys.reduce((a,b)=>(counts?.[b]||0)>(counts?.[a]||0)?b:a,votePositionKeys[0]);
    onChoose(code,groupCode,best);
  };
  const sortBy=(kind:'country'|'group',key?:string)=>{
    const same=sort.kind===kind&&(kind==='country'||sort.key===key);
    const dir=same?(sort.dir==='asc'?'desc':'asc'):(kind==='country'?'asc':'desc');
    setRawSort(encodeMatrixSort(kind==='country'?{kind,dir}:{kind,key:key!,dir}));
  };
  const heading=<h4><UiMessage id="voteCountries.heading"/></h4>;
  const totalsText=(counts:Record<VotePosition,number>)=><span className="vote-country-totals">{votePositionKeys.map((p,i)=><span key={p} className={'vote-'+p}>{i?' · ':''}{counts[p]}</span>)}</span>;
  const label=(code:string)=>countryName(code,language);
  if(narrow)return <section className="vote-countries" lang={ui.language}>{heading}
    <ul className="vote-country-list">{ordered.map(row=>{
      const expanded=open===row.country;
      return <li key={row.country}>
        <button type="button" className="vote-country-row" aria-expanded={expanded} onClick={()=>setOpen(expanded?null:row.country)} aria-label={ui.t('voteCountries.country_row',{country:label(row.country),for:String(row.counts.for),against:String(row.counts.against),abstaining:String(row.counts.abstaining)})}>
          <span className="vote-country-row-head"><span lang={language}>{label(row.country)}</span>{totalsText(row.counts)}</span>
          <VoteBar totals={row.counts} thin/>
        </button>
        {expanded&&<ul className="vote-country-groups">
          <li><button type="button" aria-pressed={country===row.country&&!group} onClick={()=>choose(row.country,null)}><span><UiMessage id="voteCountries.total"/></span>{totalsText(row.counts)}</button></li>
          {[...row.groups].map(([code,counts])=><li key={code}><button type="button" aria-pressed={country===row.country&&group===code} aria-label={ui.t('voteCountries.group_row',{group:groupLabel(code,ui),for:String(counts.for),against:String(counts.against),abstaining:String(counts.abstaining)})} onClick={()=>choose(row.country,code)}><span lang={groupLabelLanguage(code,ui)}>{groupLabel(code,ui)}</span>{totalsText(counts)}</button></li>)}
        </ul>}
      </li>;
    })}</ul>
  </section>;
  const sorted=(kind:'country'|'group',key?:string)=>sort.kind===kind&&(kind==='country'||sort.key===key)?(sort.dir==='asc'?'ascending':'descending'):'none';
  return <section className="vote-countries" lang={ui.language}>{heading}
    <div style={{overflowX:'auto'}}><table className="vote-country-table">
      <thead><tr>
        <th scope="col" aria-sort={sorted('country')}><button type="button" onClick={()=>sortBy('country')}><UiMessage id="voteCountries.country"/></button></th>
        <th scope="col"><UiMessage id="voteCountries.total"/></th>
        {groups.map(code=><th scope="col" key={code} aria-sort={sorted('group',code)}><button type="button" lang={groupLabelLanguage(code,ui)} aria-label={ui.t('voteCountries.sort',{column:groupLabel(code,ui)})} onClick={()=>sortBy('group',code)}>{groupLabel(code,ui)}</button></th>)}
      </tr></thead>
      <tbody>{ordered.map(row=><tr key={row.country}>
        <th scope="row"><button type="button" className="insight-text-button" aria-pressed={country===row.country&&!group} onClick={()=>choose(row.country,null)} lang={language}>{label(row.country)}</button></th>
        <td>{totalsText(row.counts)}</td>
        {groups.map(code=>{
          const cell=row.cells.get(code);
          if(!cell)return <td key={code} className="vote-none" aria-label={ui.t('voteCountries.none')}>–</td>;
          const text=cell.position?positions[cell.position]:cell.tied!.map(p=>positions[p]).join(' / ');
          return <td key={code}><button type="button" className={'vote-'+(cell.position||'tied')} aria-pressed={country===row.country&&group===code} aria-label={ui.t('voteCountries.cell',{country:label(row.country),group:groupLabel(code,ui),count:String(cell.count),position:text})} title={text} onClick={()=>choose(row.country,code,cell.position||cell.tied![0])}>{cell.count}</button></td>;
        })}
      </tr>)}</tbody>
    </table></div>
  </section>;
}
