// Slice only server-bound comparison cuts. Keep body/note formatting in the
// published columns' coordinate systems; notes never become provision text.
export function proposalNoteComparison(wording,scope) {
  if(!['word-footnotes','pdf-footnotes'].includes(scope?.kind))return null;
  const slice=(text,formatting,end)=>{
    if(typeof text!=='string'||!Number.isSafeInteger(end)||end<0||end>text.length)return null;
    const separator=end===text.length?null:/^\n_{3,}[ \t]*(?:\n|$)/u.exec(text.slice(end));
    if(end!==text.length&&!separator)return null;
    const notesStart=end+(separator?.[0].length||0),range=(start,end)=>(formatting||[]).filter(mark=>mark.end>start&&mark.start<end).map(mark=>({...mark,start:Math.max(mark.start,start)-start,end:Math.min(mark.end,end)-start}));
    return {body:text.slice(0,end),notes:text.slice(notesStart),bodyFormatting:range(0,end),notesFormatting:range(notesStart,text.length)};
  };
  const original=slice(wording.originalText,wording.originalFormatting,scope.originalBodyEnd),proposed=slice(wording.proposedText,wording.proposedFormatting,scope.proposedBodyEnd);
  return original&&proposed&&(original.notes||proposed.notes)?{original,proposed}:null;
}
