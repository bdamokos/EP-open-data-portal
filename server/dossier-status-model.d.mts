import type {CellarEvent,IndexEvent,ProcedureStage,ProcedureSummary,procedureSteps} from './procedure-steps.mjs';

export type DossierTally={for:number;against:number;abstaining:number};
export type DossierMainVote={id:string;date:string|null;outcome:string|null;method:string|null;ballotStatus:string|null;totals:{for:number|null;against:number|null;abstaining:number|null}|null};
export type DossierCommittee={code:string;name:string;language:string|null};
export type DossierVotingList={blockVotes:number;blockAmendments:number;individual:number;identical:number};
export type DossierStatusSlots={committees?:DossierCommittee[];mainVote?:DossierMainVote|null;plenaryDate?:string|null;votingList?:DossierVotingList|null};
export type DossierStatusResponse={version:number;reference:string;family:string|null;steps:ReturnType<typeof procedureSteps>['steps'];stage:ProcedureStage;indexEvents:IndexEvent[];slots:DossierStatusSlots};
export type DossierStatusLine={id:string;values?:{date?:string|null;tally?:DossierTally|null;committees?:DossierCommittee[];label?:string;labelLanguage?:string|null}};
export function votingListLineId(counts:DossierVotingList|null|undefined):string|null;
export function resolutionStage(vote:DossierMainVote|null|undefined):ProcedureStage;
export function mergeDossierStatus(status:{reference:string;indexEvents?:IndexEvent[];stage?:ProcedureStage},input:{cellarEvents?:CellarEvent[];summaries?:ProcedureSummary[];asOf:string}):ReturnType<typeof procedureSteps>;
export function dossierStatusLines(input:{stage:ProcedureStage;steps?:ReturnType<typeof procedureSteps>['steps'];councilApproval?:{date:string}|null;latest?:unknown;indexEvents?:IndexEvent[];slots?:DossierStatusSlots;cellarEvents?:CellarEvent[]}):{sentence:DossierStatusLine|null;next:DossierStatusLine|null};
