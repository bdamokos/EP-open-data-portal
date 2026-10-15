import {useExplorerParam} from './pocExplorerUrl';
import {useInsightData} from './PocInsightData';
import {countryName} from './PocCountryMap';
import {CountryFilter} from './PocCountryFilter';
import {humanDate} from './PocInsightCharts';
type Metric='speakers'|'voters'|'amendmentVotes';
type Row={id:string;title:string;date:string;sittingId:string;upcoming:boolean;speakers:number|null;voters:number|null;amendmentVotes:number|null;rollCalls:number};
type Response={topics:Row[];series:({date:string}&Record<Metric,number|null>)[];window:{start:string;end:string};coverage:{topicsWithSpeechLinks:number;topics:number;gaps:{kind:string;sitting:string}[]}};
type Sitting={id:string;date:string;phase?:string};
export function plenaryMonday(date:string){const day=new Date(date+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);return day.toISOString().slice(0,10);}
export function PocParticipation({language,sittings,onTopic}:{language:string;sittings:Sitting[];onTopic:(sitting:string,topic:string)=>void}) {
  const latest=[...sittings].filter(s=>s.phase!=='upcoming').sort((a,b)=>b.date.localeCompare(a.date))[0]||sittings[0];
  const [period,setPeriod]=useExplorerParam('hot-period','sitting:'+(latest?.id||'')),[metric,setMetric]=useExplorerParam<Metric>('hot-rank','speakers',['speakers','voters','amendmentVotes']),[country,setCountry]=useExplorerParam<string|null>('hot-country',null),[search,setSearch]=useExplorerParam<string>('hot-search','');
  const [kind,value]=[period.slice(0,period.indexOf(':')),period.slice(period.indexOf(':')+1)];
  const params=new URLSearchParams({lang:language,...(country?{country}:{}),[kind]:value});
  const state=useInsightData<Response>(value?'insights/participation?'+params:null),data=state.data;
  const labels:Record<Metric,string>={speakers:'MEPs speaking',voters:'MEPs voting',amendmentVotes:'Amendment roll-calls'};
  const weeks=[...new Set(sittings.map(s=>plenaryMonday(s.date)))].sort().reverse();
  const rows=data?[...data.topics].filter(row=>row.title.toLocaleLowerCase(language).includes(search.toLocaleLowerCase(language))).sort((a,b)=>(b[metric]??-1)-(a[metric]??-1)||a.title.localeCompare(b.title)):[];
  const bins=data?.series||[],hasActivity=data?.topics.some(row=>row[metric]!==null),future=kind==='sitting'&&sittings.find(s=>s.id===value)?.phase==='upcoming'||Boolean(data?.topics.length&&data.topics.every(row=>row.upcoming));
  const max=Math.max(1,...bins.map(bin=>bin[metric]||0)),x=(i:number)=>20+i/Math.max(1,bins.length-1)*620,y=(count:number)=>135-count/max*115;
  const line=bins.map((bin,i)=>bin[metric]===null?'':`${i===0||bins[i-1][metric]===null?'M':'L'}${x(i)},${y(bin[metric]!)}`).join(' ');
  function chooseCountry(code:string|null){setCountry(code);if(code&&metric==='amendmentVotes')setMetric('speakers');}
  return <section className="insight-participation">
    <div className="insight-controls insight-participation-controls">
      <label>Period<select value={period} onChange={event=>setPeriod(event.target.value)}><optgroup label="Sittings">{sittings.map(s=><option key={s.id} value={'sitting:'+s.id}>{humanDate(s.date,language)}{s.phase==='upcoming'?' · upcoming':''}</option>)}</optgroup><optgroup label="Whole weeks">{weeks.map(week=><option key={week} value={'week:'+week}>Week of {humanDate(week,language)}</option>)}</optgroup></select></label>
      <CountryFilter country={country} onChange={chooseCountry} language={language}/>
      <label>Rank by<select value={metric} onChange={event=>setMetric(event.target.value as Metric)}>{Object.entries({speakers:'Speakers',voters:'Voters',amendmentVotes:'Roll-calls'}).map(([key,label])=><option key={key} value={key} disabled={Boolean(country&&key==='amendmentVotes')}>{label}</option>)}</select></label>
      <label className="insight-participation-search">Find an agenda item<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search titles"/></label>
    </div>
    {(country||search)&&<div className="insight-active-filters" aria-label="Active participation filters">{country&&<button onClick={()=>chooseCountry(null)}>MEPs elected in {countryName(country,language)} ×</button>}{search&&<button onClick={()=>setSearch('')}>Title: {search} ×</button>}</div>}
    {!data&&state.loading&&<p role="status">Loading participation…</p>}{state.error&&<p role="alert">Participation temporarily unavailable. <button onClick={state.retry}>Reload</button></p>}
    {data&&<>
      <p className="insight-chart-caption">{humanDate(data.window.start,language)}{data.window.end!==data.window.start?' — '+humanDate(data.window.end,language):''} · {country?'MEPs elected in '+countryName(country,language):'All current MEPs'}</p>
      {future&&<p className="insight-empty-state">This period has not taken place. {rows.length?'Open a scheduled item to read its agenda and earlier linked debate.':'Activity will appear after the sitting.'}</p>}
      {!future&&!hasActivity&&<p className="insight-empty-state">No saved {labels[metric].toLowerCase()} for this period. Choose another sitting or open an agenda item below.</p>}
      {bins.length>1&&hasActivity&&<figure className="insight-participation-trend"><figcaption>{labels[metric]} per sitting</figcaption><svg viewBox="0 0 660 155" role="img" aria-label={labels[metric]+': '+bins.map(bin=>humanDate(bin.date,language)+' '+(bin[metric]??'unavailable')).join(', ')}><line x1="20" x2="640" y1="135" y2="135" stroke="#ffffff40"/><path d={line} fill="none" stroke="#fff200" strokeWidth="3"/>{bins.map((bin,i)=>bin[metric]!==null?<circle key={bin.date} cx={x(i)} cy={y(bin[metric]!)} r="5" fill="#fff200"><title>{humanDate(bin.date,language)}: {bin[metric]}</title></circle>:null)}</svg><ol>{bins.map(bin=><li key={bin.date}><strong>{bin[metric]??'—'}</strong><span>{new Intl.DateTimeFormat(language,{weekday:'short',day:'numeric',month:'short'}).format(new Date(bin.date+'T12:00:00Z'))}</span></li>)}</ol></figure>}
      <div className="insight-participation-table"><div className="insight-participation-table-header"><span>{future?'Scheduled agenda':'Agenda item'}</span><span>Speaking</span><span>Voting</span><span>Amendment roll-calls <small>All MEPs</small></span></div>{rows.map((row,i)=><button key={row.id} className="insight-participation-row" onClick={()=>onTopic(row.sittingId,row.id)}><span><b>{row[metric]===null?'':i+1}</b><strong>{row.title}</strong><small>{humanDate(row.date,language)}{row.upcoming?' · upcoming':''}</small></span>{(['speakers','voters','amendmentVotes'] as const).map(key=><span className={metric===key?'is-ranked':undefined} key={key}><small>{key==='amendmentVotes'?'Roll-calls · all MEPs':key==='speakers'?'Speaking':'Voting'}</small>{row[key]??'—'}</span>)}</button>)}</div>
      {!rows.length&&<p>{search?'No agenda titles match this search.':'No agenda items available in this view.'}</p>}
      <p className="insight-chart-caption">Distinct current MEPs per item. Speaking counts use saved debate links; — means unavailable. Amendment roll-calls cover all MEPs and count votes, not amendments tabled.</p>{data.coverage.gaps.length>0&&<p className="insight-secondary">Partial coverage: some source details are unavailable or exceed this view’s limit.</p>}
    </>}
  </section>;
}
