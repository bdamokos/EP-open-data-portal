export function recordHref(id:string,kind?:string,member?:string,reference?:string){
 const q=new URLSearchParams();
 if(reference){q.set('view','legislation');q.set('pl-mode','dossier');q.set('dossier-ref',reference);}
 else if(kind==='document'&&!member){q.set('view','legislation');q.set('agenda-document',id);}
 else if(kind==='question'){q.set('view','questions');q.set('q-read',id);}
 else if(member){q.set('member',member);q.set('module',kind==='speech'?'speeches':'activities');q.set(kind==='speech'?'speech':'activity',id);}
 else {q.set('view','legislation');q.set('agenda-topic',id);const day=id.match(/^MTG-PL-(\d{4}-\d{2}-\d{2})/);if(day)q.set('agenda-period','sitting:MTG-PL-'+day[1]);}
 return '?'+q;
}
