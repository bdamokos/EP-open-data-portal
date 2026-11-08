import {apiPrefixes} from './config.mjs';
import {HttpError} from './http-utils.mjs';

// Accept origin-form paths only, before URL parsing can reinterpret an authority.
export function parseRequestTarget(request) {
  const target=request.url||'/';
  if(!target.startsWith('/')||target.startsWith('//')||target.split('?',1)[0].includes('\\')||/[\u0000-\u0020\u007f]/u.test(target))
    throw new HttpError(400,'invalid_path','The request path is invalid');
  return new URL(target,'http://localhost');
}
export const apiPrefixOf=url=>apiPrefixes.find(prefix=>url.pathname===prefix||url.pathname.startsWith(`${prefix}/`));
// Routes that may run for the extended 50 s request budget instead of 30 s.
export const requestBudgetMs=(url,apiPrefix)=>/^\/(?:speech-context|motion-comparison)\//.test(url.pathname.slice(apiPrefix.length))?50_000:30_000;
