const clean=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim();
const valid=lines=>Array.isArray(lines)&&lines.length&&lines.every(l=>Number.isSafeInteger(l.page)&&Number.isFinite(l.y)&&Array.isArray(l.items)&&l.items.length&&l.items.every(i=>typeof i.text==='string'&&Number.isFinite(i.x)&&Number.isFinite(i.right)&&i.right>=i.x));
export function councilPdfNumberFrame(lines,text) {
 if(!valid(lines))return null;
 const m=/^([1-9]\d*)([.)])\s+\S/u.exec(text),first=lines?.[0]?.items;
 if(!m||!first||first[0]?.text!==m[1]+m[2]||!first[1]||!Number.isFinite(first[1].x)||first[1].x-first[0].x<10||first[1].x-first[0].x>100||lines.some(l=>l.page!==lines[0].page)||lines.slice(1).some(l=>Math.abs(l.items[0].x-first[1].x)>.5))return null;
 return {number:m[1],delimiter:m[2],page:lines[0].page,x:first[0].x,bodyX:first[1].x,y:lines[0].y,endY:lines.at(-1).y,basis:'native-number-lines',tolerance:.5};
}
export function councilPdfArticleFrame(lines) {
 if(!valid(lines)||lines.length!==2||lines[0].page!==lines[1].page)return null;
 const texts=lines.map(l=>clean(l.items.map(i=>i.text).join(' '))),m=/^[„“‘«»"]?Článek ([1-9]\d*)$/u.exec(texts[0]),centers=lines.map(l=>(l.items[0].x+l.items.at(-1).right)/2);
 if(!m||!/^\p{L}[\p{L}\p{M}\s-]+$/u.test(texts[1])||!centers.every(Number.isFinite)||Math.abs(centers[0]-centers[1])>1)return null;
 return {number:m[1],page:lines[0].page,y:lines[0].y,endY:lines[1].y,basis:'native-centered-article',tolerance:1};
}
