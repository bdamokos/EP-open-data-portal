import {placeLabel} from './placeLabels.mjs';
import {storyLinkClaims} from './storyLinkModel.mjs';
import {agendaTitle,isEuPlace,partialQuarter,topicsHref,monthRangeLabel} from './topicPresentation.mjs';
import {cleanStoryTitle,storyNumber,storyPlaceName,normalizeReferenceStoryFacts,primaryStoryPlace} from './topicStoryModel.mjs';
import {europeStoryIso3} from './storyEurope.mjs';
const EUROPE=new Set(europeStoryIso3);
// Recurring sentences have alternative wordings with the same slots, picked by quarter, scope and sentence.
const VARIANTS={'exact.busiestPlace':1,'exact.busiestPlain':1,'exact.busiestOne':1,'exact.busiestMany':1,'exact.mostDebatedOne':1,'exact.mostDebatedMany':1,'exact.questionRiseFew':1,'exact.questionJumpedFew':1,'map.urgency.many':1,'map.lead.first':1,'map.lead.again':1,'map.lead.streak':1,'map.lead.tied':1,'place.quarter.questions':1};
const hash=text=>{let h=2166136261;for(const c of text){h^=c.codePointAt(0);h=Math.imul(h,16777619)>>>0;}h^=h>>>16;h=Math.imul(h,0x85ebca6b)>>>0;h^=h>>>13;h=Math.imul(h,0xc2b2ae35)>>>0;return (h^h>>>16)>>>0;};
// Consecutive quarters alternate: the quarter's position plus a per-scope, per-sentence offset. Whole-term stories use position 0.
export function storyVariant(id,period,scope,has=()=>true){const base=id.replace(/^topics\.story\./,''),n=VARIANTS[base];if(!n)return id;const m=/^(\d{4})-Q([1-4])$/.exec(period||''),position=m?Number(m[1])*4+Number(m[2])-1:0,k=(position+hash(scope+'|'+base))%(n+1);return k&&has(id+'.v'+(k+1))?id+'.v'+(k+1):id;}
// The slot that starts each sentence that can open the Europe story; other openers start with fixed words.
const LEADS={'integrated.questionPlaceDebates':'place','integrated.questionPlaceRise':'place','integrated.questionPlaceDebatesRise':'place','integrated.placeQuestions':'place','exact.busiestPlace':'place','map.urgency.many':'urgencyDebates','exact.urgencyPartial':'urgencyDebates','exact.urgencyCount':'urgencyDebates','exact.mostDebatedOne':'places','exact.mostDebatedMany':'places','exact.rises':'changes','map.lead.first':'place','map.lead.again':'place','map.lead.streak':'place','map.lead.tied':'places','count.urgencyDebates':'count','links.urgency':'count','exact.questionRiseFew':'about','exact.questionJumpedFew':'about','exact.questionRiseEach':'about','exact.questionJumpedEach':'about','exact.documentRiseFew':'about','exact.documentRiseEach':'about','exact.questionRare':'place','exact.questionRareEach':'places'};
export function storyFactsRoute(s={},browse={}){const p=new URLSearchParams({scope:s.place?'place':s.topic?'topic':'map',mode:s.mode||'q',zoom:s.zoom||'world',askers:s.excludeOwn?'not-home':'all',lang:s.language||'en'});if(s.place||s.topic)p.set('key',s.place?'place:'+s.place:s.topic);if(s.period)p.set('period',s.period);for(const [k,v]of Object.entries(browse))if(v)p.set(k,v);return 'topics/story-facts?'+p;}
export function storyRecord(r,kind){return {id:r.id,kind,titleLanguage:r.titleLanguage,title:kind==='debate'?agendaTitle(r.rawTitle||r.title):r.title||r.t,date:r.date||r.d,url:r.url||(r.cre?`https://www.europarl.europa.eu/doceo/document/${r.cre}_EN.html`:undefined),outcome:r.outcome?{...r.outcome,method:/VOTE_HAND|show.of.hands/i.test([r.outcome.method,r.outcome.decisionMethod,r.outcome.decision_method].join(' '))?'VOTE_HAND':r.outcome.method}:null,groups:r.groups};}
export function buildExactTopicStories(payload,s={}){
 if(!payload?.ready||!payload.counts||!payload.winners)return [];
 s={language:'en',...s};
 const has=s.hasMessage||(()=>String(s.language).split('-')[0]==='en'),europe=Array.isArray(payload.europe)?new Set(payload.europe):EUROPE,inView=p=>s.zoom!=='eu'||europe.has(p),startForms=new Map(),nameLanguages=new Map();
 const f=normalizeReferenceStoryFacts(payload),period=s.period,c={...(period?payload.periodCounts.find(r=>r.period===period)||{}:payload.counts)},w=period?payload.periodWinners[period]||{}:payload.winners,labels=s.labels||{},num=n=>storyNumber(n,s.language),digits=n=>Number(n).toLocaleString(s.language==='en'?'en-GB':s.language),name=(p,start=false)=>{
  const localized=placeLabel(p,s.language,{label:labels[p]||p,labelLanguage:s.labelLanguages?.[p]||null});
  const text=storyPlaceName(p,localized.label,{language:s.language,start});
  if(localized.labelLanguage)nameLanguages.set(text,localized.labelLanguage);
  if(start)startForms.set(text,storyPlaceName(p,localized.label,{language:s.language}));
  return text;
 };
 const byDate=(a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id));

 const ds=new Map(f.debates.map(d=>[d.id,d])),docs=new Map(f.docs.map(d=>[d.id,d])),lines=[];
 const msg=(id,values={})=>({message:'topics.story.'+id,values}),ref=(text,records=[],extra={})=>({text,records,...extra});
 const cm=(n,unit)=>({...msg('count.'+unit,{count:num(n)}),counts:{count:n}});
 const browse=(text,list,place,askers)=>ref(text,[],{browse:{list,...(place?{place}:{}),...(askers?{askers}:{})}});
 const title=d=>ref(cleanStoryTitle(agendaTitle(d.rawTitle||d.title)),[storyRecord(d,ds.has(d.id)?'debate':'document')],{italic:true,titleLanguage:d.titleLanguage});
 const add=(id,values,priority=1,order=priority,extra={})=>lines.push({id:'topics.story.'+id,values,priority,order,cost:1,...extra});
 const records=d=>[storyRecord(d,'debate'),...(d.docs||[]).map(id=>docs.get(id)).filter(Boolean).filter(d=>d.outcome?.outcome==='ADOPTED').map(d=>storyRecord(d,'document'))];
 const debates=(ids)=>ids.map(x=>ds.get(typeof x==='string'?x:x.id)).filter(d=>d&&d.meps>=3);
 const busy0=debates(s.place?w.leadingPlaceDebates3Plus||[]:s.topic?w.busiestDebates||[]:w.busiestNonUrgencyDebates||[]);
 const busy=[...busy0].sort(byDate);
 const narratedText=d=>{const all=(d.docs||[]).map(id=>docs.get(id)).filter(x=>x?.outcome?.outcome==='ADOPTED'&&/RESOLUTION_MOTION/.test(x.type));return all.find(x=>x.type==='RESOLUTION_MOTION_JOINT')||all[0]||null;};
 const narrates=list=>({narrates:list.map(narratedText).filter(Boolean).map(x=>x.id)});
 // A rejection is told only when every linked motion has a known outcome and none was adopted.
 const rejectedText=d=>{const all=(d.docs||[]).map(id=>docs.get(id)).filter(x=>x&&/RESOLUTION_MOTION/.test(x.type)),joints=all.filter(x=>x.type==='RESOLUTION_MOTION_JOINT'),r=joints.length===1?joints[0]:!joints.length&&all.length===1?all[0]:null;return r&&all.every(x=>x.outcomeStatus==='known'&&x.outcome&&x.outcome.outcome!=='ADOPTED')&&r.outcome.outcome==='REJECTED'&&r.outcome.for!=null&&r.outcome.against!=null?r:null;};
 const outcome=d=>{const all=(d.docs||[]).map(id=>docs.get(id)).filter(x=>x?.outcome?.outcome==='ADOPTED'&&/RESOLUTION_MOTION/.test(x.type)),r=all.find(x=>x.type==='RESOLUTION_MOTION_JOINT')||all[0];if(!r){const x=rejectedText(d);if(!x)return null;const rs=[storyRecord(x,'document')];return msg('semicolon',{value:msg('outcome.rejected',{resolution:ref(msg('resolution'),rs),tally:msg('tally.simple',{for:ref(digits(x.outcome.for),rs),against:ref(digits(x.outcome.against),rs)})})});}const o=r.outcome,rs=[storyRecord(r,'document')],resolution=ref(msg('resolution'),rs);return msg('semicolon',{value:o.for!=null&&o.against!=null?msg(r.type==='RESOLUTION_MOTION_JOINT'&&r.groupsAvailable===true&&r.groups?.length>=2?'outcome.jointPassed':'outcome.passed',{resolution,groups:ref(num(r.groups?.length||0),rs),tally:msg('tally.simple',{for:ref(digits(o.for),rs),against:ref(digits(o.against),rs)})}):msg(/VOTE_HAND/.test(o.method||'')?'outcome.showOfHands':'outcome.adopted',{resolution})});};
 const day=d=>new Intl.DateTimeFormat(s.language==='en'?'en-GB':s.language||'en-GB',{day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
 const fmt=d=>['council-commission','commission','hrvp','eucouncil','president','topical','oral-question'].includes(d.format)?msg('comma',{value:msg('format.'+d.format)}):null;
 const debateValues=d=>({title:ref(cleanStoryTitle(agendaTitle(d.rawTitle||d.title)),records(d),{italic:true,titleLanguage:d.titleLanguage}),meps:ref(cm(d.meps,'meps'),records(d)),date:day(d.date),format:fmt(d),outcome:outcome(d)});
 const told=new Set();
 const home=p=>s.mode!=='d'&&!s.excludeOwn&&isEuPlace(p.id)&&payload.series?.[p.id]?.[period]?.questionHome?msg(payload.series[p.id][period].questionHome===p.count?'rise.eachHome':'rise.someHome',{questions:ref(num(payload.series[p.id][period].questionHome),[],{rawCount:payload.series[p.id][period].questionHome,target:topicsHref('place:'+p.id,{'t-q':period,'t-kind':'question','t-askers':'home'})})}):null;
 const busyValues=busy.map(d=>msg('exact.debate',debateValues(d)));
 if((period||!s.place&&!s.topic)&&busy.length){
  if(busy.length===1&&!s.place){const d=busy[0],p0=d.primaryPlace||primaryStoryPlace(d),pp=p0&&inView(p0)?p0:null,v=debateValues(d);
   // Lead with the place when the debate has one primary place in view; topics use their own frame.
   if(s.topic)add('exact.topicBusiest',{...v,meps:ref({...cm(d.meps,'meps'),values:{count:num(d.meps).replace(/^./,x=>x.toLocaleUpperCase(s.language))}},records(d))},1,2,narrates([d]));
   else if(pp){if(s.mode!=='d')told.add(pp);add('exact.busiestPlace',{...v,place:name(pp,true)},1,2,{...narrates([d]),placeId:pp});}
   else add('exact.busiestPlain',v,1,2,narrates([d]));}
  else add(s.place?'exact.placeDebates':busy.length===1?'exact.busiestOne':'exact.busiestMany',{debates:busyValues},1,2,narrates(busy));}
 if(!s.place&&!s.topic){
  const urg=(payload.sets?.urgencyDebates?.[period]||[]).map(id=>ds.get(id)).filter(Boolean).sort(byDate);startForms.set(num(c.urgencyDebates||0).replace(/^./,x=>x.toLocaleUpperCase(s.language)),num(c.urgencyDebates||0));
  if(c.urgencyDebates&&urg.length){const primary=d=>{const p=d.primaryPlace||primaryStoryPlace(d);return p&&inView(p)?p:null;},adopted=d=>(d.docs||[]).some(id=>docs.get(id)?.outcome?.outcome==='ADOPTED'&&/RESOLUTION_MOTION/.test(docs.get(id)?.type)),allAdopted=urg.every(adopted),places=[...new Set(urg.map(primary).filter(Boolean))];add(urg.length===1?'map.urgency.one':places.length===urg.length?'map.urgency.many':places.length?'exact.urgencyPartial':'exact.urgencyCount',{count:ref(num(c.urgencyDebates).replace(/^./,x=>x.toLocaleUpperCase(s.language)),urg.flatMap(records)),urgencyDebates:ref({...msg('count.urgencyDebates',{count:num(c.urgencyDebates).replace(/^./,x=>x.toLocaleUpperCase(s.language))}),counts:{count:c.urgencyDebates}},urg.flatMap(records)),title:ref(cleanStoryTitle(agendaTitle(urg[0].rawTitle||urg[0].title)),records(urg[0]),{italic:true,titleLanguage:urg[0].titleLanguage}),resolution:allAdopted?msg('urgency.resolution',{resolution:ref(msg('resolution'),records(urg[0]))}):null,places:places.map(p=>ref(name(p),urg.filter(d=>primary(d)===p).flatMap(records))),resolutions:allAdopted?msg('urgency.resolutions',{resolutions:ref(msg('resolutions'),urg.flatMap(records))}):null,debates:urg.map(d=>ref(cleanStoryTitle(agendaTitle(d.rawTitle||d.title)),records(d),{italic:true,titleLanguage:d.titleLanguage}))},4,3);}
  const most=w.mostDebatedPlaces||[];if(most.length&&most[0].count>=2)add(most.length===1?'exact.mostDebatedOne':'exact.mostDebatedMany',{places:most.map((p,i)=>browse(name(p.id,i===0),'debates',p.id)),count:{...browse(num(most[0].count),'debates',most[0].id),rawCount:most[0].count}},5,4);
  const questionGap=false;
  const rises=(s.mode==='d'?w.risingDocumentPlaces:questionGap?[]:w.risingQuestionPlaces)?.filter(p=>s.mode==='d'||!told.has(p.id)&&!(w.mostQuestionedPlaces?.length>1&&w.mostQuestionedPlaces.some(l=>l.id===p.id)));
  if(rises?.length){
   const kindOf=p=>s.mode==='d'?'exact.documentRiseFew':p.baselineMean<0.5?'exact.questionRare':p.ratio>=4?'exact.questionJumpedFew':'exact.questionRiseFew';
   const meanText=p=>p.baselineMean<1?'<1':String(Math.round(p.baselineMean*10)/10);
   const average=(p,ids)=>ref(p.baselineMean<1?msg('average.lessThanOne'):msg('average.value',{average:digits(Math.round(p.baselineMean*10)/10)}),[],{browse:{list:s.mode==='d'?'documents':'questions',place:ids[0],periods:payload.periods.slice(1,payload.periods.indexOf(period)).join(',')}});
   const placeRef=(p,i=0)=>s.mode!=='d'&&p.baselineMean<0.5?ref(name(p.id,i===0),[],{browse:{list:'questions',place:p.id,periods:payload.periods.slice(1,payload.periods.indexOf(period)+1).join(',')}}):browse(name(p.id),s.mode==='d'?'documents':'questions',p.id);
   const leader=p=>s.mode!=='d'&&w.mostQuestionedPlaces?.length===1&&w.mostQuestionedPlaces[0].id===p.id?msg('rise.leader',{questions:browse(msg('moreThanAny'),'questions',p.id)}):null;
   // Several places with the same change share one sentence; otherwise each gets its own.
   const same=rises.length>1&&(s.mode==='d'||rises.every(p=>!payload.series?.[p.id]?.[period]?.debates))&&rises.every(p=>kindOf(p)===kindOf(rises[0])&&p.count===rises[0].count&&meanText(p)===meanText(rises[0])&&!leader(p)&&!home(p));
   if(same){const p=rises[0];add('exact.rises',{changes:[msg(kindOf(p).replace(/Few$/,'')+'Each',{places:rises.map((p,i)=>placeRef(p,i)),count:browse(num(p.count),s.mode==='d'?'documents':'questions',p.id),questions:browse(cm(p.count,'questions'),'questions',p.id),average:average(p,rises.map(r=>r.id))})]},s.mode==='d'?3:2,s.mode==='d'?6:5);}
   else for(const p of rises)add('exact.rises',{changes:[msg(kindOf(p),{place:placeRef(p),count:browse(num(p.count),s.mode==='d'?'documents':'questions',p.id),questions:browse(cm(p.count,'questions'),'questions',p.id),leader:leader(p),home:home(p),average:average(p,[p.id])})]},s.mode==='d'?3:2,s.mode==='d'?6:5);
  }
  if(s.mode==='d'){const top=[...(w.topAdoptedPlaces||[])].sort((a,b)=>b.count-a.count||name(a.id).localeCompare(name(b.id))).slice(0,4);if(top.length)add('exact.mapAdopted',{places:top.map(p=>browse(p.count>1?msg('placeWithCount',{place:name(p.id),count:num(p.count)}):name(p.id),'adoptedTexts',p.id)),others:c.placesWithAdoptedTexts>top.length?msg('amongPlaces',{places:{...browse(num(c.placesWithAdoptedTexts),'adoptedTexts'),rawCount:c.placesWithAdoptedTexts}}):null},2,5);}
  else {const leaders=questionGap?[]:w.mostQuestionedPlaces||[];if(leaders.length&&(leaders.length>1||!told.has(leaders[0].id)&&!rises?.some(p=>p.id===leaders[0].id))){const count=leaders[0].count;const periods=payload.periods||[],index=periods.indexOf(period),partial=p=>partialQuarter(p,payload.partial);let streak=1;for(let i=index-1;i>=0&&!partial(periods[i]);i--){const old=payload.periodWinners[periods[i]]?.mostQuestionedPlaces||[];if(old.length!==1||old[0].id!==leaders[0].id)break;streak++;}add(leaders.length>1?'map.lead.tied':partial(period)?'map.lead.soFar':streak>=3?'map.lead.streak':streak===2?'map.lead.again':'map.lead.first',{places:leaders.map((p,i)=>browse(name(p.id,i===0),'questions',p.id)),place:browse(name(leaders[0].id,!partial(period)),'questions',leaders[0].id),ordinal:ref(msg(s.language==='en'&&streak<=9?'ordinal.words.'+streak:'ordinal.'+new Intl.PluralRules(s.language||'en',{type:'ordinal'}).select(streak),{count:num(streak)}),[],{browse:{list:'questions',place:leaders[0].id,periods:periods.slice(index-streak+1,index+1).join(',')}}),questions:browse(cm(count,leaders.length>1?'questionsEach':'questions'),'questions',leaders[0].id)},3,6);}}
 }else if(s.place){
  if(!period){if(c.questions)add(isEuPlace(s.place)&&payload.askers==='all'?'place.summary.questionsElsewhere':'place.summary.questions',{questions:browse(cm(c.questions,'questions'),'questions'),place:labels[s.place]||s.place,elsewhere:{...browse(num(c.questionElsewhere),'questions',null,'elsewhere'),rawCount:c.questionElsewhere}},1);
   if(c.debates)add(c.adoptedTexts?'exact.placePlenary':'place.summary.plenary',{debates:browse(cm(c.debates,'debates'),'debates'),texts:browse(cm(c.adoptedTexts,'texts'),'adoptedTexts')},2);
  }else if(c.questions)add('place.quarter.questions',{questions:browse(cm(c.questions,'questions'),'questions'),origin:!s.excludeOwn&&isEuPlace(s.place)&&payload.askers==='all'&&c.questionHome&&c.questionUnknown===0?msg(c.questionHome===c.questions?'origin.eachHome':'origin.onlyElsewhere',{questions:{...browse(num(c.questionElsewhere),'questions',null,'elsewhere'),rawCount:c.questionElsewhere}}):null,comparison:(()=>{const index=payload.periods.indexOf(period),before=payload.periods.slice(1,index),total=before.reduce((n,p)=>{const row=payload.periodCounts.find(r=>r.period===p);return n+(row?row.questions:0);},0),mean=before.length?total/before.length:0;return index>=2&&!partialQuarter(period,payload.partial)&&c.questions>=8&&c.questions>=2*Math.max(1,mean)?msg('comparison',{average:ref(mean<1?msg('average.lessThanOne'):msg('average.value',{average:num(Math.round(mean*10)/10)}),[],{browse:{list:'questions',periods:before.join(',')}})}):null;})()},3);
 }else {const full=payload.periodCounts.filter(p=>!partialQuarter(p.period,payload.partial)),peak=Math.max(0,...full.map(p=>p.groups));if(period&&c.groups>0&&c.groups===peak)add('topic.quarter.peak',{groups:ref(cm(c.groups,'groups'),[],{pageRecords:true,period})},1);if(!period&&c.groups)add('topic.summary',{groups:ref(cm(c.groups,'groups'),[],{pageRecords:true}),topic:payload.topic?.labelLanguage?{text:payload.topic.label,records:[],labelLanguage:payload.topic.labelLanguage}:payload.topic?.label||s.topic},1);}
 if(s.topic||s.place&&period){const ids=payload.sets?.adoptedTexts?.[period]||payload.sets?.adoptedTextsWhenAtMostTwo?.[period]||[],named=ids.map(id=>docs.get(id)).filter(Boolean),headline=(w.headlineAdoptedTexts3Plus||[]).filter(x=>x.debateMeps>=3).map(x=>docs.get(x.id)).filter(Boolean);
  const vote=d=>d.outcome?.for!=null&&d.outcome?.against!=null?msg('textWithTally',{title:title(d),for:ref(digits(d.outcome.for),[storyRecord(d,'document')]),against:ref(digits(d.outcome.against),[storyRecord(d,'document')])}):title(d);
  // Counted membership is proven by the quarter's adopted set or by the adopted-text winners drawn from it.
  const quarterOf=date=>date?date.slice(0,4)+'-Q'+Math.ceil(Number(date.slice(5,7))/3):null;
  const counted=new Set([...ids,...(w.headlineAdoptedTexts3Plus||[]).map(x=>x.id),...(w.headlineAdoptedTexts||[]).map(x=>x.id),...(w.closestAdoptedTexts||[]).map(x=>x.id)]);
  // Topic quarters: when the busiest debate's own dossier text is the headline adoption, say it once.
  const lead=s.topic&&period&&busy.length===1?busy[0]:null,merged=lead&&headline.find(d=>(lead.docs||[]).includes(d.id)&&d.outcome?.for!=null&&d.outcome?.against!=null);
  if(merged){const i=lines.findIndex(l=>l.id==='topics.story.exact.topicBusiest');if(i>=0)lines.splice(i,1);add('exact.topicBusiestAdopted',{title:ref(cleanStoryTitle(agendaTitle(lead.rawTitle||lead.title)),records(lead),{italic:true,titleLanguage:lead.titleLanguage}),date:day(lead.date),meps:ref(cm(lead.meps,'meps'),records(lead)),tally:msg('tally.simple',{for:ref(digits(merged.outcome.for),[storyRecord(merged,'document')]),against:ref(digits(merged.outcome.against),[storyRecord(merged,'document')])})},1,2,{narrates:[merged.id]});}
  // The adoption sentence is built from the final story: a text is left out only if a kept sentence names it,
  // it was adopted in this quarter, and it is provably in the counted set.
  if(c.adoptedTexts)add('exact.adopted',null,3,3,{finalize:kept=>{
   const told=new Set(!period?[]:kept.flatMap(l=>l.narrates||[]).filter(id=>{const x=docs.get(id);return x&&quarterOf(x.outcome?.date)===period&&counted.has(id);}));
   const rest=named.filter(d=>!told.has(d.id)),restHeadline=headline.filter(d=>!told.has(d.id)),already=told.size;
   if(c.adoptedTexts<=already||named.length&&!rest.length)return null;
   return {id:'topics.story.'+(already?'exact.adoptedAlso':'exact.adopted'),values:{count:browse(cm(c.adoptedTexts-already,'texts'),'adoptedTexts'),texts:named.length?msg('exact.named',{texts:rest.map(vote)}):restHeadline.length?msg('exact.including',{texts:restHeadline.map(vote)}):null}};}});
  const closest=(w.closestAdoptedTexts||[]).filter(x=>x.margin<100).map(x=>docs.get(x.id)).filter(Boolean);if(period&&closest.length)add(closest.length===1?'exact.closestOne':'exact.closest',{texts:closest.map(vote)},4);
 }

 if(!period&&s.place){const best=Math.max(0,...payload.periodCounts.map(p=>p.debateSpeakerAppearances)),peaks=payload.periodCounts.filter(p=>best>0&&p.debateSpeakerAppearances===best);if(peaks.length)add('place.summary.peak',{quarter:peaks.map(p=>ref(monthRangeLabel(p.period,s.language),[],{period:p.period}))},4);}
 if(period&&busy.length){const procedures=new Set(busy.flatMap(d=>d.procedures||[])),press=[...new Map([...procedures].flatMap(p=>f.press?.[p]||[]).map(p=>[p.id,p])).values()];if(press.length)add('press',{title:ref(press[0].title,[{...press[0],kind:'press'}],{italic:true,titleLanguage:'en'})},6);}
 // Outside appearances are complete enumeration, independent of the four-line
 // statistical story budget. One name represents all of that person's addresses.
 const outside=(payload.outsideSpeakers||[]).filter(a=>(!period||a.date.slice(0,4)+'-Q'+Math.ceil(Number(a.date.slice(5,7))/3)===period)&&(!s.place||a.country===s.place)&&(s.place||s.zoom!=='eu'||inView(a.country))).sort(byDate);
 const outsideLines=[];
 const address=a=>{const speechId=[a.speechId,a.id,a.headerSource?.url].map(value=>String(value||'').match(/(?:^|\/speeches\/)(MTG-PL-\d{4}-\d{2}-\d{2}-OTH-[A-Z0-9-]+)(?:[?]|$)/)?.[1]).find(id=>id?.startsWith('MTG-PL-'+a.date+'-'));return {id:a.debateId,kind:'debate',title:a.name,date:a.date,...(speechId?{speechId}:{})};};
 if(!s.topic&&outside.length){
  if(s.place){for(const a of outside)outsideLines.push({id:'topics.story.place.outside',values:{place:name(a.country,true),speaker:ref(a.name,[address(a)],{claimId:a.personId}),date:new Intl.DateTimeFormat(s.language==='en'?'en-GB':s.language,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(a.date+'T12:00:00Z'))},priority:1,order:7,cost:1});}
  else if(period){const people=new Map();for(const a of outside){const key=a.personId+':'+a.country;if(!people.has(key))people.set(key,[]);people.get(key).push(a);}outsideLines.push({id:'topics.story.map.outside',values:{speakers:[...people.values()].map(as=>{const role=as.map(a=>a.roles?.[s.language.split('-')[0]]).find(r=>r?.role);return msg(role?'outside.speakerRole':'outside.speaker',{speaker:ref(as[0].name,as.map(address),{claimId:as[0].personId}),...(role?{role:ref(role.role,[],{labelLanguage:s.language.split('-')[0]})}:{place:name(as[0].country)})});})},priority:1,order:7,cost:1});}
 }
 // Combine only map facts, before the existing priority budget. The payload's series
 // already has the requested askers, zoom and quarter; evidence arrays are paged.
 if(!s.place&&!s.topic&&s.mode!=='d'){
  const bare=(n,kind,p)=>browse({...msg('count.number',{count:kind==='questions'?digits(n):num(n)}),counts:{count:n}},kind,p);
  const amount=(p,kind)=>{const row=payload.series?.[p]?.[period],n=row?.[kind];return Number.isSafeInteger(n)&&n>0?browse(cm(n,kind==='debates'?'shortDebates':kind),kind,p):null;};
  const leaders=w.mostQuestionedPlaces||[];
  const busyLine=lines.find(l=>l.placeId);
  if(busyLine){const p=busyLine.placeId,joint=leaders.length>1&&leaders.find(l=>l.id===p),rise=s.mode!=='d'&&(w.risingQuestionPlaces||[]).find(r=>r.id===p),known=joint||rise,q=amount(p,'questions')||(known?browse(cm(known.count,'questions'),'questions',p):null);
   if(s.mode!=='d'&&leaders.length===1&&leaders[0].id===p){busyLine.id='topics.story.integrated.both';if(partialQuarter(period,payload.partial)){busyLine.id+='SoFar';busyLine.values.place=name(p);}busyLine.values.questions=bare(leaders[0].count,'questions',p);const periods=payload.periods||[],index=periods.indexOf(period);let streak=1;for(let i=index-1;i>=0&&!partialQuarter(periods[i],payload.partial);i--){const old=payload.periodWinners[periods[i]]?.mostQuestionedPlaces||[];if(old.length!==1||old[0].id!==p)break;streak++;}if(!partialQuarter(period,payload.partial)&&streak>=2){busyLine.id+=streak===2?'Again':'Streak';busyLine.values.ordinal=msg(s.language==='en'&&streak<=9?'ordinal.words.'+streak:'ordinal.'+new Intl.PluralRules(s.language,{type:'ordinal'}).select(streak),{count:num(streak)});}}
   else if(q&&s.mode!=='d'){busyLine.id='topics.story.integrated.'+(joint?'busiestShared':'busiest');busyLine.values.questions=q;}
   if(rise&&busyLine.values.questions){busyLine.id+='Rise';busyLine.values.home=home(rise);busyLine.values.average=ref(rise.baselineMean<1?msg('average.lessThanOne'):msg('average.value',{average:digits(Math.round(rise.baselineMean*10)/10)}),[],{browse:{list:'questions',place:p,periods:payload.periods.slice(1,payload.periods.indexOf(period)).join(',')}});}
   const most=(w.mostDebatedPlaces||[]).find(r=>r.id===p&&r.count>=2);
   if(most){busyLine.id=busyLine.id==='topics.story.exact.busiestPlace'?'topics.story.integrated.busiestNoQuestions':busyLine.id;busyLine.id+='MostDebated';busyLine.values.debateCount=bare(most.count,'debates',p);
    // A co-leader gets its own sentence when the budget permits; otherwise name
    // it in this count claim so absorbing the maximum never implies a sole win.
    busyLine.finalize=kept=>{const named=new Set(kept.flatMap(l=>l.tells||[])),peers=(w.mostDebatedPlaces||[]).filter(r=>r.id!==p&&!named.has(r.id));return {id:busyLine.id,values:{...busyLine.values,debateCount:peers.length?msg('integrated.debateCountPeers',{count:busyLine.values.debateCount,peers:peers.map(r=>name(r.id))}):busyLine.values.debateCount}};};
   }
  }
  // A sole leader stays merged with its rise. Tied leaders share one line,
  // including each co-leader's rise and debates in its own place phrase.
  const claimed=new Set(told);
  for(const l of lines.filter(l=>l.id.startsWith('topics.story.map.lead.'))){
   const ps=l.values.places.map(p=>p.browse.place);l.tells=ps.filter(p=>!told.has(p));ps.forEach(p=>claimed.add(p));
   if(s.mode!=='d')l.order=3;
   if(leaders.length>1){
    const remaining=leaders.filter(p=>!told.has(p.id));
    if(!remaining.length){l.priority=Infinity;continue;}
    const riseOf=p=>(w.risingQuestionPlaces||[]).find(r=>r.id===p.id),kind=r=>r.baselineMean<0.5?'Rare':r.ratio>=4?'Jumped':'Rose',mean=r=>r.baselineMean<1?'<1':String(Math.round(r.baselineMean*10)/10);
    const average=(r,ids)=>ref(r.baselineMean<1?msg('average.lessThanOne'):msg('average.value',{average:digits(Math.round(r.baselineMean*10)/10)}),[],{browse:{list:'questions',...(ids.length>1?{places:[...ids].sort().join(',')}:{place:ids[0]}),periods:payload.periods.slice(1,payload.periods.indexOf(period)).join(',')}});
    // Co-leaders with the same change share one rise clause, as main's grouped rise sentence did.
    const risen=remaining.map(riseOf).filter(Boolean),group=risen.length>1&&risen.every(r=>kind(r)!=='Rare'&&kind(r)===kind(risen[0])&&mean(r)===mean(risen[0])&&!home(r))?risen:[];
    const details=(p,i)=>{const debates=amount(p.id,'debates'),rise=group.some(r=>r.id===p.id)?null:riseOf(p),values={place:name(p.id,i===0)};
     if(debates)values.debates=debates;
     if(rise){if(kind(rise)!=='Rare')values.average=average(rise,[p.id]);values.home=home(rise);}
     return debates||rise?msg('integrated.questionPlace'+(debates?'Debates':'')+(rise?kind(rise)==='Rare'?'Rare':'Rise':''),values):values.place;
    };
    const questions={...bare(leaders[0].count,'questions',remaining[0].id),browse:{list:'questions',places:remaining.map(p=>p.id).sort().join(',')}};
    l.id='topics.story.integrated.lead.'+(remaining.length>1?'tied':'shared');
    l.values=remaining.length>1?{places:remaining.map(details),questions}:{place:details(remaining[0],0),questions};
    if(group.length){l.id+=(group.length===remaining.length?'Each':'With')+kind(group[0]);l.values.average=average(group[0],group.map(r=>r.id));if(group.length<remaining.length)l.values.risers=group.map(r=>name(r.id));}
    continue;
   }
   if(ps.length===1){const d=amount(ps[0],'debates');l.id=l.id.replace('map.lead.','integrated.lead.');l.values.questions=bare(leaders[0].count,'questions',ps[0]);if(d)l.values.debates=d;else l.id+='Only';}
  }
  for(const l of lines.filter(l=>l.id==='topics.story.exact.rises')){
   const change=l.values.changes[0],p=change.values.place?.browse?.place;l.tells=p?[p]:(change.values.places||[]).map(p=>p.browse?.place).filter(Boolean);
   for(const place of change.values.places||[])if(place.browse?.place)claimed.add(place.browse.place);
   if(p){claimed.add(p);const d=amount(p,'debates');if(d&&s.mode!=='d'){change.message+='Debates';change.values.debates=d;}}
   if(s.mode!=='d')l.order=4;
  }
  for(const l of lines.filter(l=>/exact.mostDebated/.test(l.id))){
   const all=w.mostDebatedPlaces||[],remaining=all.filter(p=>!claimed.has(p.id));
   if(!remaining.length){l.priority=Infinity;continue;}
   l.order=5;l.tells=remaining.map(p=>p.id);
   const count={...bare(all[0].count,'debates',remaining[0].id),browse:{list:'debates',places:remaining.map(p=>p.id).sort().join(',')}};
   if(remaining.length>1){
    l.id='topics.story.integrated.mostDebatedTied';l.values={places:remaining.map((p,i)=>{const questions=amount(p.id,'questions');return questions?msg('integrated.placeQuestions',{place:name(p.id,i===0),questions}):name(p.id,i===0);}),count};
   }else{const p=remaining[0],questions=amount(p.id,'questions'),also=all.length>1;
    l.id='topics.story.integrated.mostDebated'+(also?'Also':'Single')+(questions?'Questions':'');
    l.values={place:name(p.id,true),...(also?{debates:amount(p.id,'debates')||browse(cm(p.count,'shortDebates'),'debates',p.id)}:{count}),...(questions?{questions}:{})};
   }
  }
  if(s.mode!=='d')for(const l of lines)if(/urgency/.test(l.id))l.order=6;
 }
 const kept=lines.filter(l=>l.priority!==Infinity).sort((a,b)=>a.priority-b.priority).slice(0,4).sort((a,b)=>a.order-b.order);
 const claimed=storyLinkClaims([...kept,...outsideLines].flatMap(l=>{if(!l.finalize)return [l];const r=l.finalize(kept.filter(x=>x!==l));return r?[{...l,...r,finalize:undefined}]:[];}).map(({finalize,narrates,placeId,tells,...l})=>l),s);
 const scope=s.place?'place:'+s.place:s.topic?'topic:'+s.topic:'map';
 const vary=v=>typeof v==='string'&&nameLanguages.has(v)&&nameLanguages.get(v)!==s.language.split('-')[0]?{text:v,records:[],labelLanguage:nameLanguages.get(v)}:v==null||typeof v!=='object'?v:Array.isArray(v)?v.map(vary):'text'in v?{...v,text:vary(v.text)}:!v.message?v:{...v,message:storyVariant(v.message,period,scope,has),values:Object.fromEntries(Object.entries(v.values).map(([k,x])=>[k,vary(x)]))};
 // On the Europe map, the first sentence names the scope; its leading words then continue a sentence.
 // On the Europe map the first sentence continues the scope phrase: only its leading word or slot changes case, never titles.
 const lead=v=>{if(v==null)return v;if(typeof v==='string')return startForms.get(v)??v;if(Array.isArray(v))return v.length?[lead(v[0]),...v.slice(1)]:v;if('text'in v)return v.italic?v:{...v,text:lead(v.text)};if(!v.message)return v;
  if(/links\.(questions|texts)About$/.test(v.message))return {...v,message:v.message+'Mid'};const slot=LEADS[v.message.replace(/^topics\.story\./,'').replace(/\.v\d+$/,'')];return slot&&Object.hasOwn(v.values,slot)?{...v,values:{...v.values,[slot]:lead(v.values[slot])}}:v;};
 return claimed.map((l,i)=>{const values=Object.fromEntries(Object.entries(l.values).map(([k,x])=>[k,vary(x)]));
  if(i===0&&s.zoom==='eu'&&!s.place&&!s.topic&&has(l.id+'.eu')){const slot=LEADS[l.id.replace(/^topics\.story\./,'')]||(/exact.mostDebated|integrated.mostDebatedTied|integrated.lead.tied/.test(l.id)?'places':null)||(/integrated\.(both|busiest|lead\.|mostDebated)/.test(l.id)?'place':null);return {...l,id:l.id+'.eu',values:slot&&Object.hasOwn(values,slot)?{...values,[slot]:lead(values[slot])}:values};}
  return {...l,id:storyVariant(l.id,period,scope,has),values};});
}
