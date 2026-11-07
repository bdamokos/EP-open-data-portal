import {useEffect,useState,type ReactNode} from 'react';

// A serif word with a caret, its value on the right. Content mounts on first open and stays.
export function FoldRow({title,value,open,onOpenChange,id,children}:{title:ReactNode;value?:ReactNode;open?:boolean;onOpenChange?:(open:boolean)=>void;id?:string;children:ReactNode}) {
  const [own,setOwn]=useState(Boolean(open)),shown=open??own,[mounted,setMounted]=useState(shown);
  useEffect(()=>{if(shown)setMounted(true);},[shown]);
  return <details className="frow" id={id} open={shown} onToggle={event=>{const next=event.currentTarget.open;if(next===shown)return;setOwn(next);onOpenChange?.(next);}}>
    <summary><span className="t">{title}<i className="car" aria-hidden="true"/></span>{value!==undefined&&<span className="val">{value}</span>}</summary>
    <div className="fopen">{mounted&&children}</div>
  </details>;
}
// The same row as a link out of the page.
export function FoldLink({title,value,href,onClick}:{title:ReactNode;value?:ReactNode;href:string;onClick?:React.MouseEventHandler<HTMLAnchorElement>}) {
  return <div className="frow"><div className="flink"><a className="t" href={href} onClick={onClick}>{title}</a>{value!==undefined&&<span className="val">{value}</span>}</div></div>;
}
