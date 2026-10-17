import type {OutsideDay} from './pocOutsideTimeline.mjs';
export type OutsideSource={url:string;fetchedAt:string};
export type OutsideHeader={personId:string;name:string|null;role:string|null;languageTag:string|null;original:boolean;capacity:string|null};
export type OutsideContribution={id:string;personId:string;date:string;term:number;start:string|null;end:string|null;titles:Record<string,string>;parentIds:string[];reportedParentIds?:string[];documentId:string|null;parentDocumentId:string|null;reference:string;originalLanguages:string[];websiteUrl:string|null;websiteLanguage:string|null;header:OutsideHeader|null;source:OutsideSource;headerSource?:OutsideSource;rosterSource:{date:string;sources:OutsideSource[]}};
export type OutsideAgenda={id:string;date:string;titles:Record<string,string>;kind:string;procedureIds:string[];procedures:{id:string;type:string|null;source:OutsideSource|null}[];source:OutsideSource};
export type OutsidePerson={id:string;name:string;role:string|null;roleLanguageTag?:string|null;capacity:string;contributions:number;appearances:number;unlinkedContributions:number;sittingDays:number;first:string;last:string;terms:number[];days:OutsideDay[];roles:string[];roleConflicts:string[]};
export type OutsideCoverage={complete:boolean;pending:number;unresolved:number;gaps:number;truncated:boolean;initialized:boolean;generation:number;updatedAt:string|null;tasks:{kind:string;total:number;completed:number}[];source:string};
export type OutsideDirectory={term:string;people:OutsidePerson[];coverage:OutsideCoverage};
export type OutsideDetail={person:OutsidePerson;contributions:OutsideContribution[];agendas:OutsideAgenda[];coSpeakers:OutsideContribution[];coverage:OutsideCoverage};
