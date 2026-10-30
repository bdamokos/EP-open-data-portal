import {amendmentsPage,amendmentAuthorMatch,amendmentGeneration,amendmentContributors,amendmentProcedureTargets} from './amendments-store.mjs';
import {resolvedAmendmentAuthorId,amendmentProposerDate,validAmendmentDate} from './amendments.mjs';

export const TOPIC_AMENDMENT_LIMITS=Object.freeze({documents:6,rows:500});

export const topicAmendmentsCacheable=value=>!value?.detail?.amendments?.documents?.some(document=>document.status==='unavailable'||document.coverage===null);

// Read the same checked attribution as the amendment catalogue. Never discover
// new sources or walk pages while rendering a topic's participant cards.
export function topicAmendments(store,documentIds,people,{readPage=amendmentsPage,procedureIds=[],asOf=null}={}) {
  const targets=[...new Set(documentIds.filter(id=>/^(?:A|B|RC)-10-\d{4}-\d{4,6}$/.test(id)))];
  const counts=Object.fromEntries(people.map(person=>[person.id,null])),countsByStage=Object.fromEntries(people.map(person=>[person.id,{committee:null,plenary:null}])),authorDates={},seen=new Map(),uncountable=new Map(),documents=[];
  const observe=(id,amendmentId,scope,date,countConflict=false)=>{
    if(asOf&&(!validAmendmentDate(date)||date>asOf))return;
    if(countConflict){const blocked=uncountable.get(id)||new Set();blocked.add(scope);uncountable.set(id,blocked);}
    const stages=seen.get(id)||{committee:new Set(),plenary:new Set()};stages[scope].add(amendmentId);seen.set(id,stages);
    if(!authorDates[id]||date>authorDates[id])authorDates[id]=date||null;
  };
  for(const document of targets.slice(0,TOPIC_AMENDMENT_LIMITS.documents)) {
    try {
      const page=readPage(store,{document,limit:TOPIC_AMENDMENT_LIMITS.rows,offset:0});
      const sources=new Map();
      for(const item of page.items) {
        if(item.targetDocumentId!==document)continue;
        // One amendment may have several language/list observations. Its exact
        // catalogue identity counts once for each independently matched person.
        const authors=new Set([item,...(item.variants||[])].flatMap(row=>(row.authors||[]).map(resolvedAmendmentAuthorId)).filter(Boolean));
        for(const id of authors)if(amendmentAuthorMatch(item,id).matched) {
          const dates=[item,...(item.variants||[])].filter(row=>amendmentAuthorMatch(row,id).aggregateMatched&&(!asOf||[row.listDocumentDate,row.tabling?.date].every(date=>!validAmendmentDate(date)||date<=asOf))).map(row=>amendmentProposerDate(row)?.date).filter(date=>date&&(!asOf||date<=asOf));
          for(const date of dates)observe(id,item.id,'plenary',date);
          for(const row of [item,...(item.variants||[])])if(amendmentAuthorMatch(row,id).aggregateMatched)for(const source of [row.proposerSource,...(row.sources||[])].filter(Boolean))sources.set(JSON.stringify(source),source);
        }
      }
      documents.push({id:document,scope:'plenary',total:page.total,checked:page.items.length,coverage:page.coverage,sources:[...sources.values()]});
    } catch {
      // An optional count must not hide the agenda or its speech readers.
      documents.push({id:document,scope:'plenary',total:null,checked:0,coverage:null,status:'unavailable'});
    }
  }
  let contributionTruncated=false;
  if(procedureIds.length){
    try{
      const contributions=amendmentContributors(store,{procedures:procedureIds,asOf,limit:TOPIC_AMENDMENT_LIMITS.rows});
      contributionTruncated=contributions.truncated;
      for(const item of contributions.items)observe(item.personId,item.id,item.scope,item.date,item.countConflict);
      const linked=[...new Map(procedureIds.flatMap(procedure=>amendmentProcedureTargets(store,procedure,{limit:TOPIC_AMENDMENT_LIMITS.documents+1})).map(target=>[target.id,target])).values()];
      for(const target of linked)if(!documents.some(document=>document.id===target.id)){
        if(documents.length>=TOPIC_AMENDMENT_LIMITS.documents){contributionTruncated=true;break;}
        documents.push({id:target.listId||target.id,scope:target.scope||'plenary',listId:target.listId||null,targetDocumentId:target.targetDocumentId||null,total:null,checked:new Set(contributions.items.filter(item=>item.listId===target.listId||item.targetDocumentId===target.id).map(item=>item.id)).size,coverage:{complete:false,wordingComplete:target.wordingComplete||false,proposerComplete:target.proposerComplete||false,gaps:target.gaps||[]},sources:target.sources||[]});
      }
    }catch{documents.push({id:null,scope:'committee',total:null,checked:0,coverage:null,status:'unavailable'});}
  }
  for(const [id,stages] of seen){const blocked=uncountable.get(id);countsByStage[id]={committee:blocked?.has('committee')?null:stages.committee.size||null,plenary:blocked?.has('plenary')?null:stages.plenary.size||null};counts[id]=blocked?.size?null:stages.committee.size+stages.plenary.size||null;}
  // These are observed lower bounds. Even a fully read target cannot establish
  // that the agenda lists every amendment target or identifies every proposer.
  return {counts,countsByStage,authorIds:[...seen.keys()].sort((a,b)=>Number(a)-Number(b)),authorDates,documents,mutationRevision:store.get('amendmentMutationRevision')||0,generation:amendmentGeneration(store),truncated:contributionTruncated||targets.length>documents.length,basis:'Saved amendments to exact agenda documents; checked person attribution; lower bounds, not dossier totals.'};
}
