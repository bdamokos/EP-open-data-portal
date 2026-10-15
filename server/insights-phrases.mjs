import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {documentFiles} from './activity-index-model.mjs';

const connectors=new Set('of the and for on to in'.split(' '));
const boilerplate=new Set(['european commission','european parliament','european union','member state','member states','eu member states','eu rules','eu legislation','eu law','new eu','use of eu','written question','oral question','question for written answer']);
const introductions=new Set('support supporting funding compliance the a an is are does will can what why how which has should in with under from at into towards between across regarding concerning application implementation revision impact ensuring need lack request question response situation possible action protection enforcement extension follow enforce implementing implement amend amending protect protecting strengthen strengthening ensure uphold'.split(' '));
const ending=/^(?:Act|Directive|Regulation|Court|Programme|Statute|Justice|Rights|Law)$/u;
const key=label=>label.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}]+/gu,'-').replace(/^-|-$/g,'');
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const words=text=>[...String(text||'').normalize('NFKC').matchAll(/\p{L}[\p{L}\p{M}’'-]*/gu)].map(m=>({text:m[0],lower:m[0].toLowerCase(),start:m.index,end:m.index+m[0].length}));
const titled=w=>/^\p{Lu}/u.test(w.text)&&w.text.replace(/[^\p{L}]/gu,'').length>=2&&!connectors.has(w.lower);

export function capitalPhrases(value,{title=false}={}) {
  const text=String(value||'').normalize('NFKC'),tokens=words(text),result=[];
  const substantive=tokens.filter(w=>!connectors.has(w.lower)),titleCase=title&&substantive.length>4&&substantive.every(titled);
  for(let i=0;i<tokens.length;i++) {
    const first=tokens[i];if(!titled(first)||introductions.has(first.lower))continue;
    let end=i,content=1;
    for(let j=i+1;j<Math.min(tokens.length,i+9);j++) {
      const next=tokens[j],gap=text.slice(tokens[j-1].end,next.start);
      if(!/^\s+$/u.test(gap))break;
      if(connectors.has(next.lower)){if(ending.test(tokens[end].text)&&next.lower!=='of')break;continue;}
      if(!titled(next)||introductions.has(next.lower))break;
      end=j;content++;
    }
    if(content<2)continue;
    const label=text.slice(first.start,tokens[end].end).replace(/[’']s$/u,''),token=key(label);
    const namedType=tokens.slice(i,end+1).some(w=>/^(?:Act|Directive|Regulation|Court|Programme|Statute|Pact|Convention|Market)$/u.test(w.text));
    if(token.length>39||token.length<3||boilerplate.has(token.replaceAll('-',' '))||(!namedType&&/^(?:EU|European|International|National|Member)$/u.test(tokens[end].text))||(titleCase&&!namedType))continue;
    result.push({key:token,label,kind:'capitalized-phrase'});i=end;
  }
  return result;
}

// Every count is a distinct question, even when a phrase repeats in its body.
export function phraseModel(questions,{bodies=new Map(),stopwords=new Set(),minCount=3,maxShare=.15}={}) {
  const candidates=new Map(),wordCounts=new Map(),grams=new Map();let processedTokens=0;
  const add=(phrase,id,body=false)=>{if(!candidates.has(phrase.key)&&candidates.size>=4000)return;const old=candidates.get(phrase.key)||{...phrase,ids:new Set(),inBody:false};old.ids.add(id);old.inBody||=body;candidates.set(phrase.key,old);};
  for(const q of questions) {
    const title=q.titles?.en||'',body=bodies.get(q.id),texts=[title,...(body?.paragraphs||[])],seenWords=new Set(),seenGrams=new Map();
    for(let i=0;i<texts.length;i++) {
      if(processedTokens>=200000)break;
      const text=texts[i].slice(0,i===0?2000:20000);for(const p of capitalPhrases(text,{title:i===0}))add(p,q.id,i>0);
      const ts=words(text).slice(0,Math.min(i===0?128:512,200000-processedTokens));processedTokens+=ts.length;for(const w of ts)seenWords.add(w.lower);
      for(let start=0;start<ts.length;start++)for(let n=2;n<=4&&start+n<=ts.length;n++) {
        const seq=ts.slice(start,start+n),first=seq[0],last=seq.at(-1),label=seq.map(w=>w.lower).join(' '),token=key(label);
        if(first.lower.length<3||last.lower.length<3||stopwords.has(first.lower)||stopwords.has(last.lower)||introductions.has(first.lower)||boilerplate.has(token.replaceAll('-',' '))||token.length>39)continue;
        if(seq.some((w,j)=>j&& !/^\s+$/u.test(text.slice(seq[j-1].end,w.start))))continue;
        if(seq.slice(1,-1).some(w=>stopwords.has(w.lower)&&!connectors.has(w.lower)))continue;
        seenGrams.set(token,{label,terms:seq.map(w=>w.lower)});
      }
    }
    for(const w of seenWords)wordCounts.set(w,(wordCounts.get(w)||0)+1);
    for(const [token,g] of seenGrams){if(!grams.has(token)&&grams.size>=100000)continue;const old=grams.get(token)||{...g,ids:new Set()};old.ids.add(q.id);grams.set(token,old);}
  }
  const total=questions.length||1;
  for(const [token,g] of grams) {
    const count=g.ids.size;if(count<minCount||count/total>maxShare)continue;
    const p=count/total,association=Math.log(p/g.terms.reduce((v,w)=>v*(wordCounts.get(w)||1)/total,1))/(-(g.terms.length-1)*Math.log(p));
    if(association<.45)continue;
    if(!candidates.has(token))candidates.set(token,{key:token,label:g.label,kind:'recurring-phrase',ids:g.ids,inBody:false});
  }
  const phrases=[...candidates.values()].sort((a,b)=>b.ids.size-a.ids.size||b.label.length-a.label.length||a.key.localeCompare(b.key)).slice(0,2000);
  const labels=Object.fromEntries(phrases.map(p=>[p.key,p.label]));
  // Skip unrelated names by indexing alternatives under their first word.
  // Each candidate uses the same Unicode-insensitive, longest-first match.
  const starts=new Map();
  for(const phrase of phrases){const first=phrase.label.match(/^\p{L}+/u)?.[0].toUpperCase();if(!first)continue;const labels=starts.get(first)||[];labels.push(phrase.label);starts.set(first,labels);}
  const patterns=new Map([...starts].map(([first,labels])=>[first,new RegExp('^(?:'+labels.sort((a,b)=>b.length-a.length).map(escape).join('|')+')(?![\\p{L}])','iu')]));
  const byLabel=new Map(phrases.map(p=>[p.label.toLowerCase(),p]));
  return {labels,phraseKeys:new Set(phrases.map(p=>p.key)),coverage:{cachedEnglishBodies:bodies.size,recognizedPhrases:phrases.length,miningTokens:processedTokens,miningBounded:processedTokens>=200000||grams.size>=100000||candidates.size>2000},extract(value){
    const text=String(value||'').normalize('NFKC'),found=new Map(),spans=[];
    let consumed=0;
    for(const word of text.matchAll(/\p{L}+/gu)){
      if(word.index<consumed)continue;
      const match=patterns.get(word[0].toUpperCase())?.exec(text.slice(word.index));if(!match)continue;
      consumed=word.index+match[0].length;
      const p=byLabel.get(match[0].toLowerCase());if(p){found.set(p.key,p);spans.push([word.index,consumed]);}
    }
    const masked=text.split('');for(const [start,end] of spans)masked.fill(' ',start,end);
    return {phrases:[...found.values()].map(({key,label,kind})=>({key,label,kind})),text:masked.join('')};
  }};
}

export async function cachedEnglishQuestionBodies(sources,{directory=process.env.ODP_CACHE_DIR,maxFiles=256,maxBytes=4*1024*1024}={}) {
  const result=new Map();if(!directory)return result;
  const expected=new Map();for(const {work} of sources){const id=work.identifier||String(work.id).split('/').at(-1);for(const f of documentFiles(work))if(f.language==='en'&&f.format==='DOCX')expected.set(f.url,id);}
  const dir=path.join(directory,'document-text-v1');let names;try{names=(await readdir(dir)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).sort().slice(0,maxFiles);}catch{return result;}
  let bytes=0;for(const name of names)try {
    const file=path.join(dir,name),info=await stat(file);if(info.size>256*1024||bytes+info.size>maxBytes)continue;bytes+=info.size;
    const r=JSON.parse(await readFile(file,'utf8')),id=expected.get(r.sourceUrl);
    if(!id||createHash('sha256').update(r.sourceUrl).digest('hex')+'.json'!==name||r.schemaVersion!==1||r.sourceId!==id||!Number.isFinite(Date.parse(r.fetchedAt))||!Array.isArray(r.paragraphs)||!r.paragraphs.every(p=>typeof p==='string'))continue;
    result.set(id,{paragraphs:r.paragraphs,fetchedAt:r.fetchedAt,sourceUrl:r.sourceUrl});
  }catch{}
  return result;
}
