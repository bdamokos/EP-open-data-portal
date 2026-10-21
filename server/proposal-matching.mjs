// An alignment key, never replacement source text. No case folding, stemming,
// accent removal, transliteration, word deletion or edit-distance matching.
export function normaliseForMatching(value,{stripNumbering=true,stripTerminators=true}={}) {
  let text=String(value??'').normalize('NFC').replace(/\u00ad/g,'').replace(/[\u00a0\u202f]/g,' ')
    .replace(/[‘’‚‛ʻʼ]/g,"'").replace(/[“”„‟«»]/g,'"').replace(/[‐‑‒–—]/g,'-');
  text=text.split(/\r?\n/).map(line=>{
    line=line.trim();
    // Quotes that enclose an entire replacement are compared as a boundary,
    // independently of whether its full stop/semicolon precedes the quote.
    const opening=/^['"]/.test(line);if(opening)line=line.slice(1).trimStart();
    if(stripNumbering)line=line.replace(/^(?:(?:\(\d+(?:\.\d+)*\s*[\p{L}]*\)|\([\p{L}]{1,5}\)|[\p{L}]{1,5}\))\s*|\d+(?:\.\d+)*\s*[\p{L}]{0,3}[.)](?:\s+|(?=\p{Lu}))|[•–—-]\s+)/u,'');
    if(stripTerminators)line=line.replace(/[.;'"\s]+$/u,'');
    else if(opening)line=line.replace(/['"]$/,'');
    return line.replace(/\s+/g,' ').trim();
  }).join(' ').replace(/\s+/g,' ').trim();
  return text;
}
