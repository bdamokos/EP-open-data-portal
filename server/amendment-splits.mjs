import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {decodeCharacterReferences} from './character-references.mjs';

// Increment when the grammar or its binding rules change, so stored failures can
// be retried. Recognition produces selectors, never source offsets or final text.
export const SPLIT_PARSER_VERSION = '2';
const MAX_DESCRIPTION_BYTES = 64 * 1024, MAX_PARTS = 256, MAX_QUOTES = 64, MAX_ALTERNATIVES = 64, MAX_DEPTH = 16;
const xmlParser = new XMLParser({preserveOrder:true, ignoreAttributes:true, parseTagValue:false, trimValues:false, processEntities:false, cdataPropName:'#cdata'});
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const problem = (code, message) => Object.assign(new Error(message), {code});
const fail = (code, message) => { throw problem(code, message); };
const clone = value => structuredClone(value);

function decodeEntities(value) {
  return decodeCharacterReferences(value,'split-xml',(_entity,reason)=>{
    if(reason==='unsupported')fail('unsafe_xml', 'Only standard XML character references are supported.');
    fail('invalid_xml', 'Invalid XML character reference.');
  });
}

function descriptionText(raw) {
  if (typeof raw !== 'string' || !raw.trim()) fail('missing_description', 'The requested language has no split description.');
  if (Buffer.byteLength(raw,'utf8') > MAX_DESCRIPTION_BYTES) fail('description_too_large', 'The split description exceeds the parser size limit.');
  let xml = raw.trim();
  // Some consumers escape the complete fragment. Unwrap that layer only at the
  // partValue boundary; escaped markup inside an ordinary fragment stays text.
  if (!xml.includes('<') && /^&lt;partValue(?:&gt;|\s)/.test(xml)) xml = decodeEntities(xml);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('unsafe_xml', 'DTD and entity declarations are not accepted.');
  if (/&(?!(?:amp|lt|gt|apos|quot|#[0-9]+|#x[0-9a-f]+);)/i.test(xml)) fail('unsafe_xml', 'Only standard XML character references are supported.');
  if ((xml.match(/</g) || []).length > 2048) fail('description_too_large', 'The split description contains too much markup.');
  if (XMLValidator.validate(xml) !== true) fail('invalid_xml', 'The split description is not well-formed XML.');
  let tree;
  try { tree = xmlParser.parse(xml); }
  catch { fail('invalid_xml', 'The split description cannot be read as XML.'); }
  if (tree.length !== 1 || !Array.isArray(tree[0].partValue)) fail('invalid_xml', 'Expected one partValue XML fragment.');
  let text = '';
  function visit(nodes, depth, decode=true) {
    if (depth > 32) fail('description_too_large', 'The split description markup is nested too deeply.');
    for (const node of nodes) for (const [key,value] of Object.entries(node)) {
      if (key === '#text') text += decode ? decodeEntities(String(value)) : String(value);
      else if (key === '#cdata') visit(value,depth+1,false);
      else if (Array.isArray(value)) {
        if (['br','p','div'].includes(key)) text += ' ';
        visit(value,depth+1,decode);
        if (['p','div'].includes(key)) text += ' ';
      }
    }
  }
  visit(tree[0].partValue,0);
  text = text.replace(/\s+/gu,' ').trim();
  if (!text) fail('missing_description', 'The split description contains no text.');
  if (/[\uE000-\uF8FF]/u.test(text)) fail('unsupported_syntax', 'Private-use parser markers are not accepted in descriptions.');
  return text;
}

const singleOpen = new Set(["'",'‘']), doubleOpen = new Set(['"','“']);
const singleClose = new Set(["'",'’']), doubleClose = new Set(['"','”']);
const word = value => /[\p{L}\p{N}]/u.test(value || '');
const boundary = tail => /^(?:\s*$|\s*,|\s+(?:and\b|without\b|in the acronym\b)|\s*\()/i.test(tail);

// Try bounded quote interpretations. Apostrophes in citizens' expectations and
// mixed straight/curly delimiters must not truncate the quoted source text.
function tokenizations(description) {
  const outputs = [];
  let attempts = 0;
  function walk(cursor, prefix, phrases) {
    if (++attempts > MAX_ALTERNATIVES * 8) fail('ambiguous_quotes', 'Too many possible quote interpretations.');
    if (outputs.length >= MAX_ALTERNATIVES) fail('ambiguous_quotes', 'Too many possible quote interpretations.');
    let start = cursor;
    while (start < description.length && !singleOpen.has(description[start]) && !doubleOpen.has(description[start])) start++;
    if (start === description.length) { outputs.push({tokens:prefix+description.slice(cursor),phrases}); return; }
    if (phrases.length >= MAX_QUOTES) fail('description_too_large', 'The split description contains too many quotations.');
    const single = singleOpen.has(description[start]), closers = single ? singleClose : doubleClose;
    for (let end=start+1;end<description.length;end++) {
      const char = description[end];
      // An unmistakable new opening delimiter belongs to a later selector.
      // Straight apostrophes following a word remain possible possessives.
      if ((single && char === '‘') || (!single && char === '“') || char === description[start] && !word(description[end-1]) && word(description[end+1])) break;
      if (!closers.has(char) || word(description[end-1]) && word(description[end+1]) || !boundary(description.slice(end+1))) continue;
      const quote = description.slice(start+1,end);
      if (!quote.trim()) continue;
      walk(end+1, prefix+description.slice(cursor,start)+'\uE000'+phrases.length+'\uE001', [...phrases,quote]);
    }
  }
  walk(0,'',[]);
  return outputs;
}

function quantifier(value) {
  if (value == null) return {};
  const count = /^(\d+) occurrences?$/i.exec(value);
  if (count && Number(count[1]) > 0 && Number.isSafeInteger(Number(count[1]))) return {expectedCount:Number(count[1])};
  if (/^\d+(?:st|nd|rd|th)(?:(?:,\s*|\s+and\s+)\d+(?:st|nd|rd|th))* occurrences?$/i.test(value)) {
    const occurrences = [...value.matchAll(/(\d+)(?:st|nd|rd|th)/gi)].map(match=>Number(match[1]));
    if (occurrences.every(number=>number>0 && Number.isSafeInteger(number)) && new Set(occurrences).size === occurrences.length) return {occurrences};
  }
  fail('unsupported_qualifier', 'The occurrence qualifier is unsupported or invalid.');
}

function unionParts(tokens) {
  const parts = []; let start = 0, depth = 0;
  for (let cursor=0;cursor<tokens.length;cursor++) {
    if (tokens[cursor] === '(') depth++;
    if (tokens[cursor] === ')') depth--;
    if (depth < 0) fail('unsupported_syntax', 'Unbalanced occurrence qualifier.');
    if (depth) continue;
    const separator = /^(?:,\s*(?:and\s+)?|\s+and\s+)/i.exec(tokens.slice(cursor));
    if (!separator) continue;
    parts.push(tokens.slice(start,cursor).trim());
    cursor += separator[0].length-1; start=cursor+1;
  }
  if (depth) fail('unsupported_syntax', 'Unbalanced occurrence qualifier.');
  parts.push(tokens.slice(start).trim());
  return parts;
}

function parseExpression(input, phrases, depth=0) {
  if (depth > MAX_DEPTH) fail('description_too_large', 'The split description grammar is nested too deeply.');
  const tokens = input.trim();
  if (/^Text as a whole$/i.test(tokens)) return {type:'all'};
  const difference = /\s+without\s+/i.exec(tokens);
  if (difference) {
    if (/\s+without\s+/i.test(tokens.slice(difference.index+difference[0].length))) fail('ambiguous_scope', 'Repeated exclusions require an explicit supported scope.');
    const base = tokens.slice(0,difference.index), excluded = tokens.slice(difference.index+difference[0].length)
      .replace(/^the words?:?\s*/i,'').replace(/\s+and excluding\s+/gi,' and ');
    const basePlan=parseExpression(base,phrases,depth+1), exceptPlan=parseExpression(excluded,phrases,depth+1);
    if (!['all','text'].includes(basePlan.type)) fail('ambiguous_scope', 'The exclusion does not identify one supported containing selection.');
    if (exceptPlan.type === 'all') fail('unsupported_syntax', 'The exclusion must identify specific text or amendment operations.');
    return {type:'difference',base:basePlan,except:exceptPlan};
  }
  const items = unionParts(tokens);
  if (items.length > 1) {
    const plans=items.map(item=>parseExpression(item,phrases,depth+1));
    if (plans.some(plan=>plan.type === 'all')) fail('unsupported_syntax','Whole-text selectors cannot be combined with additional selections.');
    return {type:'union',items:plans};
  }
  let match = /^\uE000(\d+)\uE001(?:\s*\(([^)]+)\))?$/.exec(tokens);
  if (match) return {type:'text',quote:phrases[Number(match[1])],...quantifier(match[2])};
  match = /^(?:the )?deletion of the words?:?\s*\uE000(\d+)\uE001$/i.exec(tokens);
  if (match) return {type:'delete_operation',quote:phrases[Number(match[1])]};
  match = /^(?:the )?(first|second|third|\d+(?:st|nd|rd|th)) \uE000(\d+)\uE001 in the acronym \uE000(\d+)\uE001(?:\s*\(([^)]+)\))?$/i.exec(tokens);
  if (match) {
    const character = phrases[Number(match[2])], within = phrases[Number(match[3])];
    const characterOccurrence = ({first:1,second:2,third:3})[match[1].toLowerCase()] ?? Number.parseInt(match[1],10);
    if ([...character].length !== 1 || !characterOccurrence || [...within].filter(value=>value===character).length < characterOccurrence) fail('invalid_character_selector', 'The selected character occurrence does not exist in the quoted acronym.');
    return {type:'character',character,characterOccurrence,within,...quantifier(match[4])};
  }
  fail('unsupported_syntax', 'The description does not match a supported split selector.');
}

function containsOperation(plan) {
  return plan.type === 'delete_operation' || plan.type === 'union' && plan.items.some(containsOperation) || plan.type === 'difference' && (containsOperation(plan.base) || containsOperation(plan.except));
}
function selectionDomain(plan) {
  const kinds = new Set();
  function visit(node) {
    if (node.type === 'delete_operation') kinds.add('amendment_operations');
    else if (node.type === 'text' || node.type === 'character') kinds.add('text');
    else if (node.type === 'union') node.items.forEach(visit);
    else if (node.type === 'difference') { visit(node.base); visit(node.except); }
  }
  visit(plan);
  return kinds.size > 1 ? 'mixed' : [...kinds][0] ?? 'unspecified';
}
const same = (left,right) => JSON.stringify(left) === JSON.stringify(right);
function matchesExclusion(plan, exclusion) {
  return same(plan,exclusion) || exclusion.type === 'union' && exclusion.items.some(item=>matchesExclusion(plan,item));
}

function parseDescription(description, previous, hints) {
  if (/^(?:those words|that word)$/i.test(description)) {
    const source = previous?.plan;
    if (source?.type !== 'difference' || containsOperation(source.except)) fail('ambiguous_anaphora', 'The reference has no unambiguous preceding text exclusion.');
    if (/^that word$/i.test(description) && (source.except.type !== 'text' || /\s/u.test(source.except.quote))) fail('ambiguous_anaphora', 'The singular reference does not identify one excluded word.');
    return {...clone(source.except),...(source.base.type === 'all' ? {} : {scope:clone(source.base)}),binding:{kind:'previous_part_exclusion',partId:previous.id}};
  }
  const plans = [], errors = [];
  for (const {tokens,phrases} of tokenizations(description)) {
    try {
      const plan = parseExpression(tokens,phrases);
      if (!plans.some(existing=>same(existing,plan))) plans.push(plan);
    } catch (error) { errors.push(error); }
  }
  if (plans.length !== 1) {
    if (plans.length > 1) fail('ambiguous_quotes', 'The quotation boundaries allow multiple different selectors.');
    throw errors.find(error=>error.code !== 'unsupported_syntax') ?? problem('unsupported_syntax','The description does not match a supported split selector.');
  }
  const plan = plans[0], scopes = hints.filter(hint=>matchesExclusion(plan,hint.plan.except));
  const uniqueScopes = scopes.filter((hint,index)=>scopes.findIndex(other=>same(hint.plan.base,other.plan.base)) === index);
  if (uniqueScopes.length > 1) fail('ambiguous_scope', 'The selector could refer to more than one earlier scoped exclusion.');
  if (uniqueScopes.length === 1) return {...plan,scope:clone(uniqueScopes[0].plan.base),binding:{kind:'earlier_part_exclusion',partId:uniqueScopes[0].id}};
  return plan;
}

function partNumber(part) {
  const values = [part?.number,part?.numbering].filter(value=>value != null);
  if (!values.length || values.some(value=>!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value)<1)) return null;
  return values.every(value=>Number(value)===Number(values[0])) ? Number(values[0]) : null;
}

/**
 * Parse an official REQUEST_VOTE_SPLIT node. Every unresolved part retains its
 * source text and produces a versioned, provenance-bearing failure for storage.
 * A parsed plan still has grounding:not_attempted: no exact span, target document
 * or outcome can be inferred from a description alone.
 */
export function parseSplitRequest(request, {sourceUrl=null,fetchedAt=null,language='en'}={}) {
  const requestId = typeof request?.id === 'string' && request.id ? request.id : null;
  const parts = [], failures = [], hints = [];
  const record = (part, code, message) => {
    const failure = {code,message};
    if (part) { part.status='unresolved'; part.plan=null; part.failure=failure; }
    failures.push({requestId,partId:part?.id ?? null,description:part?.description ?? null,language,parserVersion:SPLIT_PARSER_VERSION,code,message,sourceUrl,fetchedAt,...(!part?{scope:'request'}:part.id==null?{scope:'component',componentIndex:part.componentIndex}:{}),...(part?.rawDescription != null ? {rawDescription:part.rawDescription} : {}),...(part?.sourceDescriptions ? {sourceDescriptions:part.sourceDescriptions} : {})});
  };
  const rawParts = array(request?.created_a_realization_of);
  if (!rawParts.length) { record(null,'missing_parts','The split request contains no component records.'); return {requestId,parts,failures}; }
  if (rawParts.length > MAX_PARTS) { record(null,'too_many_parts','The split request exceeds the component limit.'); return {requestId,parts,failures}; }
  const seen = new Map();
  for (const [componentIndex,raw] of rawParts.entries()) {
    const id = typeof raw?.id === 'string' && raw.id ? raw.id : null;
    const number = partNumber(raw), rawDescription = raw?.expressionContent?.[language];
    const fingerprint = JSON.stringify([raw?.number,raw?.numbering,rawDescription]);
    if (id && seen.has(id)) {
      const first = seen.get(id);
      if (first.fingerprint !== fingerprint && !first.conflicting) { first.conflicting=true; first.part.conflictingDescriptions=[first.part.rawDescription,typeof rawDescription === 'string' ? rawDescription : null]; }
      continue;
    }
    const part = {id,...(!id?{componentIndex}:{}),number,description:typeof rawDescription === 'string' ? rawDescription : null,rawDescription:typeof rawDescription === 'string' ? rawDescription : null,language,plan:null,status:'unresolved',failure:null};
    if (typeof rawDescription !== 'string' && raw?.expressionContent && typeof raw.expressionContent === 'object') part.sourceDescriptions={...raw.expressionContent};
    parts.push(part); if (id) seen.set(id,{part,fingerprint,conflicting:false});
  }
  parts.sort((left,right)=>(left.number ?? Infinity)-(right.number ?? Infinity));
  const counts = new Map(); for (const part of parts) if (part.number != null) counts.set(part.number,(counts.get(part.number) ?? 0)+1);
  let previous = null;
  for (const part of parts) {
    try {
      if (!requestId) fail('missing_request_id','The split request has no exact source identifier.');
      if (request?.had_activity_type && !array(request.had_activity_type).some(value=>typeof value === 'string' && value.endsWith('/REQUEST_VOTE_SPLIT'))) fail('invalid_request_type','The source record is not a split-vote request.');
      if (!part.id) fail('missing_part_id','The split component has no exact source identifier.');
      if (seen.get(part.id)?.conflicting) fail('conflicting_part','Duplicate component records disagree on the description or number.');
      if (part.number == null) fail('invalid_part_number','The split component has no unambiguous positive integer number.');
      if (counts.get(part.number) > 1) fail('ambiguous_part_number','Different split components have the same part number.');
      if (part.rawDescription == null) fail('missing_language','The requested language has no split description.');
      part.description=descriptionText(part.rawDescription);
      if (language !== 'en') fail('unsupported_language','The split grammar currently supports English descriptions only.');
      const prior = previous?.number === part.number-1 ? previous : null;
      const plan = parseDescription(part.description,prior,hints);
      part.plan={...plan,grounding:'not_attempted',selectionDomain:selectionDomain(plan)};
      part.status='parsed';
      previous={id:part.id,number:part.number,plan};
      if (plan.type === 'difference' && plan.base.type !== 'all') hints.push({id:part.id,plan});
    } catch (error) {
      record(part,error.code ?? 'invalid_description',error.code ? error.message : 'The split description could not be parsed.');
      previous=null;
    }
  }
  return {requestId,parts,failures};
}
