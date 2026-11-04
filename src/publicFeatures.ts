// Keep the unfinished catalogue out of public navigation until it is ready.
// Its components, API and indexing remain available for continued development.
export const publicAmendmentsEnabled: boolean = false;

type ExplorerView = 'legislation'|'questions'|'geopolitics'|'outside'|'amendments'|'groups'|'hemicycle'|'saved';

export function publicExplorerView(value: string|null): ExplorerView|null {
  if (value === 'amendments' && !publicAmendmentsEnabled) return null;
  return ['legislation','questions','geopolitics','outside','amendments','groups','hemicycle','saved'].includes(value || '')
    ? value as ExplorerView : null;
}

export function publicMemberModule(value: string|null): string {
  if (value === 'amendments' && !publicAmendmentsEnabled) return 'speeches';
  return ['profile','activities','amendments','votes'].includes(value || '') ? value! : 'speeches';
}
