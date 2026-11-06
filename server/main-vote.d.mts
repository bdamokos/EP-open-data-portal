export type MainVoteDecision={id:string;subjectId?:string|null;ballotStatus?:string;outcome?:string|null;referenceTexts?:{en?:string};};
export function mainVote<T extends MainVoteDecision>(decisions:T[],subject:{id:string;wholeTextDecisions?:T[]}|null|undefined):T|null;
