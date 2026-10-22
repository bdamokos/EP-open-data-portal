import {createContext,useContext,useMemo,type ReactNode} from 'react';
import {personNameIndex,personDisplayName} from './personNames.mjs';

const Names=createContext(new Map<string,string>());
export function PersonNamesProvider({members,children}:{members?:{id:number|string;firstName?:string;lastName?:string}[];children:ReactNode}) {
  const names=useMemo(()=>personNameIndex(members),[members]);
  return <Names.Provider value={names}>{children}</Names.Provider>;
}
export function usePersonName() {
  const names=useContext(Names);
  return (id:unknown,label?:string|null)=>personDisplayName(names,id,label);
}
export function PersonName({id,label,fallback=''}:{id:unknown;label?:string|null;fallback?:string}) {
  const name=usePersonName()(id,label)||fallback;
  return <span lang="" title={label&&label!==name?`Source label: ${label}`:undefined}>{name}</span>;
}
