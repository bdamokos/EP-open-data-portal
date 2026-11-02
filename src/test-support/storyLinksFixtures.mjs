// Modeled aggregates and bounded public-style identities for rendered story tests.
// These fixtures exercise the shipped templates; they are not live observations.
export const storyPeriods=['2024-Q3','2024-Q4','2025-Q1','2025-Q2','2025-Q3','2025-Q4','2026-Q1','2026-Q2','2026-Q3','2026-Q4'];
export const storyLabels={COL:'Colombia',TUR:'Türkiye',ROU:'Romania',TUN:'Tunisia',IRN:'Iran',GRC:'Greece',UKR:'Ukraine'};
export function mapLinkFacts({zoom='world',mode='q'}={}){
 const urgency=zoom==='eu'?2:8,place=zoom==='eu'?'ROU':'COL',counts={questions:37,questionElsewhere:5,questionHome:0,questionUnknown:0,debates:urgency+1,urgencyDebates:urgency,adoptedTexts:2,groups:20,placesWithAdoptedTexts:27};
 const debates=[],sets={urgencyDebates:{}},periodWinners={};
 for(const p of storyPeriods){const date=p.slice(0,4)+'-'+String((Number(p.at(-1))-1)*3+1).padStart(2,'0')+'-07';const ids=[];
  for(let i=0;i<=urgency;i++){const id=`MTG-PL-${date}-PVCRE-ITM-${i+1}`;debates.push({id,title:i?'Urgency debate '+i:'Public policy in Ukraine',date,q:p,meps:i?5:69,format:i?'urgency':null,places:{UKR:['title']},primaryPlace:'UKR',docs:[]});if(i)ids.push(id);}
  sets.urgencyDebates[p]=ids;
  periodWinners[p]={busiestNonUrgencyDebates:[{id:`MTG-PL-${date}-PVCRE-ITM-1`,meps:69}],mostQuestionedPlaces:[{id:'TUR',count:37}],risingQuestionPlaces:[{id:place,count:13,baselineMean:5.4,ratio:2.4}],risingDocumentPlaces:[{id:place,count:9,baselineMean:2,ratio:4.5}],topAdoptedPlaces:[{id:'TUR',count:2}]};
 }
 return {ready:true,scope:'map',mode,zoom,askers:'not-home',counts,periodCounts:storyPeriods.map(period=>({period,...counts})),periodWinners,winners:{},sets,questions:[],docs:[],debates,periods:storyPeriods,partial:{first:'2024-07-16',last:'2026-11-01'},series:{}};
}
export const sourceDocuments=Array.from({length:3},(_,i)=>({id:'B-10-2026-00000'+(i+1),title:'MOTION FOR A RESOLUTION on Exact adopted text '+(i+1),date:'2026-01-10',type:'RESOLUTION_MOTION',places:['IRN'],keywords:[],outcome:{outcome:'ADOPTED',date:'2026-01-12',for:100+i,against:3}}));
export function placeLinkFacts(place='IRN'){
 const facts=mapLinkFacts(),counts={questions:4,debates:0,adoptedTexts:3,groups:4,questionElsewhere:3,questionHome:1,questionUnknown:0};return {...facts,scope:'place',key:'place:'+place,askers:'all',counts,periodCounts:storyPeriods.map(period=>({period,...counts})),periodWinners:Object.fromEntries(storyPeriods.map(p=>[p,{}])),docs:sourceDocuments,debates:[],sets:{adoptedTexts:Object.fromEntries(storyPeriods.map(p=>[p,sourceDocuments.map(d=>d.id)]))},questions:[],series:{}};
}
export function recordLinkPage(q){
 const documents=q.list==='documents'||q.list==='adoptedTexts',records=documents?sourceDocuments:Array.from({length:4},(_,i)=>({id:'E-10-2026-00000'+(i+1),title:'Exact question '+(i+1),date:'2026-01-10',answers:[]}));
 return {...placeLinkFacts(q.key?.replace('place:','')||'IRN'),docs:documents?records:[],questions:documents?[]:records,page:{total:records.length,items:records.map(r=>({id:r.id,kind:documents?'document':'question',date:r.date})),nextCursor:null}};
}
export function topicLinkDetail(key='place:IRN'){
 return {ready:true,concept:{key,label:key.startsWith('place:')?storyLabels[key.slice(6)]||'A place':'Climate policy',...(key.startsWith('place:')?{id:key.slice(6),iso3:key.slice(6)}:{})},periods:storyPeriods,partial:{first:'2024-07-16',last:'2026-11-01'},series:storyPeriods.map(period=>({period,question:4,questionHome:1,questionElsewhere:3,questionUnknown:0,document:3,speech:0,debate:0,vote:0,groups:4})),total:4,groupsTotal:4,groups:[],peaks:{question:[],document:[],groups:[]},facets:{keywords:[],places:[],topics:[]},nextOffset:null};
}
