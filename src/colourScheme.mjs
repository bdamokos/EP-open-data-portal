// Colour scheme preference: follow the system, or a light/dark override kept on this device.
export const COLOUR_SCHEME_KEY='ep.colour-scheme.v1';
export const colourSchemes=['system','light','dark'];
const browserBars={light:'#f6f5f1',dark:'#141618'};
const appliedSchemes=new WeakMap();

function storage(){try{return window.localStorage;}catch{return null;}}

export function readColourScheme(){
  try{const value=storage()?.getItem(COLOUR_SCHEME_KEY);return value==='light'||value==='dark'?value:'system';}catch{return 'system';}
}

// Persistence may fail; remounted controls must still reflect this document's choice.
export function readActiveColourScheme(doc=document){
  return appliedSchemes.get(doc)??readColourScheme();
}

export function nextColourScheme(current){
  return colourSchemes[(colourSchemes.indexOf(current)+1)%colourSchemes.length];
}

// System preference keeps both media-specific theme-color tags; an override pins them.
export function applyColourScheme(scheme,doc=document){
  appliedSchemes.set(doc,scheme);
  const root=doc.documentElement;
  if(scheme==='light'||scheme==='dark')root.dataset.theme=scheme;else delete root.dataset.theme;
  for(const meta of doc.querySelectorAll('meta[name="theme-color"]')){
    const media=meta.getAttribute('media')||'';
    const own=media.includes('dark')?'dark':'light';
    meta.setAttribute('content',browserBars[scheme==='light'||scheme==='dark'?scheme:own]);
  }
}

export function saveColourScheme(scheme){
  try{
    if(scheme==='light'||scheme==='dark')storage()?.setItem(COLOUR_SCHEME_KEY,scheme);
    else storage()?.removeItem(COLOUR_SCHEME_KEY);
  }catch{}
  applyColourScheme(scheme);
}
