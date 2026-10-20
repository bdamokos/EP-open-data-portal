import {readFileSync} from 'node:fs';

// Happy DOM does not evaluate light-dark(). Resolve each token pair for one
// scheme so computed styles carry the colours that scheme would paint.
const theme=readFileSync(new URL('../theme.css',import.meta.url),'utf8');
export const schemes=['light','dark'];

export function themeCss(scheme) {
  return theme.replace(/light-dark\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)/g,(_,light,dark)=>scheme==='dark'?dark:light);
}

export function tokenValue(scheme,name) {
  const match=themeCss(scheme).match(new RegExp(`--${name}:\\s*([^;]+);`));
  if(!match)throw new Error(`Unknown token --${name}`);
  const value=match[1].trim();
  const alias=value.match(/^var\(--([\w-]+)\)$/);
  return alias?tokenValue(scheme,alias[1]):value;
}

function channels(color) {
  if(color.startsWith('#')) {
    const hex=color.slice(1),pairs=hex.length<=4?[...hex.slice(0,3)].map(value=>value+value):hex.slice(0,6).match(/../g);
    return pairs.map(value=>parseInt(value,16));
  }
  return color.match(/[\d.]+/g).slice(0,3).map(Number);
}

function luminance(color) {
  return channels(color).map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4)
    .reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
}

export function contrast(a,b) {
  const [light,dark]=[luminance(a),luminance(b)].sort((x,y)=>y-x);
  return (light+.05)/(dark+.05);
}

const unpainted=value=>!value||value==='transparent'||/^rgba\([^)]*,\s*0\)$/.test(value);

// The colour behind an element: its own or its nearest painted ancestor's background, else the page.
export function paintedBackground(window,element,scheme) {
  for(let node=element;node&&node.nodeType===1;node=node.parentElement) {
    const value=window.getComputedStyle(node).backgroundColor;
    if(!unpainted(value))return value;
  }
  return tokenValue(scheme,'bg');
}
