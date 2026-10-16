import {SavedNav} from './PocSaved';
import {PocTextSearch} from './PocTextSearch';
import './ParliamentHeader.css';

type ExplorerView = 'legislation' | 'questions' | 'outside';

export function ParliamentHeader({view,onMembers,onNavigate,onSaved,language='en'}: {
  view: 'members' | ExplorerView | 'saved';
  onMembers: () => void;
  onNavigate?: (view: ExplorerView) => void;
  onSaved?: () => void;
  language?:string;
}) {
  return <header className="parliament-header">
    <span className="parliament-brand" lang="en">EUROPEAN PARLIAMENT</span>
    <nav aria-label="Explore Parliament" lang="en">
      <button aria-current={view==='members'?'page':undefined} onClick={onMembers}>Members</button>
      {(['legislation','questions','outside'] as const).map(destination=><button
        key={destination}
        aria-current={view===destination?'page':undefined}
        disabled={!onNavigate&&view!==destination}
        onClick={()=>onNavigate?.(destination)}
      >{destination==='legislation'?'Plenary agenda':destination==='questions'?'Questions':'Outside voices'}</button>)}
      {onSaved&&<SavedNav onClick={onSaved} current={view==='saved'}/>}
    </nav>
    <PocTextSearch prefix="global-fts" label="Search Parliament text" language={language} className="poc-text-search-global" scopeNote="Searches saved speeches, parliamentary questions and linked answers. Coverage varies by language and document."/>
  </header>;
}
