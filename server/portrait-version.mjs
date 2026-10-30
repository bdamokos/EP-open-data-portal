// Independent of JSON API contracts. Bump only when the image endpoint changes.
export const PORTRAIT_VERSION = 1;
export function versionedPortraitUrl(url) {
  return `${url}${url.includes('?') ? '&' : '?'}v=${PORTRAIT_VERSION}`;
}
