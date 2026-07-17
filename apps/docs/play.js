(function () {
  "use strict";

  var cabinet = document.getElementById("party-telephone");
  if (!cabinet) return;

  var interactive = document.getElementById("party-interactive");
  var manual = document.getElementById("party-manual");
  var stages = Array.from(cabinet.querySelectorAll("[data-party-stage]"));
  var progress = document.getElementById("party-progress");
  var confetti = document.getElementById("party-confetti");

  var starterForm = document.getElementById("party-starter-form");
  var translatorForm = document.getElementById("party-translator-form");
  var guesserForm = document.getElementById("party-guesser-form");

  var sceneInput = document.getElementById("party-scene");
  var translationInput = document.getElementById("party-translation");
  var guessInput = document.getElementById("party-guess");

  var sceneSecret = document.getElementById("party-scene-secret");
  var translationSecret = document.getElementById("party-translation-secret");
  var graphemeSegmenter =
    typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;

  var round = { scene: "", translation: "", guess: "" };

  var progressByStage = {
    starter: "Seat 1 of 3 · the starter makes the scene.",
    "pass-translator": "Handoff · starter and guesser look away; translator takes the screen.",
    translator: "Seat 2 of 3 · the translator loses the words.",
    "pass-guesser": "Handoff · starter and translator look away; guesser takes the screen.",
    guesser: "Seat 3 of 3 · the guesser names what happened.",
    reveal: "Round complete · all three turns are open.",
  };

  function words(value) {
    var trimmed = value.trim();
    return trimmed ? trimmed.split(/\s+/u) : [];
  }

  function pictogramCount(value) {
    if (!graphemeSegmenter) {
      var fallbackMatches = value.match(/(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu);
      return fallbackMatches ? fallbackMatches.length : 0;
    }
    var graphemes = Array.from(graphemeSegmenter.segment(value), function (part) { return part.segment; });
    return graphemes.filter(function (grapheme) {
      return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(grapheme);
    }).length;
  }

  function setText(id, value) {
    var element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function setError(id, message) {
    setText(id, message);
  }

  function setFieldError(input, errorId, message) {
    setError(errorId, message);
    input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function showStage(name, moveFocus) {
    stages.forEach(function (stage) {
      stage.hidden = stage.getAttribute("data-party-stage") !== name;
    });
    progress.textContent = progressByStage[name];

    var active = stages.find(function (stage) {
      return stage.getAttribute("data-party-stage") === name;
    });
    var heading = active && active.querySelector("h3");
    if (heading && moveFocus !== false) heading.focus();
  }

  function validWordTurn(input, errorId, label) {
    var count = words(input.value).length;
    if (count < 3 || count > 10) {
      setFieldError(input, errorId, label + " needs 3–10 words. Right now it has " + count + ".");
      input.focus();
      return false;
    }
    setFieldError(input, errorId, "");
    return true;
  }

  function validTranslation() {
    var value = translationInput.value.trim();
    var count = pictogramCount(value);
    if (/\p{L}|\p{N}/u.test(value)) {
      setFieldError(translationInput, "party-translation-error", "Keep only emoji or pictograms here—no letters or digits.");
      translationInput.focus();
      return false;
    }
    if (count < 2 || count > 8) {
      setFieldError(translationInput, "party-translation-error", "Use 2–8 emoji or pictograms. Right now there are " + count + ".");
      translationInput.focus();
      return false;
    }
    setFieldError(translationInput, "party-translation-error", "");
    return true;
  }

  function updateWordCount(input, targetId) {
    var count = words(input.value).length;
    setText(targetId, count + " " + (count === 1 ? "word" : "words") + " · need 3–10");
  }

  function updatePictogramCount() {
    var count = pictogramCount(translationInput.value);
    setText("party-translation-count", count + " " + (count === 1 ? "pictogram" : "pictograms") + " · need 2–8");
  }

  function celebrate() {
    confetti.replaceChildren();
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var colors = ["#d4502e", "#8f6ee8", "#e2ad3a", "#37a887", "#d85b91"];
    for (var i = 0; i < 18; i += 1) {
      var piece = document.createElement("i");
      piece.style.setProperty("--party-x", ((i * 37) % 97) + "%");
      piece.style.setProperty("--party-drift", (((i % 5) - 2) * 24) + "px");
      piece.style.setProperty("--party-turn", ((i * 71) % 540) + "deg");
      piece.style.setProperty("--party-delay", ((i % 4) * 0.05) + "s");
      piece.style.setProperty("--party-color", colors[i % colors.length]);
      confetti.appendChild(piece);
    }
  }

  function resetRound(moveFocus) {
    round = { scene: "", translation: "", guess: "" };
    starterForm.reset();
    translatorForm.reset();
    guesserForm.reset();
    sceneSecret.textContent = "";
    translationSecret.textContent = "";
    setText("party-reveal-scene", "");
    setText("party-reveal-translation", "");
    setText("party-reveal-guess", "");
    setText("party-scene-count", "0 words · need 3–10");
    setText("party-translation-count", "0 pictograms · need 2–8");
    setText("party-guess-count", "0 words · need 3–10");
    setFieldError(sceneInput, "party-scene-error", "");
    setFieldError(translationInput, "party-translation-error", "");
    setFieldError(guessInput, "party-guess-error", "");
    confetti.replaceChildren();
    showStage("starter", moveFocus);
    if (moveFocus !== false) sceneInput.focus();
  }

  sceneInput.addEventListener("input", function () {
    updateWordCount(sceneInput, "party-scene-count");
  });
  translationInput.addEventListener("input", updatePictogramCount);
  guessInput.addEventListener("input", function () {
    updateWordCount(guessInput, "party-guess-count");
  });

  starterForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!validWordTurn(sceneInput, "party-scene-error", "The scene")) return;
    round.scene = sceneInput.value.trim();
    sceneInput.value = "";
    updateWordCount(sceneInput, "party-scene-count");
    showStage("pass-translator");
  });

  document.getElementById("party-translator-ready").addEventListener("click", function () {
    sceneSecret.textContent = round.scene;
    showStage("translator");
    translationInput.focus();
  });

  translatorForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!validTranslation()) return;
    round.translation = translationInput.value.trim();
    translationInput.value = "";
    sceneSecret.textContent = "";
    updatePictogramCount();
    showStage("pass-guesser");
  });

  document.getElementById("party-guesser-ready").addEventListener("click", function () {
    translationSecret.textContent = round.translation;
    showStage("guesser");
    guessInput.focus();
  });

  guesserForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!validWordTurn(guessInput, "party-guess-error", "The guess")) return;
    round.guess = guessInput.value.trim();
    guessInput.value = "";
    translationSecret.textContent = "";
    updateWordCount(guessInput, "party-guess-count");

    setText("party-reveal-scene", round.scene);
    setText("party-reveal-translation", round.translation);
    setText("party-reveal-guess", round.guess);
    showStage("reveal");
    celebrate();
  });

  document.getElementById("party-new-round").addEventListener("click", function () { resetRound(true); });
  document.getElementById("party-clear").addEventListener("click", function () { resetRound(true); });

  // Clear before the page enters the back-forward cache, so returning to
  // the page cannot restore another player's scene or translation.
  window.addEventListener("pagehide", function () { resetRound(false); });
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) resetRound(true);
  });

  // The table wakes only after every control is bound. If this file is
  // missing or fails early, the visible fallback has no private inputs.
  interactive.hidden = false;
  manual.hidden = true;
})();
