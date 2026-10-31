import { XMLParser, XMLValidator } from "fast-xml-parser";
export const SPEECH_XML_BYTES=2*1024*1024;

// EP annotates speeches, questions and other fragment structures with xml:lang.
// The translation marker belongs to the annotation, not to a particular tag.
export function transcriptLanguage(xml) {
  if (!xml || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    return { tags: [], machine: false, originalLanguage: null };
  const parsed = new XMLParser({ignoreAttributes:false,parseTagValue:false,tagValueProcessor:()=>'',updateTag:(_tag,_path,attributes)=>{
    for(const key of Object.keys(attributes))if(key!=='@_xml:lang')delete attributes[key];
  }}).parse(xml);
  const tags = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    const tag = value["@_xml:lang"];
    if (typeof tag === "string" && tag) tags.push(tag.toLowerCase());
    for (const [key, child] of Object.entries(value))
      if (!key.startsWith("@_")) visit(child);
  };
  visit(parsed);
  const translated = tags.find((tag) => tag.includes("-t-"));
  // A translation's source language is explicit even if an enclosing wrapper
  // carries an interface-language annotation.
  // A plain language tag identifies this text's language, not its provenance.
  const originalLanguage = translated ? translated.split("-t-")[0] : null;
  return {
    tags: [...new Set(tags)],
    machine: tags.some((tag) => /(?:^|-)mtec(?:-|$)/.test(tag)),
    originalLanguage,
  };
}
