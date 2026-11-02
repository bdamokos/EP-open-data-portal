const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const reference=value=>typeof value==='string'?value:typeof value?.id==='string'?value.id:null;
// Longest titles first so "Executive Vice-President" is not read as "Vice-President".
const titles=['High Representative/Vice-President','Executive Vice-President','Vice-President','President','Commissioner','Mrs','Mr','Ms'];

// The Open Data API names only the answering institution. Parliament's
// published answer header names the office holder who answered for it.
export function answerInstitution(answer) {
  const ids=[...array(answer?.creator),...array(answer?.workHadParticipation).filter(p=>reference(p?.participation_role)==='def/ep-roles/AUTHOR').flatMap(p=>array(p.had_participant_organization))].map(reference).filter(id=>/^org\/[A-Za-z0-9_-]{1,100}$/.test(id||''));
  return [...new Set(ids)].sort()[0]||null;
}

// Reads the English header line "Answer given by <title> <name> on behalf of <institution>".
export function answerHeaderSignatory(header) {
  if(typeof header!=='string')return null;
  const match=/(?:^|\n)\s*(?:Joint\s+)?answer\s+given\s+by\s+(?:the\s+)?([^\n]+?)\s*\n\s*on\s+behalf\s+of\s+(?:the\s+)?([^\n(]+?)\s*(?:\n|$)/i.exec(header);
  if(!match)return null;
  const statement=match[1].replace(/\s+/g,' ').trim(),onBehalfOf=match[2].replace(/\s+/g,' ').trim();
  if(!statement||statement.length>120||!onBehalfOf||onBehalfOf.length>120)return null;
  const title=titles.find(value=>statement.toLowerCase().startsWith(value.toLowerCase()+' '))||null;
  const name=(title?statement.slice(title.length):statement).trim();
  if(!name)return null;
  return {statement,title,name,onBehalfOf};
}

export function questionAnswerer(answer,text) {
  const institution=answerInstitution(answer);
  const signatory=text?.textLanguage==='en'?answerHeaderSignatory(text.paragraphs?.[0]):null;
  if(!institution&&!signatory)return null;
  return {institution,signatory:signatory&&{...signatory,language:'en',sourceUrl:text.sourceUrl||null}};
}
