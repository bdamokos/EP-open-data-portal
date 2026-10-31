export function diagnosticRequest(input) {
  try {
    const url=new URL(String(input), 'http://localhost');
    if(!/^\/api\/[a-z-]+(?:\/|$)/.test(url.pathname))return null;
    // Only public record identifiers and language/version selectors survive.
    const query=new URLSearchParams();
    for(const key of ['lang','language','v','term','year','offset','limit','member','sitting','week','from','to','document']) {
      const value=url.searchParams.get(key);
      if(value && /^[a-zA-Z0-9()._-]{1,100}$/.test(value))query.set(key,value);
    }
    return url.pathname.slice(0,500)+(query.size?'?'+query:'');
  } catch {return null;}
}
export function diagnosticFrames(stack) {
  return typeof stack==='string'?[...stack.matchAll(/\/(?:assets\/[A-Za-z0-9_.-]+\.js|src\/[A-Za-z0-9_./-]+\.(?:tsx?|m?js)):\d+:\d+/g)].slice(0,3).map(match=>match[0]):[];
}
