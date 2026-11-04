import test from 'node:test';
import assert from 'node:assert/strict';
import {ownCouncilPageContent} from './council-draft-page-ownership.mjs';
const path=(x,y,width,marked=[])=>({operation:'constructPath',args:[23,[[0,x,y,1,x+width,y,1,x+width,y+.5,1,x,y+.5,4]],[x,y,x+width,y+.5]],matrix:[1,0,0,1,0,0],marked});
const item=(str,x,y,width)=>({str,width,height:10,transform:[10,0,0,10,x,y],ascent:.8,descent:-.2});
function fixture(){
 const owner={ref:'1 0 R',parents:[],content:[{page:1,mcid:1},{page:1,object:'2 0 R'}]},url='https://example.eu/act';
 return {owner,url,items:[item(url,10,80,50)],page:{page:1,paint:[path(10,78,50,[['P',1]])],annotations:[{subtype:'Link',nativeSafe:true,ref:'2 0 R',url,rect:[9,77,61,90]}]}};
}
test('printed URI, empty appearance and native object owner account for a link underline',()=>{
 const f=fixture(),result=ownCouncilPageContent([f.page],{paragraphs:[f.owner],noteBlocks:[],entries:()=>f.items});
 assert.equal(f.page.paint.length,0);assert.equal(f.page.annotations.length,0);assert.equal(f.page.ownedPaint[0].kind,'link-underline');assert.equal(result.links[0].url,f.url);assert(result.annotationObjects.has('2 0 R'));
});
for(const [name,change] of [
 ['appearance or action unproved',f=>f.page.annotations[0].nativeSafe=false],
 ['foreign native owner',f=>f.owner.content.pop()],
 ['different URI',f=>f.page.annotations[0].url+='-other'],
 ['unowned tagged underline',f=>f.page.paint[0].marked=[['P',2]]],
 ['changed transform',f=>f.page.paint[0].matrix[0]=1.01],
])test(`ownership stays incomplete with ${name}`,()=>{
 const f=fixture();change(f);ownCouncilPageContent([f.page],{paragraphs:[f.owner],noteBlocks:[],entries:()=>f.items});
 assert(f.page.paint.length||f.page.annotations.length);
});
test('an extra painted path is never dropped with a proved link',()=>{
 const f=fixture();f.page.paint.push(path(20,45,30));ownCouncilPageContent([f.page],{paragraphs:[f.owner],noteBlocks:[],entries:()=>f.items});assert.equal(f.page.paint.length,1);
});
test('a unique note separator has a native Note owner and a bounded gap above its text',()=>{
 const note={ref:'4 0 R'},body={ref:'5 0 R',parents:[],content:[]},page={page:1,paint:[path(10,72,40,[['Artifact']])],annotations:[]};
 const run=()=>ownCouncilPageContent([page],{paragraphs:[body],noteBlocks:[note],entries:r=>r===note?[item('1 Note body.',10,60,60)]:[item('Body text.',10,100,80)]});
 run();assert.equal(page.paint.length,0);assert.equal(page.ownedPaint[0].owner,note.ref);assert.equal(page.ownedPaint[0].kind,'note-separator');
 page.paint=[path(10,72,40,[['Artifact']]),path(10,74,45,[['Artifact']])];run();assert.equal(page.paint.length,2,'two candidate separators remain unproved');
});
