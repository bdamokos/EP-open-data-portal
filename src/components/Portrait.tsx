import {publicUrl} from '../publicUrl';
import type {MemberSummary} from '../types';
import {OverflowText} from './OverflowText';
import {usePortraitImage} from '../usePortraitImage';

export function Portrait({member,labelled=false,onClick,className=''}:{member:MemberSummary;labelled?:boolean;onClick?:()=>void;className?:string}) {
 const fallback=publicUrl('assets/portrait-placeholder.svg');
 const url=member.imageUrl.startsWith('http')?member.imageUrl:publicUrl(member.imageUrl);
 const portrait=usePortraitImage(url,fallback,labelled);
 const content=<><img ref={portrait.imageRef} src={portrait.src} alt="" decoding="async" draggable={false} loading={labelled?'lazy':'eager'} onLoad={portrait.onLoad} onError={portrait.onError}/>{labelled&&<span className="portrait__label"><strong><OverflowText text={member.firstName}/></strong><strong><OverflowText text={member.lastName}/></strong></span>}</>;
 return onClick?<button className={`portrait portrait--button ${className}`} type="button" onClick={onClick} aria-label={`${member.firstName} ${member.lastName}`}>{content}</button>:<div className={`portrait ${className}`}>{content}</div>;
}
