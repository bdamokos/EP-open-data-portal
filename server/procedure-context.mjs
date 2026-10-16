import {odpLanguage} from './odp.mjs';
import {HttpError} from './http-utils.mjs';
import {parseProcedurePage,parseSummaryPage,procedureReference} from './official-context.mjs';

export function procedureContextQuery(search) {
  for(const key of search.keys())if(!['lang','reference','summary'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated summary query.');
  const reference=procedureReference(search.get('reference')),language=odpLanguage(search.get('lang')||'en'),summary=search.get('summary');
  if(summary&&!/^\d{1,12}$/.test(summary))throw new HttpError(400,'invalid_summary','Choose a published summary.');
  return {reference,language,summary};
}
export class ProcedureContext {
  constructor(sources,catalog){Object.assign(this,{sources,catalog});}
  async query({reference,language,summary,order=['first-reading','parliament-decision','final-act','proposal','document']}) {
    const sourceLanguage=language==='fr'?'fr':'en',url='https://oeil.europarl.europa.eu/oeil/'+sourceLanguage+'/procedure-file?'+new URLSearchParams({reference});
    const page=await this.sources.get(url),procedure=parseProcedurePage(page.html,reference,sourceLanguage);
    const selected=summary?procedure.summaries.find(s=>s.id===summary):order.map(stage=>procedure.summaries.find(s=>s.stage===stage)).find(Boolean);
    if(summary&&!selected)throw new HttpError(400,'summary_not_linked','This summary is not linked to the procedure.');
    let text=null;
    if(selected){const body=await this.sources.get(selected.url),parsed=parseSummaryPage(body.html,reference);if(selected.date&&parsed.date!==selected.date)throw new HttpError(502,'summary_date','The summary date does not match the procedure.');text={...selected,...parsed,source:{url:body.url,fetchedAt:body.fetchedAt,stale:Boolean(body.viewCache?.stale)}};}
    const id=reference.match(/^(\d{4})\/(\d{4}[A-Z]?)/).slice(1).join('-');let topics=null,topicError=false;
    try{const known=await this.catalog.known([id],language);topics=known.get(id);if(!topics||topics.stale)topics=(await this.catalog.load([id],language)).get(id);if(topics.reference!==reference)topics={state:'ambiguous',concepts:[]};}catch{topicError=true;}
    return {view:'procedure-context',reference,title:procedure.title,language:sourceLanguage,summaries:procedure.summaries,summary:text,subjects:procedure.subjects,topics:topics?.concepts||[],topicState:topics?.state||'unavailable',topicError,source:{url:page.url,fetchedAt:page.fetchedAt,stale:Boolean(page.viewCache?.stale)}};
  }
}
// A cited act is best described by its final-act summary, then by the proposal.
export const REFERENCE_SUMMARY_ORDER=Object.freeze(['final-act','proposal','first-reading','parliament-decision','document']);
