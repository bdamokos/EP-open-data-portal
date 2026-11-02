import {UiMessage,useUiI18n} from './UiI18nReact';
import './QuestionAnswerer.css';
import type {QuestionAnswerer as Answerer} from './explorerTypes';

const institutions:Record<string,string>={'org/EU_COMMISSION':'questionanswerer.institution.commission','org/EU_COUNCIL':'questionanswerer.institution.council'};

export function QuestionAnswerer({answerer}:{answerer?:Answerer|null}) {
  const ui=useUiI18n();
  if(!answerer)return null;
  const {signatory,institution}=answerer;
  const known=institution&&institutions[institution];
  const body=known ? <span lang={ui.language}>{ui.t(known)}</span> : (signatory ? <span lang="en">{signatory.onBehalfOf}</span> : null);
  if(signatory)return <p className="question-answerer" lang={ui.language}><UiMessage id="questionanswerer.signatory" values={{person:<span lang="en">{signatory.statement}</span>,institution:body}}/></p>;
  return body ? <p className="question-answerer" lang={ui.language}><UiMessage id="questionanswerer.institution" values={{institution:body}}/></p> : null;
}
