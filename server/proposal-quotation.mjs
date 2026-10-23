// Track the observed replacement delimiter across paragraphs. Inner term quotes
// never close the containing replacement. Apostrophes inside words are text.
const starts=new Set(['‘','‚','“','„','«','"',"'",'”']);
const ends=new Set(['’','”','»','"',"'",'“']);
const word=/[\p{L}\p{N}]/u;
function closingFor(mark,language){
  if(mark==='‘')return ['’'];
  if(mark==='‚')return ['‘'];
  if(mark==='“')return ['”'];
  if(mark==='„')return ['pl','ro'].includes(language)?['”']:['“'];
  if(mark==='«')return ['»'];
  return [mark];
}
export function quotationClosed(text,state,language){
  for(let i=0;i<text.length;i++){
    const mark=text[i];
    if(!starts.has(mark)&&!ends.has(mark))continue;
    if(/[‘’"']/.test(mark)&&word.test(text[i-1]??'')&&word.test(text[i+1]??''))continue;
    const top=state.marks.at(-1);
    if(top?.closing.includes(mark)){
      state.marks.pop();
      if(top.outer)return true;
    }else if(state.implicit&&!state.marks.length&&ends.has(mark)&&/^[.;,:]?\s*$/.test(text.slice(i+1))){
      return true;
    }else if(starts.has(mark)){
      state.marks.push({closing:closingFor(mark,language),outer:!state.implicit&&!state.marks.length});
    }
  }
  return false;
}
