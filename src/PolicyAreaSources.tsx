import {createContext,useCallback,useContext,useEffect,useId,useState,type ReactNode} from 'react';
import {UiMessage} from './UiI18nReact';
import type {TopicConcept} from './TopicsTypes';

type LabelPresence='none'|'policy'|'translated';
const Labels=createContext<((id:string,state:LabelPresence|null)=>void)|null>(null);
export function usePolicyAreaLabels(labels:(TopicConcept|null|undefined)[]){
 const register=useContext(Labels),id=useId(),policy=labels.filter(label=>label?.key.startsWith('oeil:')),state:LabelPresence=policy.some(label=>label?.labelSource==='explorer-translation')?'translated':policy.length?'policy':'none';
 useEffect(()=>{register?.(id,state);return()=>register?.(id,null);},[register,id,state]);
 return register!==null;
}
export function PolicyAreaLabelUsage({labels}:{labels:(TopicConcept|null|undefined)[]}){usePolicyAreaLabels(labels);return null;}
export function PolicyAreaSources({translated=false}:{translated?:boolean}){
 return <details className="policy-area-sources"><summary><UiMessage id="amendments.sources.2eb56b"/></summary><p><UiMessage id="topics.policyAreaSource" values={{source:<a href="https://oeil.europarl.europa.eu/oeil/en/search" target="_blank" rel="noreferrer" lang="en">Legislative Observatory</a>}}/></p>{translated&&<p><UiMessage id="topics.explorerTranslation"/></p>}</details>;
}
export function PolicyAreaSourcesPage({children,enabled=true}:{children:ReactNode;enabled?:boolean}){
 const [labels,setLabels]=useState(new Map<string,LabelPresence>());
 const register=useCallback((id:string,state:LabelPresence|null)=>setLabels(previous=>{
  if(state===null&&!previous.has(id)||previous.get(id)===state)return previous;
  const next=new Map(previous);if(state===null)next.delete(id);else next.set(id,state);return next;
 }),[]);
 return <Labels.Provider value={register}>{children}{enabled&&[...labels.values()].some(state=>state!=='none')&&<PolicyAreaSources translated={[...labels.values()].some(state=>state==='translated')}/>}</Labels.Provider>;
}
