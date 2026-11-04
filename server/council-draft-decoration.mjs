import {createHash} from 'node:crypto';
// Geometry is measured in native PDF points; matrix coefficients need tighter
// comparison because they multiply the path coordinates. No visual matching.
export const DECORATION_TOLERANCE=Object.freeze({points:0.001,matrix:0.000001});
const plain=v=>ArrayBuffer.isView(v)?Array.from(v,plain):Array.isArray(v)?v.map(plain):v;
export const decorationShape=p=>({operation:p.operation,args:plain(p.args),matrix:p.matrix});
function equal(a,b,tolerance){if(typeof a==='number'&&typeof b==='number')return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance;if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>equal(v,b[i],tolerance));return a===b;}
const same=(a,b)=>a.operation===b.operation&&equal(plain(a.args),plain(b.args),DECORATION_TOLERANCE.points)&&equal(a.matrix,b.matrix,DECORATION_TOLERANCE.matrix);
const eligible=p=>p.operation==='constructPath'&&p.marked.every(mark=>mark[0]==='Artifact');
export function repeatedPageDecoration(pages){
 if(pages.length<2)return {hash:null,paths:[],pages:pages.map(p=>({page:p.page,remaining:p.paint}))};
 // Preserve multiplicity: repeated occurrences must exist on every page too.
 const candidates=pages[0].paint.filter(eligible),available=pages.map(p=>p.paint.filter(eligible).slice()),paths=[];
 for(const candidate of candidates){const indices=available.map(p=>p.findIndex(v=>same(candidate,v)));if(indices.some(i=>i<0))continue;paths.push(decorationShape(candidate));available.forEach((p,i)=>p.splice(indices[i],1));}
 const hash=paths.length?createHash('sha256').update(JSON.stringify(paths)).digest('hex'):null;
 return {hash,tolerance:DECORATION_TOLERANCE,paths,pages:pages.map(p=>{const remaining=p.paint.slice();for(const path of paths){const index=remaining.findIndex(v=>eligible(v)&&same(path,v));if(index<0)throw Error('council-decoration-proof-mismatch');remaining.splice(index,1);}return {page:p.page,remaining};})};
}
