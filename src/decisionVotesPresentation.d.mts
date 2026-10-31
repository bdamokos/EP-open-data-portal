import type {Amendment,AmendmentDecision} from './AmendmentTypes';
import type {DecisionVotesResponse} from './DecisionVotesTypes';
export function decisionVotesRoute(id:string,language:string):string|null;
export function validateDecisionVotes(data:unknown,id:string):data is DecisionVotesResponse;
export function amendmentVoteBinding(item:Amendment,indexed:AmendmentDecision,data:DecisionVotesResponse):boolean;
export function authorVotePosition(id:string|number|null,data:DecisionVotesResponse, ui?: import('./uiI18n.mjs').UiFormatter):string;
