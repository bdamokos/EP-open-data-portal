import type {JoinedActivity} from './explorerTypes';
import type {MotionAmendmentsState} from './MotionAmendments';

export type MotionTextChoice={id:string;kind:'original'|'joint';title:string;titleLanguage:string|null};
export type MotionJourneyBinding={memberId:number;sourceId:string;ownerId?:string;choices:MotionTextChoice[]};
/** An available motion may have a selection-level reason; its exact whole-text actions remain usable. */
export type MotionJourney={documentId:string|null;amendments:MotionAmendmentsState;selectedTA:string|null;status:'available'|'unavailable'|'inactive';reason:string|null;requested:boolean};
export const MOTION_JOURNEY_KEYS:readonly string[];
export function motionTextChoices(activity:JoinedActivity):MotionTextChoice[];
export function createMotionJourney(binding:MotionJourneyBinding,factoryDefaults?:MotionAmendmentsState):MotionJourney;
export function normalizeMotionJourney(value:unknown,binding:MotionJourneyBinding,factoryDefaults?:MotionAmendmentsState):MotionJourney;
export function readMotionJourney(query:URLSearchParams,binding:MotionJourneyBinding,factoryDefaults?:MotionAmendmentsState):MotionJourney;
export function changeMotionText(documentId:string,binding:MotionJourneyBinding,factoryDefaults?:MotionAmendmentsState):MotionJourney;
export function motionJourneyKey(state:MotionJourney):string;
export function motionJourneyParams(binding:MotionJourneyBinding,state:MotionJourney):URLSearchParams;
export function motionJourneyUrl(href:string,binding:MotionJourneyBinding,state:MotionJourney):URL;
