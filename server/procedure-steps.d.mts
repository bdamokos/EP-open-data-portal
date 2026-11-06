export type ProcedureStage='proposal'|'referred'|'drafting'|'reported'|'position-talks'|'position'|'deal'|'council-approved'|'signed'|'journal'|'resolution-adopted'|'unknown';
export type ProcedureStepKey='proposal'|'committee'|'parliament'|'council'|'talks'|'deal'|'final'|'signed'|'journal';
export type IndexEvent={had_activity_type?:string;activity_date?:string|null;activity_id?:string;[key:string]:unknown};
export type CellarEvent={types?:Array<{code:string;[key:string]:unknown}>;status?:string;date?:string|null;[key:string]:unknown};
export type ProcedureSummary={stage?:string;date?:string|null;documentReference?:string|null;[key:string]:unknown};
export function procedureSteps(input:{reference:string;indexEvents?:IndexEvent[];cellarEvents?:CellarEvent[];summaries?:ProcedureSummary[];asOf:string}):{
  family:string|null;
  steps:Array<{key:ProcedureStepKey;state:'done'|'current'|'open';date:string|null;partial:boolean}>;
  stage:ProcedureStage;
  latest:IndexEvent|CellarEvent|ProcedureSummary|null;
};
