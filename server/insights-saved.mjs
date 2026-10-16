import {createHash} from 'node:crypto';
import {HttpError} from './http-utils.mjs';
import {documentFiles} from './activity-index-model.mjs';
import {questionFromSource} from './insights-model.mjs';
import {odpLanguage} from './odp.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function savedQuery(search) {
  for(const key of search.keys())if(!['lang','questions','members'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated saved-item query.');
  const list=(key,pattern)=>{const value=search.get(key);if(!value)return [];const ids=value.split(',');if(ids.length>100||ids.some(id=>!pattern.test(id))||new Set(ids).size!==ids.length)throw new HttpError(400,'invalid_selection','Choose up to 100 distinct saved items.');return ids;};
  return {language:odpLanguage(search.get('lang')||'en'),questions:list('questions',/^[EPHO]-10-\d{4}-\d{6}$/),members:list('members',/^[1-9]\d{0,8}$/)};
}
export function savedStates(store,query) {
  const status=store.status(),generation=status.servingGeneration;
  if(!generation)throw new HttpError(503,'insights_loading','Saved Parliament data is not ready.');
  const questions=query.questions.map(id=>{
    const source=store.source(generation,'/parliamentary-questions/'+id);if(!source)return {id,status:'not-saved'};
    const q=questionFromSource({...source,key:'/parliamentary-questions/'+id});if(!q)return {id,status:'not-saved'};
    const answers=q.answers.map(a=>({id:a.id,date:a.date})).sort((a,b)=>a.id.localeCompare(b.id));
    const files=work=>documentFiles(work).map(file=>[file.language,file.format,file.url,file.byteSize??null]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const answerFiles=(source.work.inverse_answers_to||[]).filter(work=>work&&typeof work==='object').map(work=>[work.identifier||work.id,files(work)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
    const titles=Object.fromEntries(Object.entries(q.titles).sort(([a],[b])=>a.localeCompare(b)));
    const title=q.titles[query.language]||q.titles.en||Object.values(q.titles)[0]||id;
    const latest=answers.map(answer=>({id:answer.id,date:answer.date||'',title,recordKind:'answer'})).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id)).slice(0,10);
    return {id,status:'available',title,latest,date:q.date,memberId:q.authors[0]?.id||null,answers,revision:digest([titles,q.date,answers,q.authors.map(a=>a.id).sort(),files(source.work),answerFiles]),sourceFetchedAt:source.fetchedAt};
  });
  const members=query.members.map(id=>{
    const record=store.db.prepare('SELECT body FROM members WHERE id=?').get(id);if(!record)return {id,status:'outside-roster'};
    const person=JSON.parse(record.body),activityOnly=" AND COALESCE(json_extract(body,'$.recordKind'),'document')<>'answer'";
    const total=store.db.prepare('SELECT COUNT(DISTINCT source_id) AS n FROM items WHERE generation=? AND mep=?'+activityOnly).get(generation,id).n;
    const present=row=>{
      const body=JSON.parse(row.body);
      const question=body.recordKind==='answer'&&body.relatedQuestionId?store.source(generation,'/parliamentary-questions/'+body.relatedQuestionId)?.work:null;
      const titles=question?.title_dcterms||body.relatedQuestionTitles||body.titles;
      return {id:row.source_id,date:row.date,title:titles?.[query.language]||titles?.en||Object.values(titles||{})[0]||body.reference||row.source_id,recordKind:body.recordKind,...(body.relatedQuestionId?{relatedQuestionId:body.relatedQuestionId}:{})};
    };
    const activities=store.db.prepare('SELECT source_id,MAX(date) AS date,body FROM items WHERE generation=? AND mep=?'+activityOnly+' GROUP BY source_id ORDER BY date DESC,source_id DESC LIMIT 10').all(generation,id).map(present);
    // Membership and revision cover every saved answer; only rich preview titles are bounded.
    const answers=store.db.prepare("SELECT source_id,MAX(date) AS date,body FROM items WHERE generation=? AND mep=? AND json_extract(body,'$.recordKind')='answer' GROUP BY source_id ORDER BY date DESC,source_id DESC").all(generation,id).map((row,index)=>{
      if(index<100)return present(row);
      const body=JSON.parse(row.body);
      return {id:row.source_id,date:row.date,relatedQuestionId:body.relatedQuestionId,recordKind:'answer'};
    });
    const latest=[...activities,...answers].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id)).slice(0,10);
    return {id,status:'available',name:person.name,total,latest,answers,activityIds:activities.map(x=>x.id),revision:digest([total,activities.map(x=>[x.id,x.date]),answers.map(x=>[x.id,x.date])])};
  });
  return {view:'saved',questions,members,checkedAt:new Date().toISOString(),coverage:{indexComplete:status.complete,servingGeneration:generation,rosterFetchedAt:status.rosterFetchedAt,lastSuccessfulRefresh:status.lastSuccessfulRefresh},basis:'Saved activity and question metadata. No text download or upstream fan-out.'};
}
