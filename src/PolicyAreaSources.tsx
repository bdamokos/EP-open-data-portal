import {createContext,useCallback,useContext,useEffect,useId,useState,type ReactNode} from 'react';
import {UiMessage} from './UiI18nReact';
import type {TopicConcept} from './TopicsTypes';

const Labels=createContext<((id:string,translated:boolean|null)=>void)|null>(null);
export function usePolicyAreaLabels(labels:(TopicConcept|null|undefined)[]){
 const register=useContext(Labels),id=useId(),translated=labels.some(label=>label?.key.startsWith('oeil:')&&label.labelSource==='explorer-translation');
 useEffect(()=>{register?.(id,translated);return()=>register?.(id,null);},[register,id,translated]);
 return register!==null;
}
export function PolicyAreaSources({translated=false}:{translated?:boolean}){
 return <details className="policy-area-sources"><summary><UiMessage id="amendments.sources.2eb56b"/></summary><p><UiMessage id="topics.policyAreaSource" values={{source:<a href="https://oeil.europarl.europa.eu/oeil/en/search" target="_blank" rel="noreferrer" lang="en">Legislative Observatory</a>}}/></p>{translated&&<p><UiMessage id="topics.explorerTranslation"/></p>}</details>;
}
export function PolicyAreaSourcesPage({children,enabled=true}:{children:ReactNode;enabled?:boolean}){
 const [labels,setLabels]=useState(new Map<string,boolean>());
 const register=useCallback((id:string,translated:boolean|null)=>setLabels(previous=>{
  if(translated===null&&!previous.has(id)||previous.get(id)===translated)return previous;
  const next=new Map(previous);if(translated===null)next.delete(id);else next.set(id,translated);return next;
 }),[]);
 if(!enabled)return <>{children}</>;
 return <Labels.Provider value={register}>{children}<PolicyAreaSources translated={[...labels.values()].some(Boolean)}/></Labels.Provider>;
}
