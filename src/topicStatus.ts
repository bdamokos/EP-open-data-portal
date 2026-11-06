import {useEffect,useState} from 'react';
import {useInsightData} from './InsightData';
import type {TopicGroup} from './TopicsTypes';
import type {ProcedureStage} from '../server/procedure-steps.mjs';

export type DossierStatusesResponse={version:number;items:{id:string;reference:string;stage:ProcedureStage}[]};
const validId=(id:string|undefined)=>/^\d{4}-\d{4}[A-Z]?$/.test(id||'');

/** Stage by procedure id for the dossiers among the listed groups, one page of identifiers at a time.
 * A failed read leaves those rows without a status. */
export function useTopicStatuses(groups:TopicGroup[]) {
  const [known,setKnown]=useState<Record<string,ProcedureStage|null>>({});
  const missing=[...new Set(groups.filter(g=>g.reference&&validId(g.procedureId)).map(g=>g.procedureId!))].filter(id=>!(id in known)).sort().slice(0,20);
  const route=missing.length?'insights/dossier-statuses?procedures='+missing.join(','):null;
  const request=useInsightData<DossierStatusesResponse>(route);
  useEffect(()=>{
    if(!route||request.route!==route||request.loading||(!request.data&&!request.error))return;
    const stages=new Map((request.data?.items||[]).map(item=>[item.id,item.stage]));
    setKnown(previous=>({...previous,...Object.fromEntries(missing.map(id=>[id,stages.get(id)??null]))}));
  },[route,request.route,request.loading,request.data,request.error]);
  return known;
}
