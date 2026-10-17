import {array} from './activity-index-model.mjs';
import {speakerNameIsSpecific,nameScript} from '../src/speakerNames.mjs';
import {requestSignal,waitForRequest} from './request-budget.mjs';
export {nameScript} from '../src/speakerNames.mjs';

const personId=value=>String(value?.id||value||'').match(/^(?:https?:\/\/data\.europarl\.europa\.eu\/)?person\/([1-9]\d*)$/)?.[1];
export function personNameVariants(person) {
  return [['givenName','familyName'],['officialGivenName','officialFamilyName']].flatMap(fields=>{
    const value=fields.map(key=>typeof person?.[key]==='string'?person[key].trim():'').filter(Boolean).join(' ');
    return value&&speakerNameIsSpecific(value)?[{value,script:nameScript(value),language:null,source:'ODP person/'+fields.join('+')}]:[];
  });
}
// An office is historical evidence: a committee vice-chair is not an EP Vice-President.
export function parliamentOffice(person,day) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day||''))return null;
  const offices=array(person?.hasMembership).filter(m=>
    /^(?:https?:\/\/data\.europarl\.europa\.eu\/)?org\/ep-\d+$/.test(String(m.organization?.id||m.organization||''))&&
    /^(?:https?:\/\/data\.europarl\.europa\.eu\/)?def\/ep-entities\/EU_INSTITUTION$/.test(String(m.membershipClassification||''))&&
    m.memberDuring?.startDate&&m.memberDuring.startDate<=day&&(!m.memberDuring.endDate||m.memberDuring.endDate>=day)
  ).flatMap(m=>{
    const role=String(m.role||'').split('/').at(-1);
    return ['PRESIDENT','PRESIDENT_VICE'].includes(role)?[{code:role==='PRESIDENT'?'president-parliament':'vice-president-parliament',membershipId:m.id,start:m.memberDuring.startDate,end:m.memberDuring.endDate||null}]:[];
  });
  return new Set(offices.map(office=>office.code)).size===1?offices[0]:null;
}

export class SpeakerIdentities {
  constructor({request}={}) {this.request=request;}
  async enrich(people,day,{chairs=[],profileIds=[]}={}) {
    if(!people.length)return [];
    const sources=[],byId=new Map(),issues=[],profileFailures=new Set();
    const supplied=new Map();
    for(const person of people) {
      const variants=supplied.get(person.id)||new Map();
      const own=[...person.nameVariants||[],...(speakerNameIsSpecific(person.name)?[{value:person.name,script:nameScript(person.name),language:null,source:person.nameSource||'ID-matched transcript header'}]:[])];
      for(const variant of own)variants.set(JSON.stringify(variant),variant);
      supplied.set(person.id,variants);
    }
    const ownerSignal=requestSignal(),signal=AbortSignal.any([AbortSignal.timeout(2500),...(ownerSignal?[ownerSignal]:[])]);
    // Reuse the directory's cached roster request; never fetch a profile per debate speaker.
    try {
      const record=await waitForRequest(this.request('/meps/show-current',{limit:1000,offset:0},{daily:true,staleWhileRevalidate:true,signal}),signal);
      sources.push({url:record.url,fetchedAt:new Date(record.fetchedAt).toISOString(),stale:Boolean(record.stale)});
      for(const person of record.payload.data||[])if(personId(person)===String(person.identifier))byId.set(String(person.identifier),person);
    }catch {issues.push('person-names-unavailable');}
    const chairIds=[...new Set([...chairs,...profileIds.filter(id=>!byId.has(id))])].filter(id=>people.some(person=>person.id===id));
    // A selected debate has few chairs. Keep exceptional sources bounded and explicit.
    for(let offset=0;offset<Math.min(chairIds.length,8)&&!signal.aborted;offset+=2)await Promise.all(chairIds.slice(offset,Math.min(offset+2,8)).map(async id=>{
      try {
        const record=await waitForRequest(this.request('/meps/'+id,{}, {ttl:7*86400000,staleWhileRevalidate:true,signal}),signal);
        const person=record.payload.data?.find(p=>personId(p)===id&&String(p.identifier)===id);
        if(!person)return;
        byId.set(id,person);sources.push({url:record.url,fetchedAt:new Date(record.fetchedAt).toISOString(),stale:Boolean(record.stale)});
      }catch {profileFailures.add(id); /* A failed office lookup cannot hide the supplied transcript. */ }
    }));
    return people.map(person=>{
      const profile=byId.get(person.id),variants=personNameVariants(profile);
      const sourceVariants=[...supplied.get(person.id).values()];
      const name=variants.find(variant=>variant.script==='Latn')?.value||variants[0]?.value||(speakerNameIsSpecific(person.name)?person.name:sourceVariants.find(variant=>speakerNameIsSpecific(variant.value))?.value||'');
      return {...person,name,nameSource:variants.length?'ODP person record':person.nameSource,
        nameVariants:[...variants,...sourceVariants],
        ...(chairs.includes(person.id)?{sittingRole:'chair',office:parliamentOffice(profile,day)}:{}),
        identitySources:sources,identityIssues:[...issues,...(profileFailures.has(person.id)?['person-profile-unavailable']:[]),...(chairs.includes(person.id)&&!parliamentOffice(profile,day)?['parliament-office-unavailable']:[])]};
    });
  }
}
