// Optional enhancement of the native shell; no app bundle or API is needed.
(function () {
  var shell = document.getElementById('initial-shell');
  if (!shell) return; // React may already have replaced it.
  var query = new URLSearchParams(window.location.search);
  var titles = { members: 'Members of the European Parliament', legislation: 'Plenary agenda', questions: 'Questions', outside: 'Outside voices', groups: 'Group voices', saved: 'Following' };
  var view = query.get('view');
  if (!Object.hasOwn(titles, view)) view = 'members';
  var title = titles[view];
  if (view === 'legislation') {
    var modes = { participation: 'What’s hot', cloud: 'Plenary word cloud', trends: 'Topic timeline', dossier: 'Dossiers' };
    var mode = query.get('pl-mode');
    if (Object.hasOwn(modes, mode)) title = modes[mode];
  } else if (view === 'members' && /^\d+$/.test(query.get('member') || '')) {
    title = 'MEP ' + query.get('member');
  }
  shell.querySelector('h1').textContent = title;
  document.title = title + ' — European Parliament data explorer';
  shell.querySelectorAll('nav a').forEach(function (link) {
    var target = new URL(link.href);
    target.searchParams.set('lang', query.get('lang') || 'en');
    link.href = target.pathname + target.search;
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
  });
})();
