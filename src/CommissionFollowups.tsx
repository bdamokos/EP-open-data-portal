import {useData} from './data';
import {TextLanguageFallback} from './TextLanguagePicker';
import {languagePreference} from '../server/language-order.mjs';

type FollowupFile={expressionId:string;manifestationId:string;language:string;languageUri:string;format:'PDF'|'HTML'|'DOCX';url:string;issued:string|null;byteSize:number|null};
type Followup={id:string;documentDate:string|null;files:FollowupFile[]};
type FollowupResponse={documentId:string;requestedLanguage:string;status:'available'|'partial'|'unavailable'|'none-listed';items:Followup[];gaps:{id:string|null;reason:string}[]};
const languageName=(code:string,locale:string)=>{try{return new Intl.DisplayNames([locale],{type:'language'}).of(code)||code.toUpperCase();}catch{return code.toUpperCase();}};
const formatName=(format:string)=>format==='DOCX'?'Word document':format;
const dateLabel=(date:string,locale:string)=>{
  try{return new Intl.DateTimeFormat(locale==='en'?'en-GB':locale,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date));}catch{return null;}
};
const preferredFiles=(files:FollowupFile[],language:string)=>languagePreference([...new Set(files.map(file=>file.language))],language).flatMap(code=>{
  const candidates=files.filter(file=>file.language===code).sort((a,b)=>['PDF','HTML','DOCX'].indexOf(a.format)-['PDF','HTML','DOCX'].indexOf(b.format)||a.url.localeCompare(b.url));
  return candidates.slice(0,1);
});
function FileLink({file,locale}:{file:FollowupFile;locale:string}) {
  const name=languageName(file.language,locale),format=formatName(file.format);
  return <a href={file.url} target="_blank" rel="noreferrer" hrefLang={file.language} aria-label={`Commission follow-up, ${name}, ${format}`}><span lang={locale}>{name}</span> · {format} ↗</a>;
}
export function CommissionFollowups({id,language,interfaceLanguage}:{id:string;language:string;interfaceLanguage:string}) {
  const state=useData<FollowupResponse>('commission-followups/'+encodeURIComponent(id)+'?'+new URLSearchParams({lang:language}));
  const data=state.data?.documentId===id&&state.data.requestedLanguage===language?state.data:null;
  const retryable=Boolean(data?.gaps?.some(gap=>gap.reason==='lookup-failed'||gap.reason==='time-budget'));
  const recordGap=Boolean(data?.gaps?.some(gap=>!gap.reason.startsWith('file-')));
  if(state.loading&&!data)return null;
  const items=data?.items||[];
  const failed=Boolean(state.error)||(!items.length&&retryable);
  const status=failed?'Commission follow-up could not be checked.':items.length&&recordGap?'Some follow-up documents could not be checked.':null;
  if(!items.length&&!status)return null;
  return <div className="commission-followups" lang="en">
    {items.map(item=>{
      const [primary,...others]=preferredFiles(item.files,language);
      const formattedDate=item.documentDate?dateLabel(item.documentDate,interfaceLanguage):null;
      return <div className="commission-followup" key={item.id}>
        <p>Commission follow-up{formattedDate&&<> · <time dateTime={item.documentDate!} lang={interfaceLanguage}>{formattedDate}</time></>}{' · '}
          {primary?<><FileLink file={primary} locale={interfaceLanguage}/>{' '}<TextLanguageFallback requested={language} actual={primary.language} interfaceLanguage={interfaceLanguage}/></>:<>File unavailable here.</>}
        </p>
        {others.length>0&&<details><summary>Other languages</summary><ul>{others.map(file=><li key={file.language}><FileLink file={file} locale={interfaceLanguage}/></li>)}</ul></details>}
      </div>;
    })}
    {status&&<p role="status">{status}{(failed||retryable)&&<> <button type="button" onClick={state.retry}>Try again</button></>}</p>}
  </div>;
}
