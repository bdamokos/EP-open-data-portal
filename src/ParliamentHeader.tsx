import {SavedNav} from './PocSaved';
import './ParliamentHeader.css';

type ExplorerView = 'legislation' | 'questions' | 'outside' | 'amendments';

export function ParliamentHeader({view,onMembers,onNavigate,onSaved}: {
  view: 'members' | ExplorerView | 'saved';
  onMembers: () => void;
  onNavigate?: (view: ExplorerView) => void;
  onSaved?: () => void;
}) {
  return <header className="parliament-header">
    <span className="parliament-brand">EUROPEAN PARLIAMENT</span>
    <nav aria-label="Explore Parliament">
      <button aria-current={view==='members'?'page':undefined} onClick={onMembers}>Members</button>
      {(['legislation','questions','amendments','outside'] as const).map(destination=><button
        key={destination}
        aria-current={view===destination?'page':undefined}
        disabled={!onNavigate&&view!==destination}
        onClick={()=>onNavigate?.(destination)}
      >{destination==='legislation'?'Plenary agenda':destination==='questions'?'Questions':destination==='amendments'?'Amendments':'Outside voices'}</button>)}
      {onSaved&&<SavedNav onClick={onSaved} current={view==='saved'}/>}
    </nav>
  </header>;
}
