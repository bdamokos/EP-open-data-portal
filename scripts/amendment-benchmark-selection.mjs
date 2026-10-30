import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {InputCache,digest} from './amendment-benchmark-cache.mjs';
import {decisionsInSample} from './amendment-benchmark-sample.mjs';
import {compareBaseline} from './amendment-benchmark-model.mjs';

const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const ref=value=>(typeof value==='string'?value:value?.id)?.replace(/^https?:\/\/data\.europarl\.europa\.eu\//u,'');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const identity=(url,request)=>request?.accept?JSON.stringify([url,{accept:request.accept,...(request.language?{language:request.language}:{})}]):url;
const requireValue=(value,message)=>{if(!value)throw new Error('Source selection: '+message);};
const root=fileURLToPath(new URL('../',import.meta.url));

export function compareSelection(current,baseline,options) {
  requireValue(current.sourceSelection?.id&&current.sourceSelection.id===baseline.sourceSelection?.id,'baseline selection identity differs');
  return compareBaseline(current,baseline,options);
}

// A selection is a processing projection, not a replacement catalogue response.
// Both input layers remain sealed and retain all their observation metadata.
export async function retainedSourceSelection({file,snapshot,cache,runtime}) {
  requireValue(cache.sealed&&cache.fetchMissing===false&&cache.cap===0,'requires sealed offline inputs and request cap 0');
  const filename=await realpath(file),repository=await realpath(root);
  requireValue(filename!==repository&&!filename.startsWith(repository+path.sep),'configuration must be outside Git');
  const bytes=await readFile(filename),config=JSON.parse(bytes);
  requireValue(config.schemaVersion===1&&config.baseSnapshotId===snapshot.snapshotId,'snapshot identity mismatch');
  requireValue(Array.isArray(config.bindings)&&config.bindings.length>0&&Array.isArray(config.supplement?.manifest),'invalid configuration');
  const directory=await realpath(path.resolve(path.dirname(filename),config.supplement.directory));
  requireValue(directory!==repository&&!directory.startsWith(repository+path.sep),'captured supplement must be outside Git');
  const extra=new InputCache(directory,{apiBase:cache.apiBase,fetchMissing:false,cap:0});
  await extra.seal(config.supplement.manifest);
  const records=new Map(),layers=new Map();
  for(const layer of [cache,extra])for(const entry of layer.manifest()) {
    const key=identity(entry.url,entry.request);
    requireValue(!records.has(key)||equal(records.get(key),entry),'conflicting captured observation: '+entry.url);
    if(!records.has(key)){records.set(key,entry);layers.set(key,layer);}
  }
  const manifest=[...records.values()].sort((a,b)=>a.url.localeCompare(b.url,'en')||JSON.stringify(a.request||{}).localeCompare(JSON.stringify(b.request||{}),'en'));
  const selectedURLs=new Set(),missingComparisons=new Set();
  const combined={apiBase:cache.apiBase,fetchMissing:false,cap:0,sealed:new Set(records.keys()),
    get requests(){return cache.requests+extra.requests;},
    get missing(){return new Map([...cache.missing,...extra.missing]);},
    manifest:()=>manifest,
    assertHealthy(){if(this.failure)throw this.failure;cache.assertHealthy();extra.assertHealthy();},
    async get(url,options={}) {
      try {
        const layer=layers.get(identity(url,options));requireValue(layer,'input not captured: '+url);
        // This flag admits a retained official download host; it creates no
        // redirect observation and cannot fetch because both layers are sealed.
        return await layer.get(url,{...options,...(selectedURLs.has(url)&&runtime.allowedDownload(url)?{officialRedirect:true}:{})});
      }catch(error){this.failure??=error;throw error;}
    },
    async json(url){const input=await this.get(url);return {input,value:input.ok?JSON.parse(input.body.toString('utf8')):null};},
  };
  const bindings=new Map(),proofs=[],groups=new Map();
  for(const binding of config.bindings) {
    const {id,documentId,number,listId,language,kind,source,parent}=binding;
    requireValue(/^(?:A|B|RC)-10-\d{4}-\d{4,6}$/u.test(documentId)&&id===documentId+'-AM-'+number&&Number.isSafeInteger(number)&&number>0,'amendment identity mismatch');
    requireValue(language==='en'&&['declared-list','report-list'].includes(kind),'unsupported selection kind/language');
    const range=listId?.match(new RegExp('^'+documentId+'-AM-(\\d+)-(\\d+)$','u'));
    requireValue(range&&number>=Number(range[1])&&number<=Number(range[2]),'list range mismatch');
    requireValue(!bindings.has(id)&&source?.url&&/^[a-f0-9]{64}$/u.test(source.sha256),'duplicate or incomplete binding');
    requireValue(parent?.url==='https://data.europarl.europa.eu/api/v2/plenary-documents/'+documentId+'?format=application%2Fld%2Bjson'&&parent.request?.accept==='application/ld+json','exact captured parent request required');
    const key=identity(parent.url,parent.request),observation=records.get(key);
    requireValue(observation?.ok&&observation.status===200&&observation.sha256===parent.sha256&&observation.fetchedAt===parent.fetchedAt,'parent observation mismatch');
    bindings.set(id,binding);selectedURLs.add(source.url);
    const group=groups.get(listId)||[];group.push(binding);groups.set(listId,group);
  }
  for(const [listId,group] of groups) {
    const binding=group[0],{documentId,parent,source,kind}=binding;
    requireValue(group.every(row=>row.documentId===documentId&&row.kind===kind&&equal(row.parent,parent)&&equal(row.source,source)),'inconsistent list binding');
    const input=await combined.get(parent.url,parent.request),payload=JSON.parse(input.body.toString('utf8'));
    requireValue(payload?.data?.length===1&&ref(payload.data[0].id)==='eli/dl/doc/'+documentId,'parent work identity mismatch');
    const work=payload.data[0],lists=array(work.inverse_foresees_change_of).filter(node=>ref(node)==='eli/dl/doc/'+listId);
    requireValue(lists.length===1,'list relationship missing or ambiguous');
    const list=lists[0],range=listId.match(/-AM-(\d+)-(\d+)$/u);
    requireValue(list.identifier===listId&&ref(list.work_type)==='def/ep-document-types/AMENDMENT_LIST'&&array(list.foresees_change_of).map(ref).includes('eli/dl/doc/'+documentId),'list type or forward parent mismatch');
    requireValue(Number(list.itemNumberBegin)===Number(range[1])&&Number(list.itemNumberEnd)===Number(range[2]),'published list range mismatch');
    const files=runtime.documentFiles(kind==='report-list'?work:list).filter(file=>file.language==='en'&&file.format==='DOCX');
    requireValue(files.length===1&&files[0].url===source.declaredUrl,'unique English source declaration required');
    if(kind==='declared-list')requireValue(source.url===source.declaredUrl,'declared list URL cannot be substituted');
    else requireValue(ref(work.work_type)==='def/ep-document-types/REPORT_PLENARY'&&runtime.documentFiles(list).length===0&&source.url.split('/').at(-1)===source.declaredUrl.split('/').at(-1),'fileless report relationship unavailable');
    const captured=await combined.get(source.url);
    requireValue(captured.ok&&captured.sha256===source.sha256,'captured source hash/status mismatch');
    if(kind==='report-list') {
      const extraction=runtime.extractAmendments(captured.body,{listId,targetDocumentId:documentId,reportId:documentId,language:'en',sourceUrl:source.url,fetchedAt:captured.fetchedAt});
      requireValue(!extraction.gaps.some(gap=>gap.code==='report-amendment-identity')&&extraction.amendments.length===Number(range[2])-Number(range[1])+1,'native report cover/main range mismatch');
    }
    proofs.push({listId,documentId,kind,parent,source,declaration:files[0],captured:{url:captured.url,resolvedSourceUrl:captured.resolvedSourceUrl??captured.url,sha256:captured.sha256,fetchedAt:captured.fetchedAt,status:captured.status},unobservedRedirectClaimed:false});
  }
  const id=digest(JSON.stringify(stable({protocol:'retained-selection-v1',baseSnapshotId:snapshot.snapshotId,bindings:config.bindings,inputs:manifest})));
  const derived=[],introducedContexts=new Set();
  return {
    id,cache:combined,
    allowsSource:url=>selectedURLs.has(url),
    apply(rows,sample,makeContextUrl) {
      return rows.map(row=>{
        const binding=bindings.get(row.id);if(!binding)return row;
        requireValue(!derived.some(previous=>previous.id===row.id),'duplicate catalogue identity');
        requireValue(row.targetDocumentId===binding.documentId&&row.number===binding.number&&decisionsInSample(row,sample).length,'binding outside exact catalogue/sample');
        const previous=row.variants?.length?row.variants:[row];
        requireValue(!previous.some(variant=>variant.listId&&variant.wordingSource?.url),'cannot override indexed wording');
        const variant={language:binding.language,listId:binding.listId,wordingSource:{url:binding.source.url,...(binding.kind==='report-list'?{reportId:binding.documentId}:{})}};
        const next={...row,variants:[variant,...(row.variants||[])]};
        introducedContexts.add(makeContextUrl(combined.apiBase,binding.documentId,binding.language,variant,row));
        derived.push({id:row.id,beforeSHA256:digest(JSON.stringify(row)),afterSHA256:digest(JSON.stringify(next)),originalLanguage:row.language??null,variant,kind:binding.kind});
        return next;
      });
    },
    async comparison(url) {
      if(!combined.sealed.has(url)&&introducedContexts.has(url)) {
        missingComparisons.add(url);
        return {input:{url,ok:false,status:null,error:'selection-comparison-not-captured',fetchedAt:null,role:'internal-processing-absence-not-HTTP'},value:null};
      }
      return combined.json(url);
    },
    receipt() {
      requireValue(derived.length===bindings.size,'not every binding belongs to the exact sample');
      return {protocol:'retained-selection-v1',id,configurationSHA256:digest(bytes),sourceSnapshotId:snapshot.snapshotId,proofs,derived,missingComparisonProjections:[...missingComparisons].sort(),originalCapturedInputsUnchanged:true,additionalInputs:extra.manifest(),canonicalAdoption:'separate review and acceptance required; no baseline recording by this mode'};
    },
  };
}
