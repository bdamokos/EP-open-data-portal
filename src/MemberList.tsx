import {Fragment,useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {MemberAffiliation} from './components/MemberAffiliation';
import {SaveButton} from './SavedControls';
import {useUiI18n,UiMessage} from './UiI18nReact';
import {groupColor,groupLabel,groupLabelLanguage} from './groupLabels';
import {countryName} from './interfaceLabels.mjs';
import {memberCommittees,memberListPageSize,memberParty,sortMembers} from './memberListPresentation.mjs';
import type {MemberSort} from './memberListPresentation.mjs';
import type {Committee,DirectoryMember} from './explorerTypes';
import './MemberList.css';

type SortKey='name'|'group'|'country';
type Props={
  members:DirectoryMember[];committees:Committee[];parties?:Record<string,string>|null;
  language:string;narrow:boolean;sort:MemberSort;onSort:(key:SortKey)=>void;onOpen:(id:number)=>void;
  // Supplied by App: importing Portrait here changes the build's chunk graph and merges the shared chunk into the entry.
  portrait:(member:DirectoryMember)=>ReactNode;
};
const fullName=(member:DirectoryMember)=>[member.firstName,member.lastName].filter(Boolean).join(' ');

export function MemberList({members,committees,parties,language,narrow,sort,onSort,onOpen,portrait}:Props) {
  const ui=useUiI18n();
  const [shown,setShown]=useState(memberListPageSize);
  const revealed=useRef<number|null>(null);
  const body=useRef<HTMLElement|null>(null);
  const collator=useMemo(()=>new Intl.Collator(language),[language]);
  const sorted=useMemo(()=>sortMembers(members,sort,{
    group:member=>member.groupCode&&member.groupCode!=='unavailable'?groupLabel(member.groupCode,ui):'',
    country:member=>/^[A-Z]{2}$/.test(member.countryCode||'')?countryName(language,member.countryCode!,ui):'',
    collate:collator.compare,
  }),[members,sort,language,ui,collator]);
  const rows=sorted.slice(0,shown);
  const showParty=!narrow&&Boolean(parties&&Object.keys(parties).length);
  // After "Show more", keyboard focus moves to the first member it added.
  useEffect(()=>{
    const index=revealed.current;revealed.current=null;
    if(index===null)return;
    body.current?.querySelectorAll<HTMLElement>('.member-list__open')[index]?.focus({preventScroll:true});
  },[shown]);
  const open=(member:DirectoryMember)=><button type="button" className="member-list__open" onClick={()=>onOpen(member.id)}>{fullName(member)}</button>;
  const committeeList=(member:DirectoryMember)=>{
    const items=memberCommittees(member,committees);
    if(!items?.length)return null;
    return <>{items.map((item,index)=><Fragment key={item.code}>{index>0&&', '}<span lang="">{item.code}</span>{item.substitute&&<>{' '}<span lang={ui.messageLocale('app.substituteShort')}><UiMessage id="app.substituteShort"/></span></>}</Fragment>)}</>;
  };
  const header=(key:SortKey,id:string)=>{
    const state=(sort.key??'name')===key?(sort.key&&sort.descending?'descending':'ascending'):'none';
    return <th scope="col" aria-sort={state}><button type="button" lang={ui.messageLocale(id)} onClick={()=>onSort(key)}><UiMessage id={id}/><span className="member-list__arrow" aria-hidden="true">{state==='ascending'?'▲':state==='descending'?'▼':''}</span></button></th>;
  };
  return <section className="member-list" ref={body}>
    {narrow ? <ul className="member-list__compact">
      {rows.map(member=><li key={member.id} data-member-id={member.id} lang="">
        {open(member)}
        <span className="member-list__follow"><SaveButton compact item={{kind:'mep',id:String(member.id),title:fullName(member)}}/></span>
        <MemberAffiliation group={member.groupCode} country={member.countryCode} language={language} detail={committeeList(member)}/>
      </li>)}
    </ul> : <table className="member-list__table">
      <thead><tr>
        <td/>
        {header('name','app.memberListName')}
        {header('group','groupvoices.political_group.c2db1f')}
        {header('country','interfaceLabels.country')}
        <th scope="col" lang={ui.messageLocale('app.memberListCommittees')}><UiMessage id="app.memberListCommittees"/></th>
        {showParty&&<th scope="col" lang={ui.messageLocale('app.memberListNationalParty')}><UiMessage id="app.memberListNationalParty"/></th>}
        <td/>
      </tr></thead>
      <tbody>{rows.map(member=>{
        const code=member.groupCode&&member.groupCode!=='unavailable'?member.groupCode:null;
        const party=showParty?memberParty(member,parties):null;
        return <tr key={member.id} data-member-id={member.id} lang="">
          <td className="member-list__photo">{portrait(member)}</td>
          <th scope="row">{open(member)}</th>
          <td>{code&&<span className="member-list__group" lang={groupLabelLanguage(code,ui)}><i aria-hidden="true" style={{background:groupColor(code)}}/>{groupLabel(code,ui)}</span>}</td>
          <td>{/^[A-Z]{2}$/.test(member.countryCode||'')&&<span lang={language}>{countryName(language,member.countryCode!,ui)}</span>}</td>
          <td>{committeeList(member)}</td>
          {showParty&&<td lang="">{party}</td>}
          <td className="member-list__follow"><SaveButton compact item={{kind:'mep',id:String(member.id),title:fullName(member)}}/></td>
        </tr>;
      })}</tbody>
    </table>}
    {rows.length<sorted.length&&<button type="button" className="member-list__more" lang={ui.messageLocale('app.showMore')} onClick={()=>{revealed.current=rows.length;setShown(shown+memberListPageSize);}}><UiMessage id="app.showMore"/></button>}
  </section>;
}
