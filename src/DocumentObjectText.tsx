import {useUiI18n} from './UiI18nReact';
import type {ReactNode} from 'react';
import {DocumentImage,type DocumentImageAssets,type DocumentImageReference} from './DocumentImage';
import {ReferenceText} from './References';
import type {NoteAnchor,DocumentLink} from './explorerTypes';
import type {FormatMark} from './DocumentFormatting';
type InlineObject={paragraph:number;offset:number;kind:string;status:string;image?:DocumentImageReference};
// Keep source offsets when replacing an unresolved inline object with a source link.
// The surrounding text, references and note anchors remain in their original positions.
export function DocumentObjectText({renderText,assets,text,paragraph,from=0,to=text.length,final=true,objects,logo,sourceUrl,anchors,links,marks,notePrefix}:{text:string;paragraph:number;from?:number;to?:number;final?:boolean;objects:InlineObject[];assets?:DocumentImageAssets;logo?:{paragraph:number;offset:number}|null;sourceUrl:string|null;anchors:NoteAnchor[];links:DocumentLink[];marks:FormatMark[];notePrefix:string;renderText?:(from:number,to:number,final:boolean)=>ReactNode}) {
  const ui=useUiI18n();
  const unresolved=new Map(objects.filter(object=>object.paragraph===paragraph&&object.status==='unresolved'&&Number.isInteger(object.offset)&&object.offset>=from&&object.offset<to&&text[object.offset]==='\uFFFC').map(object=>[object.offset,object]));
  const nodes:ReactNode[]=[];let start=from;
  // A slice ending at a replaced object owns the note anchored there; the label slice before a hanging tab does not.
  const slice=(sliceFrom:number,sliceTo:number,ownsEnd:boolean)=>{
    if(renderText)return <span key={'text-'+sliceFrom}>{renderText(sliceFrom,sliceTo,ownsEnd)}</span>;
    const spans=links.map(link=>({...link,start:Math.max(link.start,sliceFrom),end:Math.min(link.end,sliceTo)})).filter(link=>link.end>link.start);
    return <ReferenceText key={'text-'+sliceFrom} text={text.slice(sliceFrom,sliceTo)} start={sliceFrom} final={ownsEnd} anchors={anchors} links={spans} marks={marks} notePrefix={notePrefix}/>;
  };
  if(!unresolved.size)return slice(from,to,final);
  for(const [offset,object] of [...unresolved].sort(([a],[b])=>a-b)) {
    nodes.push(slice(start,offset,true));
    if(logo?.paragraph===paragraph&&logo.offset===offset){start=offset+1;continue;}
    const label=object.kind==='drawing'?ui.t("document.object.imageOriginal"):ui.t("document.object.seeOriginal");
    nodes.push(object.image?<DocumentImage key={'object-'+offset} image={object.image} assets={assets}/>:sourceUrl?<a key={'object-'+offset} className="document-context-object" lang={ui.language} href={sourceUrl} target="_blank" rel="noreferrer">{label}</a>:<span key={'object-'+offset} className="document-context-object" lang={ui.language}>{object.kind==='drawing'?ui.t("batch6.documentcontextreader.image.unavailable.87"):ui.t("batch6.documentcontextreader.content.unavailable.87")}</span>);
    start=offset+1;
  }
  nodes.push(slice(start,to,final));
  return <>{nodes}</>;
}

