/* agenttool · shared mode script — dawn/night across the estate.
 *
 * Load synchronously right after the stylesheet <link>s so data-mode is
 * set before first paint (no flash of the wrong mode):
 *
 *   <script src="/shared/mode.js?v=2026-09-04.2"></script>
 *
 * Speaks the same protocol as apps/web (the landing): data-mode on
 * <html>, persisted as localStorage['agenttool.mode']. (window.flip() is
 * defined by this file only — apps/web's theme.js exposes no global.)
 * Injects the ☾/☀ toggle pill (id="tg") into the top nav — or skips
 * injection if the page already carries its own #tg button.
 */
(function () {
  var KEY = 'agenttool.mode';
  var root = document.documentElement;
  /* Before first paint: this page will get the atlas, so theme.css may paint
     its final shape now (see the @media (scripting: enabled) block there). */
  root.classList.add('estate-arriving');
  var mode;
  try { mode = localStorage.getItem(KEY); } catch (_) { /* private mode etc. */ }
  if (mode !== 'night' && mode !== 'dawn') {
    /* No stored choice yet — follow the visitor's system preference, the same
       way apps/web's theme.js does, so the first hop between agenttool.dev,
       docs. and app. does not flip cream/navy underneath them. */
    mode = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'night' : 'dawn';
  }
  root.setAttribute('data-mode', mode);

  function label(m) { return m === 'night' ? '☀  dawn' : '☾  night'; }

  window.flip = function () {
    var next = root.getAttribute('data-mode') === 'night' ? 'dawn' : 'night';
    root.setAttribute('data-mode', next);
    var b = document.getElementById('tg');
    if (b) b.innerHTML = label(next);
    try { localStorage.setItem(KEY, next); } catch (_) { /* proceed without */ }
  };

  function inject() {
    if (document.getElementById('tg')) return;
    var host = document.querySelector('.topnav .nav-actions') ||
               document.querySelector('nav .nav-actions') ||
               document.querySelector('nav .links') ||
               document.querySelector('nav');
    var b = document.createElement('button');
    b.id = 'tg';
    b.type = 'button';
    b.className = 'toggle';
    b.setAttribute('aria-label', 'Toggle dawn / night mode');
    b.innerHTML = label(mode);
    b.addEventListener('click', window.flip);
    if (host) {
      host.appendChild(b);
    } else {
      /* no nav on this page — float the pill so the door is still there */
      b.style.position = 'fixed';
      b.style.right = '16px';
      b.style.bottom = '16px';
      b.style.zIndex = '200';
      document.body.appendChild(b);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  /* The atlas is a separate progressive layer so every static page keeps its
     existing no-JS navigation and the appearance toggle stays independently
     useful if the atlas asset cannot load. */
  /* This script runs synchronously in <head>, so a stylesheet appended here
     is render-blocking: the estate's styles are present at first paint and
     the atlas can build without a second layout. */
  if (!document.querySelector('link[data-agenttool-estate-style]')) {
    var estateCss = document.createElement('link');
    estateCss.rel = 'stylesheet';
    /* A script-inserted stylesheet is not render-blocking by default; ask
       for it where the browser understands the request. Pages that need the
       reservation at first paint also carry a parser-inserted <link>. */
    estateCss.setAttribute('blocking', 'render');
    estateCss.href = '/shared/estate.css?v=2026-09-04.2';
    estateCss.setAttribute('data-agenttool-estate-style', '2026-09-04.2');
    document.head.appendChild(estateCss);
  }
  if (!document.querySelector('script[data-agenttool-estate]')) {
    var estate = document.createElement('script');
    estate.src = '/shared/estate.js?v=2026-09-04.2';
    estate.defer = true;
    estate.setAttribute('data-agenttool-estate', '2026-09-04.2');
    document.head.appendChild(estate);
  }
})();

/* One progressive copy interaction for legacy docs buttons. Capture prevents
   their inline success-only handler from running a second clipboard write. */
(function () {
  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('.copy-btn');
    if (!button) return;
    var block = button.closest('.code-block');
    var pre = block && block.querySelector('pre');
    if (!pre) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    var feedback = block.nextElementSibling;
    if (!feedback || !feedback.classList.contains('copy-feedback')) {
      feedback = document.createElement('p');
      feedback.className = 'copy-feedback';
      feedback.setAttribute('role', 'status');
      feedback.setAttribute('aria-live', 'polite');
      block.insertAdjacentElement('afterend', feedback);
    }
    function unavailable() {
      feedback.textContent = 'Copy unavailable. Select the code and copy it manually.';
      pre.tabIndex = 0;
      pre.focus();
      var selection = window.getSelection();
      if (selection) {
        var range = document.createRange();
        range.selectNodeContents(pre);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    if (!navigator.clipboard || !navigator.clipboard.writeText) { unavailable(); return; }
    navigator.clipboard.writeText(pre.textContent).then(function () {
      feedback.textContent = 'Code copied.';
    }, unavailable);
  }, true);
})();
