import {ALL_ENTITIES} from '@nodable/entities';

const xmlNames=Object.freeze({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"});
const pressNames=Object.freeze({...xmlNames,nbsp:' ',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',ndash:'–',mdash:'—',hellip:'…'});
const positivePoint=point=>Number.isSafeInteger(point)&&point>0&&point<=0x10ffff;
const scalarPoint=point=>positivePoint(point)&&!(point>=0xd800&&point<=0xdfff);
const xmlPoint=point=>scalarPoint(point)&&(point>=0x20||[9,10,13].includes(point));
const numeric=/^#(?:[0-9]+|x[0-9a-f]+)$/i;

// Fixed compatibility policies, not interchangeable HTML/XML standards modes.
// Keep recognition limits and numeric quirks beside the shared decoding engine.
const policies=Object.freeze({
  'source-title':Object.freeze({
    pattern:/&(#x[0-9a-fA-F]+|#X[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    names:ALL_ENTITIES,validPoint:scalarPoint,
  }),
  'vote-reference':Object.freeze({
    pattern:/&(amp|lt|gt|quot|apos|#(?:[0-9]+|x[0-9a-fA-F]+));/g,
    names:xmlNames,validPoint:point=>xmlPoint(point)&&point!==0xfffe&&point!==0xffff,
  }),
  'press-html':Object.freeze({
    pattern:/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi,
    names:pressNames,lowercaseNames:true,validPoint:positivePoint,
  }),
  'split-xml':Object.freeze({
    pattern:/&([^;\s]+);/g,
    names:xmlNames,validPoint:xmlPoint,
  }),
});
const preserve=entity=>entity;

// Decode one string layer without parsing markup, trimming or coercing input.
// onInvalid receives the original token and 'unsupported' or 'invalid-point';
// split descriptions use it to retain their domain-specific failures.
export function decodeCharacterReferences(value,policy,onInvalid=preserve) {
  if(!Object.hasOwn(policies,policy))throw new TypeError('Unknown character-reference policy.');
  const {pattern,names,lowercaseNames,validPoint}=policies[policy];
  return value.replace(pattern,(entity,name)=>{
    const key=lowercaseNames?name.toLowerCase():name;
    if(Object.hasOwn(names,key))return names[key];
    if(!numeric.test(name))return onInvalid(entity,'unsupported');
    const point=name[1]==='x'||name[1]==='X'?Number.parseInt(name.slice(2),16):Number(name.slice(1));
    return validPoint(point)?String.fromCodePoint(point):onInvalid(entity,'invalid-point');
  });
}
