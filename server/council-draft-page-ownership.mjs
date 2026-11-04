// Ownership proofs for content formatting, separate from repeated decoration.
// Unclassified paint and annotations stay on the page and keep it incomplete.
const tolerance=0.02;
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance;
function rectangle(paint){
 if(paint.operation!=='constructPath'||![22,23].includes(paint.args?.[0])||paint.matrix?.length!==6||!paint.matrix.every(Number.isFinite)||!paint.matrix.slice(0,4).every((v,i)=>Math.abs(v-[1,0,0,1][i])<=1e-6))return null;
 const paths=paint.args[1];if(paths?.length!==1)return null;
 const v=paths[0];if(v.length!==13||v[0]!==0||v[3]!==1||v[6]!==1||v[9]!==1||v[12]!==4)return null;
 const points=[[v[1],v[2]],[v[4],v[5]],[v[7],v[8]],[v[10],v[11]]];
 if(points.some((p,i)=>{const next=points[(i+1)%4];return near(p[0],next[0])===near(p[1],next[1]);})||near(points[0][0],points[2][0])||near(points[0][1],points[2][1]))return null;
 const x=Math.min(...points.map(p=>p[0])),y=Math.min(...points.map(p=>p[1])),x2=Math.max(...points.map(p=>p[0])),y2=Math.max(...points.map(p=>p[1]));
 if(x2<=x||y2<=y||y2-y>1)return null;
 return [x+paint.matrix[4],y+paint.matrix[5],x2+paint.matrix[4],y2+paint.matrix[5]];
}
const inside=(small,large)=>small.every((v,i)=>i<2?v>=large[i]-tolerance:v<=large[i]+tolerance);
function bounds(item){
 const t=item.transform;if(!t||Math.abs(t[1])>1e-6||Math.abs(t[2])>1e-6||t[0]<=0||t[3]<=0||!Number.isFinite(item.ascent)||!Number.isFinite(item.descent))return null;
 return [t[4],t[5]+item.height*item.descent,t[4]+item.width,t[5]+item.height*item.ascent];
}
export function ownCouncilPageContent(pages,{paragraphs,noteBlocks,entries}){
 const links=[],annotationObjects=new Set();
 for(const page of pages){
  const ownedPaint=[],ownedAnnotations=[],used=new Set();
  for(const annotation of page.annotations){
   if(annotation.subtype!=='Link'||!annotation.nativeSafe||!annotation.url||!/^https?:\/\//u.test(annotation.url))continue;
   const owners=paragraphs.filter(p=>p.content.some(c=>c.object===annotation.ref));if(owners.length!==1)continue;
   const owner=owners[0],items=entries(owner,page.page),urls=items.filter(i=>i.str.trim()===annotation.url),item=urls[0],box=item&&bounds(item);
   if(urls.length!==1||!box||!inside(box,annotation.rect))continue;
   const underlines=page.paint.filter(p=>{
    // The text advance can include a final glyph's side bearing. Bound that
    // right-edge difference to 0.75 point; it cannot conceal another glyph.
    const r=rectangle(p);if(!r||!inside(r,annotation.rect)||!near(r[0],box[0])||Math.abs(r[2]-box[2])>0.75||r[3]>item.transform[5]||item.transform[5]-r[3]>item.height*.25)return false;
    const mark=p.marked.at(-1);return mark?.[0]==='P'&&owner.content.some(c=>c.page===page.page&&c.mcid===mark[1]);
   });
   if(underlines.length>1)continue;
   for(const paint of underlines){used.add(paint);ownedPaint.push({kind:'link-underline',owner:owner.ref,annotation:annotation.ref,paint});}
   const proof={kind:'printed-link',owner:owner.ref,annotation:annotation.ref,url:annotation.url,rect:annotation.rect,textBounds:box,baseline:item.transform[5],appearance:'empty'};
   ownedAnnotations.push(proof);annotationObjects.add(annotation.ref);links.push(proof);
  }
  // A separator belongs to a native Note block only when it is the sole thin
  // artifact rectangle between that block and the preceding body text.
  for(const note of noteBlocks){
   const items=entries(note,page.page).filter(i=>i.str.trim()),boxes=items.map(bounds);if(!items.length||boxes.some(b=>!b))continue;
   const left=Math.min(...boxes.map(b=>b[0])),right=Math.max(...boxes.map(b=>b[2])),top=Math.max(...boxes.map(b=>b[3])),height=Math.max(...items.map(i=>i.height));
   const body=paragraphs.filter(p=>!p.parents.some(a=>a.role==='/Note')).flatMap(p=>entries(p,page.page)).filter(i=>i.str.trim());
   const bottom=Math.min(...body.map(i=>bounds(i)?.[1]??-Infinity));
   const candidates=page.paint.filter(p=>{
    const r=rectangle(p);return r&&!used.has(p)&&p.marked.every(m=>m[0]==='Artifact')&&near(r[0],left)&&r[2]<=right+tolerance&&r[2]-r[0]>=height*3&&r[1]>top&&r[1]-top<=height*3&&r[3]<bottom;
   });
   if(candidates.length!==1)continue;
   used.add(candidates[0]);ownedPaint.push({kind:'note-separator',owner:note.ref,paint:candidates[0]});
  }
  page.ownedPaint=ownedPaint;page.ownedAnnotations=ownedAnnotations;
  page.paint=page.paint.filter(p=>!used.has(p));page.annotations=page.annotations.filter(a=>!ownedAnnotations.some(p=>p.annotation===a.ref));
 }
 return {links,annotationObjects};
}
