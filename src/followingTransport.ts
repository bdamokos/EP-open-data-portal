import {API_ROOT} from './api';
import {versionedApiUrl} from '../server/api-version.mjs';
import {reportApiVersionMismatch} from './apiVersionMismatch.mjs';
import type {SavedStates} from './bookmarks.mjs';
export async function postSavedQuestions(language:string,questions:string[]):Promise<SavedStates> {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12_000);
  try {
    const response=await fetch(versionedApiUrl(API_ROOT+'/insights/saved?lang='+encodeURIComponent(language)),{method:'POST',credentials:'omit',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({questions}),signal:controller.signal});
    const data=await response.json();reportApiVersionMismatch(response.status,data);
    if(!response.ok)throw Object.assign(Error(data?.error?.message||"Couldn't check for updates."),{code:data?.error?.code,status:response.status});
    return data;
  } finally {clearTimeout(timer);}
}
