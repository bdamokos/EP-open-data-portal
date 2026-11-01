// Deterministic client stories over the reference facts payload. No source I/O.
import {europeStoryIso3} from './storyEurope.mjs';
export const cleanStoryTitle=title=>String(title||'').replace(/^(?:(?:JOINT )?MOTION FOR A RESOLUTION|(?:INTERIM )?REPORT|RECOMMENDATION)\s+(?:on\s+)?/i,'');
export function storyNumber(n,language='en'){const words=['zero','one','two','three','four','five','six','seven','eight','nine'];return language.split('-')[0]==='en'&&Number.isInteger(n)&&n>0&&n<10?words[n]:Number(n).toLocaleString(language);}
const quarter=d=>d?.slice(0,4)+'-Q'+Math.ceil(Number(d?.slice(5,7))/3);
const docRecord=d=>({id:d.id,title:d.title,date:d.date,kind:'document'});
const debateRecord=d=>({id:d.id,title:d.rawTitle||d.title,date:d.date,kind:'debate'});
const questionRecord=q=>({id:q.id,title:q.t,date:q.d,kind:'question'});
const ref=(records,text,extra={})=>({text,records,...extra});
const line=(id,values)=>{const base=id.replace(/One$/,''),slot={busiest:'speakers',urgency:'debates',leader:'questions',leaderSoFar:'questions',placeQuestions:'questions',texts:'texts',topicSummary:'groups'}[base],value=slot&&values[slot];return {id:'topics.story.'+(slot?base:id),values,...(value?{counts:{count:value.numeric??value.records.length}}:{})};};
const ordered=(xs,metric)=>[...xs].sort((a,b)=>metric(b)-metric(a)||a.id.localeCompare(b.id));
export function primaryStoryPlace(d){const keys=Object.keys(d.places),t=keys.filter(p=>d.places[p].includes('title')),o=keys.filter(p=>d.places[p].includes('official'));if(t.length===1)return t[0];const both=t.filter(p=>o.includes(p));if(both.length===1)return both[0];return d.format==='urgency'&&!t.length&&o.length===1?o[0]:null;}
export const strongStoryPlace=(d,p)=>Boolean(d.places[p]?.includes('title')||primaryStoryPlace(d)===p);
const EU=new Set('AUT BEL BGR HRV CYP CZE DNK EST FIN FRA DEU GRC HUN IRL ITA LVA LTU LUX MLT NLD POL PRT ROU SVK SVN ESP SWE'.split(' '));
export function buildTopicStories(facts,{periods,partial=[],period,place,topic,zoom='world',mode='q',excludeOwn=false,labels={},language='en'}={}){
 if(!facts||!Array.isArray(facts.debates)||!Array.isArray(facts.docs)||!Array.isArray(facts.questions))return [];
 const num=n=>storyNumber(n,language),initial=n=>{const value=num(n);return value.charAt(0).toLocaleUpperCase(language)+value.slice(1);},inView=p=>zoom!=='eu'||europeStoryIso3.includes(p),label=p=>labels[p]||p;
 const topicFact=topic&&facts.topics?.[topic],members=new Set(topicFact?.members?.map(m=>m[0])||[]),groups=new Set(topicFact?.members?.map(m=>m[3])||[]);
 if(topic&&!topicFact)return [];
 const docs=facts.docs.filter(d=>(!place||d.places.includes(place))&&(!topic||members.has(d.id)||d.keywords.includes(topic.replace(/^eurovoc:/,''))));
 const docIds=new Set(docs.map(d=>d.id));
 const debates=facts.debates.filter(d=>(!period||d.q===period)&&(!place||strongStoryPlace(d,place))&&(!topic||members.has(d.id)||groups.has(d.id)||d.docs.some(id=>docIds.has(id)))&&(place||topic||Object.keys(d.places).some(p=>inView(p)&&strongStoryPlace(d,p))));
 const scopedDocs=docs.filter(d=>(!period||quarter(d.date)===period)&&(place||topic||d.places.some(inView)));
 const questions=facts.questions.filter(q=>(!place||q.places.includes(place))&&(!topic||members.has(q.id)));
 const qFor=(p,q)=>questions.filter(x=>(!q||quarter(x.d)===q)&&x.places.includes(p)&&(!excludeOwn||!x.home.includes(p)));
 const places=[...new Set(questions.flatMap(q=>q.places))].filter(p=>(!place||p===place)&&inView(p));
 const result=[];
 const docById=new Map(facts.docs.map(d=>[d.id,d]));
 const resolution=d=>{const rs=d.docs.map(id=>docById.get(id)).filter(x=>x&&/RESOLUTION_MOTION/.test(x.type)&&x.outcome);return rs.find(x=>x.type==='RESOLUTION_MOTION_JOINT')||rs[0];};
 const outcome=r=>{const o=r?.outcome;if(!o||!['ADOPTED','REJECTED'].includes(o.outcome))return null;const values={text:ref([docRecord(r)],cleanStoryTitle(r.title),{italic:true})};if(o.for!=null&&o.against!=null){values.for=num(o.for);values.against=num(o.against);if(o.abst!=null)values.abstentions=num(o.abst);return line(o.outcome==='ADOPTED'?(o.abst==null?'adopted':'adoptedTally'):(o.abst==null?'rejected':'rejectedTally'),values);}return line(o.outcome==='ADOPTED'?'adoptedNoTally':'rejectedNoTally',values);};
 // The maintainer's order is deliberate: busiest, urgency, most debated, rise, leader.
 const big=ordered(debates.filter(d=>d.format!=='urgency'),d=>d.meps)[0];
 if(big){const values={debate:ref([debateRecord(big)],cleanStoryTitle(big.rawTitle||big.title),{italic:true}),speakers:ref([debateRecord(big)],num(big.meps),{numeric:big.meps}),date:new Intl.DateTimeFormat(language==='en'?'en-GB':language,{day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(big.date+'T12:00:00Z'))};result.push(line(big.meps===1?'busiestOne':'busiest',values));}
 const urgency=debates.filter(d=>d.format==='urgency').sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 if(urgency.length){const countries=[...new Set(urgency.flatMap(d=>Object.keys(d.places).filter(p=>inView(p)&&strongStoryPlace(d,p))))];result.push(line(urgency.length===1?'urgencyOne':'urgency',{debates:ref(urgency.map(debateRecord),initial(urgency.length)),places:countries.map(p=>ref(urgency.filter(d=>strongStoryPlace(d,p)).map(debateRecord),label(p)))}));}
 const debateCounts=new Map();for(const d of debates)for(const p of Object.keys(d.places).filter(p=>inView(p)&&strongStoryPlace(d,p)))debateCounts.set(p,(debateCounts.get(p)||0)+1);
 const rankedDebates=[...debateCounts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
 if(!place&&rankedDebates[0]?.[1]>=2&&rankedDebates[0][1]>(rankedDebates[1]?.[1]||0)){const [p,n]=rankedDebates[0],records=debates.filter(d=>strongStoryPlace(d,p)).map(debateRecord);result.push(line('mostDebated',{place:ref(records,label(p)),debates:ref(records,num(n))}));}
 if(place||topic){const decided=scopedDocs.filter(d=>['ADOPTED','REJECTED'].includes(d.outcome?.outcome)&&!scopedDocs.some(other=>other.derivedFrom?.includes(d.id)));const headline=ordered(decided,d=>Math.max(0,...debates.filter(b=>b.docs.includes(d.id)).map(b=>b.meps)))[0];const statement=outcome(headline||resolution(big||{docs:[]}));if(statement)result.push(statement);}
 if(mode==='q'){
  const i=periods?.indexOf(period)??-1,earlier=(periods||[]).slice(0,i).filter(q=>!partial.includes(q));
  const ranked=places.map(p=>({p,records:qFor(p,period)})).filter(x=>x.records.length).sort((a,b)=>b.records.length-a.records.length||label(a.p).localeCompare(label(b.p)));
  let rise=null;
  if(i>=2&&!partial.includes(period)&&earlier.length){rise=ranked.map(r=>{const average=earlier.reduce((sum,q)=>sum+qFor(r.p,q).length,0)/earlier.length;return {...r,average,ratio:r.records.length/Math.max(1,average)};}).filter(r=>r.records.length>=8&&r.ratio>=1.5).sort((a,b)=>b.ratio-a.ratio||b.records.length-a.records.length||a.p.localeCompare(b.p))[0];}
  if(rise){const records=rise.records.map(questionRecord);result.push(line(rise.average<0.5?'riseRare':rise.ratio>=4?'riseJumped':'rise',{place:ref(records,label(rise.p)),questions:ref(records,num(records.length)),average:ref(earlier.flatMap(q=>qFor(rise.p,q)).map(questionRecord),num(Math.round(rise.average*10)/10))}));}
  const lead=ranked[0];if(lead&&lead.p!==rise?.p){const records=lead.records.map(questionRecord),tied=ranked.filter(r=>r.records.length===lead.records.length);
  if(!place&&tied.length>1)result.push(line('leaders',{places:tied.map(r=>ref(r.records.map(questionRecord),label(r.p))),questions:ref([...new Map(tied.flatMap(r=>r.records.map(questionRecord)).map(r=>[r.id,r])).values()],num(records.length))}));
  else result.push(line((place?'placeQuestions':partial.includes(period)?'leaderSoFar':'leader')+(records.length===1?'One':''),{place:ref(records,label(lead.p)),questions:ref(records,place?initial(records.length):num(records.length))}));}
 }else{const adopted=scopedDocs.filter(d=>d.outcome?.outcome==='ADOPTED'&&!scopedDocs.some(other=>other.derivedFrom?.includes(d.id)));if(adopted.length)result.push(line(adopted.length===1?'textsOne':'texts',{texts:ref(adopted.map(docRecord),num(adopted.length))}));}
 if(topic&&topicFact){const rows=(period?topicFact.members.filter(m=>quarter(m[2])===period):topicFact.members)||[],ids=[...new Set(rows.map(m=>m[3]))];result.push(line((period?topicFact.groups[period]||0:Object.values(topicFact.groups).reduce((a,b)=>a+b,0))===1?'topicSummaryOne':'topicSummary',{groups:ref(ids.map(id=>({id,kind:'debate',title:id,date:rows.find(m=>m[3]===id)?.[2]})),initial(period?topicFact.groups[period]||0:Object.values(topicFact.groups).reduce((a,b)=>a+b,0)),{numeric:period?topicFact.groups[period]||0:Object.values(topicFact.groups).reduce((a,b)=>a+b,0)}),topic:topicFact.label}));}
 // Each selected template is one sentence; unknown outcomes create no assertion.
 return result.slice(0,4);
}
