import {defaultUi} from './uiDefault.mjs';
const labels=Object.freeze({
  VOTE_ELECTRONIC_ROLLCALL:'Roll-call vote',
  VOTE_HAND:'Show of hands',
  VOTE_ELECTRONIC:'Electronic vote (names not recorded)',
  VOTE_ELECTRONIC_SECRET:'Secret ballot (electronic)',
  VOTE_SECRET:'Secret ballot',
  VOTE_SECRET_BALLOT:'Secret ballot',
});
export const labelsUi = (ui = defaultUi) => (Object.freeze({
  VOTE_ELECTRONIC_ROLLCALL:ui.t("voteMethod.rollCall"),
  VOTE_HAND:ui.t("voteMethod.hands"),
  VOTE_ELECTRONIC:ui.t("voteMethod.electronic"),
  VOTE_ELECTRONIC_SECRET:ui.t("voteMethod.secretElectronic"),
  VOTE_SECRET:ui.t("voteMethod.secret"),
  VOTE_SECRET_BALLOT:ui.t("voteMethod.secret"),
}));

export const knownVoteMethodLabel=(method, ui=defaultUi)=>Object.hasOwn(labelsUi(ui),method)?labelsUi(ui)[method]:null;
export const voteMethodLabel=(method, ui=defaultUi)=>knownVoteMethodLabel(method,ui)||'';
