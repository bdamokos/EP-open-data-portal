// Native XML only: no production legal hierarchy or placement evidence.
const children=(nodes,key)=>nodes.flatMap(node=>node[key]?[node[key]]:[]);
export const literal=nodes=>nodes.map(node=>Object.entries(node).map(([name,value])=>name==='w:t'?value.map(part=>part['#text']??'').join(''):name==='w:tab'?'\t':name==='w:noBreakHyphen'?'\u2011':name==='w:softHyphen'?'\u00ad':['w:br','w:cr'].includes(name)?'\n':['w:r','w:hyperlink'].includes(name)?literal(value):'').join('')).join('');
const only=(nodes,names)=>nodes.every(node=>Object.entries(node).every(([name,value])=>name===':@'||name==='#text'&&String(value).trim()===''||names.includes(name)&&Array.isArray(value)));
function gridProperties(nodes){
 const leaves=['w:tblStyle','w:tblW','w:jc','w:tblLayout','w:tblLook','w:bidiVisual','w:tblInd','w:tblCellSpacing','w:tblOverlap','w:tblHeader','w:cantSplit','w:trHeight','w:gridBefore','w:gridAfter','w:wBefore','w:wAfter','w:tcW','w:gridSpan','w:vAlign','w:textDirection','w:hideMark','w:noWrap','w:shd','w:cnfStyle','w:tblCaption','w:tblDescription'];
 for(const node of nodes)for(const [name,value] of Object.entries(node)){
  if(name===':@'||name==='#text'&&String(value).trim()==='')continue;
  if(['w:gridBefore','w:gridAfter'].includes(name)&&node[':@']?.['@_w:val']!=='0')return false;
  const edges=['w:top','w:left','w:bottom','w:right','w:start','w:end'],allowed=['w:tblBorders','w:tcBorders'].includes(name)?[...edges,'w:insideH','w:insideV','w:tl2br','w:tr2bl']:['w:tblCellMar','w:tcMar'].includes(name)?edges:null;
  if(allowed){if(!only(value,allowed)||value.some(n=>Object.entries(n).some(([key,v])=>key!==':@'&&(!Array.isArray(v)||v.length))))return false;}
  else if(!leaves.includes(name)||!Array.isArray(value)||value.length)return false;
 }
 return true;
}
export function completeGrid(table){
 if(!only(table,['w:tblPr','w:tblGrid','w:tr'])||children(table,'w:tblPr').length>1||children(table,'w:tblGrid').length>1||!children(table,'w:tblPr').every(gridProperties)||children(table,'w:tblGrid').some(grid=>!only(grid,['w:gridCol'])||grid.some(n=>n['w:gridCol']?.length)))return false;
 return children(table,'w:tr').every(row=>only(row,['w:tblPrEx','w:trPr','w:tc'])&&children(row,'w:tblPrEx').length<=1&&children(row,'w:tblPrEx').every(gridProperties)&&children(row,'w:trPr').length<=1&&children(row,'w:trPr').every(gridProperties)&&children(row,'w:tc').every(cell=>only(cell,['w:tcPr','w:p'])&&children(cell,'w:tcPr').length<=1&&children(cell,'w:tcPr').every(gridProperties)));
}
