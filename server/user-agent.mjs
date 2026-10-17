// One product name for every request to a public source; the purpose says which reader sent it.
const PRODUCT = 'EP-OpenData-Explorer/0.1';
export const userAgent = purpose => `${PRODUCT} (${purpose})`;
// www.europarl.europa.eu serves portraits and RSS feeds only to agents in the conventional
// "Mozilla/5.0 (compatible; …)" form that crawlers use; other agents get a 202 placeholder page.
// The product name and purpose stay in the string, so these requests remain identifiable as ours.
export const browserCompatibleUserAgent = purpose => `Mozilla/5.0 (compatible; ${PRODUCT}; ${purpose})`;
