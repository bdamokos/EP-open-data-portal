import {useData} from './data';
import {selectVoteTitle} from './voteTitles.mjs';
import {displayVoteTitle} from './memberVotesPresentation.mjs';
import type {MemberVote,MemberVoteSubject} from './MemberVotesTypes';

type RecordResponse={sourceUrl:string;payload:{data:{id:string;identifier:string;work_type:string;title_dcterms?:Record<string,string>}[]}};

export function VoteSubjectTitle({subject,vote,language}:{subject:MemberVoteSubject;vote:MemberVote;language:string}) {
  const original=selectVoteTitle(subject.titles,language,subject.title||'',subject.titleLanguage||'en');
  const documentId=subject.documentIds.length===1&&/^A-10-\d{4}-\d{4,6}$/.test(subject.documentIds[0])?subject.documentIds[0]:null;
  const linked=documentId&&vote.context.relationships.some(edge=>edge.from===subject.uri&&edge.field==='based_on_a_realization_of'&&edge.to==='https://data.europarl.europa.eu/eli/dl/doc/'+documentId);
  const url=linked&&original.language!==language?'https://data.europarl.europa.eu/api/v2/plenary-documents/'+documentId:null;
  const request=useData<RecordResponse>(url?'source-record?'+new URLSearchParams({url,lang:language}):null);
  const records=request.data?.sourceUrl===url&&Array.isArray(request.data?.payload?.data)?request.data.payload.data:[];
  const record=records.length===1?records[0]:null;
  const exact=record&&typeof record.id==='string'&&record.id.replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'')==='eli/dl/doc/'+documentId&&record.identifier===documentId&&typeof record.work_type==='string'&&record.work_type.split('/').at(-1)==='REPORT_PLENARY';
  const title=exact&&typeof record.title_dcterms?.[language]==='string'&&record.title_dcterms[language].trim()?selectVoteTitle({[language]:record.title_dcterms[language]},language):original;
  return <p className="member-votes-detail-subject" lang={title.language} title={title.sourceLiteral}>{displayVoteTitle(title.text)||'Subject title unavailable'}</p>;
}
