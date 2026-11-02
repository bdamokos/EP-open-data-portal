import {useUiI18n} from './UiI18nReact';
import {languageName} from './interfaceLabels.mjs';
import {INTERFACE_LANGUAGES} from './interfaceLanguage.mjs';

// The translate mark: a CJK character beside a Latin letter, drawn as strokes.
function TranslateIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7.5 2.5v2.2M2.8 5.6h9.4M10.4 5.6c-1 4-3.4 6.9-7.2 8.4M4.6 5.6c1 4 3.4 6.9 7.2 8.4"/>
    <path d="M12.8 21.5 17 10.6l4.2 10.9M14.3 17.7h5.4"/>
  </svg>;
}

// A native select laid over a compact button keeps the platform picker and keyboard behaviour.
export function InterfaceLanguageControl({language,onChange}:{language:string;onChange:(language:string)=>void}) {
  const ui = useUiI18n();
  const label = ui.t("app.interface_language");
  return <label className="explorer-language-control" lang={ui.language} title={label}>
    <TranslateIcon/>
    <span className="explorer-language-code" aria-hidden="true">{language.toUpperCase()}</span>
    <select aria-label={label} value={language} onChange={event=>onChange(event.target.value)}>
      {INTERFACE_LANGUAGES.map(code=><option lang={code} key={code} value={code}>{languageName(code)}</option>)}
    </select>
  </label>;
}
