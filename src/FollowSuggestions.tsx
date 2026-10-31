import {uiErrorText} from './uiErrors.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {MemberAffiliation} from './components/MemberAffiliation';
import {useLayoutEffect,useRef,useState} from 'react';
import {coverageStore,savedStore,useCoverage} from './SavedControls';
import {Portrait} from './components/Portrait';

export function FollowSuggestions({language='en'}:{language?:string}){
  const ui = useUiI18n();
  const coverage=useCoverage(),suggestions=coverageStore.suggestions(ui),[error,setError]=useState('');
  const section=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null),focus=useRef<string[]|null>(null),[retainHeading,setRetainHeading]=useState(false);
  useLayoutEffect(()=>{
    if(!focus.current)return;
    const buttons=Array.from(section.current?.querySelectorAll<HTMLButtonElement>('[data-suggestion]')||[]);
    const next=focus.current.map(id=>buttons.find(button=>button.dataset.suggestion===id)).find(Boolean)||buttons[0];
    (next||heading.current)?.focus();focus.current=null;
  });
  if(!suggestions.length&&!retainHeading&&!coverage.storageError)return null;
  return <section ref={section} className="explorer-follow-suggestions" aria-labelledby={(suggestions.length||retainHeading) ? "follow-suggestions-heading" : undefined} lang={ui.language}>
    {(suggestions.length>0||retainHeading)&&<h2 id="follow-suggestions-heading" ref={heading} tabIndex={-1} onBlur={()=>{if(!coverageStore.suggestions().length)setRetainHeading(false);}}><UiMessage id="followsuggestions.suggested_to_follow"/></h2>}
    {coverage.storageError&&<p role="alert"><UiMessage id="followsuggestions.follow_suggestions_could_not_be_saved_in_this_browser"/> <button onClick={()=>coverageStore.retryStorage()}><UiMessage id="followsuggestions.retry_saving_suggestions"/></button></p>}
    {error&&<p role="alert">{error}</p>}
    <div className="explorer-suggestion-list">{suggestions.map(({member,reasons},index)=>{
      const name=member.firstName+' '+member.lastName;
      const act=(follow:boolean)=>{
        try{
          if(follow)savedStore.toggle({kind:'mep',id:String(member.id),title:name});
          focus.current=suggestions.slice(index+1).map(s=>String(s.member.id));setRetainHeading(true);setError('');
          if(follow)coverageStore.syncFollows(savedStore.snapshot().items);else coverageStore.dismiss(member.id);
        }catch(e){setError(uiErrorText(e,ui));}
      };
      return <article key={member.id} className="explorer-suggestion-card">
        <Portrait member={member}/><div><h3>{name}</h3><MemberAffiliation group={member.groupCode} country={member.countryCode} language={language}/>{reasons.map(({context,reason})=><p key={context}>{context}<br/>{reason}</p>)}
        <div className="explorer-saved-actions"><button data-suggestion={member.id} aria-label={ui.t("followsuggestions.follow_name",{name})} onClick={()=>act(true)}><UiMessage id="followsuggestions.follow"/></button><button aria-label={ui.t("followsuggestions.dismiss_suggestion_for_name", {name: String(name)})} onClick={()=>act(false)}><UiMessage id="followsuggestions.dismiss"/></button></div></div>
      </article>;
    })}</div>
  </section>;
}
