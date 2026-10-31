import {createUiI18n} from './uiI18n.mjs';
import english from './ui-locales/en.json' with {type:'json'};
import existing from './ui-locales/existing.json' with {type:'json'};
import aliases from './ui-locales/aliases.json' with {type:'json'};
import reviewedPluralForms from './ui-locales/plural-forms.json' with {type:'json'};
import pairs from './ui-locales/plural-pairs.json' with {type:'json'};

export const uiMessageId = key => Object.hasOwn(aliases,key)?aliases[key]:key;

/** Snapshot UI dictionaries; caller-owned dictionaries and parliamentary data stay untouched. */
export function createAppUiI18n(catalogues = {}, pluralForms = reviewedPluralForms) {
  const source={...english};
  for(const pair of pairs)source[pair.other]={plural:pair.count,one:english[pair.one],other:english[pair.other]};
  const translations={};
  for(const language of new Set([...Object.keys(existing),...Object.keys(catalogues),...Object.keys(pluralForms)])) {
    const messages={...existing[language],...catalogues[language]};
    for(const pair of pairs) {
      const other=messages[pair.other],one=messages[pair.one];
      if(typeof other==='string')messages[pair.other]={plural:pair.count,other,...(typeof one==='string'?{one}:{})};
    }
    for(const [key,forms] of Object.entries(pluralForms[language]??{})) {
      const id=uiMessageId(key),original=source[id];
      if(!original||typeof original!=='object'||!original.plural)throw new TypeError(`Unknown UI plural family: ${language}/${key}`);
      const base=messages[id];
      // Partial forms need a translated other form; no English dictionaries are
      // manufactured for languages whose translations have not arrived.
      if(typeof base!=='object'&&typeof forms.other!=='string')continue;
      messages[id]={...(typeof base==='object'?base:{}),plural:original.plural,...forms};
    }
    translations[language]=messages;
  }
  const i18n=createUiI18n({source,translations});
  return Object.freeze({sourceLocale:i18n.sourceLocale,forLocale(language) {
    const formatter=i18n.forLocale(language);
    return Object.freeze({...formatter,
      t:(id,values)=>formatter.t(uiMessageId(id),values),
      messageLocale:id=>formatter.messageLocale(uiMessageId(id)),
      pluralCategoryFor:(id,value,type)=>formatter.pluralCategoryFor(uiMessageId(id),value,type),
      rich:(id,values,counts)=>formatter.rich(uiMessageId(id),values,counts),
    });
  }});
}
