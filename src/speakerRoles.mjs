// Use the label's declared language, not the fragment's position or UI language.
export function speakerRoleLabel(person,language) {
  const label=person?.roleLabels?.[language];
  if(label)return label.text?.trim()&&label.language===language?label:null;
  if(person?.role?.trim()&&person.role!=='Chairing the sitting'&&person.roleLanguage===language)return {text:person.role,language};
  return null;
}
export function contributorOffice(person,language='en', ui) {
  return speakerRoleLabel(person,language)||speakerRoleLabel(person,'en')||{text:ui ? ui.t("batch5.speakerroles.mjs.9.117") : 'Role translation unavailable',language:ui?.language??'en'};
}
