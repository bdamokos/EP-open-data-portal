import {UiMessage, useUiI18n} from './UiI18nReact';
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
  const ui = useUiI18n();
  return <header className="parliament-header">
    <span className="parliament-brand" lang={ui.language}><SiteMark/><UiMessage id="batch4.parliamentheader.tsx.23.1"/></span>
    <nav aria-label={ui.t("batch4.parliamentheader.tsx.24.1")} lang={ui.language}>
      <button aria-current={(view==='members') ? 'page' : undefined} onClick={onMembers}><UiMessage id="batch4.parliamentheader.tsx.25.1"/></button>
      {(['legislation','questions','amendments','outside','groups'] as const).filter(destination=>destination!=='amendments'||publicAmendmentsEnabled).map(destination=><button
        key={destination}
        aria-current={(view===destination) ? 'page' : undefined}
        disabled={!onNavigate&&view!==destination}
        onClick={()=>onNavigate?.(destination)}
      >{destination==='legislation'?ui.t("plenarymodes.plenary_agenda"):destination==='questions'?ui.t("textsearch.questions"):destination==='amendments'?ui.t("legislation.amendments.900866"):destination==='groups'?ui.t("groupvoices.group_voices.f21b8b"):ui.t("outsidevoices.outside_voices.a027e6")}</button>)}
      {onSaved&&<SavedNav onClick={onSaved} current={view==='saved'}/>}
    </nav>
    <ThemeToggle/>
    <TextSearch global prefix="global-fts" label={ui.t("batch4.parliamentheader.tsx.35.1")} language={language} className="explorer-text-search-global"/>
  </header>;
}
