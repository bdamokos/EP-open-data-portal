import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { languageCode, speechWebsite } from './ep-links.mjs';
import {speechAgendaMembership,speechParentDocuments} from './speech-agenda.mjs';
import countryLabels from './insights-country-labels.json' with {type:'json'};

const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const canonical = value => String(value?.id || value || '').replace(/^https?:\/\/data\.europarl\.europa\.eu\//, '');
const tail = value => canonical(value).split('/').at(-1);
const text = value => typeof value === 'string' ? value : value?.['#text'] || '';
const parser = new XMLParser({ignoreAttributes:false, parseTagValue:false, trimValues:false});
const personId = value => canonical(value).match(/^person\/([1-9]\d*)$/)?.[1];
const specificName = value => value && !/^(?:(?:the|le|la|der|die|il|el)\s+)?(?:president[ea]?|président(?:e)?|präsident(?:in)?|chair(?:person|man)?|speaker)$/i.test(value);

const normalizeRole = role => role.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[‐‑–—]/g,'-').replace(/\s+/g,' ').trim();
const countries = new Set(countryLabels.labels.map(({label})=>normalizeRole(label)));
export const OUTSIDE_GROUPS = Object.freeze({commission:'Commission', council:'Council presidency', eu:'Other EU institutions', leaders:'Heads of state & government', parliaments:'Other parliaments', international:'International organisations', other:'Other speakers'});
export function outsideCapacity(role) {
  if (!role) return null;
  const value=normalizeRole(role);
  // Identify the institution before the office: its president is not a national leader.
  if (/european council|conseil europeen|consejo europeo|conselho europeu|europaischen rates|europai tanacs|central bank|banque centrale|zentralbank|centrale bank|kozponti bank|european investment bank|\beib\b|court of auditors|cour des comptes|european ombudsman|mediateur europeen/i.test(value)) return 'eu';
  if (/united nations|\bun (?:general assembly|secretary)|nations unies|\bnato\b|council of europe|conseil de l.europe|organization for security and co-operation|organisation for security and co-operation|\bosce\b/i.test(value)) return 'international';
  if (/president.in.office.{0,20}council|council.{0,20}presiden|tanacs soros elnoke|president.{0,15}conseil|ratsprasiden|uachtaran-in-oifig sa chomhairle/i.test(value)) return 'council';
  if (/commission|kommission|comision|komisj|bizottsag|komisar|kummissjoni/i.test(value)) return 'commission';
  if (/speaker.{0,50}(?:parliament|rada)|president.{0,50}(?:parliament|assembly|assemblee)/i.test(value)) return 'parliaments';
  if (/prime minister|premier ministre|primeiro.ministro|head of (?:state|government)|president[ea]? (?:of |de |da |de la |of the )(?:republic|republique|republica)\b|president de l['’]ukraine\b|taoiseach|chancellor|miniszterelnok|\b(?:king|queen|grand duke|emperor|emir|sultan|roi|reine|rey|reina|rei|konig|konigin) (?:of|de|do|da|von)\b/i.test(value)) return 'leaders';
  const country=value.match(/^president of (.+?)\s*[.,]?$/)?.[1];
  if (country && (countries.has(country) || countries.has(country.replace(/^the /,'')))) return 'leaders';
  return 'other';
}

export function outsideSpeech(activity, fetchedAt, queryUrl = null) {
  if (tail(activity.had_activity_type) !== 'PLENARY_DEBATE_SPEECH') return null;
  const id = activity.activity_id;
  if (!/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(id || '')) return null;
  if(activity.activity_date!==id.slice(7,17) || !Number.isFinite(Date.parse(activity.activity_date)) || new Date(activity.activity_date).toISOString().slice(0,10)!==activity.activity_date)return null;
  const doc = array(activity.recorded_in_a_realization_of).find(value => value && typeof value === 'object') || {};
  const originals = array(doc.originalLanguage).map(languageCode).filter(Boolean);
  const participants = [...new Set(array(activity.had_participation).filter(p => !p.participation_role || tail(p.participation_role) === 'SPEAKER').flatMap(p => array(p.had_participant_person)).map(personId).filter(Boolean))];
  const observations = [];
  for (const [key, xml] of Object.entries(doc['api:xmlFragment'] || {})) {
    if (typeof xml !== 'string' || xml.length > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) continue;
    try {
      const statements = parser.parse(xml).oralStatements;
      const from = Object.values(statements || {}).flatMap(array).find(node => node && typeof node === 'object' && node.from)?.from;
      if (!from) continue;
      const languageTag = from['@_xml:lang'] || key;
      const original = originals.includes(languageTag) && !/-t-/.test(languageTag);
      for (const person of array(from.person)) {
        const personId = String(person?.['@_refersTo'] || '').match(/^(?:epdata:)?person\/(\d+)$/)?.[1];
        const name = text(person).trim();
        if (!participants.includes(personId) || !specificName(name)) continue;
        observations.push({personId, name, role:array(from.role).map(text).join(' ').trim() || null, languageTag, fragmentKey:key, original});
      }
    } catch { /* A malformed fragment leaves the identity unresolved. */ }
  }
  const headers = participants.map(personId => {
    const values = observations.filter(value => value.personId === personId);
    const chosen = values.find(value => value.original) || values.find(value => value.languageTag === 'en') || values[0];
    return {personId, name:chosen?.name || null, role:chosen?.role || null, languageTag:chosen?.languageTag || null, original:chosen?.original || false, capacity:outsideCapacity(chosen?.role), observations:values};
  });
  const term = Number(String(doc.identifier || doc.id || '').match(/CRE-(\d+)-/)?.[1]) || (activity.activity_date < '2024-07-16' ? 9 : 10);
  if(![9,10].includes(term))return null;
  const parentDocumentIds = speechParentDocuments(activity);
  return speechAgendaMembership({id, date:activity.activity_date, term, start:activity.activity_start_date || null, end:activity.activity_end_date || null, titles:activity.activity_label || {}, participants, headers,
    parentIds:[...new Set(array(activity.inverse_consists_of).map(canonical).map(value=>value.match(/^eli\/dl\/event\/(MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]+)$/)?.[1]).filter(Boolean))],
    documentId:doc.identifier || tail(doc.id) || null, parentDocumentIds, parentDocumentId:parentDocumentIds.length === 1 ? parentDocumentIds[0] : null, reference:doc.number || id, originalLanguages:array(doc.originalLanguage), ...speechWebsite(doc),
    headerChecked:observations.length>0, source:{url:queryUrl || 'https://data.europarl.europa.eu/api/v2/speeches/' + id, fetchedAt}});
}

export function outsideAgenda(activity, fetchedAt, url) {
  if (!activity?.activity_id) return null;
  return {id:activity.activity_id, date:activity.activity_date, titles:activity.activity_label || {}, kind:tail(activity.had_activity_type),
    procedureIds:[...new Set([...array(activity.inverse_consists_of),...array(activity.inverse_was_scheduled_in)].map(canonical).map(value => value.match(/^eli\/dl\/proc\/(\d{4}-\d{4}[A-Z]?)$/)?.[1]).filter(Boolean))], source:{url, fetchedAt}};
}

export function outsidePerson(rows, agendas = new Map(), language = 'en') {
  const ordered = rows.toSorted((a,b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || '') || a.id.localeCompare(b.id));
  const named = ordered.filter(row => row.header?.name);
  const capacities = new Map();
  for (const row of ordered) if (row.header?.capacity) capacities.set(row.header.capacity, (capacities.get(row.header.capacity) || 0) + 1);
  const capacity = [...capacities].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'other';
  const days = new Map();
  const appearances = new Set();
  for (const row of ordered) {
    const day = days.get(row.date) || {date:row.date, contributions:0, itemIds:[], items:[], formal:false, legislative:false};
    day.contributions++;
    for (const id of row.parentIds) {
      appearances.add(id); if (!day.itemIds.includes(id)) day.itemIds.push(id);
      const agenda = agendas.get(id);
      if(!day.items.some(item=>item.id===id))day.items.push({id,kind:agenda?.kind||null,legislative:Boolean(agenda?.procedures?.some(p=>['COD','CNS'].includes(p.type)))});
      if (agenda?.kind === 'PLENARY_ACTIVITY') day.formal = true;
      if (agenda?.procedures?.some(p => ['COD','CNS'].includes(p.type))) day.legislative = true;
    }
    days.set(row.date, day);
  }
  const roleHeader = named.toReversed().find(row => row.header?.role && row.header.capacity === capacity)?.header;
  const role = roleHeader?.role || null;
  const dailyCapacities=new Map();
  for(const row of ordered)if(row.header?.capacity){const counts=dailyCapacities.get(row.date)||new Map();counts.set(row.header.capacity,(counts.get(row.header.capacity)||0)+1);dailyCapacities.set(row.date,counts);}
  const conflicts=ordered.filter(row=>{const counts=dailyCapacities.get(row.date);if(!row.header?.capacity || !counts || counts.size<2)return false;const largest=Math.max(...counts.values());return counts.get(row.header.capacity)<largest || [...counts.values()].filter(count=>count===largest).length>1;}).map(row=>row.id);
  return {id:ordered[0].personId, name:named.at(-1)?.header.name || `Speaker ${ordered[0].personId}`, role, roleLanguageTag:roleHeader?.languageTag || null, capacity, contributions:ordered.length, appearances:appearances.size, unlinkedContributions:ordered.filter(row => !row.parentIds.length).length,
    sittingDays:days.size, first:ordered[0].date, last:ordered.at(-1).date, terms:[...new Set(ordered.map(row => row.term))], days:[...days.values()],
    roleConflicts:conflicts,
    roles:[...new Set(ordered.map(row => row.header?.role).filter(Boolean))], language};
}
