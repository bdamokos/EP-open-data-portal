import {stampedDigest} from './api-version-stamp.mjs';
import {fileURLToPath} from 'node:url';
import {contractDigest} from '../scripts/api-contract.mjs';

const digest = stampedDigest() ?? contractDigest(fileURLToPath(new URL('../', import.meta.url))).digest;
if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('The API contract stamp is invalid.');
export const API_VERSION = digest.slice(0, 12);

// Called at the transport boundary; route and page URL keys stay intact.
export function versionedApiUrl(url) {
  return `${url}${url.includes('?') ? '&' : '?'}v=${API_VERSION}`;
}
