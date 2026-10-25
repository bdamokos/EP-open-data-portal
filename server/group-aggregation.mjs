// Dated contributions never inherit the current-roster display fallback.
export function contributionGroup(id,date,groupOn) {
  const value=groupOn(id,date);
  return typeof value==='object'&&value?value.code:null;
}
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const median=values=>{const a=values.toSorted((a,b)=>a-b),n=a.length;return n?(a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2:null;};
export function groupContributions(observations,groupOn) {
  const rows=new Map();let unavailable=0;
  for(const observation of observations) {
    const group=contributionGroup(observation.id,observation.date,groupOn);
    if(!group){unavailable++;continue;}
    const row=rows.get(group)||{label:group,count:0};row.count++;rows.set(group,row);
  }
  return {rows:[...rows.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label)),total:observations.length,unavailable,dateBasis:'Contribution date; question authors and answers use question document_date'};
}
// Each author-question pair is a contribution. Answer dates measure elapsed
// time only; they can never select a political group.
export function questionGroupMetrics(questions,groupOn,includeAuthor=()=>true) {
  const buckets=new Map(),observations=[];
  for(const question of questions)for(const author of question.authors.filter(author=>includeAuthor(author,question))) {
    observations.push({id:author.id,date:question.date});
    const group=contributionGroup(author.id,question.date,groupOn);if(!group)continue;
    const row=buckets.get(group)||{answered:0,unanswered:0,answerStatusUnavailable:0,answerDays:[]};
    if(question.answers.length) {
      row.answered++;
      const first=question.answers.map(a=>a.date).filter(date=>validDate(date)&&date>=question.date).sort()[0];
      if(first)row.answerDays.push((Date.parse(first)-Date.parse(question.date))/86400000);
    }else if(question.answersObserved)row.unanswered++;
    else row.answerStatusUnavailable++;
    buckets.set(group,row);
  }
  const result=groupContributions(observations,groupOn);
  return {...result,rows:result.rows.map(row=>{const metrics=buckets.get(row.label),known=metrics.answered+metrics.unanswered;return {...row,answered:metrics.answered,unanswered:metrics.unanswered,answerStatusUnavailable:metrics.answerStatusUnavailable,answeredShare:known?metrics.answered/known:null,answerTimeObservations:metrics.answerDays.length,medianAnswerDays:median(metrics.answerDays),meanAnswerDays:metrics.answerDays.length?metrics.answerDays.reduce((n,x)=>n+x,0)/metrics.answerDays.length:null};})};
}
export function activityAffiliation(row,question,groupOn,currentGroup) {
  const date=row.recordKind==='answer'?question?.document_date||null:row.date||null;
  const value=groupOn(row.mepId,date);
  return {affiliationDate:date,contributionGroup:typeof value==='object'&&value?value.code:null,affiliationGroup:typeof value==='object'&&value?value.code:value==='not-serving'?null:currentGroup??null};
}
