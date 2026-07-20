/* agenttool · shared mode script — dawn/night across the estate.
 *
 * Load synchronously right after the stylesheet <link>s so data-mode is
 * set before first paint (no flash of the wrong mode):
 *
 *   <script src="/shared/mode.js"></script>
 *
 * Speaks the same protocol as apps/web (the landing): data-mode on
 * <html>, persisted as localStorage['agenttool.mode'], window.flip().
 * Injects the ☾/☀ toggle pill (id="tg") into the top nav — or skips
 * injection if the page already carries its own #tg button.
 */
(function () {
  var KEY = 'agenttool.mode';
  var root = document.documentElement;
  var mode;
  try { mode = localStorage.getItem(KEY); } catch (_) { /* private mode etc. */ }
  if (mode !== 'night' && mode !== 'dawn') mode = 'dawn';
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
})();
