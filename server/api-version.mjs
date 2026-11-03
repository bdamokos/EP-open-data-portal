import {fileURLToPath} from 'node:url';
import {contractDigest} from '../scripts/api-contract.mjs';

export const API_VERSION = (contractDigest(fileURLToPath(new URL('../', import.meta.url)))).digest.slice(0, 12);

// Called at the transport boundary; route and page URL keys stay intact.
export function versionedApiUrl(url) {
  return `${url}${url.includes('?') ? '&' : '?'}v=${API_VERSION}`;
}
