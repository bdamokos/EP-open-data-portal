// Independent of JSON API contracts. Bump only when the image endpoint changes.
export const PORTRAIT_VERSION = 1;
export function versionedPortraitUrl(url) {
  if (!/^(?:(?:\.\/)*|\/)api\/portrait\/[1-9][0-9]*$/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${PORTRAIT_VERSION}`;
}
