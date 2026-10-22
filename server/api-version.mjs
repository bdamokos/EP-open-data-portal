// Bump only for API response contract changes, never for commits or releases.
export const API_VERSION = 22;

// Append the new version's digest when bumping; keep recorded entries unchanged.
export const API_CONTRACT_DIGESTS = Object.freeze({
  1: '648ced086ef0aedc3311852c0c57685e650c6fb54ab2091f55cfd661319f320b',
  2: 'f77982bf69adfa027862ea8d913991e52892e917a5a44cfa7ca04f4a171f14f5',
  3: 'f77982bf69adfa027862ea8d913991e52892e917a5a44cfa7ca04f4a171f14f5',
  4: 'f77982bf69adfa027862ea8d913991e52892e917a5a44cfa7ca04f4a171f14f5',
  5: '9209423e993712bac06c2f1bc85367ff00a9200b8e9abeb4f20b1edb8e0042d3',
  6: '5ebad6d6a4c089b53be6b06e7cd3f471dbc1fd30deac2c738cd12f62582f27e0',
  7: '3ec33027be2677853bf6a19a227ea08d8756bafe44ecbd4bfb2207ca33368aed',
  8: '1b3e926e3496b50c9ed7cbcc5a8491992f93ebd45a82ac71d13bcd5cfa198525',
  9: '1b3e926e3496b50c9ed7cbcc5a8491992f93ebd45a82ac71d13bcd5cfa198525',
  10: '4bf2d87703bd7b2754f29fc49513eae9788db5d6eb7f1df1e2f07fc8302599a0',
  11: 'd0cf52f66c9e92adcfc5ef9558b8cdba8d657920c10a2345b34ee15b5accf402',
  12: '2dc4a172e5c65e9f39a9b4ea1a549532876bcaf08e882d1589e4743e18db8399',
  13: '755dfd2c729c25d26734cc26f39d2cd440bf0fbc9c7d8e8e515a7bd0c8ff04eb',
  14: '15a3346a7513c000e0fa01126b8fdf8cd9d72ed2e354ce5da48d0660a4dd1380',
  15: '691cae9b23fedfc13d0375f10ae7aba9ca5ee4b40796db158cca02c6efde6733',
  16: 'f905d1b2a4395fc4066a25ffba03d934b5357defee32b67dafe8c4e57ce393f9',
  17: 'f905d1b2a4395fc4066a25ffba03d934b5357defee32b67dafe8c4e57ce393f9',
  18: '595931fe06b02400784a806252b1865740e36f6d2659d60f1750a38f57d11b3e',
  19: '7d5296cbe082006083c60a4aafd06db3bcfd926843ea4ee9bab9d5c6dfbec426',
  20: '6777d4e3d8141f6cec9b19b89a71ef7533c85bd9f032ba6b25394f6210f4050a',
  21: '8ae0af4e7fef67ac2702abdc7f3433c8b613cf890403a29407f88d9f56c26e8b',
  22: '6a6c4afc5baf5a7eb2b9d9005bc4f9ec33fe113619384edfae9ffdd9e7ee5af8',
});

// Called only at the GET transport boundary; route and page URL keys stay intact.
export function versionedApiUrl(url) {
  return `${url}${url.includes('?') ? '&' : '?'}v=${API_VERSION}`;
}
