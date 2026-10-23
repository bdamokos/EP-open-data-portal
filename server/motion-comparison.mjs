import {languagePreference} from './language-order.mjs';
import {odp,ODP_BASE,odpLanguage} from './odp.mjs';
import {HttpError} from './http-utils.mjs';
import {array,tail,documentFiles,procedureIds} from './activity-index-model.mjs';
import {documentText,allowedDownload} from './document-text.mjs';
import {motionReference} from './motion-outcomes.mjs';
import {motionBody,compareMotionBodies} from './motion-diff.mjs';

const stages=new Set(['original-joint','original-adopted','joint-adopted']);
const ref=value=>String(value?.id || value || '').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
const references=value=>array(value).map(ref);
const files=work=>documentFiles(work).filter(f=>f.format==='DOCX' && f.language && allowedDownload(f.url));
const timestamp=value=>new Date(value).toISOString();

export function createMotionComparison({request=odp,readText=documentText}={}) {
  return async function motionComparison(originalId,jointId,{stage='original-joint',language='en'}={}) {
    if(!/^B-10-\d{4}-\d{4,6}$/.test(originalId) || !/^RC-10-\d{4}-\d{4,6}$/.test(jointId))
      throw new HttpError(400,'invalid_motion','Choose an original motion and its joint motion.');
    if(!stages.has(stage))throw new HttpError(400,'invalid_comparison','Unknown comparison stage.');
    odpLanguage(language);
    const sources=[];
    async function read(endpoint,id,type) {
      const record=await request(endpoint,{}, {staleWhileRevalidate:true});
      const work=record.payload.data.find(w=>w.identifier===id && ref(w.id)==='eli/dl/'+(type==='procedure'?'proc/':'doc/')+id);
      // Procedures have a process ID instead of a document identifier.
      const node=type==='procedure'?record.payload.data.find(w=>ref(w.id)==='eli/dl/proc/'+id):work;
      if(!node || type!=='procedure' && tail(node.work_type)!==type)throw new HttpError(502,'invalid_motion_source','Parliament did not return the requested source record.');
      sources.push({url:record.url || ODP_BASE+endpoint,fetchedAt:timestamp(record.fetchedAt),stale:Boolean(record.stale),refreshError:record.refreshError || null});
      return node;
    }
    const [original,joint]=await Promise.all([
      read('/plenary-documents/'+originalId,originalId,'RESOLUTION_MOTION'),
      read('/plenary-documents/'+jointId,jointId,'RESOLUTION_MOTION_JOINT'),
    ]);
    if(!references(joint.is_derivative_of).includes('eli/dl/doc/'+originalId))
      throw new HttpError(422,'unlinked_motion','The joint motion does not explicitly identify this original motion.');
    const base={status:'unavailable',stage,requestedLanguage:language,textLanguage:null,availableLanguages:[],sources,documents:[],rows:[],summary:null};
    let adopted;
    if(stage!=='original-joint') {
      const procedures=procedureIds(joint);
      if(!procedures.length || procedures.length>4)return {...base,reason:'The joint motion has no supported procedure link for finding its adopted text.'};
      const candidates=new Set();
      for(const id of procedures) {
        const procedure=await read('/procedures/'+id,id,'procedure');
        for(const value of references(procedure.created_a_realization_of))if(/^eli\/dl\/doc\/TA-10-\d{4}-\d{4}$/.test(value))candidates.add(tail(value));
      }
      if(candidates.size>8)return {...base,reason:'Too many adopted texts are linked to this procedure to select one reliably.'};
      const matched=[];
      // Check every candidate before choosing: a missing or conflicting record remains a gap.
      for(const id of candidates) {
        const candidate=await read('/adopted-texts/'+id,id,'TEXT_ADOPTED');
        if(references(candidate.adopts).includes('eli/dl/doc/'+jointId))matched.push(candidate);
      }
      if(matched.length!==1)return {...base,reason:matched.length?'More than one adopted text explicitly links to this joint motion.':'No published adopted text explicitly links to this joint motion.'};
      adopted=matched[0];
    }
    const works=stage==='original-joint'?[original,joint]:stage==='original-adopted'?[original,adopted]:[joint,adopted];
    const common=[...new Set(files(works[0]).map(f=>f.language))].filter(code=>files(works[1]).some(f=>f.language===code)).sort();
    const textLanguage=languagePreference(common,language)[0];
    if(!textLanguage)return {...base,reason:'These two texts have no common language with a supported document file.'};
    const texts=await Promise.all(works.map(work=>readText(work,textLanguage)));
    const documents=works.map((work,i)=>({id:work.identifier,reference:work.identifier.startsWith('TA-')?work.label || work.identifier:motionReference(work.identifier),
      title:work.title_dcterms?.[languagePreference(Object.keys(work.title_dcterms||{}).filter(code=>work.title_dcterms[code]?.trim()),textLanguage)[0]] || work.identifier,date:work.document_date || null,
      sourceUrl:texts[i].sourceUrl,fetchedAt:texts[i].fetchedAt,language:texts[i].textLanguage,translationType:texts[i].translationType,
      stale:Boolean(texts[i].stale),refreshError:texts[i].refreshError || null}));
    const selected={...base,textLanguage,availableLanguages:common,documents};
    if(texts.some(text=>text.status!=='available'))return {...selected,reason:'One or both document texts are temporarily unavailable. Try again or open the source files.'};
    if(texts.some(text=>text.textLanguage!==textLanguage))return {...selected,reason:'The requested common text language could not be read for both documents.'};
    const bodies=texts.map(text=>motionBody(text,textLanguage)),gap=bodies.find(body=>body.status!=='available');
    if(gap)return {...selected,reason:gap.reason};
    return {...selected,status:'available',reason:null,...compareMotionBodies(bodies[0].blocks,bodies[1].blocks)};
  };
}
export const motionComparison=createMotionComparison();
