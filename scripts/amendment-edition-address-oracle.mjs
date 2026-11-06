import {oracleAddress} from './amendment-oracle-grammar.mjs';
import {rawResolutionPointUnits} from './amendment-benchmark-resolution-oracle.mjs';

// Reviewed list-position correspondences, never phonetic transliteration.
// Bulgarian uses а..щ for Latin a..z, then аа, аб, etc.
// Only the held Greek insertion suffix α is mapped; base letters stay unverified.
const alphabets={bg:'абвгдежзийклмнопрстуфхцчшщ'};
const latinSuffixes=['bis','ter','quater','quinquies','sexies','septies','octies','nonies','decies'];
const letters=(value,language,decoded=false)=>[...(value??'')].map(c=>{
  if(!/[\p{L}]/u.test(c))return c;
  if(/[a-z]/iu.test(c))return language==='bg'&&!decoded&&!/[ao]/iu.test(c)?'?':c;
  const at=alphabets[language]?.indexOf(c.toLowerCase());
  return at===undefined||at<0?'?':String.fromCharCode((c===c.toUpperCase()?65:97)+at);
}).join('');
const suffix=(value,language,decoded=false)=>language==='el'&&value==='α'?'a':latinSuffixes.includes(value)?String.fromCharCode(97+latinSuffixes.indexOf(value)):letters(value,language,decoded);
const key=path=>JSON.stringify(path.map(p=>[p.kind,p.value,p.isNew]));
const unknown=()=>({assertion:{status:'unverified',reason:'oracle-edition-address-disagreement'}});

export function editionAddress(wording,raw=wording.targetLabel?.split('\n')[0]||'') {
  raw=raw.normalize('NFC').replace(/\s+/gu,' ').replace(/([–—])(?=\S)/gu,'$1 ').trim();
  let decodedPoint=false;
  if(wording.language==='bg') {
    // A Latin e in the heading is a Cyrillic е only when both native columns
    // explicitly print е). This repairs a glyph, never a target from prose.
    if(/^е\)\s/u.test(wording.originalText||'')&&/^е\)\s/u.test(wording.proposedText||''))raw=raw.replace(/(буква )e$/u,'$1е');
    const point=/^(Параграф \d+ [–—-] буква )([а-яa-z]+(?: [а-яa-z]+)*)(.*)$/u.exec(raw);
    if(point) {
      const bits=point[2].split(' '),isNew=/\((?:нова|ново|нов)\)/u.test(point[3]);
      const ending=isNew&&bits.length>1?' '+letters(bits.pop(),'bg'):'';
      raw=point[1]+letters(bits.join(''),'bg')+ending+point[3];
      decodedPoint=true;
    }
  }
  if(wording.language==='cs')raw=raw.replace(/podbod/gu,'písm.').replace(/třetí pododstavec/gu,'pododstavec 3');
  if(wording.language==='da')raw=raw.replace(/^N\.[ºo] /u,'');
  const path=oracleAddress(raw,wording.language,{resolution:['motion-resolution','unknown'].includes(wording.baseline)});
  if(!path)return null;
  const result=path.map((p,i)=>{
    const base=letters(p.base??p.value,wording.language,decodedPoint),ending=suffix(p.suffix,wording.language,decodedPoint);
    // In a legislative instruction Czech bod directly under Čl. is a point.
    const kind=wording.language==='cs'&&p.kind==='paragraph'&&i===1&&/^Čl\. \d+ – bod /u.test(raw)?'point':wording.language==='nl'&&p.kind==='paragraph'&&i>0&&path[i-1].kind==='paragraph'?'subparagraph':p.kind;
    return {...p,kind,base,suffix:ending,value:base+ending,isNew:p.isNew||Boolean(p.negative&&wording.originalText==='')};
  });
  return result.some(p=>p.value.includes('?'))?null:result;
}

// Compare every held edition's outer address, including ordinary alphabetic
// labels. Additional underlying-act lines are compared wherever both editions
// print them; omission is retained as a heading gap, never a different target.
export function oracleEditionTarget({text,wording,placement}) {
  const editions=wording.addressEditions||[],path=editionAddress(wording);
  if(placement?.status!=='placed')return null;
  const points=path?.length===2&&path[0].kind==='paragraph'&&path[1].kind==='point'
    ?rawResolutionPointUnits(text).units.filter(u=>u.path.length===2&&u.path[0].value===path[0].value):[];
  const numeric=p=>p?.length===2&&p[0].kind==='paragraph'&&p[1].kind==='point'&&/^\d+$/u.test(String(p[1].base));
  let mismatch=numeric(path)&&points.length>0;
  if(!editions.length)return mismatch?unknown():null;
  const others=editions.filter(e=>e.language!==wording.language),paths=others.map(e=>editionAddress(e));
  if(!others.length)return mismatch?unknown():null;
  // Whole-document operations have their own native-source assertions.
  if(!path&&paths.every(p=>!p))return null;
  if(!path||paths.some(p=>!p))return unknown();
  mismatch ||= points.length>0&&paths.some(numeric);
  if(!mismatch) {
    if(paths.some(p=>key(p)!==key(path)))return unknown();
    // Commission-proposal placement addresses the outer instruction. Its
    // quoted amended-act headings are context, not competing target paths.
    {
      const underlying=entry=>(entry.targetLabel||'').split('\n').slice(1).map(line=>{
        const parts=line.split(/ [—–] /u);
        for(let i=0;i<parts.length;i++) {const address=editionAddress(entry,parts.slice(i).join(' – '));if(address)return address;}
        return null;
      }).filter(Boolean);
      const own=underlying(wording);
      const nestedInsertion=wording.originalText===''&&!path.at(-1).isNew&&own.some(p=>p.at(-1).kind==='subparagraph'&&p.at(-1).isNew);
      const sets=[own,...others.map(underlying)];
      if((wording.baseline==='present-text'||nestedInsertion)&&sets.filter(p=>p.length).length>1&&new Set(sets.filter(p=>p.length).map(paths=>JSON.stringify(paths.map(key)))).size>1)return unknown();
    }
    return null;
  }
  const fitting=[path,...paths].filter(p=>!numeric(p));
  if(!fitting.length||new Set(fitting.map(key)).size!==1)return unknown();
  const chosen=fitting[0];
  if(chosen.length!==2||chosen[0].kind!=='paragraph'||chosen[0].value!==path[0].value||chosen[1].kind!=='point'||!chosen[1].isNew)return unknown();
  const anchors=points.filter(p=>p.label===chosen[1].base);
  if(anchors.length!==1||!anchors[0].complete)return unknown();
  const anchor=anchors[0];
  if(placement.insertAfter!==anchor.end||placement.insertBefore!==anchor.end+1)return {assertion:{status:'failed',reason:'oracle-edition-address-boundary-mismatch'}};
  return {target:{raw:wording.targetLabel,language:wording.language,complete:true,segments:chosen}};
}
