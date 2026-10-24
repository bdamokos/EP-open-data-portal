import {createContext,useContext,type ReactNode} from 'react';
import {ParliamentHeader} from './ParliamentHeader';
import type {InsightProps} from './InsightTypes';
import './Insights.css';
import './ExplorerLayout.css';

const FramedInsight=createContext(false);
export const useInsightFrame=()=>useContext(FramedInsight);

// Navigation is eager and stays mounted while a destination's code loads.
export function InsightFrame({view,language='en',onBack,onNavigate,onSaved,children}:InsightProps&{
  view:'legislation'|'questions'|'outside'|'amendments'|'groups';children:ReactNode;
}) {
  return <main className="explorer-insights" lang={language}>
    <ParliamentHeader view={view} onMembers={onBack} onNavigate={onNavigate} onSaved={onSaved} language={language}/>
    <FramedInsight.Provider value={true}>{children}</FramedInsight.Provider>
  </main>;
}
