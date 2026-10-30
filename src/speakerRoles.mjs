import {defaultUi} from './uiDefault.mjs';
// Use the label's declared language, not the fragment's position or UI language.
export function speakerRoleLabel(person,language) {
  const label=person?.roleLabels?.[language];
  if(label)return label.text?.trim()&&label.language===language?label:null;
  if(person?.role?.trim()&&person.role!=='Chairing the sitting'&&person.roleLanguage===language)return {text:person.role,language};
  return null;
}
export function contributorOffice(person,language='en', ui = defaultUi) {
  return speakerRoleLabel(person,language)||speakerRoleLabel(person,'en')||{text:ui.t("batch5.speakerroles.mjs.9.117"),language:ui.language};
}
