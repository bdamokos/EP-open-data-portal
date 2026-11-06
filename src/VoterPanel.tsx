import {useEffect,useId,useState,type RefObject} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {InsightPortrait} from './InsightPortrait';
import {PersonName} from './PersonName';
import {insightMemberHref} from './InsightShared';
import {groupColor,groupLabel,groupLabelLanguage} from './groupLabels';
import {groupShortLabel} from './groupShort';
import {voteCountryName as countryName} from './voteCountryName';
import {listFor,type PanelVoter} from './voterPanelModel.mjs';
import {votePositionKeys,type VotePosition} from './votePositions';
import './VoterPanel.css';

export type PanelPosition='all'|VotePosition;
type Props={rows:PanelVoter[];counts:Record<'all'|VotePosition,number>;position:PanelPosition;group:string|null;country:string|null;query:string;language:string;headingRef:RefObject<HTMLHeadingElement|null>;
  onPosition:(position:PanelPosition)=>void;onQuery:(query:string)=>void;onClearGroup:()=>void;onClearCountry:()=>void;onClose:()=>void;onMember?:(id:number,sourceId?:string)=>void};
const pageSize=100;

// Who voted how: a compact list of rows with a position tab, a name search and the active country and group filters.
export function VoterPanel({rows,counts,position,group,country,query,language,headingRef,onPosition,onQuery,onClearGroup,onClearCountry,onClose,onMember}:Props) {
  const ui=useUiI18n(),headingId=useId(),[shown,setShown]=useState(pageSize);
  const list=listFor(rows,position);
  useEffect(()=>{setShown(pageSize);},[position,group,country,query]);
  useEffect(()=>{
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();onClose();}};
    document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);
  },[onClose]);
  const title=country||group?<>{country&&<span lang={language}>{countryName(country,language)}</span>}{country&&group&&' · '}{group&&<span lang={groupLabelLanguage(group,ui)}>{groupLabel(group,ui)}</span>}</>:null;
  return <section className="vote-voter-panel" role="region" aria-labelledby={headingId}>
    <header>
      <h3 id={headingId} ref={headingRef} tabIndex={-1}>{title||<UiMessage id="votegroups.panel.heading"/>}<small>{list.length}</small></h3>
      <button type="button" className="vote-voter-close" onClick={onClose} aria-label={ui.t('votegroups.panel.close')}><span aria-hidden="true">×</span></button>
    </header>
    <div className="insight-chart-switch vote-voter-tabs" role="group" aria-label={ui.t('legislation.vote_position.4dccce')}>
      {(['all',...votePositionKeys] as const).map(p=><button key={p} type="button" aria-pressed={position===p} onClick={()=>onPosition(p)}>{p==='all'?ui.t('votegroups.panel.tab.all'):ui.t('votegroups.position.'+p)} <span className="vote-voter-count">{counts[p]}</span></button>)}
    </div>
    <label className="vote-voter-search"><span className="vote-sr-only">{ui.t('votegroups.panel.search')}</span><input type="search" value={query} placeholder={ui.t('votegroups.panel.search')} onChange={event=>onQuery(event.target.value)}/></label>
    {(group||country)&&<div className="vote-voter-filters">{country&&<button type="button" className="insight-text-button" onClick={onClearCountry}><UiMessage id="votegroups.countries.clear"/></button>}{group&&<button type="button" className="insight-text-button" onClick={onClearGroup}><UiMessage id="legislation.all_groups.33c7d0"/></button>}</div>}
    <ul className="vote-voter-list">{list.slice(0,shown).map(row=><li key={row.id+row.position} className="vote-voter-row">
      <a href={insightMemberHref(row.id,language)} className="vote-voter-portrait" tabIndex={-1} aria-hidden="true" onClick={onMember?(event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;event.preventDefault();onMember(Number(row.id));}):undefined}><InsightPortrait id={row.id} name={row.name} onUnavailable={()=>{}}/></a>
      <span className="vote-voter-main">
        <a href={insightMemberHref(row.id,language)} className="vote-voter-name" onClick={onMember?(event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;event.preventDefault();onMember(Number(row.id));}):undefined}><PersonName id={row.id} label={row.name} fallback={ui.t('insightshared.mep')}/></a>
        <small><span lang={groupLabelLanguage(row.group,ui)}><i className="vote-voter-dot" style={{background:groupColor(row.group)}} aria-hidden="true"/>{row.group==='unavailable'?ui.t('votegroups.seats.unknownGroup'):groupShortLabel(row.group,ui)}</span>{row.country&&<> · <span lang={language}>{countryName(row.country,language)}</span></>}</small>
      </span>
      <span className={'vote-voter-position vote-'+row.position}>{ui.t('votegroups.position.'+row.position)}</span>
    </li>)}</ul>
    {list.length>shown&&<button type="button" className="insight-text-button" onClick={()=>setShown(value=>value+pageSize)}><UiMessage id="votegroups.panel.more"/></button>}
    {!list.length&&<p className="insight-secondary"><UiMessage id="legislation.no_named_voters_in_this_selection.51d18b"/></p>}
  </section>;
}
