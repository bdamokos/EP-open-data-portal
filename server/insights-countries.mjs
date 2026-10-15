// Current country of representation, from saved official roster metadata.
export const EU_COUNTRIES=Object.freeze('AT BE BG HR CY CZ DK EE FI FR DE EL HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '));
export const countryCode=value=>value==='GR'?'EL':EU_COUNTRIES.includes(value)?value:null;
export function memberCountry(id,members,metadata=new Map()){return countryCode(metadata.get(String(id))?.['api:country-of-representation']||members.get(String(id))?.countryCode);}
const factorial=[0];
function logChoose(n,k){if(k<0||k>n)return -Infinity;while(factorial.length<=n){const i=factorial.length;factorial.push(factorial[i-1]+Math.log(i));}return factorial[n]-factorial[k]-factorial[n-k];}
// One-sided exact Fisher test: country-authored questions versus questions without
// an author from that country. Co-authored questions are never independent rows.
export function enrichmentProbability(total,feature,country,matching){
  const min=Math.max(0,country-(total-feature)),max=Math.min(feature,country);
  if(matching<=min)return 1;
  let sum=0;for(let k=matching;k<=max;k++)sum+=Math.exp(logChoose(feature,k)+logChoose(total-feature,country-k)-logChoose(total,country));
  return Math.min(1,sum);
}
export function adjustProbabilities(entries){
  const sorted=[...entries].sort((a,b)=>a.p-b.p);let next=1;
  for(let i=sorted.length-1;i>=0;i--){next=Math.min(next,sorted[i].p*sorted.length/(i+1));sorted[i].adjustedP=next;}
  return entries;
}
export function countryQuestions(analysis,members,metadata){
  const delegationSizes=new Map(EU_COUNTRIES.map(code=>[code,0]));for(const id of members.keys()){const code=memberCountry(id,members,metadata);if(code)delegationSizes.set(code,delegationSizes.get(code)+1);}
  const questions=analysis.questions.map(q=>({...q,countries:[...new Set(q.authors.filter(a=>members.has(a.id)).map(a=>memberCountry(a.id,members,metadata)).filter(Boolean))]}));
  const authorship=new Map(questions.map(q=>{const byCountry=new Map();for(const author of q.authors){if(!members.has(author.id))continue;const code=memberCountry(author.id,members,metadata);if(!code)continue;const ids=byCountry.get(code)||new Set();ids.add(author.id);byCountry.set(code,ids);}return [q.id,byCountry];}));
  const vocabulary=new Map(),countryVocabulary=new Map(EU_COUNTRIES.map(code=>[code,new Map()]));
  for(const q of questions)for(const word of q.tokens){vocabulary.set(word,(vocabulary.get(word)||0)+1);for(const code of q.countries){const words=countryVocabulary.get(code);words.set(word,(words.get(word)||0)+1);}}
  const chosen=new Set(analysis.words.map(w=>w.word));
  // Country-specific vocabulary must survive even when absent from the global top60.
  for(const words of countryVocabulary.values())for(const [word] of [...words].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,40))chosen.add(word);
  const wordCandidates=[...chosen].map(word=>({word,label:analysis.termLabels?.[word]||null,questionCount:vocabulary.get(word)||0})).sort((a,b)=>b.questionCount-a.questionCount||a.word.localeCompare(b.word));
  const candidates=new Map([...wordCandidates.map(w=>['word:'+w.word,{id:'word:'+w.word,label:w.label||w.word,kind:'word',globalCount:0,countries:new Map()}]),...analysis.clusters.map(c=>['cluster:'+c.id,{id:'cluster:'+c.id,label:c.label,kind:'cluster',globalCount:c.questionCount,countries:new Map()}])]);
  // Statistical global counts are restricted to known-country English titles below.
  for(const feature of candidates.values())feature.globalCount=0;
  const totals=new Map(EU_COUNTRIES.map(code=>[code,{code,questions:0,titledQuestions:0,authors:new Set(),features:[]}])) ,unknown=questions.filter(q=>!q.countries.length).length;
  for(const q of questions){
    for(const code of q.countries){const c=totals.get(code);c.questions++;for(const id of authorship.get(q.id).get(code)||[])c.authors.add(id);}
    if(!q.titles.en||!q.countries.length)continue;
    for(const code of q.countries)totals.get(code).titledQuestions++;
    for(const key of [...q.tokens.map(t=>'word:'+t),...(q.clusterId?['cluster:'+q.clusterId]:[])]){
      const feature=candidates.get(key);if(!feature)continue;feature.globalCount++;
      for(const code of q.countries){let bucket=feature.countries.get(code);if(!bucket){bucket={count:0,authors:new Set()};feature.countries.set(code,bucket);}bucket.count++;for(const id of authorship.get(q.id).get(code)||[])bucket.authors.add(id);}
    }
  }
  const testedQuestions=questions.filter(q=>q.titles.en&&q.countries.length).length;
  const tests=[];
  for(const feature of candidates.values())for(const country of totals.values()){
    const bucket=feature.countries.get(country.code),count=bucket?.count||0,otherTotal=testedQuestions-country.titledQuestions,otherCount=feature.globalCount-count;
    const share=country.titledQuestions?count/country.titledQuestions:null,otherShare=otherTotal?otherCount/otherTotal:null;
    const row={id:feature.id,label:feature.label,kind:feature.kind,count,authors:bucket?.authors.size||0,share:share===null?null:share*100,otherShare:otherShare===null?null:otherShare*100,lift:otherShare>0&&share!==null?share/otherShare:null,p:count>=5&&(bucket?.authors.size||0)>=3&&otherTotal>=10&&share>otherShare?enrichmentProbability(testedQuestions,feature.globalCount,country.titledQuestions,count):1};
    tests.push(row);if(count)country.features.push(row);
  }
  adjustProbabilities(tests);
  return {questions,wordCandidates,countries:[...totals.values()].map(c=>({code:c.code,questionCount:c.questions,titledQuestionCount:c.titledQuestions,authorCount:c.authors.size,delegationSize:delegationSizes.get(c.code),features:c.features.map(({p,...f})=>({...f,highlighted:f.adjustedP<=.05})).sort((a,b)=>Number(b.highlighted)-Number(a.highlighted)||(b.lift||0)-(a.lift||0)||b.count-a.count)})),unknownCountryQuestions:unknown,
    method:'One question per country with at least one author representing it. Statistical comparisons use only English-titled questions with known current-country authors. Current saved roster. Highlights require 5 questions, 3 authors and a one-sided exact Fisher test with Benjamini–Hochberg adjustment across all displayed words, topics and countries (5% false-discovery threshold). Associations describe title vocabulary, not national preferences.'};
}
