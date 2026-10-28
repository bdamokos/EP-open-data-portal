// Offline analysis of public ODP metadata observations; inputs and reports stay outside Git.
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {array,tail} from '../server/activity-index-model.mjs';
import {distributionEvidenceFor,validAmendmentDate,canonicalEPReference} from '../server/amendments.mjs';
const DAY=86400000;
export function distribution(values) {
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  const percentile=p=>sorted.length?sorted[Math.max(0,Math.ceil(p*sorted.length)-1)]:null;
  return {count:sorted.length,min:sorted[0]??null,p50:percentile(.5),p90:percentile(.9),p95:percentile(.95),p99:percentile(.99),max:sorted.at(-1)??null};
}
export function studyFreshness(observations,{now=Date.now(),graceDays=60}={}) {
  if(!Number.isInteger(graceDays)||graceDays<1||graceDays>3650)throw Error('Grace days must be an integer between 1 and 3650.');
  const lists=new Map(),history=new Map(),corrections=[],sources=[];
  for(const observation of [...observations].sort((a,b)=>String(a.fetchedAt).localeCompare(String(b.fetchedAt)))) {
    sources.push({url:observation.url,fetchedAt:observation.fetchedAt});
    for(const target of observation.payload?.data||[]) {
      const targetId=target.identifier||tail(target.id);
      if(!/^(A|B|RC)-10-202[456]-\d+$/.test(targetId))continue;
      const decisions=array(target.inverse_decided_on_a_realization_of).concat(array(target.inverse_based_on_a_realization_of)).flatMap(ref=>{
        const match=canonicalEPReference(ref)?.match(/\/MTG-PL-(\d{4}-\d{2}-\d{2})-(?:DEC|VOT)-/);return match?[match[1]]:[];
      }).filter(validAmendmentDate).sort();
      for(const list of array(target.inverse_foresees_change_of)) {
        if(!list||typeof list!=='object'||tail(list.work_type)!=='AMENDMENT_LIST'||!array(list.foresees_change_of).some(ref=>canonicalEPReference(ref)===canonicalEPReference(target.id)))continue;
        const id=list.identifier||tail(list.id),descriptors=distributionEvidenceFor(list,null).descriptors;
        const prior=lists.get(id),date=list.document_date;
        for(const file of descriptors) {
          const key=id+'\0'+file.url+'\0'+file.language,previous=history.get(key);
          if(previous&&(file.byteSize!=null&&previous.file.byteSize!=null&&file.byteSize!==previous.file.byteSize||file.issued&&previous.file.issued&&Date.parse(file.issued)!==Date.parse(previous.file.issued)))corrections.push({id,language:file.language,url:file.url,previous:previous.file,current:file,previousObservedAt:previous.at,observedAt:observation.fetchedAt,daysAfterDocument:validAmendmentDate(date)?(Date.parse(observation.fetchedAt)-Date.parse(date))/DAY:null});
          history.set(key,{file,at:observation.fetchedAt});
        }
        lists.set(id,{id,date,descriptors,decisions:decisions.length?decisions:prior?.decisions||[]});
      }
    }
  }
  const languageLags=[],listLags=[],decisionLags=[],ages=[],missing={documentDate:0,issued:0,decisionDate:0,docxDistribution:0};
  for(const list of lists.values()) {
    if(!list.descriptors.length){missing.docxDistribution++;continue;}
    if(!validAmendmentDate(list.date)){missing.documentDate++;continue;}
    const lags=[];
    for(const file of list.descriptors) {
      if(!file.issued){missing.issued++;continue;}
      const lag=(Date.parse(file.issued)-Date.parse(list.date))/DAY;languageLags.push(lag);lags.push(lag);
      if(list.decisions.length)decisionLags.push((Date.parse(file.issued)-Date.parse(list.decisions.at(-1)))/DAY);
    }
    if(lags.length)listLags.push(Math.max(...lags));
    if(!list.decisions.length)missing.decisionDate++;
    ages.push((now-Math.max(Date.parse(list.date),...list.decisions.map(Date.parse)))/DAY);
  }
  const settled=ages.filter(age=>age>graceDays).length;
  return {observedAt:new Date(now).toISOString(),sources,listCount:lists.size,languageIssueLagDays:distribution(languageLags),latestLanguagePerListLagDays:distribution(listLags),issueAfterLatestDecisionDays:distribution(decisionLags),missing,
    corrections:{status:corrections.length?'observed':'unavailable-without-repeated-descriptor-observations',observations:corrections},
    weeklyPrimaryDownloads:{baseline:lists.size-missing.docxDistribution,avoidedNow:settled,remainingNow:lists.size-missing.docxDistribution-settled,avoidedSteadyState:ages.length,unknownDate:lists.size-missing.docxDistribution-ages.length,graceDays},
    limits:'Published issue times are current metadata, not first-observed language arrivals or a complete correction history. Decision dates require exact VOT/DEC references. Counts model one retained primary file per list; retries, missing blobs and optional author counterparts are excluded.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const directory=process.argv[2];if(!directory)throw Error('Usage: node scripts/amendment-freshness-study.mjs OBSERVATION_DIRECTORY [GRACE_DAYS]');
  const records=[];for(const name of (await readdir(directory)).filter(name=>/^\d+\.json$/.test(name))){const record=JSON.parse(await readFile(path.join(directory,name),'utf8'));if(record.url&&record.payload)records.push(record);}
  if(!records.length)throw Error('No public metadata observations found.');
  console.log(JSON.stringify(studyFreshness(records,{graceDays:Number(process.argv[3]||60)}),null,2));
}
