// Chooses the interface language before the shell and app read ?lang=.
// An explicit ?lang= wins, then the saved choice, then the browser languages.
// Keep the key and language list in step with src/interfaceLanguage.mjs.
(function () {
  try {
    var supported = ['bg', 'es', 'cs', 'da', 'de', 'et', 'el', 'en', 'fr', 'ga', 'hr', 'it', 'lv', 'lt', 'hu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'fi', 'sv'];
    var url = new URL(window.location.href);
    if (supported.indexOf(url.searchParams.get('lang')) >= 0) return;
    var choice = null;
    try { choice = window.localStorage.getItem('ep.interface-language.v1'); } catch (error) {}
    if (supported.indexOf(choice) < 0) {
      choice = null;
      var tags = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language];
      for (var i = 0; i < tags.length && !choice; i++) {
        var code = String(tags[i] || '').toLowerCase().split('-')[0];
        if (supported.indexOf(code) >= 0) choice = code;
      }
    }
    if (!choice || choice === 'en') return;
    url.searchParams.set('lang', choice);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  } catch (error) {}
})();
