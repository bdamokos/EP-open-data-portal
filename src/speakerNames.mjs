const chairNames=new Set(('president|the president|presiding|chair|the chair|chairman|chairperson|le président|la présidente|président|présidente|der präsident|die präsidentin|präsident|präsidentin|el presidente|la presidenta|presidente|presidenta|il presidente|la presidente|o presidente|a presidente|de voorzitter|voorzitter|elnök|az elnök|przewodniczący|przewodnicząca|předsedající|predsedajúci|președinte|preşedinte|председател|πρόεδρος|talmannen|formanden|puhemies|predsjedatelj|predsedujoči|pirmininkas|pirmininkė|priekšsēdētājs|juhataja|an t-uachtarán|il-president').split('|'));
export const speakerIsChair=name=>typeof name==='string'&&chairNames.has(name.trim().normalize('NFC').toLocaleLowerCase());
export const speakerNameIsSpecific=name=>typeof name==='string'&&Boolean(name.trim())&&!speakerIsChair(name)&&!/^(?:(?:the|le|la)\s+)?(?:speaker|president|presiding|chair|chairman|chairperson)$/i.test(name.trim());
export function nameScript(name) {
  const scripts=[['Latn','Latin'],['Grek','Greek'],['Cyrl','Cyrillic']].filter(([,script])=>new RegExp('\\p{Script='+script+'}','u').test(name||''));
  return scripts.length===1?scripts[0][0]:null;
}
