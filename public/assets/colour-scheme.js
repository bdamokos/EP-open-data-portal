// Applies a saved light or dark override before the first paint.
// Keep the key and browser-bar colours in step with src/colourScheme.mjs.
(function () {
  try {
    var scheme = window.localStorage.getItem('ep.colour-scheme.v1');
    if (scheme !== 'light' && scheme !== 'dark') return;
    document.documentElement.dataset.theme = scheme;
    var bar = scheme === 'dark' ? '#141618' : '#f6f5f1';
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', bar);
  } catch (error) {}
})();
