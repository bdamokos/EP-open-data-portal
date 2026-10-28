// Track the observed replacement delimiter across paragraphs. Inner term quotes
// never close the containing replacement. Apostrophes inside words are text.
const starts=new Set(['‘','‚','“','„','«','"',"'",'”']);
const ends=new Set(['’','”','»','"',"'",'“']);
const word=/[\p{L}\p{N}]/u;
function closingFor(mark,language){
  if(mark==='»')return ['«'];
  if(mark===',')return ['‘'];
  if(mark==='‘')return ['’'];
  if(mark==='‚')return ['‘'];
  if(mark==='“')return ['”'];
  if(mark==='„')return ['pl','ro','hr','hu'].includes(language)?['”']:['“'];
  if(mark==='«')return ['»'];
  return [mark];
}
function uncertain(state,tail){state.ambiguous=true;state.ambiguities=(state.ambiguities??0)+1;state.ambiguousTail=tail;}
export function quotationClosed(text,state,language){
  const tailStart=text.search(/[\s.;,:··]*$/u);
  for(let i=0;i<text.length;i++){
    const mark=text[i];
    const lowComma=language==='sl'&&mark===','&&!word.test(text[i-1]??'')&&word.test(text[i+1]??'');
    if(!starts.has(mark)&&!ends.has(mark)&&!lowComma)continue;
    if(/[‘’"']/.test(mark)&&word.test(text[i-1]??'')&&word.test(text[i+1]??''))continue;
    if((mark==='’'||mark==="'")&&/[sS]/u.test(text[i-1]??'')&&/^\s+\p{L}/u.test(text.slice(i+1)))continue;
    const top=state.marks.at(-1),atEnd=i+1>=tailStart;
    const canOpen=lowComma||mark==='»'&&language==='hu'||mark==='’'&&language==='fi'||starts.has(mark)&&
      (mark!=='”'||['sv','fi'].includes(language))&&
      (!/[‘"']/u.test(mark)||!word.test(text[i-1]??''));
    // Some published replacements repeat their opening mark at the start of
    // the first numbered paragraph after an article heading (COM(2024)183).
    if(top?.outer&&state.marks.length===1&&top.open===mark&&i===text.search(/\S/u)&&/^\(?\d+[.)]/u.test(text.slice(i+1)))continue;
    // Symmetric quotes also delimit terms inside a replacement. Opening a
    // term is distinguished by its left boundary, rather than closing scope.
    if(top?.outer&&top.open===mark&&!atEnd&&canOpen&&word.test(text[i+1]??'')&&!word.test(text[i-1]??'')){
      state.marks.push({open:mark,closing:closingFor(mark,language),outer:false});continue;
    }
    if(top?.closing.includes(mark)){
      // A plural possessive followed by its noun is ordinary text, including
      // inside a nested term quotation. A trailing apostrophe is ambiguous:
      // punctuation after it alone cannot establish a replacement boundary.
      const apostrophe=mark==='’'||mark==="'";
      if(top.outer&&(!atEnd||apostrophe&&!/[.!?;:][)\]}]*$/u.test(text.slice(0,i)))){
        if(apostrophe)uncertain(state,atEnd);continue;
      }
      state.marks.pop();
      if(top.outer)return true;
    }else if(state.implicit&&!state.marks.length&&ends.has(mark)&&atEnd){
      if((mark==='’'||mark==="'")&&!/[.!?;:][)\]}]*$/u.test(text.slice(0,i))){uncertain(state,atEnd);continue;}
      return true;
    }else if(canOpen){
      state.marks.push({open:mark,closing:closingFor(mark,language),outer:!state.implicit&&!state.marks.length});
    }
  }
  return false;
}
