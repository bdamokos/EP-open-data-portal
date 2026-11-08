import {UiMessage,useUiI18n} from './UiI18nReact';
import {dossierLinkClick} from './dossierJourney';
import {voteHref,voteSentence} from './votePagePresentation.mjs';
import type {LegislationResponse} from './LegislationTypes';

// The item's outcome in the vote page's words, directly under its agenda heading.
export function AgendaOutcome({main,language}:{main:NonNullable<NonNullable<LegislationResponse['detail']>['mainVote']>;language:string}) {
  const ui=useUiI18n();
  const sentence=voteSentence({...main,scope:{kind:'unclassified',basis:'unclassified'},referenceTexts:{},context:{amendmentIds:[]},parts:[]},{mainVoteId:main.id,procedureReferral:main.procedureReferral,language},ui);
  return <p className="insight-agenda-outcome" lang={ui.language}><UiMessage id={sentence.id} values={sentence.values}/>{sentence.noNames&&<> <UiMessage id="votepage.no_names"/></>} <a href={voteHref(main.id,language)} onClick={dossierLinkClick}><UiMessage id="votepage.see_the_vote"/></a></p>;
}
