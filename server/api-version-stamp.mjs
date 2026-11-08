import {readFileSync} from 'node:fs';

// Release images stamp the digest at build time (scripts/stage-runtime.mjs).
// Everywhere else, including the image's build stage, derive it from the sources.
// Kept apart from api-version.mjs so a process that only needs the version (the
// split front) can read the stamp without loading the code that derives it.
export function stampedDigest() {
  if (process.env.NODE_ENV !== 'production') return null;
  try {return JSON.parse(readFileSync(new URL('./api-contract.json', import.meta.url), 'utf8')).digest;}
  catch (error) {if (error.code === 'ENOENT') return null;throw error;}
}
