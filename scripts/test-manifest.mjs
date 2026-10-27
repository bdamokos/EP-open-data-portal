export const testDirectories = ['src', 'server', 'scripts'];

// Subprocess startup and isolated cache/restart checks are kept in the slow profile.
export const slow = [
  {file: 'scripts/amendment-language-benchmark.test.mjs', reason: 'Spawns Python for independent raw DOCX and language oracle checks.'},
  {file: 'scripts/agenda-benchmark.test.mjs', reason: 'Spawns isolated agenda replay processes to verify cold, warm and restart measurements.'},
  {file: 'server/amendment-extraction-thread.test.mjs', reason: 'Spawns Node to check natural process exit after extraction cancellation.'},
  {file: 'server/directory-loading.test.mjs', reason: 'Spawns Node to check directory loading and restart behaviour.'},
  {file: 'server/text-cache.test.mjs', reason: 'Spawns Node to check retained text cache restarts.'},
  {file: 'server/directory-cache.test.mjs', reason: 'Spawns Node to check directory cache persistence.'},
  {file: 'server/public-serving.test.mjs', reason: 'Spawns Node to stage and inspect the production runtime.'},
  {file: 'server/startup-indexes.test.mjs', reason: 'Spawns Node to check preparation before HTTP startup and active-writer refusal.'},
  {file: 'server/odp-cache.test.mjs', reason: 'Spawns Node to check cache publication and restart isolation.'},
  {file: 'server/static-cache.test.mjs', reason: 'Spawns Node to build the static asset fixture.'},
  {file: 'server/speaker-identity.test.mjs', reason: 'Spawns Node to check retained speaker identity.'},
  {file: 'server/portrait-cache.test.mjs', reason: 'Spawns Node to check portrait cache restarts.'},
  {file: 'server/speech-transcript.test.mjs', reason: 'Spawns Node to check transcript metadata isolation.'},
  {file: 'server/proposal-structure.test.mjs', reason: 'Spawns Node to check 8 MiB parsing under a 256 MiB heap.'},
  {file: 'server/docx-fidelity.test.mjs', reason: 'Spawns Node to check retained DOCX fidelity.'},
  {file: 'server/test-runner.test.mjs', reason: 'Spawns Node to verify runner profiles, preload inheritance and capability failures.'},
  {file: 'server/profile-affiliation.test.mjs', reason: 'Spawns Node to check isolated profile and roster affiliation reads.'},
  {file: 'scripts/api-version.test.mjs', reason: 'Spawns Git and Node to check API-version CLI history and conflict reconciliation.'},
];
