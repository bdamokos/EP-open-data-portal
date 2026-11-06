import type {MouseEventHandler,ReactNode} from 'react';

// A strip link; on a phone only its narrow form shows.
export function StripLink({href,onClick,wide,narrow,label}:{href:string|null;onClick?:MouseEventHandler<HTMLAnchorElement>;wide:ReactNode;narrow:ReactNode;label?:string}) {
  const body=<span><span className="on-wide">{wide}</span><span className="on-narrow">{narrow}</span></span>;
  return href?<a className="c" href={href} onClick={onClick} aria-label={label}>{body}</a>:<span className="c muted" aria-disabled="true">{body}</span>;
}
// The top row: back link on the left, stepper on the right.
export function PageStrip({back,children}:{back:ReactNode;children?:ReactNode}) {
  return <div className="strip">{back}{children&&<span className="step">{children}</span>}</div>;
}
