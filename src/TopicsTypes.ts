export type TopicConcept={key:string;label:string;role?:string;id?:string;iso3?:string|null;language?:string|null;featured?:boolean;askers?:string};
export type TopicSeries={period:string;question:number;questionHome:number;questionElsewhere:number;questionUnknown:number;document:number;speech:number;vote:number;debate:number;groups:number;top?:{key:string;title:string;date:string}};
export type TopicItem=TopicConcept&{series:TopicSeries[];total:number;groupsTotal:number;counts:Record<string,number>};
export type TopicOverview={ready:boolean;items:TopicItem[];periods:string[];sittingDays:Record<string,number|null>;partial:{first:string|null;last:string|null};coverage?:{procedures?:number;referenced?:number;[key:string]:unknown}};
export type TopicGroup={key:string;kind:string;title:string;date:string;reference?:string;agendaId?:string;procedureId?:string;items:{id:string;kind:string;title:string;date:string;members:string[]}[];speechCount:number;speakers:{id:string;name:string|null}[]};
export type TopicDetail=Omit<TopicOverview,'items'>&{concept:TopicConcept|null;series:TopicSeries[];groups:TopicGroup[];total:number;groupsTotal:number;nextOffset:number|null;facets:Record<'keywords'|'places'|'topics',(TopicConcept&{n:number})[]>};
export type RecordTopic={id:string;status:string;topics:TopicConcept[];places:TopicConcept[];keywords:TopicConcept[]};
