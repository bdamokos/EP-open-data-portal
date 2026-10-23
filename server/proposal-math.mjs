// Convert an allowlisted OMML subset to a JSON MathML tree. XML names, arbitrary
// attributes, URLs and upstream markup are never carried into rendered MathML.
export const MATHML_TAGS=Object.freeze(['math','mrow','mi','mn','mo','mtext','mfrac','msub','msup','msubsup','msqrt','mroot','munder','mover','munderover','mtable','mtr','mtd']);
const tags=new Set(MATHML_TAGS);
export const MATHML_VARIANTS=Object.freeze(['normal']);
const variants=new Set(MATHML_VARIANTS);
const alphabets={roman:{p:'normal',b:'bold',i:'italic',bi:'bold-italic'},script:{p:'script',i:'script',b:'bold-script',bi:'bold-script'},
  fraktur:{p:'fraktur',b:'bold-fraktur'},'double-struck':{p:'double-struck'},
  'sans-serif':{p:'sans-serif',b:'bold-sans-serif',i:'sans-serif-italic',bi:'sans-serif-bold-italic'},monospace:{p:'monospace'}};
// MathML Core only defines mathvariant="normal" on mi. Encode the other
// alphabets with Unicode, including the legacy Letterlike Symbols exceptions.
// https://w3c.github.io/mathml-core/#dfn-mathvariant
// https://www.unicode.org/charts/PDF/U1D400.pdf
const alphabetRanges={
  bold:[0x1d400,0x1d41a,0x1d7ce],italic:[0x1d434,0x1d44e],
  'bold-italic':[0x1d468,0x1d482,0x1d7ce],script:[0x1d49c,0x1d4b6],
  'bold-script':[0x1d4d0,0x1d4ea],fraktur:[0x1d504,0x1d51e],
  'bold-fraktur':[0x1d56c,0x1d586],'double-struck':[0x1d538,0x1d552,0x1d7d8],
  'sans-serif':[0x1d5a0,0x1d5ba,0x1d7e2],'bold-sans-serif':[0x1d5d4,0x1d5ee,0x1d7ec],
  'sans-serif-italic':[0x1d608,0x1d622,0x1d7e2],'sans-serif-bold-italic':[0x1d63c,0x1d656,0x1d7ec],
  monospace:[0x1d670,0x1d68a,0x1d7f6],
};
const alphabetExceptions={italic:{h:'ℎ'},script:{B:'ℬ',E:'ℰ',F:'ℱ',H:'ℋ',I:'ℐ',L:'ℒ',M:'ℳ',R:'ℛ',e:'ℯ',g:'ℊ',o:'ℴ'},
  fraktur:{C:'ℭ',H:'ℌ',I:'ℑ',R:'ℜ',Z:'ℨ'},'double-struck':{C:'ℂ',H:'ℍ',N:'ℕ',P:'ℙ',Q:'ℚ',R:'ℝ',Z:'ℤ'}};
function mathematicalText(text,variant,unsupported) {
  if(!variant||variant==='normal')return text;
  const ranges=alphabetRanges[variant];
  return [...text].map(character=>{
    if(alphabetExceptions[variant]?.[character])return alphabetExceptions[variant][character];
    const code=character.codePointAt(0),index=code>=65&&code<=90?0:code>=97&&code<=122?1:code>=48&&code<=57?2:-1;
    if(index>=0&&ranges[index]!==undefined)return String.fromCodePoint(ranges[index]+code-[65,97,48][index]);
    // Whitespace and operators have no alphabetic identity to transform. Every
    // other character needs an explicit mapping; never substitute plain letters.
    if(!/^[\s+\-=<>≤≥≠×÷∑∏∫∈∉±·(),.;:|/!%_\[\]{}]$/u.test(character))unsupported.add('unmapped-mathematical-character:'+variant+':U+'+code.toString(16).toUpperCase());
    return character;
  }).join('');
}
const operandShapes={
  'm:f':{'m:num':[1,1],'m:den':[1,1]},
  'm:sSub':{'m:e':[1,1],'m:sub':[1,1]},'m:sSup':{'m:e':[1,1],'m:sup':[1,1]},
  'm:sSubSup':{'m:e':[1,1],'m:sub':[1,1],'m:sup':[1,1]},
  'm:rad':{'m:e':[1,1],'m:deg':[1,1]},'m:nary':{'m:e':[1,1],'m:sub':[1,1],'m:sup':[1,1]},
  'm:d':{'m:e':[1,Infinity]},'m:m':{'m:mr':[1,Infinity]},'m:mr':{'m:e':[1,Infinity]},
  'm:eqArr':{'m:e':[1,Infinity]},'m:func':{'m:fName':[1,1],'m:e':[1,1]},
  'm:limLow':{'m:e':[1,1],'m:lim':[1,1]},'m:limUpp':{'m:e':[1,1],'m:lim':[1,1]},
  'm:acc':{'m:e':[1,1]},'m:bar':{'m:e':[1,1]},
};
const containerProperties={
  'm:f':['m:type'],'m:sSub':[],'m:sSup':[],'m:sSubSup':[],
  'm:rad':['m:degHide'],'m:nary':['m:chr','m:limLoc','m:grow','m:subHide','m:supHide'],
  'm:d':['m:begChr','m:endChr','m:sepChr','m:grow','m:shp'],
  'm:m':['m:baseJc','m:cGp','m:cGpRule','m:cSp','m:plcHide','m:rSp','m:rSpRule','m:mcs'],
  'm:mr':[],'m:eqArr':['m:baseJc','m:maxDist','m:objDist','m:rSp','m:rSpRule'],
  'm:func':[],'m:limLow':[],'m:limUpp':[],'m:acc':['m:chr'],'m:bar':['m:pos'],
};
const wordRunProperties=new Set(['rFonts','b','bCs','i','iCs','caps','smallCaps','strike','dstrike','outline','shadow','emboss','imprint',
  'noProof','snapToGrid','vanish','webHidden','color','spacing','w','kern','position','sz','szCs','highlight','u','effect','bdr','shd',
  'fitText','vertAlign','rtl','cs','em','lang','eastAsianLayout','specVanish','oMath'].map(name=>'w:'+name));
const booleanProperties=new Set(['m:degHide','m:subHide','m:supHide','m:grow','m:plcHide','m:maxDist','m:objDist']);
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
      (value.tag==='mover'&&Object.keys(attributes)[0]==='accent'&&attributes.accent==='true'||value.tag==='munder'&&Object.keys(attributes)[0]==='accentunder'&&attributes.accentunder==='true'||value.tag==='mi'&&Object.keys(attributes)[0]==='mathvariant'&&variants.has(attributes.mathvariant));
    return value&&typeof value==='object'&&tags.has(value.tag)&&safeAttributes&&Object.keys(value).every(key=>['tag','children','attributes'].includes(key))&&Array.isArray(value.children)&&value.children.every(item=>visit(item,depth+1));
  }
  return visit(tree,0)&&tree?.tag==='math';
}
export function ommlToMathML(input,{sourceUrl=null}={}) {
  const unsupported=new Set();let count=0;
  const exhausted=()=>{if(++count<=10000)return false;unsupported.add('complexity-limit');return true;};
  const fail=name=>{unsupported.add(name);return node('mtext','\uFFFC');};
  function validateProperties(container,parts) {
    const allowed=new Set([...containerProperties[container],'m:ctrlPr']),seen=new Set();
    for(const part of parts??[])for(const [key,value] of Object.entries(part)){
      if(exhausted())return;
      if(key==='#text'&&!String(value).trim())continue;
      if(key===':@')continue;
      if(!allowed.has(key)||seen.has(key)){unsupported.add('malformed-property:'+container+':'+key);continue;}
      seen.add(key);
      if(key==='m:ctrlPr'){
        const runs=(value??[]).filter(part=>Object.hasOwn(part,'w:rPr'));
        if(runs.length>1)unsupported.add('malformed-control-properties');
        for(const run of value??[])for(const [name,content] of Object.entries(run)){
          if(name==='#text'&&!String(content).trim())continue;
          if(name!=='w:rPr'||run[':@']){unsupported.add('malformed-control-properties');continue;}
          for(const property of content??[])for(const [name,children] of Object.entries(property)){
            if(name===':@'||name==='#text'&&!String(children).trim())continue;
            if(!wordRunProperties.has(name)||!Array.isArray(children)||children.some(child=>Object.entries(child).some(([name,text])=>name!=='#text'||String(text).trim())))unsupported.add('unsupported-control-property:'+name);
          }
        }
      }else if(key==='m:mcs'){
        for(const column of value??[])for(const [name,content] of Object.entries(column)){
          if(name==='#text'&&!String(content).trim())continue;
          if(name!=='m:mc'||column[':@']){unsupported.add('malformed-matrix-columns');continue;}
          const properties=content.filter(part=>Object.hasOwn(part,'m:mcPr'));
          if(properties.length!==1||content.length!==1)unsupported.add('malformed-matrix-columns');
          for(const property of properties)validateScalarProperties(property['m:mcPr'],new Set(['m:count','m:mcJc']));
        }
      }else validateScalarProperties([part],new Set([key]));
    }
  }
  function validateScalarProperties(parts,allowed) {
    const seen=new Set();
    for(const part of parts??[])for(const [key,value] of Object.entries(part)){
      if(exhausted())return;
      if(key==='#text'&&!String(value).trim()||key===':@')continue;
      if(!allowed.has(key)||seen.has(key)||!Array.isArray(value)||value.some(child=>Object.entries(child).some(([name,text])=>name!=='#text'||String(text).trim())))unsupported.add('malformed-scalar-property:'+key);
      seen.add(key);
      const attributes=part[':@'];
      if(attributes&&Object.keys(attributes).some(key=>key!=='@_m:val'))unsupported.add('property-attributes:'+key);
      const setting=attributes?.['@_m:val'];
      if(booleanProperties.has(key)&&setting!==undefined&&!['0','1','false','true','off','on'].includes(String(setting)))unsupported.add('boolean-property:'+key);
    }
  }
  const hidden=(properties,key)=>{const setting=child(properties,key);return !!setting&&(setting[':@']?.['@_m:val']===undefined||['1','true','on'].includes(String(setting[':@']['@_m:val'])));};
  function validateShape(name,parts,attributes) {
    const shape=operandShapes[name],counts=new Map(),property=name+'Pr';
    if(attributes)unsupported.add('container-attributes:'+name);
    for(const part of parts??[])for(const [key,value] of Object.entries(part)){
      if(exhausted())return;
      if(key==='#text'&&!String(value).trim())continue;
      if(!Object.hasOwn(shape,key)&&key!==property){unsupported.add('unexpected-operand:'+name+':'+key);continue;}
      counts.set(key,(counts.get(key)??0)+1);
      if(!Array.isArray(value)||part[':@'])unsupported.add('malformed-operand:'+name+':'+key);
      if(key===property){
        validateProperties(name,value);
      }
    }
    for(const [key,[min,max]] of Object.entries({...shape,[property]:[0,1]})){
      const size=counts.get(key)??0;
      if(size<min||size>max)unsupported.add('operand-cardinality:'+name+':'+key);
    }
  }
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
      if(Object.hasOwn(operandShapes,key))validateShape(key,value,entry[':@']);
      const at=(name)=>sequence(children(value,name),depth+1);
      const properties=(name)=>children(value,name);
      const get=(prop,name)=>val(properties(prop),name);
      if(['m:oMath','m:oMathPara'].includes(key))out.push(...sequence(value,depth+1).children);
      else if(key==='m:r') {
        // Mathematical alphabets change symbol identity; validate before encoding.
        if(entry[':@'])unsupported.add('math-run-attributes');
        const variant=runVariant(value??[]);
        const wordProperties=(value??[]).filter(part=>Object.hasOwn(part,'w:rPr'));
        if(wordProperties.length>1)unsupported.add('duplicate-w:rPr');
        if(wordProperties.length)validateProperties('m:sSub',[{'m:ctrlPr':wordProperties}]);
        for(const part of value??[])for(const [name,runs] of Object.entries(part)) {
          if(++count>10000){out.push(fail('complexity-limit'));break;}
          if([':@','m:rPr','w:rPr'].includes(name)||name==='#text'&&!String(runs).trim())continue;
          if(name!=='m:t'){out.push(fail(name));continue;}
          if(part[':@']&&Object.entries(part[':@']).some(([key,value])=>key!=='@_xml:space'||!['default','preserve'].includes(value)))unsupported.add('math-text-attributes');
          for(const run of runs??[])if(Object.keys(run).some(key=>key!=='#text'))unsupported.add('math-text-content');
          const text=(runs??[]).filter(run=>'#text'in run).map(run=>String(run['#text'])).join('');
          const token=node(/^\d+(?:[.,]\d+)?$/.test(text)?'mn':/^[+\-=<>≤≥≠×÷∑∏∫∈∉±·(),;:|]+$/u.test(text)?'mo':/^[\p{L}]+$/u.test(text)?'mi':'mtext',text);
          token.children=[mathematicalText(text,variant,unsupported)];
          if(variant==='normal'&&token.tag==='mi')token.attributes={mathvariant:'normal'};
          out.push(token);
        }
      }
      else if(key==='m:f') {
        const type=get('m:fPr','m:type')??'bar';
        out.push(type==='bar'?node('mfrac',at('m:num'),at('m:den')):fail('fraction-'+type));
      }
      else if(['m:sSub','m:sSup','m:sSubSup'].includes(key))out.push(node(key==='m:sSub'?'msub':key==='m:sSup'?'msup':'msubsup',at('m:e'),...(key!=='m:sSup'?[at('m:sub')]:[]),...(key!=='m:sSub'?[at('m:sup')]:[])));
      else if(key==='m:rad') {
        const degreeHidden=hidden(properties('m:radPr'),'m:degHide'),degree=at('m:deg');
        if(degreeHidden&&degree.children.length)unsupported.add('hidden-operand:m:rad:m:deg');
        out.push(degreeHidden||!degree.children.length?node('msqrt',at('m:e')):node('mroot',at('m:e'),degree));
      }
      else if(key==='m:nary') {
        const character=get('m:naryPr','m:chr')??'∫',base=node('mo',character),sub=at('m:sub'),sup=at('m:sup');
        const lower=!hidden(properties('m:naryPr'),'m:subHide')&&sub.children.length;
        const upper=!hidden(properties('m:naryPr'),'m:supHide')&&sup.children.length;
        if(!lower&&sub.children.length||!upper&&sup.children.length)unsupported.add('hidden-operand:m:nary');
        const location=get('m:naryPr','m:limLoc')??'subSup';
        if(!['subSup','undOvr'].includes(location))unsupported.add('nary-limit-location');
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
          validateShape('m:mr',part['m:mr'],part[':@']);
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
      else if(key==='m:oMathParaPr')validateScalarProperties(value,new Set(['m:jc']));
      else out.push(fail(key));

    }
    return node('mrow',out);
  }
  const math=node('math',sequence(Array.isArray(input)?input:[input]));
  if(!JSON.stringify(math).includes('"children":["'))unsupported.add('empty-math');
  if(!isSafeMathML(math))unsupported.add('unsafe-or-oversize-math');
  return {kind:'math',status:unsupported.size?'unresolved':'converted',complete:!unsupported.size,math:unsupported.size?null:math,
    replacement:'\uFFFC',sourceUrl:officialDocumentUrl(sourceUrl),unsupported:[...unsupported].sort()};
}
