import type {UiFormatter,UiTextValues} from './uiI18n.mjs';
export class UiMessageError extends Error {
  readonly uiMessageId:string;
  readonly uiValues:UiTextValues;
  constructor(id:string,values?:UiTextValues,formatter?:UiFormatter);
}
export function uiErrorText(error:unknown,formatter?:UiFormatter):string;
