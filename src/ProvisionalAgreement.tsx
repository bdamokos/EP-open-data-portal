import type {ReactNode} from 'react';
import {UiMessage} from './UiI18nReact';

export type ProvisionalAgreementResponse={
  version:number;documentId:string;amendmentId:string;listId:string;requestedLanguage:string;
  status:'verified'|'unavailable';
  agreement:null|{listId:string;language:string;url:string};
  adoptedText:null|{id:string;url:string};
  text:null|{documentId:string;kind:'adopted-text'|'agreement'};
  finalAct:null|{label:string;url:string};
  proposal:null|{reference:string;year:string;number:string;url:string|null};
};

const external=(value:string|null|undefined,hosts:string[])=>{try{const url=new URL(value||'');return url.protocol==='https:'&&!url.username&&!url.password&&hosts.includes(url.hostname)?url.href:null;}catch{return null;}};
const link=(href:string|null,label:ReactNode)=>href?<a href={href} target="_blank" rel="noreferrer">{label}</a>:null;

// The agreement's links and the legend for Parliament's own marks. Each link
// appears only when the server bound it by an exact identifier.
export function ProvisionalAgreementLinks({data}:{data:ProvisionalAgreementResponse}) {
  const agreement=external(data.agreement?.url,['data.europarl.europa.eu']),adopted=external(data.adoptedText?.url,['www.europarl.europa.eu']);
  const act=external(data.finalAct?.url,['eur-lex.europa.eu']),proposal=external(data.proposal?.url,['eur-lex.europa.eu']);
  return <div className="provisional-agreement">
    <p className="document-context-notice" role="status"><UiMessage id="amendment.replaces_whole_text"/></p>
    <ul className="provisional-links">
      {agreement&&<li>{link(agreement,<UiMessage id="amendment.agreement_text"/>)}</li>}
      {adopted&&<li>{link(adopted,<UiMessage id="batch6.documentcontextreader.adopted.text.40"/>)}</li>}
      {data.proposal&&<li>{proposal?link(proposal,<UiMessage id="batch6.references.commission.proposal.25"/>):<UiMessage id="proposalcontexttext.commission.proposal.com.year.number" values={{year:data.proposal.year,number:data.proposal.number}}/>}</li>}
      {act&&data.finalAct&&<li><UiMessage id="amendment.final_act" values={{act:link(act,data.finalAct.label)}}/></li>}
    </ul>
    <p className="document-context-notice"><UiMessage id="amendment.provisional_marks"/> <UiMessage id="amendment.provisional_unmarked"/></p>
  </div>;
}
