import {responseRetryAt} from './client.mjs';
import {defaultUi} from './uiDefault.mjs';
import {API_ROOT} from './api';
import {versionedApiUrl} from '../server/api-version.mjs';
import {reportApiVersionMismatch} from './apiVersionMismatch.mjs';
import type {SavedStates} from './bookmarks.mjs';
export async function postSavedQuestions(language:string,questions:string[], ui: import('./uiI18n.mjs').UiFormatter = defaultUi):Promise<SavedStates> {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new DOMException('Timeout','TimeoutError')),12_000);
  try {
    const response=await fetch(versionedApiUrl(API_ROOT+'/insights/saved?lang='+encodeURIComponent(language)),{method:'POST',credentials:'omit',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({questions}),signal:controller.signal});
    const data = await response.json().catch(error => {
        if(controller.signal.aborted)throw controller.signal.reason;
        if(error?.name==='AbortError'||response.ok&&error?.name!=='SyntaxError')throw error;
        return null;
      });controller.signal.throwIfAborted();reportApiVersionMismatch(response.status,data);
    if(!response.ok)throw Object.assign(Error(data?.error?.message||ui.t("followingtransport.couldn.t.check.for.updates")),{code:data?.error?.code,status:response.status,retryAt:responseRetryAt(response,data)});
    if(!data||!Array.isArray(data.questions))throw Error(ui.t("followingtransport.couldn.t.check.for.updates"));
    return data;
  } finally {clearTimeout(timer);}
}
