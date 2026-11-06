import type {ReactNode} from 'react';

// The one control on these pages: underlined words, a 44 px target, the chosen word pressed.
export function WordSwitch<T extends string>({options,value,onChange,label}:{options:readonly {value:T;label:ReactNode}[];value:T;onChange:(value:T)=>void;label:string}) {
  return <div className="wordswitch" role="group" aria-label={label}>{options.map(option=><button key={option.value} type="button" className="c word" aria-pressed={option.value===value} onClick={()=>onChange(option.value)}>{option.label}</button>)}</div>;
}
