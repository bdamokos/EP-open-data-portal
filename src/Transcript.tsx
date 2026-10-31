import {Fragment} from 'react';
import {speechHighlightParts} from './speechHighlight.mjs';

type Run={text:string;italic:boolean};
export type TranscriptParagraph={text:string;runs:Run[]};

// Read text and the source's italic marker only; never insert source HTML or attributes.
export function transcriptParagraphs(xml:string|null):{paragraphs:TranscriptParagraph[];error:boolean} {
  if(!xml)return {paragraphs:[],error:false};
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror'))return {paragraphs:[],error:true};
  const paragraphs=[...doc.getElementsByTagNameNS('*','p')].map(paragraph=>{
    const runs:Run[]=[];
    const append=(text:string,italic:boolean)=>{if(text)runs.push({text,italic});};
    const visit=(node:Node,italic=false)=>{
      if(node.nodeType===3||node.nodeType===4){append(node.textContent||'',italic);return;}
      if(node.nodeType!==1)return;
      const element=node as Element;
      if(element.localName==='time') {
        // Some word-timed fragments omit the separators between word elements.
        const previous=runs.at(-1)?.text;
        if(previous&&!/\s$/.test(previous))append(' ',italic);
      }
      const marked=italic||element.localName==='inline'&&element.getAttribute('name')==='i';
      for(const child of element.childNodes)visit(child,marked);
    };
    visit(paragraph);
    const raw=runs.map(run=>run.text).join('');
    const removed=[...raw.matchAll(/^\s+|\s+$|\s+(?=[,.;:!?])/g)].map(match=>({start:match.index,end:match.index+match[0].length}));
    const normalized:Run[]=[];let offset=0;
    for(const run of runs) {
      const end=offset+run.text.length;let cursor=offset;
      for(const range of removed) {
        if(range.end<=cursor||range.start>=end)continue;
        if(range.start>cursor)normalized.push({text:raw.slice(cursor,range.start),italic:run.italic});
        cursor=Math.min(end,range.end);
      }
      if(cursor<end)normalized.push({text:raw.slice(cursor,end),italic:run.italic});
      offset=end;
    }
    const merged:Run[]=[];
    for(const run of normalized) {
      const previous=merged.at(-1);
      if(previous?.italic===run.italic)previous.text+=run.text;else merged.push({...run});
    }
    return {text:merged.map(run=>run.text).join(''),runs:merged};
  }).filter(paragraph=>paragraph.text);
  return {paragraphs,error:false};
}

export function TranscriptText({paragraph,highlight}:{paragraph:TranscriptParagraph;highlight?:string|null}) {
  let offset=0;
  const matches=speechHighlightParts(paragraph.text,highlight).flatMap(part=>{
    const start=offset;offset+=part.text.length;
    return part.match ? ([{start,end:offset}]) : ([]);
  });
  let cursor=0;
  return <>{paragraph.runs.map((run,index)=>{
    const start=cursor,end=start+run.text.length;cursor=end;
    const content=[];let at=start;
    for(const match of matches) {
      if(match.end<=at||match.start>=end)continue;
      const from=Math.max(at,match.start),to=Math.min(end,match.end);
      if(from>at)content.push(paragraph.text.slice(at,from));
      content.push(<mark key={from}>{paragraph.text.slice(from,to)}</mark>);at=to;
    }
    if(at<end)content.push(paragraph.text.slice(at,end));
    return run.italic ? <i key={index}>{content}</i> : <Fragment key={index}>{content}</Fragment>;
  })}</>;
}
