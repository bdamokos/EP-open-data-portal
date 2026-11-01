// Client templates over retained official facts. No I/O or inferred outcomes.
import {europeStoryIso3} from './storyEurope.mjs';
export const cleanStoryTitle=title=>String(title||'').replace(/^(?:(?:JOINT )?MOTION FOR A RESOLUTION|(?:INTERIM )?REPORT|RECOMMENDATION)\s+(?:on\s+)?/i,'');
export function storyNumber(n,language='en'){const words=['zero','one','two','three','four','five','six','seven','eight','nine'];return language.split('-')[0]==='en'&&Number.isInteger(n)&&n>0&&n<10?words[n]:Number(n).toLocaleString(language==='en'?'en-GB':language);}
export function primaryStoryPlace(d){const keys=Object.keys(d.places),t=keys.filter(p=>d.places[p].includes('title')),o=keys.filter(p=>d.places[p].includes('official'));if(t.length===1)return t[0];const both=t.filter(p=>o.includes(p));if(both.length===1)return both[0];return d.format==='urgency'&&!t.length&&o.length===1?o[0]:null;}
export const strongStoryPlace=(d,p)=>Boolean(d.places[p]?.includes('title')||primaryStoryPlace(d)===p);
const quarter=d=>d?.slice(0,4)+'-Q'+Math.ceil(Number(d?.slice(5,7))/3);
const unique=records=>[...new Map(records.map(r=>[r.kind+':'+r.id,r])).values()];
const groupCodes=new Set('PPE S-D S_D RENEW VERTS-ALE VERTS_ALE ECR PFE PATRIOTS ESN THE-LEFT THE_LEFT NI'.split(' '));
const groupIdentity=g=>({S_D:'S-D',VERTS_ALE:'VERTS-ALE',THE_LEFT:'THE-LEFT',PATRIOTS:'PFE'}[g]||g);
const groupsOf=d=>[...new Set((d.groups||[]).filter(g=>groupCodes.has(g)).map(groupIdentity))];
const EU=new Set('AUT BEL BGR HRV CYP CZE DNK EST FIN FRA DEU GRC HUN IRL ITA LVA LTU LUX MLT NLD POL PRT ROU SVK SVN ESP SWE'.split(' '));
const msg=(id,values={},counts)=>({message:'topics.story.'+id,values,...(counts?{counts}:{})});
const sentence=(id,values={},priority=1,order=1,cost=1)=>({id:'topics.story.'+id,values,priority,order,cost});
const link=(records,text,extra={})=>({records:unique(records),text,...extra});
const byMeps=(a,b)=>b.meps-a.meps||a.id.localeCompare(b.id);
const byDate=(a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id);
function capped(lines){let left=4;return [...lines].sort((a,b)=>a.priority-b.priority||a.order-b.order).filter(line=>{if(line.cost>left)return false;left-=line.cost;return true;}).sort((a,b)=>a.order-b.order);}
export function buildTopicStories(facts,selection={}){
 if(!facts||!Array.isArray(facts.debates)||!Array.isArray(facts.docs)||!Array.isArray(facts.questions))return [];
 const {periods=[],partial=[],period,place,topic,zoom='world',mode='q',excludeOwn=false,labels={},language='en',proseLanguage='en'}=selection;
 const num=n=>storyNumber(n,language),initial=n=>{const s=num(n);return s.charAt(0).toLocaleUpperCase(language)+s.slice(1);};
 const day=d=>new Intl.DateTimeFormat(language==='en'?'en-GB':language,{day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
 const inView=p=>zoom!=='eu'||europeStoryIso3.includes(p),name=p=>labels[p]||p;
 const docById=new Map(facts.docs.map(d=>[d.id,d]));
 const docRecord=d=>({id:d.id,title:d.title,date:d.date,kind:'document',url:d.url||`https://www.europarl.europa.eu/doceo/document/${d.id}_EN.html`,outcome:d.outcome||undefined,groups:groupsOf(d)});
 const debateRecord=d=>({id:d.id,title:d.rawTitle||d.title,date:d.date,kind:'debate',...(d.cre?{url:`https://www.europarl.europa.eu/doceo/document/${d.cre}_EN.html`}:{})});
 const qRecord=q=>({id:q.id,title:q.t,date:q.d,kind:'question'});
 const docSet=d=>unique([d,...(d.derivedFrom||[]).map(id=>docById.get(id)).filter(Boolean)].map(docRecord));
 const debSet=d=>unique([debateRecord(d),...d.docs.map(id=>docById.get(id)).filter(Boolean).map(docRecord)]);
 const resolution=d=>{const rs=d.docs.map(id=>docById.get(id)).filter(x=>x&&/RESOLUTION_MOTION/.test(x.type)&&x.outcome);return rs.find(x=>x.type==='RESOLUTION_MOTION_JOINT')||rs[0]||null;};
 const adoptedResolution=d=>{const r=resolution(d);return r?.outcome?.outcome==='ADOPTED'?r:null;};
 const urgencySet=d=>unique([debateRecord(d),...(adoptedResolution(d)?[docRecord(adoptedResolution(d))]:[])]);
 const count=(records,n,unit,capital=false)=>link(records,msg('count.'+unit,{count:capital?initial(n):num(n)},{count:n}));
 const title=(records,text)=>link(records,cleanStoryTitle(text),{italic:true});
 const format=d=>['council-commission','commission','hrvp','eucouncil','president','topical','oral-question','urgency'].includes(d.format)?msg('format.'+d.format):null;
 const avgText=(a,records)=>msg(a<1?'average.lessThanOne':'average.value',a<1?{}:{average:link(records,num(a<10?Math.round(a*10)/10:Math.round(a)))});
 const hasTally=o=>o?.for!=null&&o?.against!=null;
 const tally=d=>{const o=d.outcome,records=docSet(d);return msg(o.abst?'tally.abstentions':'tally.simple',{for:link(records,num(o.for)),against:link(records,num(o.against)),...(o.abst?{abstentions:link(records,num(o.abst))}:{})},{count:o.abst||0});};
 const outcomeClause=(d,joint=false)=>{const r=resolution(d);if(!r)return null;const o=r.outcome,records=docSet(r),resolutionLink=link(records,msg('resolution'));
  if(o.outcome==='ADOPTED'&&hasTally(o))return msg(joint&&r.type==='RESOLUTION_MOTION_JOINT'&&groupsOf(r).length>=2?'outcome.jointPassed':'outcome.passed',{resolution:resolutionLink,tally:tally(r),groups:link(records,num(groupsOf(r).length))});
  if(o.outcome==='REJECTED'&&hasTally(o))return msg('outcome.rejected',{resolution:resolutionLink,tally:tally(r)});
  if(o.outcome==='ADOPTED')return msg(/VOTE_HAND/.test(o.method||o.decision_method||'')?'outcome.showOfHands':'outcome.adopted',{resolution:resolutionLink});
  return null;};
 const press=d=>{const procedures=new Set([...(d.procedures||[]),...d.docs.flatMap(id=>docById.get(id)?.procedures||[])]),items=[...new Map([...procedures].flatMap(p=>facts.press?.[p]||[]).map(r=>[r.id,r])).values()].sort(byDate);const r=items[0];return r?sentence('press',{title:title([{...r,kind:'press'}],r.title)},6,2.5):null;};
 const allPlaces=[...new Set([...facts.questions.flatMap(q=>q.places),...facts.docs.flatMap(d=>d.places),...facts.debates.flatMap(d=>Object.keys(d.places))])].filter(inView);
 const questions=(p,q,other=excludeOwn)=>facts.questions.filter(x=>x.places.includes(p)&&(!q||quarter(x.d)===q)&&(!other||!x.home.includes(p)));
 const knownElsewhere=(p,q)=>{const state=typeof q.askers==='string'?q.askers:q.askers?.[p];if(state)return state==='elsewhere';return !q.home.includes(p)&&Boolean(q.authors?.length)&&q.authors.every(id=>Boolean(facts.mepCountry?.[String(id)]));};
 const strongDebates=(p,q)=>facts.debates.filter(d=>(!q||d.q===q)&&strongStoryPlace(d,p));
 const placeDocs=(p,q)=>facts.docs.filter(d=>d.places.includes(p)&&(!q||quarter(d.date)===q));
 const prior=(i)=>periods.slice(0,i).filter(q=>!partial.includes(q));
 const riser=(series,min)=>{const i=periods.indexOf(period),before=prior(i);if(i<2||partial.includes(period)||!before.length)return null;
  return allPlaces.map(p=>{const records=series(p,period),previous=before.flatMap(q=>series(p,q)),average=previous.length/before.length;return {p,records,previous,average,ratio:records.length/Math.max(1,average)};}).filter(r=>r.records.length>=min&&r.ratio>=1.5).sort((a,b)=>b.ratio-a.ratio||b.records.length-a.records.length||name(a.p).localeCompare(name(b.p)))[0]||null;};
 const isResolution=d=>/RESOLUTION_MOTION/.test(d.type);
 const topTexts=docs=>docs.filter(d=>!docs.some(other=>other.derivedFrom?.includes(d.id)));
 const knownAdopted=docs=>topTexts(docs.filter(d=>d.outcome?.outcome==='ADOPTED'));
 if(place){
  const allQ=questions(place,null),allDeb=strongDebates(place,null),allDocs=placeDocs(place,null),res=knownAdopted(unique([...allDocs.filter(isResolution),...allDeb.map(adoptedResolution).filter(Boolean)]));
  if(!period){const lines=[];
   if(allQ.length){const elsewhere=allQ.filter(q=>knownElsewhere(place,q)),unknownOrigin=allQ.some(q=>!q.home.includes(place)&&!knownElsewhere(place,q));lines.push(sentence(EU.has(place)&&!excludeOwn&&!unknownOrigin?'place.summary.questionsElsewhere':'place.summary.questions',{questions:count(allQ.map(qRecord),allQ.length,'questions'),place:name(place),elsewhere:link(elsewhere.map(qRecord),num(elsewhere.length))},1,1));}
   if(allDeb.length)lines.push(sentence(res.length?'place.summary.plenaryResolutions':'place.summary.plenary',{debates:count(allDeb.map(debateRecord),allDeb.length,'debates'),resolutions:count(res.map(docRecord),res.length,'resolutions')},2,2));
   const peak=periods.map(q=>({q,meps:strongDebates(place,q).reduce((n,d)=>n+d.meps,0),n:questions(place,q).length})).filter(x=>!partial.includes(x.q)||x.meps).sort((a,b)=>b.meps-a.meps||b.n-a.n)[0];
   if(peak?.meps)lines.push(sentence('place.summary.peak',{quarter:link([...strongDebates(place,peak.q).map(debateRecord),...questions(place,peak.q).map(qRecord)],peak.q.replace('-',' '),{period:peak.q})},3,3));return capped(lines);
  }
  const lines=[],debs=[...strongDebates(place,period)].sort((a,b)=>Number(primaryStoryPlace(b)===place)-Number(primaryStoryPlace(a)===place)||byMeps(a,b)).slice(0,2).sort(byDate);
  debs.forEach((d,i)=>{const fmt=format(d),outcome=outcomeClause(d,true);lines.push(sentence('place.quarter.debate',{kind:msg('debateKind.'+(d.format==='urgency'?'urgency':d.format==='topical'?'topical':'ordinary')),date:day(d.date),title:title(debSet(d),d.title),format:fmt&&!['urgency','topical'].includes(d.format)?msg('parenthetic',{value:fmt}):null,meps:count(debSet(d),d.meps,'meps'),outcome:outcome?msg('semicolon',{value:outcome}):null},1,i+1));const pr=press(d);if(pr){pr.order=i+1.1;lines.push(pr);}});
  const qs=questions(place,period),other=questions(place,period).filter(q=>knownElsewhere(place,q)),unknownOrigin=questions(place,period).some(q=>!q.home.includes(place)&&!knownElsewhere(place,q)),i=periods.indexOf(period),previous=prior(i).flatMap(q=>questions(place,q)),average=prior(i).length?previous.length/prior(i).length:null;
  if(qs.length)lines.push(sentence('place.quarter.questions',{questions:count(qs.map(qRecord),qs.length,'questions',true),origin:EU.has(place)&&!excludeOwn&&!unknownOrigin&&other.length!==qs.length?msg(other.length?'origin.onlyElsewhere':'origin.eachHome',other.length?{questions:link(other.map(qRecord),num(other.length))}:{}):null,comparison:average!=null&&!partial.includes(period)&&i>=2&&qs.length>=8&&qs.length>=2*Math.max(1,average)?msg('comparison',{average:avgText(average,previous.map(qRecord))}):null},2,3));
  const extra=knownAdopted(placeDocs(place,period).filter(d=>isResolution(d)&&!debs.some(b=>resolution(b)?.id===d.id)));if(extra.length)lines.push(sentence('place.quarter.otherResolutions',{resolutions:count(extra.map(docRecord),extra.length,'resolutions')},3,4));return capped(lines);
 }
 if(topic){const t=facts.topics?.[topic];if(!t)return [];const kw=topic.replace(/^eurovoc:/,''),groups=new Set(t.members.map(m=>m[3])),members=new Set(t.members.map(m=>m[0]));
  const docs=facts.docs.filter(d=>d.keywords.includes(kw)||members.has(d.id)),docIds=new Set(docs.map(d=>d.id)),debs=facts.debates.filter(d=>groups.has(d.id)||d.docs.some(id=>docIds.has(id)));
  const rows=period?t.members.filter(m=>quarter(m[2])===period):t.members,records=unique(rows.map(m=>({id:m[0],kind:m[1],date:m[2],title:docById.get(m[0])?.title||facts.debates.find(d=>d.id===m[0])?.rawTitle||t.label})));
  const n=period?t.groups[period]||0:new Set(t.members.map(m=>m[3])).size;if(!period)return n?[sentence('topic.summary',{groups:{...count(records,n,'groups'),pageRecords:true},topic:t.label})]:[];
  const lines=[],peak=periods.filter(q=>!partial.includes(q)).sort((a,b)=>(t.groups[b]||0)-(t.groups[a]||0))[0];if(period===peak&&n)lines.push(sentence('topic.quarter.peak',{groups:{...count(records,n,'groups'),pageRecords:true}},1,1));
  const big=[...debs].filter(d=>d.q===period).sort(byMeps)[0];if(big)lines.push(sentence('topic.quarter.bigDebate',{meps:count(debSet(big),big.meps,'meps',true),title:title(debSet(big),big.title),date:day(big.date),format:format(big)?msg('comma',{value:format(big)}):null},2,2));
  const adopted=knownAdopted(docs.filter(d=>d.outcome?.outcome==='ADOPTED'&&quarter(d.outcome.date)===period)),withTally=adopted.filter(d=>hasTally(d.outcome));
  if(adopted.length){if(adopted.length<=2&&withTally.length===adopted.length)lines.push(sentence('topic.quarter.adoptedFew',{texts:withTally.map(d=>msg('textWithTally',{title:title(docSet(d),d.title),for:link(docSet(d),num(d.outcome.for)),against:link(docSet(d),num(d.outcome.against))}))},3,3));
   else{const meps=d=>Math.max(0,...debs.filter(b=>b.docs.includes(d.id)).map(b=>b.meps)),head=[...withTally].sort((a,b)=>meps(b)-meps(a)||b.outcome.for-a.outcome.for)[0],close=[...withTally].sort((a,b)=>(a.outcome.for-a.outcome.against)-(b.outcome.for-b.outcome.against))[0];lines.push(sentence('topic.quarter.adoptedMany',{texts:count(adopted.map(docRecord),adopted.length,'texts'),headline:head?msg('including',{title:title(docSet(head),head.title),for:link(docSet(head),num(head.outcome.for)),against:link(docSet(head),num(head.outcome.against))}):null},3,3));if(close&&close!==head&&close.outcome.for-close.outcome.against<100)lines.push(sentence('topic.quarter.closest',{title:title(docSet(close),close.title),tally:tally(close)},4,4));}}
  return capped(lines);
 }
 // Map: exact reviewed priorities, followed by display order.
 const debs=facts.debates.filter(d=>d.q===period&&Object.keys(d.places).some(p=>inView(p)&&strongStoryPlace(d,p))),urg=debs.filter(d=>d.format==='urgency').sort(byDate),big=debs.filter(d=>d.format!=='urgency').sort(byMeps)[0],lines=[];
 if(big){const p=primaryStoryPlace(big),same=p&&big.title.trim().toLowerCase()===name(p).toLowerCase(),fmt=format(big),r=adoptedResolution(big),outcome=r?msg('map.bigDebate.resolution',{resolution:link(docSet(r),msg('resolution')),outcome:hasTally(r.outcome)?msg('resolution.passed',{tally:tally(r)}):msg(/VOTE_HAND/.test(r.outcome.method||r.outcome.decision_method||'')?'resolution.showOfHands':'resolution.adopted')}):null;
  lines.push(sentence('map.bigDebate.'+(p&&inView(p)?same?'placeIsTitle':'place':'plain'),{place:p?link(debSet(big),name(p)):null,debate:link(debSet(big),msg('debateOnMap')),title:title(debSet(big),big.title),meps:count(debSet(big),big.meps,'meps'),date:day(big.date),format:fmt?msg('comma',{value:fmt}):null,resolution:outcome},1,2,outcome?2:1));const pr=press(big);if(pr)lines.push(pr);}
 if(urg.length){const places=[...new Set(urg.map(primaryStoryPlace).filter(p=>p&&inView(p)))],allAdopted=urg.every(d=>adoptedResolution(d));if(urg.length===1){const d=urg[0];lines.push(sentence('map.urgency.one',{title:title(urgencySet(d),d.title),resolution:allAdopted?msg('urgency.resolution',{resolution:link(urgencySet(d),msg('resolution'))}):null},4,3));}
  else if(places.length)lines.push(sentence(places.length===urg.length?'map.urgency.many':'map.urgency.manyPartial',{count:link(urg.flatMap(urgencySet),initial(urg.length)),places:places.map(p=>link(urg.filter(d=>primaryStoryPlace(d)===p).flatMap(urgencySet),name(p))),resolutions:allAdopted?msg('urgency.resolutions',{resolutions:link(urg.flatMap(urgencySet),msg('resolutions'))}):null},4,3));}
 const rankedDebates=allPlaces.map(p=>({p,records:debs.filter(d=>strongStoryPlace(d,p))})).sort((a,b)=>b.records.length-a.records.length||name(a.p).localeCompare(name(b.p)));
 if(rankedDebates[0]?.records.length>=2&&rankedDebates[0].records.length>(rankedDebates[1]?.records.length||0)){const r=rankedDebates[0],records=r.records.map(debateRecord);lines.push(sentence('map.mostDebated',{place:link(records,name(r.p)),debates:count(records,r.records.length,'debates')},5,4));}
 if(mode==='q'){
  const ranked=q=>allPlaces.map(p=>({p,records:questions(p,q)})).filter(r=>r.records.length).sort((a,b)=>b.records.length-a.records.length||name(a.p).localeCompare(name(b.p))),leaders=ranked(period),lead=leaders[0],tied=lead?leaders.filter(r=>r.records.length===lead.records.length):[],rise=riser((p,q)=>questions(p,q),8);
  if(rise){const records=rise.records.map(qRecord),home=rise.records.filter(q=>q.home.includes(rise.p)),pd=strongDebates(rise.p,period).sort(byMeps)[0];lines.push(sentence('map.rise.'+(rise.average<0.5?'rare':rise.ratio>=4?'jumped':'rose'),{place:link(records,name(rise.p)),questions:count(records,records.length,'questions'),number:link(records,num(records.length)),average:avgText(rise.average,rise.previous.map(qRecord)),home:!excludeOwn&&EU.has(rise.p)&&home.length?msg(home.length===records.length?'rise.eachHome':'rise.someHome',{questions:link(home.map(qRecord),num(home.length))}):null,leader:lead?.p===rise.p&&tied.length===1?msg('rise.leader',{questions:link(records,msg('moreThanAny'))}):null,debate:pd&&pd.id!==big?.id&&!urg.includes(pd)?msg('rise.debate',{title:title(debSet(pd),pd.title),date:day(pd.date)}):null},2,5));}
  if(tied.length>1&&(!rise||!tied.some(r=>r.p===rise.p)))lines.push(sentence('map.lead.tied',{places:tied.map(r=>link(r.records.map(qRecord),name(r.p))),questions:count(tied.flatMap(r=>r.records.map(qRecord)),lead.records.length,'questionsEach')},3,6));
  else if(lead&&(!rise||lead.p!==rise.p)&&tied.length===1){const i=periods.indexOf(period),sole=q=>{const rows=ranked(q);return rows[0]&&rows[0].records.length>(rows[1]?.records.length||0)?rows[0].p:null;};let streak=1;for(let j=i-1;j>=0&&!partial.includes(periods[j])&&sole(periods[j])===lead.p;j--)streak++;
   const ordinal=new Intl.PluralRules(proseLanguage,{type:'ordinal'}).select(streak),record=lead.records.map(qRecord),streakRecords=periods.slice(i-streak+1,i+1).flatMap(q=>questions(lead.p,q).map(qRecord));lines.push(sentence('map.lead.'+(partial.includes(period)&&period===periods.at(-1)?'soFar':streak>=3?'streak':streak===2?'again':'first'),{place:link(record,name(lead.p)),questions:count(record,record.length,'questions'),ordinal:link(streakRecords,language.split('-')[0]==='en'&&streak<=9?msg('ordinal.words.'+streak):msg('ordinal.'+ordinal,{count:num(streak)}))},3,6));}
 }else{
  const res=knownAdopted(facts.docs.filter(d=>isResolution(d)&&d.outcome?.outcome==='ADOPTED'&&quarter(d.outcome.date)===period&&d.places.some(inView))),places=allPlaces.map(p=>({p,docs:res.filter(d=>d.places.includes(p))})).filter(r=>r.docs.length).sort((a,b)=>b.docs.length-a.docs.length||name(a.p).localeCompare(name(b.p)));
  if(places.length)lines.push(sentence('map.texts.resolutions',{places:places.slice(0,4).map(r=>link(r.docs.map(docRecord),r.docs.length>1?msg('placeWithCount',{place:name(r.p),count:num(r.docs.length)}):name(r.p))),others:places.length>4?msg('amongPlaces',{places:link(res.map(docRecord),num(places.length))}):null},2,5));
  const rise=riser((p,q)=>placeDocs(p,q),3);if(rise)lines.push(sentence('map.texts.rise',{place:link(rise.records.map(docRecord),name(rise.p)),number:link(rise.records.map(docRecord),num(rise.records.length)),average:avgText(rise.average,rise.previous.map(docRecord))},3,6));
 }
 return capped(lines);
}
