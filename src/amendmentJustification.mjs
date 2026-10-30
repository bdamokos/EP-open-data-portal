/** A retained justification must still belong to the selected published edition. */
export function amendmentJustification(record) {
  if(typeof record?.justification!=='string'||!record.justification.trim())return null;
  const hasFieldSource=Object.hasOwn(record.fieldSources||{},'justification');
  const source=hasFieldSource?record.fieldSources.justification:
    Object.hasOwn(record,'metadataSource')?record.metadataSource:record.source??record.wordingSource??null;
  if(hasFieldSource&&(!source||source.url&&record.metadataSource?.url&&source.url!==record.metadataSource.url))return null;
  const sourceList=typeof source?.url==='string'?source.url.match(/(?:A|B|RC)-10-\d{4}-\d{4,6}-AM-\d{1,5}-\d{1,5}(?=[_/?.]|$)/u)?.[0]:null;
  if(sourceList&&record.listId&&sourceList!==record.listId)return null;
  const language=source&&Object.hasOwn(source,'language')?source.language??null:record.language??null;
  const selectedLanguage=record.wordingSource?.language??record.source?.language??record.language;
  if(language&&selectedLanguage&&language!==selectedLanguage)return null;
  return {text:record.justification,language,source};
}
