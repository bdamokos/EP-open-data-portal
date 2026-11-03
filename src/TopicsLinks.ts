export function recordHref(id:string,kind?:string,member?:string,reference?:string){
 const q=new URLSearchParams();
 if(reference){q.set('view','legislation');q.set('pl-mode','dossier');q.set('dossier-ref',reference);}
 else if(kind==='document'&&!member){q.set('view','legislation');q.set('agenda-document',id);}
 else if(kind==='question'){q.set('view','questions');q.set('q-read',id);}
 else if(member){q.set('member',member);q.set('module',kind==='speech'?'speeches':'activities');q.set(kind==='speech'?'speech':'activity',id);}
 else {q.set('view','legislation');q.set('agenda-topic',id);const day=id.match(/^MTG-PL-(\d{4}-\d{2}-\d{2})/);if(day)q.set('agenda-period','sitting:MTG-PL-'+day[1]);}
 return '?'+q;
}

// Only these event identities have a supported agenda destination.
export const agendaTopicTarget=(id?:string)=>id&&/^MTG-PL-\d{4}-\d{2}-\d{2}-(?:PVCRE-ITM-\d+(?:-\d+)?|OJ-ITM-[DV]-\d+(?:-\d+)?)$/.test(id)?id:null;

// Interface locale belongs to the destination UI, even when story prose falls back to English.
// Source URLs are evidence and must remain byte-for-byte unchanged.
export function storyInterfaceHref(href:string,locale:string){
 if((!href.startsWith('?')&&!href.startsWith('/'))||href.startsWith('//'))return href;
 const fragment=href.indexOf('#'),hash=fragment<0?'':href.slice(fragment),route=fragment<0?href:href.slice(0,fragment);
 const query=route.indexOf('?'),params=new URLSearchParams(query<0?'':route.slice(query+1));params.set('lang',locale);
 return (query<0?route:route.slice(0,query))+'?'+params+hash;
}
