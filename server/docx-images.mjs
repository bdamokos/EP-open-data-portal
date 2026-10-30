import {inflateRawSync,crc32} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {XMLParser,XMLValidator} from 'fast-xml-parser';

export const DOCUMENT_IMAGES_VERSION=1;
export const IMAGE_LIMITS=Object.freeze({entries:2000,count:100,bytes:4*1024*1024,total:12*1024*1024,pixels:20_000_000});
const parse=xml=>new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',parseTagValue:false,trimValues:false}).parse(xml);
const list=x=>x==null?[]:Array.isArray(x)?x:[x];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Sniff dimensions before allowing browser decoding. No executable vector formats.
export function imageInfo(b) {
 try {
  let mime,width,height;
  if(b.length>=33&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.toString('ascii',12,16)==='IHDR'){mime='image/png';width=b.readUInt32BE(16);height=b.readUInt32BE(20);}
  else if(b.length>=10&&/^GIF8[79]a$/.test(b.toString('ascii',0,6))){mime='image/gif';width=b.readUInt16LE(6);height=b.readUInt16LE(8);}
  else if(b.length>=26&&b.toString('ascii',0,2)==='BM'&&b.readUInt32LE(14)>=40){mime='image/bmp';width=Math.abs(b.readInt32LE(18));height=Math.abs(b.readInt32LE(22));}
  else if(b.length>=30&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){
    const kind=b.toString('ascii',12,16);mime='image/webp';
    if(kind==='VP8X'){width=1+b.readUIntLE(24,3);height=1+b.readUIntLE(27,3);}
    else if(kind==='VP8 '&&b[23]===0x9d&&b[24]===1&&b[25]===0x2a){width=b.readUInt16LE(26)&16383;height=b.readUInt16LE(28)&16383;}
    else if(kind==='VP8L'&&b[20]===0x2f){const bits=b.readUInt32LE(21);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
  }
  else if(b.length>4&&b[0]===255&&b[1]===216){
    mime='image/jpeg';let p=2;
    while(p+4<=b.length){if(b[p++]!==255)break;while(b[p]===255)p++;const marker=b[p++];if(marker===0xd9||marker===0xda)break;if(marker===1||marker>=0xd0&&marker<=0xd7)continue;
      const size=b.readUInt16BE(p);if(size<2||p+size>b.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&size>=8){height=b.readUInt16BE(p+3);width=b.readUInt16BE(p+5);break;}p+=size;
    }
  }
  return mime&&width>0&&height>0&&width<=20000&&height<=20000&&width*height<=IMAGE_LIMITS.pixels?{mime,width,height}:null;
 }catch{return null;}
}
function directory(buffer){
  if(buffer.length<22||buffer.length>8*1024*1024)throw Error('archive-limit');let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0||buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6))throw Error('archive-invalid');
  const count=buffer.readUInt16LE(end+10);if(count>IMAGE_LIMITS.entries)throw Error('archive-limit');let p=buffer.readUInt32LE(end+16);const entries=new Map();
  for(let i=0;i<count;i++){
    if(p+46>buffer.length||buffer.readUInt32LE(p)!==0x02014b50)throw Error('archive-invalid');
    const nameLength=buffer.readUInt16LE(p+28),extra=buffer.readUInt16LE(p+30),comment=buffer.readUInt16LE(p+32),next=p+46+nameLength+extra+comment;
    if(next>buffer.length)throw Error('archive-invalid');const name=buffer.toString('utf8',p+46,p+46+nameLength);
    if(entries.has(name))throw Error('duplicate-part');entries.set(name,{flags:buffer.readUInt16LE(p+8),method:buffer.readUInt16LE(p+10),crc:buffer.readUInt32LE(p+16),compressed:buffer.readUInt32LE(p+20),size:buffer.readUInt32LE(p+24),offset:buffer.readUInt32LE(p+42)});p=next;
  }
  return entries;
}
// Relationship IDs belong to their source part. Never fetch linked/external media.
export function docxImages(buffer,parts){
  const assets={},relationships=new Map();let entries,total=0,count=0;
  try{entries=directory(buffer);}catch{return {assets,resolve:()=>null};}
  function bytes(name){
    const e=entries.get(name);if(!e||e.flags&1||![0,8].includes(e.method)||e.size>IMAGE_LIMITS.bytes||e.compressed>buffer.length||e.offset+30>buffer.length||buffer.readUInt32LE(e.offset)!==0x04034b50)throw Error('media-unavailable');
    const n=buffer.readUInt16LE(e.offset+26),x=buffer.readUInt16LE(e.offset+28),start=e.offset+30+n+x;
    if(buffer.readUInt16LE(e.offset+6)!==e.flags||buffer.readUInt16LE(e.offset+8)!==e.method||buffer.toString('utf8',e.offset+30,e.offset+30+n)!==name||start+e.compressed>buffer.length)throw Error('media-invalid');
    total+=e.size;if(total>IMAGE_LIMITS.total)throw Error('media-limit');const compressed=buffer.subarray(start,start+e.compressed),b=e.method===0?compressed:inflateRawSync(compressed,{maxOutputLength:IMAGE_LIMITS.bytes});
    if(b.length!==e.size||crc32(b)!==e.crc)throw Error('media-invalid');return b;
  }
  function rels(part){
    if(relationships.has(part))return relationships.get(part);const file=path.posix.join(path.posix.dirname(part),'_rels',path.posix.basename(part)+'.rels'),xml=parts.get(file);let map=new Map();
    if(xml&&XMLValidator.validate(xml)===true&&!/<!DOCTYPE|<!ENTITY/i.test(xml)){
      for(const rel of list(parse(xml).Relationships?.Relationship)){if(map.has(rel.Id)){map.set(rel.Id,null);continue;}map.set(rel.Id,rel);}
    }relationships.set(part,map);return map;
  }
  function resolve(node,part='word/document.xml'){
    if(node['mc:AlternateContent']){
      const branches=node['mc:AlternateContent'].filter(n=>n['mc:Choice']||n['mc:Fallback']);
      for(const branch of branches){const kind=branch['mc:Choice']?'mc:Choice':'mc:Fallback',candidate=resolve({'w:drawing':branch[kind]},part);if(candidate?.id)return {...candidate,compatibility:kind};}
      return {reason:'drawing-layout-required'};
    }
    const refs=[],properties=[],unsupported=[];
    function visit(nodes){for(const n of nodes||[])for(const [key,value] of Object.entries(n)){
      if(key==='a:blip'){refs.push({id:n[':@']?.['@_r:embed'],external:n[':@']?.['@_r:link']});if(value.some(child=>Object.keys(child).some(key=>key!==':@'&&key!=='a:extLst')))unsupported.push('picture-effect');}
      if(key==='v:imagedata'){refs.push({id:n[':@']?.['@_r:id'],external:n[':@']?.['@_src']});if(Object.keys(n[':@']||{}).some(k=>/crop|gamma|blacklevel|gain|grayscale|bilevel/i.test(k)))unsupported.push('picture-transform');}
      if(key==='v:shape'&&/rotation|flip/i.test(String(n[':@']?.['@_style']||'')))unsupported.push('picture-transform');
      if(key==='a:custGeom'||key==='a:prstGeom'&&n[':@']?.['@_prst']!=='rect')unsupported.push('picture-geometry');
      if(['w:txbxContent','wps:wsp','wpg:wgp','a:grpSp','v:group','c:chart','dgm:relIds'].includes(key))unsupported.push('drawing-layout');
      if(['wp:docPr','pic:cNvPr'].includes(key))properties.push(n[':@']||{});
      if(key==='a:srcRect'&&Object.values(n[':@']||{}).some(v=>Number(v)!==0)||key==='a:xfrm'&&Object.entries(n[':@']||{}).some(([k,v])=>['@_rot','@_flipH','@_flipV'].includes(k)&&!['0','false'].includes(String(v)))||['a:duotone','a:lum','a:grayscl','a:alphaModFix','a:clrChange'].includes(key))unsupported.push('picture-transform');
      if(key!==':@'&&Array.isArray(value))visit(value);
    }}visit([node]);
    if(refs.length!==1)return {reason:'drawing-layout-required'};if(refs[0].external)return {reason:'external-picture'};if(!refs[0].id)return {reason:'picture-relationship-missing'};if(unsupported.length)return {reason:'picture-transform-unsupported'};
    const rel=rels(part).get(refs[0].id);if(!rel||rel.TargetMode==='External'||!String(rel.Type).endsWith('/image')||typeof rel.Target!=='string'||/[\\%?#:]|^\//.test(rel.Target))return {reason:'picture-relationship-unsupported'};
    const target=path.posix.normalize(path.posix.join(path.posix.dirname(part),rel.Target));if(!/^word\/media\/[^/]+$/.test(target))return {reason:'picture-target-unsupported'};
    try{
      if(++count>IMAGE_LIMITS.count)return {reason:'picture-count-limit'};const b=bytes(target),info=imageInfo(b);if(!info)return {reason:'picture-format-or-dimensions-unsupported'};const id=hash(b);
      assets[id]??={...info,data:b.toString('base64'),sha256:id};
      const prop=properties.find(p=>p['@_descr'])||properties[0]||{};
      return {id,part,target,relationshipId:refs[0].id,description:String(prop['@_descr']||'').slice(0,2000),title:String(prop['@_title']||'').slice(0,500),...info};
    }catch(error){return {reason:error.message||'picture-unavailable'};}
  }
  return {assets,resolve};
}
export function documentImages(record){
  const assets=record?.imageAssets;if(!assets||typeof assets!=='object'||Array.isArray(assets))return {};
  const result={};let total=0;
  for(const [id,asset] of Object.entries(assets)){
    if(Object.keys(result).length>=IMAGE_LIMITS.count||!/^[a-f0-9]{64}$/.test(id)||typeof asset?.data!=='string'||asset.data.length>Math.ceil(IMAGE_LIMITS.bytes/3)*4)continue;
    const b=Buffer.from(asset.data,'base64'),info=imageInfo(b);total+=b.length;
    if(total>IMAGE_LIMITS.total)break;if(!info||hash(b)!==id||asset.mime!==info.mime||asset.width!==info.width||asset.height!==info.height)continue;
    result[id]={...info,sha256:id,data:asset.data};
  }return result;
}
