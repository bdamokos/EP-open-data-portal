import {defaultUi} from './uiDefault.mjs';
/** Only errors constructed by the application carry a translatable message ID. */
export class UiMessageError extends Error {
  constructor(id,values={},formatter=defaultUi) {
    super(formatter.t(id,values));
    this.uiMessageId=id;
    this.uiValues=Object.freeze({...values});
  }
}
export function uiErrorText(error,formatter=defaultUi) {
  return error instanceof UiMessageError?formatter.t(error.uiMessageId,error.uiValues):error?.message??String(error);
}
