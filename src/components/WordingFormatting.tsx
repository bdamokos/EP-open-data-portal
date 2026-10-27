import {Fragment,type ReactNode} from 'react';
import type {TextDiffSegment} from '../textDiff.mjs';

/** UTF-16 offsets into the exact, unchanged wording column. */
export type WordingFormat={start:number;end:number;kind:'superscript'|'subscript'};
function firstMark(marks:WordingFormat[],offset:number) {
  let low=0,high=marks.length;
  while(low<high){const middle=(low+high)>>>1;if(marks[middle].end<=offset)low=middle+1;else high=middle;}
  return low;
}
function kindAt(marks:WordingFormat[],offset:number) {
  const mark=marks[firstMark(marks,offset)];return mark&&mark.start<=offset?mark.kind:undefined;
}
function boundaries(marks:WordingFormat[],start:number,end:number) {
  const points:number[]=[];
  for(let index=firstMark(marks,start);index<marks.length&&marks[index].start<end;index++) {
    const mark=marks[index];if(mark.start>start)points.push(mark.start);if(mark.end<end)points.push(mark.end);
  }
  return points;
}
export function FormattedWording({text,formatting=[],start=0,renderText}:{text:string;formatting?:WordingFormat[];start?:number;renderText?:(text:string,start:number)=>ReactNode}) {
  const end=start+text.length;
  const points=[...new Set([start,end,...boundaries(formatting,start,end)])].sort((a,b)=>a-b);
  return <>{points.slice(0,-1).map((from,index)=>{
    const value=text.slice(from-start,points[index+1]-start),content=renderText?renderText(value,from):value,kind=kindAt(formatting,from);
    return kind==='superscript'?<sup key={from}>{content}</sup>:kind==='subscript'?<sub key={from}>{content}</sub>:<Fragment key={from}>{content}</Fragment>;
  })}</>;
}
// Text alignment remains the bounded plain-text diff. On equal passages only,
// compare vertical presentation and show differing spans as deletion/insertion.
export function formattingDiff(segments:TextDiffSegment[],original:WordingFormat[],proposed:WordingFormat[]):TextDiffSegment[] {
  let before=0,after=0;const output:TextDiffSegment[]=[];
  for(const segment of segments) {
    if(segment.type!=='equal')output.push(segment);
    else {
      const length=segment.text.length;
      const points=[...new Set([0,length,...boundaries(original,before,before+length).map(point=>point-before),...boundaries(proposed,after,after+length).map(point=>point-after)].filter(point=>point>=0&&point<=length))].sort((a,b)=>a-b);
      for(let index=0;index<points.length-1;index++) {
        const start=points[index],text=segment.text.slice(start,points[index+1]);
        if(kindAt(original,before+start)===kindAt(proposed,after+start))output.push({type:'equal',text});
        else output.push({type:'delete',text},{type:'insert',text});
      }
    }
    if(segment.type!=='insert')before+=segment.text.length;
    if(segment.type!=='delete')after+=segment.text.length;
  }
  return output;
}
