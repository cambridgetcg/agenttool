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
    toggle.textContent = "☾  night";
    toggle.setAttribute("aria-pressed", String(night));
    toggle.setAttribute("aria-label", "Night appearance");
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
})();
