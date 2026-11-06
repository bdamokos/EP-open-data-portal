// Keep the unfinished catalogue out of public navigation until it is ready.
// Its components, API and indexing remain available for continued development.
export const publicAmendmentsEnabled: boolean = false;

type ExplorerView = 'legislation'|'questions'|'geopolitics'|'outside'|'amendments'|'groups'|'hemicycle'|'saved'|'meps';

export function publicExplorerView(value: string|null): ExplorerView|null {
  if (value === 'amendments' && !publicAmendmentsEnabled) return null;
  return ['legislation','questions','geopolitics','outside','amendments','groups','hemicycle','saved','meps'].includes(value || '')
    ? value as ExplorerView : null;
}

// `meps` is the directory wall: it keeps the member-wall URL fields the same
// way the default (null) view does.
export function memberWallView(value: string|null): boolean {
  return !value || value === 'meps';
}

// An older directory link carries filters and no view; it still opens the directory.
export function explorerViewFromQuery(query: URLSearchParams): ExplorerView|null {
  // A member profile takes precedence over a view: the URL writes the member only when no view is set.
  if (/^\d+$/.test(query.get('member') || '')) return null;
  const view = publicExplorerView(query.get('view'));
  if (view) return view;
  return ['country','committee','group','organization','mep-view'].some(key => query.has(key)) || (query.has('role') && query.get('role') !== 'both') ? 'meps' : null;
}

export function publicMemberModule(value: string|null): string {
  if (value === 'amendments' && !publicAmendmentsEnabled) return 'speeches';
  return ['profile','activities','amendments','votes'].includes(value || '') ? value! : 'speeches';
}
