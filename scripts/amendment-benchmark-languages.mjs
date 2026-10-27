import {documentFiles,array,tail} from '../server/activity-index-model.mjs';
import {languageCode} from '../server/ep-links.mjs';
import {amendmentLanguagePreference} from '../server/language-order.mjs';
import {docxContent,documentNotes} from '../server/document-text.mjs';

const prefix='https://data.europarl.europa.eu/';
const ref=value=>String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
async function metadata(cache,kind,id) {
  const saved=await cache.json(prefix+'api/v2/'+kind+'/'+id+'?format=application%2Fld%2Bjson');
  const nodes=array(saved.value?.data).filter(node=>ref(node.id)==='eli/dl/doc/'+id&&node.identifier===id);
  if(nodes.length!==1)throw new Error('Language-variant metadata identity unavailable: '+id);
  return nodes[0];
}

// Optional supplementary acquisition for snapshots whose catalogue indexed only
// one wording language. Selection uses publication metadata, never extraction
// success or placement. Old sealed snapshots remain replayable without it.
export async function acquireLanguageVariants(rows,contexts,cache) {
  const result=new Map(),documentId=rows[0].targetDocumentId;
  const all=rows.flatMap(row=>(row.variants?.length?row.variants:[row]));
  const missing=all.filter(variant=>variant.listId&&variant.language&&variant.wordingSource?.url&&variant.baseline!=='commission-proposal'&&
    contexts.get(variant.language)?.plain.value?.document?.selectedText?.availableTextLanguages?.length&&
    !contexts.get(variant.language).plain.value.document.selectedText.availableTextLanguages.includes(variant.language));
  if(!missing.length)return result;
  const work=await metadata(cache,'plenary-documents',documentId);
  const linked=new Set(array(work.inverse_foresees_change_of).map(ref));
  const frozenLanguages=new Set(missing.flatMap(variant=>contexts.get(variant.language).plain.value.document.selectedText.availableTextLanguages));
  // Supplement wording for the frozen body's observed languages. A language
  // newly published after capture must not masquerade as a code improvement.
  const bodyFiles=documentFiles(work).filter(file=>file.format==='DOCX'&&frozenLanguages.has(file.language));
  for(const variant of missing) {
    if(result.has(variant.listId))continue;
    if(!linked.has('eli/dl/doc/'+variant.listId))throw new Error('Language-variant list relationship unavailable: '+variant.listId);
    const declarations=array(work.inverse_foresees_change_of).filter(node=>ref(node)==='eli/dl/doc/'+variant.listId);
    if(declarations.length!==1)throw new Error('Language-variant list declaration is ambiguous: '+variant.listId);
    const declared=declarations[0];
    const list=typeof declared==='object'&&documentFiles(declared).some(file=>file.format==='DOCX'&&frozenLanguages.has(file.language))?declared:await metadata(cache,'documents',variant.listId);
    if(list.identifier!==variant.listId||ref(list.id)!=='eli/dl/doc/'+variant.listId)throw new Error('Language-variant list identity unavailable: '+variant.listId);
    if(tail(list.work_type)!=='AMENDMENT_LIST'||!array(list.foresees_change_of).map(ref).includes('eli/dl/doc/'+documentId))throw new Error('Language-variant list target unavailable: '+variant.listId);
    const files=documentFiles(list).filter(file=>file.format==='DOCX');
    const languages=amendmentLanguagePreference(files.map(file=>file.language).filter(language=>bodyFiles.some(file=>file.language===language)),variant.language,array(work.originalLanguage).map(languageCode));
    const language=languages[0],lists=files.filter(file=>file.language===language),bodies=bodyFiles.filter(file=>file.language===language);
    if(!language||lists.length!==1||bodies.length!==1)continue;
    const wording=await cache.get(lists[0].url),body=await cache.get(bodies[0].url);
    result.set(variant.listId,{language,wording,body,files:bodyFiles});
  }
  return result;
}

export function languageVariantContext(saved,plain,runtime) {
  if(!saved?.body.ok)return plain;
  const content=(runtime?.docxContent||docxContent)(saved.body.body);
  return {input:saved.body,value:{...plain.value,document:{...plain.value.document,selectedText:{...content,...(runtime?.documentNotes||documentNotes)(content),status:'available',textLanguage:saved.language,availableTextLanguages:[...new Set(saved.files.map(file=>file.language))],sourceUrl:saved.body.url,fetchedAt:saved.body.fetchedAt}}}};
}
