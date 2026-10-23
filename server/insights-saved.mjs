import {sourceTitles} from './source-titles.mjs';
import {languagePreference} from './language-order.mjs';
import {createHash} from 'node:crypto';
import {HttpError} from './http-utils.mjs';
import {documentFiles} from './activity-index-model.mjs';
import {questionFromSource} from './insights-model.mjs';
import {odpLanguage} from './odp.mjs';
export const SAVED_INSIGHTS_VERSION=3;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function selectedTitle(titles,language,fallback) {
  const code=languagePreference(Object.keys(titles||{}).filter(code=>titles[code]?.trim()),language)[0];
  return code?{title:titles[code],titleLanguage:code}:{title:fallback,titleLanguage:null};
}
export function savedItemPreview(store,generation,row,language) {
  const body=JSON.parse(row.body);
  const question=body.recordKind==='answer'&&body.relatedQuestionId?store.source(generation,'/parliamentary-questions/'+body.relatedQuestionId)?.work:null;
  const titles=sourceTitles(question?.title_dcterms||body.relatedQuestionTitles||body.titles);
  return {id:row.source_id,date:row.date,...selectedTitle(titles,language,body.reference||row.source_id),recordKind:body.recordKind,...(body.relatedQuestionId?{relatedQuestionId:body.relatedQuestionId}:{})};
}
export function savedQuery(search) {
  for(const key of search.keys())if(!['lang','questions'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated saved-item query.');
  const list=(key,pattern)=>{const value=search.get(key);if(!value)return [];const ids=value.split(',');if(ids.length>100||ids.some(id=>!pattern.test(id))||new Set(ids).size!==ids.length)throw new HttpError(400,'invalid_selection','Choose up to 100 distinct saved items.');return ids;};
  return {language:odpLanguage(search.get('lang')||'en'),questions:list('questions',/^[EPHO]-10-\d{4}-\d{6}$/)};
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
    const selected=selectedTitle(q.titles,query.language,id);
    const latest=answers.map(answer=>({id:answer.id,date:answer.date||'',...selected,recordKind:'answer'})).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id)).slice(0,10);
    return {id,status:'available',...selected,latest,date:q.date,memberId:q.authors[0]?.id||null,answers,revision:digest([titles,q.date,answers,q.authors.map(a=>a.id).sort(),files(source.work),answerFiles]),sourceFetchedAt:source.fetchedAt};
  });
  return {view:'saved',questions,checkedAt:new Date().toISOString(),coverage:{indexComplete:status.complete,servingGeneration:generation,rosterFetchedAt:status.rosterFetchedAt,lastSuccessfulRefresh:status.lastSuccessfulRefresh},basis:'Saved activity and question metadata. No text download or upstream fan-out.'};
}

// Question IDs belong in the request body; the GET accepts questions only.
export function savedPostQuery(search,body) {
  for(const key of search.keys())if(key!=='lang'||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated saved-item query.');
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='questions')||!Array.isArray(body.questions)||body.questions.length>100||body.questions.some(id=>typeof id!=='string'||!(/^[EPHO]-10-\d{4}-\d{6}$/).test(id))||new Set(body.questions).size!==body.questions.length)
    throw new HttpError(400,'invalid_selection','Choose up to 100 distinct saved questions.');
  return {language:odpLanguage(search.get('lang')||'en'),questions:body.questions};
}
