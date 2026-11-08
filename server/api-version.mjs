import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Release images stamp the digest at build time (scripts/stage-runtime.mjs).
// Everywhere else, including the image's build stage, derive it from the sources.
function stampedDigest() {
  if (process.env.NODE_ENV !== 'production') return null;
  try {return JSON.parse(readFileSync(new URL('./api-contract.json', import.meta.url), 'utf8')).digest;}
  catch (error) {if (error.code === 'ENOENT') return null;throw error;}
}
// The deriving code (and its parser) loads only when there is no stamp, so a production process that only needs the version stays small.
const digest = stampedDigest() ?? (await import('../scripts/api-contract.mjs')).contractDigest(fileURLToPath(new URL('../', import.meta.url))).digest;
if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('The API contract stamp is invalid.');
export const API_VERSION = digest.slice(0, 12);

// Called at the transport boundary; route and page URL keys stay intact.
export function versionedApiUrl(url) {
  return `${url}${url.includes('?') ? '&' : '?'}v=${API_VERSION}`;
}
