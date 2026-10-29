import {amendmentsPage,amendmentAuthorMatch,amendmentGeneration} from './amendments-store.mjs';
import {resolvedAmendmentAuthorId} from './amendments.mjs';

export const TOPIC_AMENDMENT_LIMITS=Object.freeze({documents:6,rows:500});

export const topicAmendmentsCacheable=value=>!value?.detail?.amendments?.documents?.some(document=>document.status==='unavailable'||document.coverage===null);

// Read the same checked attribution as the amendment catalogue. Never discover
// new sources or walk pages while rendering a topic's participant cards.
export function topicAmendments(store,documentIds,people,{readPage=amendmentsPage}={}) {
  const targets=[...new Set(documentIds.filter(id=>/^(?:A|B|RC)-10-\d{4}-\d{4,6}$/.test(id)))];
  const counts=Object.fromEntries(people.map(person=>[person.id,null])),seen=new Map(),documents=[];
  for(const document of targets.slice(0,TOPIC_AMENDMENT_LIMITS.documents)) {
    try {
      const page=readPage(store,{document,limit:TOPIC_AMENDMENT_LIMITS.rows,offset:0});
      const sources=new Map();
      for(const item of page.items) {
        if(item.targetDocumentId!==document)continue;
        // One amendment may have several language/list observations. Its exact
        // catalogue identity counts once for each independently matched person.
        const authors=new Set([item,...(item.variants||[])].flatMap(row=>(row.authors||[]).map(resolvedAmendmentAuthorId)).filter(id=>Object.hasOwn(counts,id)));
        for(const id of authors)if(amendmentAuthorMatch(item,id).matched) {
          const ids=seen.get(id)||new Set();ids.add(item.id);seen.set(id,ids);
          for(const row of [item,...(item.variants||[])])if(amendmentAuthorMatch(row,id).aggregateMatched)for(const source of [row.proposerSource,...(row.sources||[])].filter(Boolean))sources.set(JSON.stringify(source),source);
        }
      }
      documents.push({id:document,total:page.total,checked:page.items.length,coverage:page.coverage,sources:[...sources.values()]});
    } catch {
      // An optional count must not hide the agenda or its speech readers.
      documents.push({id:document,total:null,checked:0,coverage:null,status:'unavailable'});
    }
  }
  for(const [id,ids] of seen)counts[id]=ids.size;
  // These are observed lower bounds. Even a fully read target cannot establish
  // that the agenda lists every amendment target or identifies every proposer.
  return {counts,documents,generation:amendmentGeneration(store),truncated:targets.length>documents.length,basis:'Saved amendments to exact agenda documents; checked person attribution; lower bounds, not dossier totals.'};
}
