// Existing reader/navigation fixtures do not model classification data. Keep
// their strict request inventories while explicitly serving the new read paths.
export function topicFixture(input){
 const path=new URL(String(input),'http://localhost').pathname;
 if(path==='/api/insights/record-topics'||path==='/api/topics/story-facts'||path==='/api/topics/overview')return Response.json({ready:false});
 return null;
}
