import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {MotionAmendments,createMotionAmendmentsState,type MotionAmendmentsState,type MotionAmendmentsChangeReason} from './MotionAmendments';
import {DocumentContextReader} from './DocumentContextReader';
import type {JoinedActivity} from './explorerTypes';
import {changeMotionText,motionJourneyKey,motionJourneyParams,motionTextChoices,normalizeMotionJourney,readMotionJourney,type MotionJourney,type MotionJourneyBinding} from './motionJourney.mjs';
import './MemberMotionReader.css';

export type MotionJourneyChangeReason=MotionAmendmentsChangeReason|'text'|'adopted-choice';
export type MemberMotionReaderProps={
  activity:JoinedActivity;memberId:number;language:string;memberName?:string;query:URLSearchParams;
  onJourneyChange:(binding:MotionJourneyBinding,next:MotionJourney,reason?:MotionJourneyChangeReason)=>void;
};

/** App owns URL, history and scroll across activity/tab unmounts. */
export function MemberMotionReader({activity,memberId,language,memberName,query,onJourneyChange}:MemberMotionReaderProps) {
  const ui = useUiI18n();
  const choices=motionTextChoices(activity),binding:MotionJourneyBinding={memberId,sourceId:activity.sourceId,ownerId:activity.id,choices};
  const state=readMotionJourney(query,binding,createMotionAmendmentsState(), ui);
  const change=(value:MotionJourney,reason?:MotionJourneyChangeReason)=>{
    const next=normalizeMotionJourney(value,binding,createMotionAmendmentsState(), ui);
    if(!motionJourneyParams(binding,next, ui).size||state.status==='available'&&motionJourneyKey(state)===motionJourneyKey(next)&&state.reason===next.reason)return;
    onJourneyChange(binding,next,reason);
  };
  const update=(amendments:MotionAmendmentsState,intent?:{reason:MotionAmendmentsChangeReason})=>change({...state,amendments,requested:true},intent?.reason);
  const selected=choices.find(choice=>choice.id===state.documentId),unavailable=state.status==='unavailable';
  const session=JSON.stringify([memberId,activity.sourceId,activity.id,state.documentId]);
  return <div className="member-motion-reader" lang={ui.language}>
    <label className="member-motion-reader__choice"><UiMessage id="motionamendments.motion_text.a96919"/> <select aria-label={ui.t("motionamendments.motion_text.a96919")} value={selected?.id||''} onChange={event=>change(changeMotionText(event.target.value,binding,createMotionAmendmentsState(), ui),'text')}>
        {!selected&&<option value="" disabled>{unavailable ? <UiMessage id="MemberMotionReader.requested_text_unavailable"/> : <UiMessage id="MemberMotionReader.choose_a_motion_text"/>}</option>}
        {choices.map(choice=><option key={choice.id} value={choice.id}>{(choice.kind==='joint') ? <UiMessage id="MemberMotionReader.joint_motion_id" values={{id: String(choice.id ?? '')}}/> : <UiMessage id="MemberMotionReader.original_motion_id" values={{id: String(choice.id ?? '')}}/>}</option>)}
      </select>
    </label>
    {selected?.title&&selected.id!==activity.sourceId&&<p className="member-motion-reader__title" lang={selected.titleLanguage||''}>{selected.title}</p>}
    {unavailable ? <p className="member-motion-reader__unavailable" role="status">{state.reason||ui.t("motionJourney.reason56")}</p> : (state.documentId&&<>
        {state.reason&&<p className="member-motion-reader__unavailable" role="status">{state.reason}</p>}
        <MotionAmendments key={session} documentId={state.documentId} memberId={memberId} memberName={memberName} language={language} state={state.amendments} onStateChange={update}
          renderContext={request=><DocumentContextReader request={request} language={language} selectedDocumentId={state.selectedTA}
            onSelectedDocumentIdChange={selectedTA=>{if(state.amendments.view==='context'&&state.amendments.contextView==='adopted')change({...state,selectedTA,requested:true},'adopted-choice');}}/>}/>
      </>)
    }
  </div>;
}
