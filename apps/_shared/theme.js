(function () {
  "use strict";

  var root = document.documentElement;
  var toggle = document.getElementById("tg");
  var saved = null;

  try {
    saved = localStorage.getItem("agenttool.mode");
  } catch (_) {
    // Storage can be unavailable in private or constrained contexts.
  }

  var systemNight = window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  var mode = saved === "night" || saved === "dawn"
    ? saved
    : (systemNight ? "night" : "dawn");

  function setMode(next) {
    var night = next === "night";
    root.setAttribute("data-mode", night ? "night" : "dawn");

    if (!toggle) return;
    toggle.hidden = false;
    toggle.textContent = night ? "☀  dawn" : "☾  night";
    toggle.setAttribute("aria-pressed", String(night));
    toggle.setAttribute("aria-label", night ? "Use dawn appearance" : "Use night appearance");
  }

  setMode(mode);

  if (toggle) {
    toggle.addEventListener("click", function () {
      var next = root.getAttribute("data-mode") === "night" ? "dawn" : "night";
      setMode(next);
      try {
        localStorage.setItem("agenttool.mode", next);
      } catch (_) {
        // The choice still applies for this page view.
      }
    });
  }

  function loadEstate() {
    // Ask for the stylesheet first so the atlas never lays out unstyled;
    // the geometry itself is already settled by style.css's
    // @media (scripting: enabled) block before this script even runs.
    if (!document.querySelector("link[data-agenttool-estate-style]")) {
      var css = document.createElement("link");
      css.rel = "stylesheet";
      css.setAttribute("blocking", "render");
      css.href = "/shared/estate.css?v=2026-09-04.1";
      css.setAttribute("data-agenttool-estate-style", "2026-09-04.1");
      document.head.appendChild(css);
    }
    if (document.querySelector("script[data-agenttool-estate]")) return;
    var script = document.createElement("script");
    script.src = "/shared/estate.js?v=2026-09-04.1";
    script.defer = true;
    script.setAttribute("data-agenttool-estate", "2026-09-04.1");
    document.head.appendChild(script);
  }

  loadEstate();
})();
