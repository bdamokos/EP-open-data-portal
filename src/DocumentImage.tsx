import {useState} from 'react';
import './DocumentImage.css';

export type DocumentImageAsset={mime:string;width:number;height:number;sha256:string;data:string};
export type DocumentImageReference={id:string;displayWidth?:number;displayHeight?:number;part:string;target:string;relationshipId:string;description:string;title:string;mime:string;width:number;height:number};
export type DocumentImageAssets=Record<string,DocumentImageAsset>;
export function DocumentImage({image,assets}:{image:DocumentImageReference;assets?:DocumentImageAssets}){
  const [expanded,setExpanded]=useState(false),[failed,setFailed]=useState<string|null>(null);
  const asset=assets?.[image.id];
  if(failed===image.id||!asset||!/^image\/(png|jpeg|gif|webp|bmp)$/.test(asset.mime)||!/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data)||asset.data.length>5592408||asset.width<=0||asset.height<=0||asset.width*asset.height>20_000_000)return <span className="document-context-object">Image unavailable</span>;
  const displayWidth=image.displayWidth??asset.width,displayHeight=image.displayHeight??asset.height;
  if(!Number.isFinite(displayWidth)||!Number.isFinite(displayHeight)||displayWidth<=0||displayHeight<=0||displayWidth>20000||displayHeight>20000)return <span className="document-context-object">Image unavailable</span>;
  const factor=expanded?Math.min(Math.max(2,asset.width/displayWidth),10000/displayWidth,10000/displayHeight):1;
  const label=image.description||image.title||'Document image';
  return <span className={'document-image'+(expanded?' document-image-expanded':'')}>
    <span className="document-image-scroll"><img src={'data:'+asset.mime+';base64,'+asset.data} width={displayWidth} height={displayHeight} style={{width:displayWidth*factor,height:'auto',aspectRatio:displayWidth+' / '+displayHeight}} alt={label} loading="lazy" onError={()=>setFailed(image.id)}/></span>
    <button type="button" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'Fit image':'Enlarge image'}</button>
  </span>;
}
