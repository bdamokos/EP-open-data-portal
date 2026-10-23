// Convert an allowlisted OMML subset to a JSON MathML tree. XML names, arbitrary
// attributes, URLs and upstream markup are never carried into rendered MathML.
export const MATHML_TAGS=Object.freeze(['math','mrow','mi','mn','mo','mtext','mfrac','msub','msup','msubsup','msqrt','mroot','munder','mover','munderover','mtable','mtr','mtd']);
const tags=new Set(MATHML_TAGS);
export const MATHML_VARIANTS=Object.freeze(['normal','bold','italic','bold-italic','script','bold-script','fraktur','bold-fraktur','double-struck','sans-serif','bold-sans-serif','sans-serif-italic','sans-serif-bold-italic','monospace']);
const variants=new Set(MATHML_VARIANTS),tokens=new Set(['mi','mn','mo','mtext']);
const alphabets={roman:{p:'normal',b:'bold',i:'italic',bi:'bold-italic'},script:{p:'script',i:'script',b:'bold-script',bi:'bold-script'},
  fraktur:{p:'fraktur',b:'bold-fraktur'},'double-struck':{p:'double-struck'},
  'sans-serif':{p:'sans-serif',b:'bold-sans-serif',i:'sans-serif-italic',bi:'sans-serif-bold-italic'},monospace:{p:'monospace'}};
const node=(tag,...children)=>({tag,children:children.flat().filter(value=>value!==null&&value!==undefined)});
const child=(nodes,key)=>nodes?.find(value=>Object.hasOwn(value,key));
const children=(nodes,key)=>child(nodes,key)?.[key]??[];
const val=(nodes,key)=>child(nodes,key)?.[':@']?.['@_m:val'];
export function officialDocumentUrl(value) {
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&['publications.europa.eu','eur-lex.europa.eu','data.europarl.europa.eu','redmapl3.europarl.europa.eu'].includes(url.hostname)?url.href:null;}catch{return null;}
}
export function isSafeMathML(tree) {
  let count=0,characters=0;
  function visit(value,depth) {
    if(depth>64||++count>20000)return false;
    if(typeof value==='string'){characters+=value.length;return characters<=100000;}
    const attributes=value?.attributes;
    const safeAttributes=attributes===undefined||attributes&&typeof attributes==='object'&&Object.keys(attributes).length===1&&
      (value.tag==='mover'&&Object.keys(attributes)[0]==='accent'&&attributes.accent==='true'||value.tag==='munder'&&Object.keys(attributes)[0]==='accentunder'&&attributes.accentunder==='true'||tokens.has(value.tag)&&Object.keys(attributes)[0]==='mathvariant'&&variants.has(attributes.mathvariant));
    return value&&typeof value==='object'&&tags.has(value.tag)&&safeAttributes&&Object.keys(value).every(key=>['tag','children','attributes'].includes(key))&&Array.isArray(value.children)&&value.children.every(item=>visit(item,depth+1));
  }
  return visit(tree,0)&&tree?.tag==='math';
}
export function ommlToMathML(input,{sourceUrl=null}={}) {
  const unsupported=new Set();let count=0;
  const fail=name=>{unsupported.add(name);return node('mtext','\uFFFC');};
  function runVariant(run){
    const properties=run.filter(part=>Object.hasOwn(part,'m:rPr'));
    if(properties.length>1)unsupported.add('duplicate-m:rPr');
    const values=new Map();
    for(const property of properties){
      if(Object.keys(property).some(key=>key!=='m:rPr'))unsupported.add('m:rPr-attributes');
      for(const part of property['m:rPr']??[])for(const [name,value] of Object.entries(part)){
        if(++count>10000){unsupported.add('complexity-limit');return null;}
        if(name==='#text'&&!String(value).trim()||name===':@')continue;
        if(!['m:scr','m:sty'].includes(name)){unsupported.add('run-property:'+name);continue;}
        const attributes=part[':@'],setting=attributes?.['@_m:val'];
        if(values.has(name)||!Array.isArray(value)||value.some(item=>Object.keys(item).some(key=>key!=='#text'||String(item[key]).trim()))||
          !attributes||Object.keys(attributes).length!==1||typeof setting!=='string')unsupported.add('malformed-run-property:'+name);
        values.set(name,setting);
      }
    }
    if(!values.size)return null;
    const script=values.get('m:scr')??'roman',style=values.get('m:sty')??(script==='roman'?'i':'p');
    const variant=Object.hasOwn(alphabets,script)&&Object.hasOwn(alphabets[script],style)?alphabets[script][style]:null;
    if(!variant)unsupported.add('mathematical-alphabet-or-style');
    return variant;
  }
  function sequence(nodes,depth=0) {
    if(depth>48||++count>10000)return fail('complexity-limit');
    const out=[];
    for(const entry of nodes??[])for(const [key,value] of Object.entries(entry)) {
      if(key===':@')continue;
      if(key==='#text'){if(String(value).trim())unsupported.add('non-run-text');continue;}
      const at=(name)=>sequence(children(value,name),depth+1);
      const properties=(name)=>children(value,name);
      const get=(prop,name)=>val(properties(prop),name);
      if(['m:oMath','m:oMathPara','m:e','m:num','m:den','m:sub','m:sup','m:deg','m:lim','m:fName'].includes(key))out.push(...sequence(value,depth+1).children);
      else if(key==='m:r') {
        // Mathematical alphabets change symbol identity. Only validated OMML
        // properties become allowlisted token attributes; unknown properties fail.
        if(entry[':@'])unsupported.add('math-run-attributes');
        const variant=runVariant(value??[]);
        for(const part of value??[])for(const [name,runs] of Object.entries(part)) {
          if(++count>10000){out.push(fail('complexity-limit'));break;}
          if([':@','m:rPr','w:rPr'].includes(name)||name==='#text'&&!String(runs).trim())continue;
          if(name!=='m:t'){out.push(fail(name));continue;}
          if(part[':@']&&Object.entries(part[':@']).some(([key,value])=>key!=='@_xml:space'||!['default','preserve'].includes(value)))unsupported.add('math-text-attributes');
          for(const run of runs??[])if(Object.keys(run).some(key=>key!=='#text'))unsupported.add('math-text-content');
          const text=(runs??[]).filter(run=>'#text'in run).map(run=>String(run['#text'])).join('');
          const token=node(/^\d+(?:[.,]\d+)?$/.test(text)?'mn':/^[+\-=<>≤≥≠×÷∑∏∫∈∉±·(),;:|]+$/u.test(text)?'mo':/^[\p{L}]+$/u.test(text)?'mi':'mtext',text);
          if(variant)token.attributes={mathvariant:variant};
          out.push(token);
        }
      }
      else if(key==='m:f') {
        const type=get('m:fPr','m:type')??'bar';
        out.push(type==='bar'?node('mfrac',at('m:num'),at('m:den')):fail('fraction-'+type));
      }
      else if(['m:sSub','m:sSup','m:sSubSup'].includes(key))out.push(node(key==='m:sSub'?'msub':key==='m:sSup'?'msup':'msubsup',at('m:e'),...(key!=='m:sSup'?[at('m:sub')]:[]),...(key!=='m:sSub'?[at('m:sup')]:[])));
      else if(key==='m:rad') {
        const hidden=['1','true','on'].includes(String(get('m:radPr','m:degHide'))),degree=at('m:deg');
        out.push(hidden||!degree.children.length?node('msqrt',at('m:e')):node('mroot',at('m:e'),degree));
      }
      else if(key==='m:nary') {
        const character=get('m:naryPr','m:chr')??'∫',base=node('mo',character),sub=at('m:sub'),sup=at('m:sup');
        const lower=!['1','true','on'].includes(String(get('m:naryPr','m:subHide')))&&sub.children.length;
        const upper=!['1','true','on'].includes(String(get('m:naryPr','m:supHide')))&&sup.children.length;
        const location=get('m:naryPr','m:limLoc')??'subSup';
        const scripted=lower&&upper?node(location==='undOvr'?'munderover':'msubsup',base,sub,sup):lower?node(location==='undOvr'?'munder':'msub',base,sub):upper?node(location==='undOvr'?'mover':'msup',base,sup):base;
        out.push(node('mrow',scripted,at('m:e')));
      }
      else if(key==='m:d') {
        const begin=get('m:dPr','m:begChr')??'(',end=get('m:dPr','m:endChr')??')',separator=get('m:dPr','m:sepChr')??'|';
        const parts=(value??[]).filter(part=>part['m:e']).flatMap((part,i)=>[...(i?[node('mo',separator)]:[]),sequence(part['m:e'],depth+1)]);
        out.push(node('mrow',...(begin?[node('mo',begin)]:[]),...parts,...(end?[node('mo',end)]:[])));
      }
      else if(key==='m:m'){
        out.push(node('mtable',(value??[]).filter(part=>part['m:mr']).map(part=>{
          for(const cell of part['m:mr'])for(const name of Object.keys(cell))if(name!=='m:e'&&name!==':@'&&!(name==='#text'&&!String(cell[name]).trim()))unsupported.add(name);
          return node('mtr',part['m:mr'].filter(cell=>cell['m:e']).map(cell=>node('mtd',sequence(cell['m:e'],depth+1))));
        })));
      }
      else if(key==='m:eqArr')out.push(node('mtable',(value??[]).filter(part=>part['m:e']).map(part=>node('mtr',node('mtd',sequence(part['m:e'],depth+1))))));
      else if(key==='m:func')out.push(node('mrow',at('m:fName'),at('m:e')));
      else if(['m:limLow','m:limUpp'].includes(key))out.push(node(key==='m:limLow'?'munder':'mover',at('m:e'),at('m:lim')));
      else if(key==='m:acc'||key==='m:bar') {
        const character=key==='m:bar'?'\u0305':get('m:accPr','m:chr')??'\u0302',position=get('m:barPr','m:pos')??'top';
        if(!['\u0305','\u0302','\u0303','\u0307','\u0308','\u0306','\u030c','\u20d7','¯','^','~','˙','¨','˘','ˇ','→','‾'].includes(character)||key==='m:bar'&&!['top','bot'].includes(position))out.push(fail(key+'-character-or-position'));
        else {const under=key==='m:bar'&&position==='bot',accent=node(under?'munder':'mover',at('m:e'),node('mo',character));accent.attributes=under?{accentunder:'true'}:{accent:'true'};out.push(accent);}
      }
      else if(['m:box','m:borderBox','m:groupChr','m:phant','m:sPre'].includes(key))out.push(fail(key));
      else if(['m:oMathParaPr','m:ctrlPr'].includes(key))continue;
      else out.push(fail(key));
      // A known container cannot hide unrecognised content next to its operands.
      if(['m:f','m:sSub','m:sSup','m:sSubSup','m:rad','m:nary','m:d','m:m','m:eqArr','m:func','m:limLow','m:limUpp','m:acc','m:bar'].includes(key)) {
        const allowed=new Set(['m:e','m:num','m:den','m:sub','m:sup','m:deg','m:lim','m:fName','m:mr',key+'Pr',':@']);
        for(const part of value??[])for(const name of Object.keys(part))if(!allowed.has(name)&&!(name==='#text'&&!String(part[name]).trim()))unsupported.add(name);
      }
    }
    return node('mrow',out);
  }
  const math=node('math',sequence(Array.isArray(input)?input:[input]));
  if(!JSON.stringify(math).includes('"children":["'))unsupported.add('empty-math');
  if(!isSafeMathML(math))unsupported.add('unsafe-or-oversize-math');
  return {kind:'math',status:unsupported.size?'unresolved':'converted',complete:!unsupported.size,math:unsupported.size?null:math,
    replacement:'\uFFFC',sourceUrl:officialDocumentUrl(sourceUrl),unsupported:[...unsupported].sort()};
}
