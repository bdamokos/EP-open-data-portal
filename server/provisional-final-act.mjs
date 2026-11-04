// An adopted text that only reproduces the resolution says that Parliament's
// position is the final act, naming it by type, year and number. That statement
// is the only evidence used: titles and similar wording never identify the act.
const STATEMENT=/\bcorresponds to the final legislative act\b/iu;
const ACT=/\bfinal legislative act,?\s+(Regulation|Directive|Decision)\s+\(EU\)\s+((?:19|20)\d{2})\/([1-9]\d{0,4})(?![\d/])/u;
const ELI_TYPE={Regulation:'reg',Directive:'dir',Decision:'dec'};

// statesFinalAct: the text names a final act, so it does not hold the position.
// act: the exact act, only when the statement gives a complete number.
export function adoptedTextFinalAct(paragraphs) {
  const statements=(Array.isArray(paragraphs)?paragraphs:[]).filter(paragraph=>typeof paragraph==='string'&&STATEMENT.test(paragraph));
  if(!statements.length)return {statesFinalAct:false,act:null};
  const found=statements.length===1?ACT.exec(statements[0]):null;
  if(!found)return {statesFinalAct:true,act:null};
  const [,type,year,number]=found;
  return {statesFinalAct:true,act:{label:`${type} (EU) ${year}/${number}`,type:ELI_TYPE[type],year:Number(year),number:Number(number),url:`https://eur-lex.europa.eu/eli/${ELI_TYPE[type]}/${year}/${number}/oj`}};
}
