import {lazy,Suspense,useEffect,useRef,useState,type ReactNode} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {useData} from './data';
import {dossierLinkClick} from './dossierJourney';
import {selectLanguageText} from './language.mjs';
import {exactAmendmentTargets,splitVoteRequests} from './memberVotesPresentation.mjs';
import {voteAmendmentWording,voteHref,voteNumbers,voteProvision,voteReferenceLabel} from './votePagePresentation.mjs';
import {publicUrl} from './publicUrl';
import {readHref} from './readRoute.mjs';
import {partsInLanguage,splitRuns} from './splitRuns.mjs';
import {SplitKey,SplitText,type SplitKeyRow} from './SplitText';
import type {PassageLabel,PassageRow,PassageRows} from './proposalPassage.mjs';
import type {DecisionVoteSibling,DecisionVotesResponse} from './DecisionVotesTypes';

const DossierVoteText=lazy(()=>import('./DossierVoteText'));
type WordingResponse={documentId:string;requestedLanguage:string;amendment:null|{id:string;variants:unknown[]}};
type PassageResponse={documentId:string;requestedLanguage:string;baseline:{kind:string;language:string}|null;placement:{operation:string|null;status:string}|null;passage:PassageRows|null};
type Vote=NonNullable<DecisionVotesResponse['decision']>;
type Context={vote:Vote;siblings:DecisionVoteSibling[];language:string;member?:string|null};
type Target={documentId:string;amendmentId:string};
type ProvisionResponse={documentId:string;requestedLanguage:string;provision:string;text:string|null;language:string|null};

function useWording({documentId,amendmentId}:Target,language:string) {
  const query=new URLSearchParams({amendment:amendmentId,lang:language,body:'0'});
  const response=useData<WordingResponse>('document-context/'+encodeURIComponent(documentId)+'?'+query,{unavailable:'error.wording'});
  const data=response.data?.documentId===documentId&&response.data.requestedLanguage===language&&response.data.amendment?.id===amendmentId?response.data:null;
  return {data,loading:response.loading};
}
/** The request a part vote belongs to, with each part's own vote among the item's votes. */
function requestRows({vote,siblings}:Context) {
  return splitVoteRequests(vote.parts.map(({componentId,number,requestUri,contentByLanguage,contextComponents})=>({componentId,number,requestUri,contentByLanguage,contextComponents}))).map(request=>{
    const requestId=vote.parts.find(part=>part.requestUri===request.requestUri)?.requestId;
    return request.parts.map(part=>({...part,decision:siblings.find(row=>row.parts.some(entry=>entry.requestId===requestId&&String(entry.number)===String(part.number)))??null}));
  });
}
function partRows(context:Context) {
  const requests=requestRows(context);
  return requests.length===1?requests[0]:[];
}
function PartsKey({context,rows,match,wordingLanguage}:{context:Context;rows:ReturnType<typeof partRows>;match:ReturnType<typeof splitRuns>;wordingLanguage:string|null}) {
  const held=wordingLanguage?partsInLanguage(rows,wordingLanguage):null;
  const parts=rows.map((part,index):SplitKeyRow=>{
    const chosen=held&&wordingLanguage?{text:held[index].description,language:wordingLanguage}:selectLanguageText(Object.fromEntries(Object.entries(part.contentByLanguage).map(([code,value])=>[code,value.text??value.sourceLiteral])),context.language);
    return {number:part.number,description:chosen.text??null,language:chosen.language??'',result:part.decision,href:part.decision?voteHref(part.decision.id,context.language,context.member):null,current:part.current};
  });
  return <SplitKey parts={parts} match={match}/>;
}
// The amendment's wording, with the parts marked when it was voted in parts. Published versions that
// differ keep the version chooser; the key always shows the parts and their results.
function Wording({context,target}:{context:Context;target:Target}) {
  const ui=useUiI18n(),{vote,language}=context;
  const {data,loading}=useWording(target,language);
  const rows=partRows(context),{n}=voteNumbers(vote);
  const status=<p role="status"><UiMessage id="dossieractivity.loading_text"/></p>;
  const keyOnly=rows.length?<section className="clause"><h3><UiMessage id="votepage.centre.amendment" values={{n:n??''}}/></h3><PartsKey context={context} rows={rows} match={null} wordingLanguage={null}/></section>:null;
  if(!data)return loading?status:keyOnly;
  const wording=voteAmendmentWording(data.amendment!.variants,vote,ui);
  if(wording.state!=='text')return wording.state==='versions'?<><Suspense fallback={status}><DossierVoteText vote={vote} language={language} showParts={false}/></Suspense>{rows.length>0&&<PartsKey context={context} rows={rows} match={null} wordingLanguage={null}/>}</>:keyOnly;
  const descriptions=partsInLanguage(rows,wording.language),match=descriptions?splitRuns(wording.text,descriptions):null;
  const current=rows.filter(part=>part.current).map(part=>String(part.number));
  return <section className="clause">
    <h3>{wording.heading}</h3>
    {match?<SplitText runs={match.runs} language={wording.language} emphasis="part" current={current}/>:<p className="clause-text plain" lang={wording.language}>{wording.text}</p>}
    {rows.length>0&&<PartsKey context={context} rows={rows} match={match} wordingLanguage={wording.language}/>}
  </section>;
}
// A provision of the report or motion, read by its exact number. Its parts are marked when the words
// are found exactly; without wording the key alone says which part this vote is.
function ProvisionText({context,target,heading}:{context:Context;target:{documentId:string;provision:string};heading:string|null}) {
  const {language}=context,requests=requestRows(context),rows=requests.length===1?requests[0]:[];
  const query=new URLSearchParams({provision:target.provision,lang:language});
  const response=useData<ProvisionResponse>('document-context/'+encodeURIComponent(target.documentId)+'?'+query,{unavailable:'error.wording'});
  const reply=response.data?.documentId===target.documentId&&response.data.provision===target.provision&&response.data.requestedLanguage===language?response.data:null;
  const text=reply?.text??null,textLanguage=reply?.language??'';
  if(!text&&!requests.length)return null;
  const descriptions=text?partsInLanguage(rows,textLanguage):null,match=text&&descriptions?splitRuns(text,descriptions):null;
  const current=rows.filter(part=>part.current).map(part=>String(part.number));
  return <section className="clause">
    {heading&&<h3 lang="">{heading}</h3>}
    {text&&(match?<SplitText runs={match.runs} language={textLanguage} emphasis="part" current={current}/>:<p className="clause-text plain" lang={textLanguage}>{text}</p>)}
    {requests.map((request,index)=><PartsKey key={index} context={context} rows={request} match={match} wordingLanguage={match?textLanguage:null}/>)}
  </section>;
}
/** What the vote is on: an amendment's wording, a provision's wording, or the parts alone. */
export function VoteText({vote,siblings,language,member=null,amendmentPage}:Context&{amendmentPage:boolean}) {
  const context={vote,siblings,language,member},targets=exactAmendmentTargets(vote);
  if(amendmentPage&&targets.length===1)return <Wording context={context} target={targets[0]}/>;
  const provision=voteProvision(vote),heading=voteReferenceLabel(vote,language);
  if(provision)return <ProvisionText key={provision.documentId+provision.provision} context={context} target={provision} heading={heading}/>;
  return <>{requestRows(context).map((rows,index)=><section className="clause" key={index}>{heading&&<h3 lang="">{heading}</h3>}<PartsKey context={context} rows={rows} match={null} wordingLanguage={null}/></section>)}</>;
}

// A deep provision's label would break mid-word in the usual gutter.
const longLabel=24;
const placeMessages:Record<string,string>={recital:'votepage.place.recital',article:'votepage.place.article',paragraph:'votepage.place.paragraph'};
function placeLabel(label:PassageLabel|null,ui:ReturnType<typeof useUiI18n>) {
  const known=label?.kind?placeMessages[label.kind]:null;
  return known&&label?.value?ui.t(known,{n:label.value}):label?.prefix??'';
}
// A neighbour keeps to two quiet lines until tapped.
function NearRow({row,language}:{row:PassageRow;language:string}) {
  const ui=useUiI18n(),[open,setOpen]=useState(false);
  return <div className={open?'verse near open':'verse near'}><span className="gut">{placeLabel(row.label,ui)}</span><p lang={language}><button type="button" className="near-text" aria-expanded={open} onClick={()=>setOpen(!open)}>{row.text}</button></p></div>;
}
function Verse({label,kind,language,children}:{label:ReactNode;kind:'old'|'new';language:string;children:ReactNode}) {
  return <div className={'verse '+kind}><span className="gut">{label}</span><p lang={language}>{children}</p></div>;
}
function Place({context,target}:{context:Context;target:Target}) {
  const ui=useUiI18n(),{vote,siblings,language}=context,{n}=voteNumbers(vote);
  const query=new URLSearchParams({amendment:target.amendmentId,lang:language,body:'passage'});
  const response=useData<PassageResponse>('document-context/'+encodeURIComponent(target.documentId)+'?'+query,{unavailable:'error.wording'});
  const {data}=useWording(target,language);
  const reply=response.data?.documentId===target.documentId&&response.data.requestedLanguage===language?response.data:null;
  const passage=reply?.placement?.status==='placed'?reply.passage:null;
  if(!passage||!data)return null;
  const wording=voteAmendmentWording(data.amendment!.variants,vote,ui);
  const operation=reply!.placement!.operation;
  if(wording.state==='versions'||!wording.provision||!wording.sourceLabel||(wording.state!=='text'&&operation!=='delete'))return null;
  const textLanguage=reply!.baseline?.language||(wording.state==='text'?wording.language:'');
  const adopted=vote.outcome==='ADOPTED'||siblings.some(row=>row.outcome==='ADOPTED'&&row.context.amendmentIds.includes(target.amendmentId));
  const source=<span lang={wording.labelLanguage??''}>{wording.sourceLabel}</span>;
  return <>
    <h2 className="section" id="place"><UiMessage id="votepage.place.heading" values={{provision:<span lang={wording.labelLanguage??''}>{wording.provision}</span>}}/></h2>
    <section className={wording.sourceLabel.length>longLabel?'verses long':'verses'}>
      {passage.before&&<NearRow row={passage.before} language={textLanguage}/>}
      {operation!=='insert'&&passage.original&&<Verse kind="old" language={textLanguage} label={<UiMessage id={reply!.baseline?.kind==='commission-proposal'?'votepage.place.commission':'votepage.place.original'} values={{provision:source}}/>}>{adopted?<del>{passage.original.text}</del>:passage.original.text}</Verse>}
      {operation!=='delete'&&wording.state==='text'&&<Verse kind="new" language={wording.language} label={<UiMessage id="votepage.place.amendment" values={{provision:source,n:n??''}}/>}>{wording.text}</Verse>}
      {passage.after&&<NearRow row={passage.after} language={textLanguage}/>}
    </section>
    <p className="place-more"><a className="c" href={publicUrl(readHref({documentId:target.documentId,amendmentId:target.amendmentId,language}))} onClick={dossierLinkClick}><UiMessage id="votepage.place.read_full"/></a></p>
  </>;
}
// The amendment in the text around it. Whole-text operations, unresolved placement and failed reads
// show nothing. The proposal behind it is read only when the reader comes near.
export function InItsPlace({vote,siblings,language}:Context) {
  const targets=exactAmendmentTargets(vote),near=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(typeof IntersectionObserver==='undefined');
  useEffect(()=>{
    if(visible||!near.current)return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'160px'});
    observer.observe(near.current);
    return ()=>observer.disconnect();
  },[visible]);
  if(targets.length!==1)return null;
  return <div ref={near} className="place">{visible&&<Place context={{vote,siblings,language}} target={targets[0]}/>}</div>;
}
