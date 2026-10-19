// Bump only for API response contract changes, never for commits or releases.
export const API_VERSION = 5;

// Append the new version's digest when bumping; keep recorded entries unchanged.
export const API_CONTRACT_DIGESTS = Object.freeze({
  1: '648ced086ef0aedc3311852c0c57685e650c6fb54ab2091f55cfd661319f320b',
  2: 'f77982bf69adfa027862ea8d913991e52892e917a5a44cfa7ca04f4a171f14f5',
  3: 'f77982bf69adfa027862ea8d913991e52892e917a5a44cfa7ca04f4a171f14f5',
  4: 'f77982bf69adfa027862ea8d913991e52892e917a5a44cfa7ca04f4a171f14f5',
  5: '9209423e993712bac06c2f1bc85367ff00a9200b8e9abeb4f20b1edb8e0042d3',
});

// Called only at the GET transport boundary; route and page URL keys stay intact.
export function versionedApiUrl(url) {
  return `${url}${url.includes('?') ? '&' : '?'}v=${API_VERSION}`;
}
