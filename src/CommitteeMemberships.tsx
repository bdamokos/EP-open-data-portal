import type {Committee,MemberProfile} from './explorerTypes';
import {Period} from './Period';
import {committeeOrder,orderedMemberships} from './memberships.mjs';

export function CommitteeMemberships({profile,committees,lang,roleName,date,retry}:{
  profile:MemberProfile;committees:Committee[];lang:string;roleName:(role:string)=>string;date:(value:string,lang:string)=>string;retry:()=>void;
}) {
  const history=profile.committeeMemberships;
  const currentRosterMatched=profile.currentAffiliation?.status==='matched';
  const current=orderedMemberships(profile.memberships || [],committees);
  const cards=history?.items || current.map(m=>({id:m.id,identity:'body/'+m.id,code:m.id,names:{},roles:[m.role],periods:[{...m,observations:[]}]}));
  const ranks=['CHAIR','CHAIR_VICE','VICE_CHAIR','MEMBER','MEMBER_SUBSTITUTE'];
  const rank=(roles:string[])=>Math.min(...roles.map(role=>ranks.includes(role)?ranks.indexOf(role):9));
  const order=(card:typeof cards[number])=>{const code=committees.find(c=>c.id===card.id)?.code||card.code;const i=committeeOrder.indexOf(code);return i<0?999:i;};
  const ordered=cards.slice().sort((a,b)=>rank(a.roles)-rank(b.roles)||order(a)-order(b)||a.code.localeCompare(b.code));
  const period=(start:string|null,end:string|null,current:boolean)=>Period({start,end,ongoing:currentRosterMatched&&current,lang,date});
  return <>
    {!ordered.length&&<p lang="en">{history?.complete?'No active committee memberships were returned.':currentRosterMatched?'Current committee memberships are unavailable.':'Committee information is unavailable.'}</p>}
    {ordered.map(card=>{
      const body=committees.find(c=>c.id===card.id);
      const names:Record<string,string>=Object.keys(card.names).length?card.names:body?.names||{};
      const name=names[lang]?{text:names[lang],language:lang}:names.en?{text:names.en,language:'en'}:null;
      const periods=card.periods.slice().reverse();
      return <section className="explorer-membership" key={card.identity} aria-label={body?.code||card.code}>
        <strong><span lang="">{body?.code||card.code}</span>{currentRosterMatched&&card.roles.length>0&&<> · <span lang={card.roles.every(role=>ranks.includes(role))?lang:''}>{card.roles.map(roleName).join(' / ')}</span></>}</strong>
        {name&&<p lang={name.language}>{name.text}</p>}
        <ol className="explorer-membership-periods" aria-label="Roles in this committee" lang="en">
          {periods.map((p,i)=><li key={i} className={currentRosterMatched&&p.current?'is-current':''}>
            <span className="explorer-membership-role" lang={ranks.includes(p.role)?lang:''}>{roleName(p.role)}</span>
            <small lang={lang}>{period(p.start,p.end,p.current)}</small>
          </li>)}
        </ol>
      </section>;
    })}
    {history?.error&&<p className="explorer-membership-gap" lang="en">{history.error} <button type="button" onClick={retry}>Retry committee history</button></p>}
  </>;
}
