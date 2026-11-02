// Existing reader/navigation fixtures do not model classification data. Keep
// their strict request inventories while explicitly serving the new read paths.
export function topicFixture(input){
 const base=globalThis.location?.href||globalThis.window?.location?.href||'http://localhost/';
 const url=new URL(typeof input==='string'?input:input.url||String(input),base);
 if(url.origin!==new URL(base).origin)return null;
 const path=url.pathname;
 if(path==='/api/insights/record-topics'||path==='/api/topics/story-facts'||path==='/api/topics/overview')return Response.json({ready:false});
 return null;
}
