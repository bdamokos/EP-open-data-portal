import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import stopwordLists from './insights-speech-stopwords.json' with {type:'json'};
import {HttpError} from './http-utils.mjs';
import {insightQuery} from './insights-store.mjs';
import {transcriptLanguage} from './transcript-language.mjs';
import {retainedSpeechData} from './corpus-speeches.mjs';
export const speechWordLanguages=Object.freeze(Object.keys(stopwordLists));
const filterKey=(word,language)=>word.normalize('NFKC').toLocaleLowerCase(language).normalize('NFD').replace(/\p{M}/gu,'');
const filters=new Map(Object.entries(stopwordLists).map(([lang,words])=>[lang,new Set(words.map(w=>filterKey(w,lang)))]));
filters.get('en').delete('ai');
for(const word of 'mr mrs ms madam mister president chairman chair thank thanks honourable honorable colleagues ladies gentlemen parliament european commission council speaker directive regulation policy act article day days today yesterday tomorrow week weeks year years commissioner commissioners minister ministers union fellow members europe people support country countries future live important need needs'.split(' '))filters.get('en').add(word);
for(const word of 'elnök elnökasszony asszony úr köszönöm tisztelt képviselőtársaim képviselőtársak'.split(' '))filters.get('hu').add(filterKey(word,'hu'));
for(const word of 'bhfuil bhfuil bhí bheidh bheith bhíonn seo sin siúd agam agat againn agaibh acu anois freisin'.split(' '))filters.get('ga').add(filterKey(word,'ga'));
export function speechWordsQuery(search,{now=Date.now()}={}) {
  for(const key of search.keys())if(!['lang','member','days','end'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated speech-word query.');
  const member=search.get('member');if(!/^[1-9]\d{0,8}$/.test(member||''))throw new HttpError(400,'invalid_member','Choose a MEP.');
  const base=new URLSearchParams(search);base.delete('member');const query=insightQuery(base,{now});
  if(!filters.has(query.language))throw new HttpError(400,'unsupported_analysis_language','Word filtering is not available for this language.');
  return {...query,member};
}
const text=node=>typeof node==='string'?node:typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?Object.entries(node).filter(([key])=>!key.startsWith('@_')).map(([,value])=>text(value)).join(' '):'';
export function speechParagraphText(xml) {
  if(typeof xml!=='string'||Buffer.byteLength(xml)>1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)return '';
  const tree=new XMLParser({ignoreAttributes:false,removeNSPrefix:true}).parse(xml),paragraphs=[];
  function visit(node){if(!node||typeof node!=='object')return;for(const [key,value] of Object.entries(node)){if(key==='p'){for(const paragraph of Array.isArray(value)?value:[value])paragraphs.push(text(paragraph?.time??paragraph));}else if(!key.startsWith('@_')){for(const child of Array.isArray(value)?value:[value])visit(child);}}}visit(tree);return paragraphs.join(' ');
}
export function speechWordTokens(text,language){const filter=filters.get(language);if(!filter)return [];const normalized=text.normalize('NFKC').toLocaleLowerCase(language);return [...normalized.matchAll(/(?:\bai\b|\p{L}[\p{L}\p{M}]{2,39})/gu)].filter(match=>!/[\d%][-‐‑–]?$/u.test(normalized.slice(Math.max(0,match.index-4),match.index))).map(match=>match[0]).filter(word=>!filter.has(filterKey(word,language)));}
export const speechWordStopwords=language=>new Set(filters.get(language)||[]);
export class SpeechWordInsights {
  constructor(store,{clock=Date.now,directory=process.env.ODP_CACHE_DIR,readTranscript,readCorpusData=retainedSpeechData}={}){this.store=store;this.clock=clock;this.directory=directory;this.readTranscript=readTranscript;this.readCorpusData=readCorpusData;this.cache=new Map();this.pending=new Map();}
  async query(query){const status=this.store.status(),key=JSON.stringify([status.servingGeneration,query.member,query.language,query.start,query.end]),old=this.cache.get(key);if(old&&this.clock()-old.at<60_000)return old.value;if(this.pending.has(key))return this.pending.get(key);
    const job=this.build(query,status);this.pending.set(key,job);try{const value=await job;this.cache.set(key,{at:this.clock(),value});while(this.cache.size>12)this.cache.delete(this.cache.keys().next().value);return value;}finally{this.pending.delete(key);}}
  async build(query,status){
    const person=this.store.db.prepare('SELECT body FROM members WHERE id=?').get(query.member);if(!person)throw new HttpError(404,'member_not_found','This MEP is not in the current roster.');
    const where="generation=? AND mep=? AND category='plenary-contributions' AND json_extract(body,'$.speechKind')='PLENARY_DEBATE_SPEECH' AND date BETWEEN ? AND ?",params=[status.servingGeneration,query.member,query.start,query.end];
    const count=this.store.db.prepare('SELECT COUNT(*) n FROM items WHERE '+where).get(...params).n;
    const rows=this.store.db.prepare('SELECT source_id,body FROM items WHERE '+where+' ORDER BY date DESC,source_id LIMIT 100').all(...params),words=new Map(),speeches=[];let rawBytes=0,xmlBytes=0,bounded=false,missing=0,wrongLanguage=0,invalid=0;
    const retained=await this.readCorpusData({sourceIds:rows.map(row=>row.source_id),language:query.language});
    const stored=new Map((retained?.records||[]).map(record=>[record.id,record]));
    for(const row of rows){
      const retainedText=stored.get(row.source_id)?.text;
      let record=null;const url='https://data.europarl.europa.eu/api/v2/speeches/'+row.source_id+'?include-output=xml_fragment&format=application%2Fld%2Bjson';
      if(retainedText)record={fetchedAt:Date.parse(retainedText.fetchedAt)};
      else try{if(this.readTranscript)record=await this.readTranscript(row.source_id);else if(this.directory){const hashed=path.join(this.directory,createHash('sha256').update(url).digest('hex')+'.json'),legacy=Buffer.from(url).toString('base64url')+'.json';let file=hashed,size;try{size=(await stat(file)).size;}catch(error){if(legacy.length>255)throw error;file=path.join(this.directory,legacy);size=(await stat(file)).size;}if(size>6*1024*1024){bounded=true;continue;}if(rawBytes+size>16*1024*1024){bounded=true;break;}rawBytes+=size;record=JSON.parse(await readFile(file,'utf8'));if(record.url!==url)record=null;}}catch{}
      const activity=(Array.isArray(record?.payload?.data)?record.payload.data:[]).find(node=>node.activity_id===row.source_id);if(!activity&&!retainedText){if(stored.get(row.source_id)?.availableLanguages.length)wrongLanguage++;else missing++;continue;}
      const docs=activity?.recorded_in_a_realization_of||[],xml=retainedText?.body||docs.map(d=>d?.['api:xmlFragment']?.[query.language]).filter(v=>typeof v==='string').join('\n');if(!xml){wrongLanguage++;continue;}
      if(xmlBytes+Buffer.byteLength(xml)>4*1024*1024){bounded=true;break;}xmlBytes+=Buffer.byteLength(xml);
      const paragraphText=retainedText?.body||docs.map(d=>speechParagraphText(d?.['api:xmlFragment']?.[query.language])).filter(Boolean).join(' ');if(!paragraphText){invalid++;continue;}
      const source=JSON.parse(row.body),tokens=speechWordTokens(paragraphText,query.language),info=retainedText?{machine:retainedText.translationType==='machine'}:transcriptLanguage(xml);speeches.push({id:row.source_id,date:source.date,title:source.titles?.[query.language]||source.titles?.en||'Speech',machineTranslation:info.machine,sourceFetchedAt:Number.isFinite(record.fetchedAt)?new Date(record.fetchedAt).toISOString():null});
      const counts=new Map();for(const word of tokens)counts.set(word,(counts.get(word)||0)+1);for(const [word,n] of counts){const previous=words.get(word)||{word,speechCount:0,occurrences:0,speechIds:[]};previous.speechCount++;previous.occurrences+=n;if(previous.speechIds.length<5)previous.speechIds.push(row.source_id);words.set(word,previous);}
    }
    return {view:'speech-words',member:query.member,language:query.language,availableAnalysisLanguages:speechWordLanguages,window:{start:query.start,end:query.end,days:query.days},words:[...words.values()].sort((a,b)=>b.speechCount-a.speechCount||b.occurrences-a.occurrences||a.word.localeCompare(b.word,query.language)).slice(0,60),speeches,coverage:{indexedSpeeches:count,consideredSpeeches:rows.length,analyzedTranscripts:speeches.length,missingSavedDetail:missing,missingRequestedLanguage:wrongLanguage,unreadableText:invalid,truncated:count>rows.length||bounded,indexComplete:status.complete,rawBytes,xmlBytes},basis:'Requested-language saved transcript paragraphs only; never falls back to another language or downloads speech text. Words ranked by distinct speeches; stopwords removed, inflections kept separate.',computedAt:new Date(this.clock()).toISOString()};
  }
}
