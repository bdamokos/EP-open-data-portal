import {publicUrl} from '../publicUrl';
import type {MemberSummary} from '../types';
import {OverflowText} from './OverflowText';
import {usePortraitImage} from '../usePortraitImage';

export function Portrait({member,labelled=false,eager=false,onClick,className=''}:{member:MemberSummary;labelled?:boolean;eager?:boolean;onClick?:()=>void;className?:string}) {
 const fallback=publicUrl('assets/portrait-placeholder.svg');
 const url=member.imageUrl.startsWith('http')?member.imageUrl:publicUrl(member.imageUrl);
 const portrait=usePortraitImage(url,fallback,labelled&&!eager);
 const content=<><span className="portrait__photo" data-state={portrait.status} aria-hidden="true"><svg className="portrait__silhouette" viewBox="0 0 300 380" focusable="false"><circle cx="150" cy="125" r="58"/><path d="M40 380v-35c0-83 40-133 110-133s110 50 110 133v35"/></svg><img ref={portrait.imageRef} src={portrait.src} alt="" decoding="async" draggable={false} loading={portrait.loading} fetchPriority={eager?'high':'auto'} onLoad={portrait.onLoad} onError={portrait.onError}/></span>{labelled&&<span className="portrait__label"><strong><OverflowText text={member.firstName}/></strong><strong><OverflowText text={member.lastName}/></strong></span>}</>;
 return onClick?<button className={`portrait portrait--button ${className}`} type="button" onClick={onClick} aria-label={`${member.firstName} ${member.lastName}`}>{content}</button>:<div className={`portrait ${className}`}>{content}</div>;
}
