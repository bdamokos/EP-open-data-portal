import {validDay} from '../server/source-availability.mjs';

const dates=(start,end)=>validDay(start)||validDay(end)?{start:validDay(start)?start:null,end:validDay(end)?end:null}:null;
// A metadata retry and a transcript retry for one identity are one missing record.
export function coverageNotices(evidence,{start,end,onlyRelevant=false,sourceIds}={}) {
  const sources=(Array.isArray(evidence)?evidence:[evidence]).filter(Boolean),records=new Map(),ranges=new Map();
  for(const source of sources) {
    const checked=source.checkedIntervals||[];
    const from=start||checked.map(range=>range.start).filter(validDay).sort()[0];
    const to=end||checked.map(range=>range.end).filter(validDay).sort().at(-1);
    for(const gap of source.gaps||[]) {
      const range=dates(gap.start,gap.end);
      const key=gap.sourceId||'',id=key.split('/').at(-1);
      const exact=sourceIds?.some(value=>value===key||value===id);
      if(sourceIds&&!exact)continue;
      if(!exact&&onlyRelevant&&!range)continue;
      if(!exact&&range&&(from&&range.end&&range.end<from||to&&range.start&&range.start>to))continue;
      if(gap.reason==='gap-list-limit'&&gap.minimumCount){ranges.set('overflow:'+source.family,{kind:'gap-overflow',count:gap.minimumCount,family:source.family});continue;}
      const speech=key.match(/(?:^|[:/])(MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+)$/)?.[1];
      const question=key.match(/^\/parliamentary-questions\/([EOP]-\d+-\d{4}-\d+(?:-ASW)?)$/)?.[1];
      const document=key.match(/^\/(?:documents|plenary-documents|adopted-texts)\/((?:A|B|RC|TA)-\d+-\d{4}-\d+)$/)?.[1];
      if(speech)records.set(speech,{kind:'speech',id:speech,date:validDay(speech.slice(7,17))?speech.slice(7,17):null});
      else if(question||document)records.set(question||document,{kind:question?'question':'document',id:question||document,sourceUrl:'https://data.europarl.europa.eu/api/v2'+key,...(typeof gap.retained==='boolean'?{retained:gap.retained}:{})});
      else if(range) {
        const kind=key.includes('outside:roster:')?'speaker-list':source.family==='questions'?'question-list':source.family==='speeches'?'speech-list':source.family==='procedures'?'dossier-list':'records';
        ranges.set([kind,range.start,range.end,gap.reason].join('|'),{kind,...range});
      }
    }
  }
  const speech=[...records.values()].filter(row=>row.kind==='speech'),other=[...records.values()].filter(row=>row.kind!=='speech');
  return [...(speech.length?[{kind:'speech-records',count:speech.length,dates:[...new Set(speech.map(row=>row.date).filter(Boolean))].sort()}]:[]),...other,...ranges.values()];
}
