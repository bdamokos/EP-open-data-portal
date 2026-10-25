const clean=value=>value.replace(/\s+/gu,' ').trim();

// The main report's comparison section precedes opinions, whose numbering
// restarts at one. An exact list range must cover this complete sequence.
export function reportAmendmentHeading(text,documentId,amendmentId,listId) {
  if(text?.textLanguage!=='en'||text.structureStatus!=='extracted'||!/^A-10-\d{4}-\d{4,6}$/.test(documentId))return null;
  const number=amendmentId?.startsWith(documentId+'-AM-')?amendmentId.slice(documentId.length+4):'';
  const range=listId?.startsWith(documentId+'-AM-')?listId.slice(documentId.length+4).match(/^(\d+)-(\d+)$/):null;
  if(!/^\d+$/.test(number)||!range||Number(range[1])!==1||Number(number)<1||Number(number)>Number(range[2]))return null;
  const paragraphs=text.paragraphs,sources=text.paragraphSources;
  if(!Array.isArray(paragraphs)||paragraphs.length>20000||!Array.isArray(sources)||sources.length!==paragraphs.length)return null;
  const body=index=>sources[index]?.container==='body'&&sources[index]?.complete===true;
  const headings=paragraphs.map(clean),starts=[];
  for(let i=0;i<headings.length;i++)if(body(i)&&/^(?:DRAFT )?EUROPEAN PARLIAMENT LEGISLATIVE RESOLUTION$/i.test(headings[i]))starts.push(i);
  if(starts.length!==1)return null;
  const start=starts[0],end=headings.findIndex((value,index)=>index>start&&body(index)&&/^(?:EXPLANATORY STATEMENT|OPINION OF THE COMMITTEE(?: .*)?|PROCEDURE(?: [–—-].*)?|MINORITY POSITION|INFORMATION ON ADOPTION(?: .*)?)$/i.test(value));
  if(end<0)return null;
  let expected=1,matched=null;
  for(let index=start+1;index<end;index++) {
    const heading=headings[index].match(/^Amendment (\d+)$/i);
    if(!heading)continue;
    if(!body(index)||Number(heading[1])!==expected++)return null;
    if(Number(heading[1])===Number(number))matched=index;
  }
  return expected-1===Number(range[2])?matched:null;
}
