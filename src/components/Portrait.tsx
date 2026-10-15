import {useEffect,useState} from 'react';
import {publicUrl} from '../publicUrl';
import type {MemberSummary} from '../types';
import {OverflowText} from './OverflowText';

export function Portrait({member,labelled=false,onClick,className=''}:{member:MemberSummary;labelled?:boolean;onClick?:()=>void;className?:string}) {
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[member.id,member.imageUrl]);
 const fallback=publicUrl('assets/portrait-placeholder.svg');
 const image=failed?fallback:member.imageUrl.startsWith('http')?member.imageUrl:publicUrl(member.imageUrl);
 const content=<><img src={image} alt="" decoding="async" draggable={false} loading={labelled?'lazy':'eager'} onError={()=>setFailed(true)}/>{labelled&&<span className="portrait__label"><strong><OverflowText text={member.firstName}/></strong><strong><OverflowText text={member.lastName}/></strong></span>}</>;
 return onClick?<button className={`portrait portrait--button ${className}`} type="button" onClick={onClick} aria-label={`${member.firstName} ${member.lastName}`}>{content}</button>:<div className={`portrait ${className}`}>{content}</div>;
}
