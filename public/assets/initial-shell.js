// Optional enhancement of the native shell; no app bundle or API is needed.
(function () {
  // Fetch the view's lazy code next to the entry, not after it runs. The build
  // names the files; a page without the list preloads nothing.
  var preload = document.querySelector('meta[name="view-preload"]'), startup = new URLSearchParams(window.location.search);
  // The document reader shares the view parameter but not its code.
  if (preload && startup.get('view') === preload.dataset.view && startup.get('pl-mode') !== 'read') {
    preload.content.split(' ').forEach(function (href) {
      if (!/^\.\/assets\/[\w.-]+\.(?:js|css)$/.test(href)) return;
      var link = document.createElement('link');
      if (/\.css$/.test(href)) { link.rel = 'preload'; link.as = 'style'; } else link.rel = 'modulepreload';
      link.crossOrigin = '';
      link.href = href;
      document.head.appendChild(link);
    });
  }
  var shell = document.getElementById('initial-shell');
  if (!shell) return; // React may already have replaced it.
  var query = new URLSearchParams(window.location.search);
  var titles = { members: 'Members of the European Parliament', legislation: 'Plenary agenda', questions: 'Questions', geopolitics: 'Geopolitics', outside: 'Outside voices', groups: 'Group voices', hemicycle: 'Hemicycle', saved: 'Following' };
  var view = query.get('view');
  if (!Object.hasOwn(titles, view)) view = 'members';
  var title = titles[view];
  if (view === 'legislation') {
    var modes = { participation: 'What’s hot', cloud: 'Plenary word cloud', topics: 'Topics', dossier: 'Dossiers', read: 'Document', vote: 'Vote' };
    var mode = query.get('pl-mode');
    if (mode === 'dossier' && !(query.get('dossier-ref') || '').trim()) mode = 'agenda';
    if (mode === 'vote' && !(query.get('pl-vote') || '').trim()) mode = 'agenda';
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
