import {SavedNav} from './SavedControls';
import {TextSearch} from './TextSearch';
import './ParliamentHeader.css';
import {publicAmendmentsEnabled} from './publicFeatures';
import {ThemeToggle} from './ThemeToggle';

// Three arcs of seats: the site's own mark, independent of Parliament branding.
const seats=[[5,4],[8,6],[11,8]].flatMap(([radius,count])=>Array.from({length:count},(_,i)=>{const angle=Math.PI*i/(count-1);return [13-Math.cos(angle)*radius,14-Math.sin(angle)*radius];}));
export function SiteMark() {
  return <svg className="parliament-mark" viewBox="0 0 26 16" aria-hidden="true">{seats.map(([x,y])=><circle key={`${x}-${y}`} cx={x} cy={y} r="1.35"/>)}</svg>;
}

type ExplorerView = 'legislation' | 'questions' | 'outside' | 'amendments' | 'groups';

export function ParliamentHeader({view,onMembers,onNavigate,onSaved,language='en'}: {
  view: 'members' | ExplorerView | 'saved';
  onMembers: () => void;
  onNavigate?: (view: ExplorerView) => void;
  onSaved?: () => void;
  language?:string;
}) {
  return <header className="parliament-header">
    <span className="parliament-brand" lang="en"><SiteMark/>European Parliament data explorer</span>
    <nav aria-label="Explore Parliament" lang="en">
      <button aria-current={view==='members'?'page':undefined} onClick={onMembers}>Members</button>
      {(['legislation','questions','amendments','outside','groups'] as const).filter(destination=>destination!=='amendments'||publicAmendmentsEnabled).map(destination=><button
        key={destination}
        aria-current={view===destination?'page':undefined}
        disabled={!onNavigate&&view!==destination}
        onClick={()=>onNavigate?.(destination)}
      >{destination==='legislation'?'Plenary agenda':destination==='questions'?'Questions':destination==='amendments'?'Amendments':destination==='groups'?'Group voices':'Outside voices'}</button>)}
      {onSaved&&<SavedNav onClick={onSaved} current={view==='saved'}/>}
    </nav>
    <ThemeToggle/>
    <TextSearch global prefix="global-fts" label="Search Parliament" language={language} className="explorer-text-search-global"/>
  </header>;
}
