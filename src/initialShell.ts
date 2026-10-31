import {loadUiLocale,uiForLocale} from './appUiI18n';

/** Explicit bindings for the app-owned startup shell. No source/API content is inspected. */
export function localizeInitialShell(document: Document, query: URLSearchParams) {
  const shell = document.getElementById('initial-shell');
  if (!shell) return;
  const ui = uiForLocale(query.get('lang') || 'en');
  const titles: Record<string, string> = {
    members: 'shell.heading.members', legislation: 'shell.navigation.plenaryAgenda',
    questions: 'shell.navigation.questions', outside: 'shell.navigation.outsideVoices',
    groups: 'shell.navigation.groupVoices', saved: 'shell.navigation.following',
  };
  const view = Object.hasOwn(titles, query.get('view') || '') ? query.get('view')! : 'members';
  const modes: Record<string, string> = {participation: 'shell.heading.whatsHot', cloud: 'shell.heading.plenaryWordCloud', trends: 'shell.heading.topicTimeline', dossier: 'shell.heading.dossiers'};
  let title = ui.t(titles[view]);
  if (view === 'legislation' && Object.hasOwn(modes, query.get('pl-mode') || '')) title = ui.t(modes[query.get('pl-mode')!]);
  if (view === 'members' && /^\d+$/.test(query.get('member') || '')) title = ui.t('shell.heading.memberNumber', {memberId: query.get('member')!});
  const set = (selector: string, value: string) => {const node = shell.querySelector(selector); if (node) node.textContent = value;};
  set('header strong', ui.t('shell.siteName'));
  set('h1', title);
  set('[role="status"]', ui.t('shell.loading'));
  set('noscript', ui.t('shell.javascriptRequired'));
  shell.querySelector('nav')?.setAttribute('aria-label', ui.t('shell.navigation.label'));
  const links: Record<string, string> = {...titles, members: 'shell.navigation.members'};
  for (const [view, id] of Object.entries(links)) set(`nav [data-view="${view}"]`, ui.t(id));
  shell.lang = ui.language;
  document.documentElement.lang = ui.language;
  document.title = ui.t('shell.documentTitle', {title});
  document.querySelector('meta[name="description"]')?.setAttribute('content', ui.t('shell.meta.description'));
}
if (typeof document !== 'undefined') {
  const query=new URLSearchParams(window.location.search);
  void loadUiLocale(query.get('lang')).then(()=>localizeInitialShell(document,query)).catch(()=>{
    // The mounted root boundary offers a document reload for failed imports.
  });
}
