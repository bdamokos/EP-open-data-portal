const msg=(id,values={},counts)=>({message:'topics.story.'+id,values,...(counts?{counts}:{})});
const plain=v=>v==null||typeof v==='string'?v:Array.isArray(v)?v.map(plain):'text'in v?plain(v.text):{...v,values:Object.fromEntries(Object.entries(v.values).map(([k,x])=>[k,plain(x)]))};
const phrase=(v,text)=>v&&typeof v==='object'&&!Array.isArray(v)&&'text'in v?{...v,text}:text;
const countValue=v=>{
 if(v==null)return null;
 if(typeof v==='object')return Number.isSafeInteger(v.rawCount)?v.rawCount:Number.isSafeInteger(v.counts?.count)?v.counts.count:countValue(v.text??v.values?.count);
 const words=['zero','one','two','three','four','five','six','seven','eight','nine'],word=words.indexOf(String(v).toLowerCase());
 const n=word>=0?word:Number(String(v).replace(/[.,\s\u00a0\u202f]/g,''));return Number.isSafeInteger(n)&&n>=0?n:null;
};
const recordKind=records=>records.some(r=>r.kind==='debate')?'debates':records.every(r=>r.kind==='question')?'questions':records.every(r=>r.kind==='document')?'documents':'records';
export function storySetKey(ref,s={}) {
 const b=ref.browse||{},kind=b.list||ref.setKind||'records';
 const core=[kind,b.places||b.place||s.place||s.topic||'map',b.periods||b.period||s.period||'term',b.askers||(s.excludeOwn?'not-home':'all'),...(kind==='records'?[ref.records.map(r=>r.kind+'~'+r.id+(r.speechId?'~'+r.speechId:'')).sort().join(',')]:[])].map(encodeURIComponent);
 if(ref.claimId)core.push('claim='+encodeURIComponent(ref.claimId));
 core.push('zoom='+(s.zoom||'world'),'mode='+(s.mode||'q'));
 if(kind==='records'){core.push('kind='+(ref.recordKind||recordKind(ref.records)));if(Number.isSafeInteger(ref.expected))core.push('n='+ref.expected);}
 if(kind==='urgency-debates'&&Number.isSafeInteger(ref.expected))core.push('n='+ref.expected);
 return core.join(':');
}
export function parseStorySetKey(key){try{
 const [list,scope,period,askers,...rest]=key.split(':').map(decodeURIComponent),ids=rest[0]&&!rest[0].includes('=')?rest.shift():undefined,options=Object.fromEntries(rest.map(v=>v.split('=')));
 if(!['questions','debates','documents','adoptedTexts','urgency-debates','records','places'].includes(list)||!scope||!period||!['all','not-home','elsewhere'].includes(askers)||options.zoom&&!['world','eu'].includes(options.zoom)||options.mode&&!['q','d'].includes(options.mode)||options.kind&&!['questions','debates','documents','records'].includes(options.kind)||options.n&&(!/^\d+$/.test(options.n)||!Number.isSafeInteger(Number(options.n))))return null;
 return {list,scope,period,askers,ids,zoom:options.zoom,mode:options.mode,kind:options.kind,expected:options.n===undefined?undefined:Number(options.n)};
}catch{return null;}}
// Linkable phrases are whole message slots, shared by exact and reference stories.
export function storyLinkClaims(lines,s={}) {
 const seen=new Set();
 function visit(v,key='',parent='') {
  if(v==null||typeof v==='string')return v;
  if(Array.isArray(v))return v.map(x=>visit(x,key,parent));
  if('text'in v){
   if(['place','places','meps','for','against','groups','resolution','resolutions','ordinal','elsewhere','leader','home'].includes(key)&&!v.pageRecords&&!(key==='elsewhere'&&v.text?.message==='topics.story.links.elsewhere')&&!(key==='places'&&(parent==='topics.story.exact.mapAdopted'&&typeof v.text==='object'||parent==='topics.story.amongPlaces')))return plain(v);
   if(key!=='title'&&!(key==='places'&&parent==='topics.story.amongPlaces')&&typeof v.text==='string'&&/^(?:[\d\s.,]+|zero|one|two|three|four|five|six|seven|eight|nine)$/i.test(v.text))return plain(v);
   if(v.text?.message==='topics.story.moreThanAny')return plain(v);
   if(key==='average'&&v.browse&&!v.browse.periods)return plain(v);
   if(v.labelLanguage&&!v.records?.length&&!v.browse&&!v.pageRecords&&!v.period)return {...v,text:plain(v.text)};
   const r={...v,text:plain(v.text)};
   if(typeof r.text==='object'&&/topics\.story\.(?:count\.|links\.(?:urgency|debatesEach|places))/.test(r.text.message)){const n=countValue(r.text);if(n!==null){r.expected=n;r.text={...r.text,counts:{...r.text.counts,count:n}};}}
   if(/urgency/.test(parent)&&['count','urgencyDebates'].includes(key))r.setKind='urgency-debates';
   if(key==='places'&&parent==='topics.story.amongPlaces')r.browse={...r.browse,list:'places'};
   // Supporting texts belong under the debate; they do not make a single debate a set.
   if(r.records?.[0]?.kind==='debate'&&key==='title')r.records=r.records.slice(0,1);
   if(!r.period&&!r.pageRecords){const id=storySetKey(r,s);if(seen.has(id))return plain(r);seen.add(id);r.setKey=id;}
   if(key==='places'&&parent==='topics.story.amongPlaces')r.text=msg('links.places',{count:plain(v.text)},{count:countValue(v.text)});
   return r;
  }
  let values={...v.values},id=v.message||v.id;
  if(/map\.urgency\.many$|exact\.urgency(?:Partial|Count)?$/.test(id)&&!values.urgencyDebates)values.count=phrase(values.count,msg('links.urgency',{count:plain(values.count)},{count:countValue(values.count)}));
  if(values.urgencyDebates)delete values.count;
  if(/exact\.mostDebated/.test(id)){
   const places=values.places||[],b=places[0]?.browse;
   values.count={...(values.count||{}),text:msg(id.endsWith('Many')?'links.debatesEach':'count.debates',{count:plain(values.count)},{count:countValue(values.count)}),...(b?{browse:{...b,places:places.map(p=>p.browse?.place).filter(Boolean).sort().join(','),place:undefined}}:{})};
  }
  if(/exact\.(questionRise|questionJumped|documentRise)|map\.rise\.(jumped|rose)|map\.texts\.rise/.test(id)){
   const ps=values.places||[values.place],source=values.place||ps[0],b=source?.browse;
   values.about=phrase(source,msg(id.includes('document')||id.includes('.texts.')?'links.textsAbout':'links.questionsAbout',{place:plain(values.places||values.place)}));
   const amount=countValue(values.number??values.count);if(amount!==null&&values.about?.records)values.about.expected=amount;
   if(b&&ps.length>1)values.about.browse={...b,places:ps.map(p=>p.browse?.place).filter(Boolean).sort().join(','),place:undefined};
   if(Object.hasOwn(values,'count'))values.count=plain(values.count);if(Object.hasOwn(values,'number'))values.number=plain(values.number);
   if(values.average?.browse&&ps.length>1)values.average={...values.average,browse:{...values.average.browse,places:ps.map(p=>p.browse?.place).filter(Boolean).sort().join(','),place:undefined}};
   if(Object.hasOwn(values,'average')){const average=values.average;values.average=phrase(average,typeof average?.text==='string'?msg('average.value',{average:average.text}):plain(average));}
  }
  if(/exact\.questionRare(?:Each)?$/.test(id)){if(values.questions)delete values.count;else values.count=phrase(values.count,msg('count.questions',{count:plain(values.count)},{count:countValue(values.count)}));}else if(/exact\.(questionRise|questionJumped|documentRise)|map\.rise\.(jumped|rose)|map\.texts\.rise/.test(id))delete values.questions;
  if(/map\.lead\.tied$/.test(id)&&values.questions?.browse){values.questions={...values.questions,browse:{...values.questions.browse,places:values.places.map(p=>p.browse?.place).filter(Boolean).sort().join(','),place:undefined}};}
  if(id==='topics.story.place.summary.questionsElsewhere')values.elsewhere=phrase(values.elsewhere,msg('links.elsewhere',{count:plain(values.elsewhere)},{count:countValue(values.elsewhere)}));
  if(id==='topics.story.origin.onlyElsewhere'||id==='topics.story.rise.someHome'){const q=values.questions;if(q?.records){values.questions=phrase(q,msg(id.endsWith('someHome')?'links.home':'links.away',{count:plain(q)},{count:countValue(q)}));}}
  if(/textWithTally$/.test(id)){values.for=plain(values.for);values.against=plain(values.against);}
  if(/outcome\./.test(id)){
   const record=values.resolution?.records?.[0];
   if(record){const tally=plain(values.tally),outcome=msg(id.endsWith('showOfHands')?'links.hands':id.endsWith('adopted')?'links.adopted':id.endsWith('rejected')?'links.rejected':'links.passed',{...(tally?{tally}:{})});values.outcome={text:outcome,records:[record]};id=id.endsWith('jointPassed')?'topics.story.links.jointOutcome':'topics.story.links.outcome';}
  }
  if(/exact\.adopted(?:Also)?$/.test(id)&&values.texts?.message?.endsWith('.named'))values.count=plain(values.count);
  return {...v,...(v.message?{message:id}:{id}),values:Object.fromEntries(Object.entries(values).map(([k,x])=>[k,visit(x,k,id)]))};
 }
 return lines.map(line=>visit(line));
}
