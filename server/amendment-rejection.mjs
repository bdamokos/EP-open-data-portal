// Whole published cells only. A dash label or a rejection mentioned inside
// replacement prose never establishes a whole-document operation.
const forms={
  en:new Map([
    ['The European Parliament rejects the Commission proposal.','commission-proposal'],
    ['The European Parliament rejects the Council position at first reading.','council-position'],
    ['The European Parliament rejects the Commission’s proposal to amend Decision (EU) 2015/1814 as regards the market stability reserve for the buildings, road transport and additional sectors and calls on the Commission to withdraw its proposal.','commission-proposal'],
  ]),
  it:new Map([['Il Parlamento europeo respinge la proposta della Commissione.','commission-proposal']]),
  fr:new Map([['Le Parlement européen rejette la proposition de la Commission.','commission-proposal']]),
};
export function amendmentRejection(variant={}) {
  if(typeof variant.originalText!=='string'||variant.originalText.trim()||typeof variant.proposedText!=='string'||variant.gaps?.length)return null;
  // A numbered provision conflicts with whole-document scope, even when its
  // complete proposed cell contains a rejection sentence.
  if(!/^[–—−-]$/u.test((variant.targetLabel||'').trim()))return null;
  const scope=forms[variant.language]?.get(variant.proposedText.normalize('NFC').replace(/\s+/gu,' ').trim());
  return scope?{operation:'reject',status:'document-operation',scope,reason:scope==='commission-proposal'?'rejects_proposal':'rejects_council_position',evidence:[{basis:'published-rejection-wording',field:'proposedText',language:variant.language}]}:null;
}
