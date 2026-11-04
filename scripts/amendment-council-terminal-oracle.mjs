// Independent Poppler geometry for a terminal numbered paragraph. No producer
// or parser imports. Earlier repeated lower labels never renumber the anchor.
const key=s=>String(s??'').normalize('NFC').replace(/\s/gu,'');
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=.5;
const literal=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim();
export function nativeTerminalParagraphFrame({point,section,siblings,nextInstruction,article,number,words}) {
 if(!Array.isArray(words)||!words.length||!Array.isArray(siblings)||siblings.length<3||!/^\d+\)\s+[^«»“”]+:$/u.test(nextInstruction??''))return false;
 const numbers=siblings.map(s=>Number(s.value));
 if(siblings.some((s,i)=>!/^\d+$/u.test(s.value)||!Number.isSafeInteger(numbers[i])||numbers[i]<1||(!i?numbers[i]!==1:numbers[i]<numbers[i-1]||numbers[i]>numbers[i-1]+1)||(i===siblings.length-1?numbers[i]!==number:numbers[i]>=number)))return false;
 if(siblings.at(-1).blocks?.length!==1)return false;
 const ordered=[];
 for(const page of [...new Set(words.map(w=>w.page))].sort((a,b)=>a-b)){
  const lines=[];for(const word of words.filter(w=>w.page===page&&!w.reference).sort((a,b)=>a.top-b.top||a.x-b.x)){
   if(![word.x,word.right,word.top,word.bottom].every(Number.isFinite)||word.bottom<=word.top)return false;
   const line=lines.at(-1);if(line&&near(line[0].top,word.top))line.push(word);else lines.push([word]);
  }for(const line of lines)ordered.push(...line.sort((a,b)=>a.x-b.x));
 }
 const joined=ordered.map(w=>key(w.text)).join(''),needle=key(point),sectionKey=key(section),at=joined.indexOf(needle),sectionAt=needle.indexOf(sectionKey),starts=[];let position=0;
 for(const w of ordered){starts.push(position);position+=key(w.text).length;}starts.push(position);
 if(!needle||at<0||joined.lastIndexOf(needle)!==at||sectionAt<0||needle.lastIndexOf(sectionKey)!==sectionAt)return false;
 const range=(offset,text)=>{const a=starts.indexOf(offset),b=starts.indexOf(offset+key(text).length);return a<0||b<=a||joined.slice(offset,offset+key(text).length)!==key(text)?null:ordered.slice(a,b);};
 const units=siblings.map(s=>range(at+sectionAt+s.offset,s.text));if(units.some(u=>!u?.length))return false;
 const first=starts.indexOf(at),firstNumber=starts.indexOf(at+sectionAt+siblings[0].offset),headStart=starts.indexOf(at+sectionAt);
 if(first<0||firstNumber<0||headStart<0)return false;
 const outer=ordered[first],outerBody=ordered[first+1],outerNumber=/^(\d+)\)$/u.exec(outer.text);
 if(!outerNumber||!outerBody||outer.page!==outerBody.page||!near(outer.top,outerBody.top)||outerBody.x-outer.x<10||outerBody.x-outer.x>100)return false;
 const group=ws=>{const lines=[];for(const w of ws){const line=lines.at(-1);if(line&&w.page===line[0].page&&near(line[0].top,w.top))line.push(w);else lines.push([w]);}return lines;};
 const heading=group(ordered.slice(headStart,firstNumber)),lineText=line=>literal(line.map(w=>w.text).join(' ')),center=line=>(line[0].x+line.at(-1).right)/2;
 if(heading.length!==2||!new RegExp('^[„“‘«»"]?Článek '+article+'$','u').test(lineText(heading[0]))||!/^\p{L}[\p{L}\p{M}\s-]+$/u.test(lineText(heading[1]))||Math.abs(center(heading[0])-center(heading[1]))>1||heading.some(line=>line.some(w=>w.page!==units[0][0].page))||heading[1][0].top>=units[0][0].top)return false;
 const labelX=units[0][0].x,bodyX=units[0][1]?.x;
 if(!near(labelX,outerBody.x)||!Number.isFinite(bodyX)||bodyX-labelX<10||bodyX-labelX>100)return false;
 for(const [i,unit] of units.entries())if(unit[0].text!==siblings[i].value+'.'||!unit[1]||unit[0].page!==unit[1].page||!near(unit[0].top,unit[1].top)||!near(unit[0].x,labelX)||!near(unit[1].x,bodyX))return false;
 const anchor=units.at(-1),closing=group(anchor),next=range(at+needle.length,nextInstruction);
 if(!next?.length||new Set([...anchor,...next].map(w=>w.page)).size!==1||closing.slice(1).some(line=>!near(line[0].x,bodyX)))return false;
 const boundary=group(next);
 if(boundary[0][0].text!==String(Number(outerNumber[1])+1)+')'||!boundary[0][1]||!near(boundary[0][0].x,outer.x)||!near(boundary[0][1].x,outerBody.x)||boundary.slice(1).some(line=>!near(line[0].x,outerBody.x))||boundary[0][0].top<=closing.at(-1)[0].top+.5)return false;
 return true;
}
