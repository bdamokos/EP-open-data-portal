import {createContext,useContext,useMemo,type ReactNode} from 'react';
import {personNameIndex,personDisplayName} from './personNames.mjs';

type DirectoryMember={id:number|string;firstName?:string;lastName?:string;countryCode?:string|null};
const Members=createContext(new Map<string,DirectoryMember>());
const Names=createContext(new Map<string,string>());
export function PersonNamesProvider({members,children}:{members?:DirectoryMember[];children:ReactNode}) {
  const names=useMemo(()=>personNameIndex(members),[members]);
  const directory=useMemo(()=>new Map((members||[]).filter(member=>/^[1-9]\d*$/.test(String(member.id))).map(member=>[String(member.id),member])),[members]);
  return <Members.Provider value={directory}><Names.Provider value={names}>{children}</Names.Provider></Members.Provider>;
}
export function usePersonName() {
  const names=useContext(Names);
  return (id:unknown,label?:string|null)=>personDisplayName(names,id,label);
}
export function PersonName({id,label,fallback=''}:{id:unknown;label?:string|null;fallback?:string}) {
  const name=usePersonName()(id,label)||fallback;
  return <span lang="" title={label&&label!==name?`Source label: ${label}`:undefined}>{name}</span>;
}

export function useDirectoryMember(id:unknown) {
  return useContext(Members).get(/^[1-9]\d*$/.test(String(id))?String(id):'');
}
