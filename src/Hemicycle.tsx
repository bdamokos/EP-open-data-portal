import {useMemo,useState,type MouseEvent} from 'react';
import {useData} from './data';
import {InsightShell,InsightStatus} from './InsightShared';
import type {InsightProps} from './InsightTypes';
import {useExplorerParam} from './explorerUrl';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {CountryFilter} from './CountryFilter';
import {matchesCountry} from './countries.mjs';
import {countryName} from './interfaceLabels.mjs';
import {groupColor,groupLabel} from './groupLabels';
import {InsightPortrait} from './InsightPortrait';
import {SourceLink} from './SourceLink';
import {groupCounts,nearestSeat,seatMatches,type HemicycleSeat} from './hemicycleModel.mjs';
import './Hemicycle.css';

type ChangedMember={member:number;name:string;firstName:string;group:string;seat?:number;from?:number|string};
type HemicycleChange={observedAt:string;sourceDate:string|null;joined:ChangedMember[];left:ChangedMember[];moved:ChangedMember[];regrouped:ChangedMember[]};
type HemicyclePlan={chamber:string;sourcePageUrl:string;sourceDate:string|null;width:number;height:number;seats:HemicycleSeat[];changes:HemicycleChange[]|null};

const chambers=['str','bru'] as const;
const formatDate=(value:string,language:string)=>new Intl.DateTimeFormat(language,{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(value));
const ignoreMissingPortrait=()=>{};
const fullName=(person:{firstName?:string;name?:string})=>`${person.firstName||''} ${person.name||''}`.trim();

function seatFill(seat:HemicycleSeat) {
  if(seat.member)return groupColor(seat.group||'');
  return seat.institution?'var(--chart-neutral)':'transparent';
}

function Change({change,language}:{change:HemicycleChange;language:string}) {
  const ui=useUiI18n();
  const parts=(['joined','left','moved','regrouped'] as const).filter(kind=>change[kind].length).map(kind=>ui.t(`hemicycle.change.${kind}`,{count:String(change[kind].length)}));
  const people=[...change.joined,...change.left,...change.moved,...change.regrouped];
  return <li><details>
    <summary>{formatDate(change.sourceDate||change.observedAt,language)}: {parts.join(', ')}</summary>
    {people.length>0&&<ul>{people.map(person=><li key={`${person.member}:${person.seat}:${person.from}`}>{fullName(person)}{person.from!==undefined?`: ${person.from} → ${person.seat??person.group}`:person.seat!==undefined?`: ${person.seat}`:''}</li>)}</ul>}
  </details></li>;
}

export function Hemicycle(props:InsightProps) {
  const ui=useUiI18n(),language=props.language||'en';
  const [chamber,setChamber]=useExplorerParam<'str'|'bru'>('hc-chamber','str',chambers);
  const [query,setQuery]=useExplorerParam<string>('hc-q','');
  const [group,setGroup]=useExplorerParam<string|null>('hc-group',null);
  const [country,setCountry]=useExplorerParam<string|null>('hc-country',null);
  const [member,setMember]=useExplorerParam<string|null>('hc-member',null);
  const [picked,setPicked]=useState<number|null>(null);
  const state=useData<HemicyclePlan>(`hemicycle/${chamber}`);
  const plan=state.data?.chamber===chamber?state.data:null;
  const seats=useMemo(()=>plan?.seats||[],[plan]);
  const counts=useMemo(()=>groupCounts(seats),[seats]);
  const filter=useMemo(()=>({query,group,country}),[query,group,country]);
  const filtering=Boolean(query.trim()||group||country);
  const matches=useMemo(()=>new Set(seats.filter(seat=>seatMatches(seat,filter,matchesCountry)).map(seat=>seat.seat)),[seats,filter]);
  const results=useMemo(()=>filtering?seats.filter(seat=>matches.has(seat.seat)):[],[filtering,seats,matches]);
  const selected=seats.find(seat=>member!==null?String(seat.member)===member:seat.seat===picked)||null;
  const select=(seat:HemicycleSeat|null)=>{setMember(seat?.member?String(seat.member):null);setPicked(seat&&!seat.member?seat.seat:null);};
  const press=(event:MouseEvent<SVGSVGElement>)=>{
    const matrix=event.currentTarget.getScreenCTM();
    if(!matrix)return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    select(nearestSeat(seats,point.x,point.y,14/matrix.a));
  };
  const seatLayer=useMemo(()=>seats.map(seat=><circle key={seat.seat} cx={seat.x} cy={seat.y} r={seat.r} fill={seatFill(seat)} data-dimmed={filtering&&!matches.has(seat.seat)?'true':undefined} data-empty={!seat.member&&!seat.institution?'true':undefined}>
    <title>{seat.member?`${fullName(seat)} · ${seat.seat}`:seat.institution?ui.t(`hemicycle.${seat.institution}`):ui.t('hemicycle.emptySeat')}</title>
  </circle>),[seats,filtering,matches,ui]);

  return <InsightShell {...props} language={language} title={ui.t('hemicycle.title')} view="hemicycle">
    <div className="hemicycle" lang={ui.language}>
      <div className="hemicycle-heading">
        <div className="insight-chart-switch" role="group" aria-label={ui.t('hemicycle.chamber')}>
          {chambers.map(item=><button key={item} type="button" aria-pressed={chamber===item} onClick={()=>{setChamber(item);setPicked(null);}}><UiMessage id={`hemicycle.chamber.${item}`}/></button>)}
        </div>
        {plan?.sourceDate&&<p><UiMessage id="hemicycle.planDate" values={{date:formatDate(plan.sourceDate,language)}}/> · <SourceLink url={plan.sourcePageUrl} language={language}><UiMessage id="hemicycle.source"/></SourceLink></p>}
      </div>
      <div className="hemicycle-filters">
        <label><UiMessage id="hemicycle.searchLabel"/><input type="search" value={query} onChange={event=>setQuery(event.target.value)}/></label>
        <CountryFilter country={country} onChange={setCountry} language={language}/>
      </div>
      {!plan?<InsightStatus loading={state.loading} error={state.error?ui.t('hemicycle.unavailable'):null} retry={state.retry} loadingMessage={ui.t('hemicycle.loading')}/>:<>
        <div className="hemicycle-groups" role="group" aria-label={ui.t('hemicycle.groups')}>
          <button type="button" aria-pressed={!group} onClick={()=>setGroup(null)}><UiMessage id="hemicycle.allGroups"/></button>
          {counts.map(({group:code,count})=><button key={code} type="button" aria-pressed={group===code} onClick={()=>setGroup(group===code?null:code)}>
            <span className="hemicycle-swatch" style={{background:groupColor(code)}} aria-hidden="true"/>{groupLabel(code,ui)} <span className="hemicycle-count">{count}</span>
          </button>)}
        </div>
        <div className="hemicycle-layout">
          <figure>
            <svg viewBox={`0 0 ${plan.width} ${plan.height}`} role="img" aria-label={ui.t('hemicycle.chart',{chamber:ui.t(`hemicycle.chamber.${chamber}`)})} onClick={press}>
              {seatLayer}
              {selected&&<circle className="hemicycle-selected" cx={selected.x} cy={selected.y} r={selected.r*1.7} style={{strokeWidth:selected.r*.55}}/>}
            </svg>
          </figure>
          <aside className="hemicycle-detail" aria-live="polite">
            {!selected?<p><UiMessage id={member!==null?'hemicycle.noSeat':'hemicycle.selectSeat'}/></p>:selected.member?<>
              <InsightPortrait id={String(selected.member)} name={fullName(selected)} onUnavailable={ignoreMissingPortrait}/>
              <h2>{fullName(selected)}</h2>
              <p><UiMessage id="hemicycle.seat" values={{seat:String(selected.seat)}}/></p>
              <p>{groupLabel(selected.group||'',ui)}{selected.country?` · ${countryName(language,selected.country,ui)}`:''}</p>
              <button type="button" onClick={()=>props.onMember?.(selected.member!)}><UiMessage id="hemicycle.openMember"/></button>
            </>:<>
              <h2><UiMessage id="hemicycle.seat" values={{seat:String(selected.seat)}}/></h2>
              <p>{selected.institution?ui.t(`hemicycle.${selected.institution}`):ui.t('hemicycle.emptySeat')}</p>
            </>}
          </aside>
        </div>
        {filtering&&<section className="hemicycle-results">
          <h2>{results.length?ui.t('hemicycle.results',{count:String(results.length)}):ui.t('hemicycle.noResults')}</h2>
          {results.length>0&&<ul>{results.map(seat=><li key={seat.seat}><button type="button" aria-pressed={selected?.seat===seat.seat} onClick={()=>select(seat)}>
            <span>{seat.member?fullName(seat):seat.institution?ui.t(`hemicycle.${seat.institution}`):ui.t('hemicycle.emptySeat')}</span><span className="hemicycle-count">{seat.seat}</span>
          </button></li>)}</ul>}
        </section>}
        {Boolean(plan.changes?.length)&&<section className="hemicycle-changes">
          <h2><UiMessage id="hemicycle.changes"/></h2>
          <ul>{plan.changes!.map(change=><Change key={change.observedAt} change={change} language={language}/>)}</ul>
        </section>}
      </>}
    </div>
  </InsightShell>;
}
