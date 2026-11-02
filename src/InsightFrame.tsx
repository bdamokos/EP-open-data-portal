import {createContext,useContext,useLayoutEffect,useRef,type ReactNode} from 'react';
import {ParliamentHeader} from './ParliamentHeader';
import type {InsightProps} from './InsightTypes';
import './Insights.css';
import './ExplorerLayout.css';

const FramedInsight=createContext(false);
export const useInsightFrame=()=>useContext(FramedInsight);

// Navigation is eager and stays mounted while a destination's code loads.
export function InsightFrame({view,language='en',onBack,onNavigate,onSaved,children}:InsightProps&{
  view:'legislation'|'questions'|'topics'|'outside'|'amendments'|'groups';children:ReactNode;
}) {
  const frame=useRef<HTMLElement>(null);
  // These destinations used to remount their scroll container. Keep that
  // reset for clicks and history navigation while preserving the header.
  useLayoutEffect(()=>{if(frame.current)frame.current.scrollTop=0;},[view]);
  return <main ref={frame} className="explorer-insights" lang={language}>
    <ParliamentHeader view={view} onMembers={onBack} onNavigate={onNavigate} onSaved={onSaved} language={language}/>
    <FramedInsight.Provider value={true}>{children}</FramedInsight.Provider>
  </main>;
}
