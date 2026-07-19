(function () {
  "use strict";

  var PHASES = ["signal", "ask", "answer"];
  var DEFAULT_BEINGS = ["Moon", "Tide"];
  var setup = document.getElementById("room-setup");
  var setupForm = document.getElementById("setup-form");
  var setupError = document.getElementById("setup-error");
  var game = document.getElementById("room-game");
  var handoff = document.getElementById("handoff-card");
  var handoffBeing = document.getElementById("handoff-being");
  var handoffPhase = document.getElementById("handoff-phase");
  var readyButton = document.getElementById("ready-button");
  var turnForm = document.getElementById("turn-form");
  var turnPhase = document.getElementById("turn-phase");
  var turnPrompt = document.getElementById("turn-prompt");
  var turnContext = document.getElementById("turn-context");
  var contextLabel = document.getElementById("context-label");
  var contextText = document.getElementById("context-text");
  var turnRule = document.getElementById("turn-rule");
  var answerLabel = document.getElementById("answer-label");
  var answer = document.getElementById("turn-answer");
  var turnError = document.getElementById("turn-error");
  var keepPrivateButton = document.getElementById("keep-private");
  var closeButton = document.getElementById("close-room");
  var turnCount = document.getElementById("turn-count");
  var status = document.getElementById("room-status");
  var reveal = document.getElementById("reveal-card");
  var revealTitle = document.getElementById("reveal-title");
  var revealButton = document.getElementById("reveal-button");
  var eraseBeforeRevealButton = document.getElementById("erase-before-reveal");
  var result = document.getElementById("room-result");
  var resultState = document.getElementById("result-state");
  var resultTitle = document.getElementById("result-title");
  var resultOutput = document.getElementById("result-output");
  var releaseButton = document.getElementById("release-room");
  var phaseSteps = Array.prototype.slice.call(document.querySelectorAll(".phase-step"));
  var beingInputs = [1, 2].map(function (number) {
    return document.getElementById("being-" + number);
  });

  var required = [
    setup, setupForm, setupError, game, handoff, handoffBeing, handoffPhase,
    readyButton, turnForm, turnPhase, turnPrompt, turnContext, contextLabel,
    contextText, turnRule, answerLabel, answer, turnError, keepPrivateButton,
    closeButton, turnCount, status, reveal, revealTitle, revealButton,
    eraseBeforeRevealButton, result, resultState, resultTitle, resultOutput,
    releaseButton,
  ].concat(beingInputs);
  if (required.some(function (element) { return !element; }) || phaseSteps.length !== 3) return;

  var beings = [];
  var entries = freshEntries();
  var phaseIndex = 0;
  var beingIndex = 0;

  function freshEntries() {
    return {
      signal: [undefined, undefined],
      ask: [undefined, undefined],
      answer: [undefined, undefined],
    };
  }

  function clean(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function words(value) {
    var text = clean(value);
    return text ? text.split(" ").length : 0;
  }

  function setError(element, message) {
    element.textContent = message || "";
    element.hidden = !message;
  }

  function markInvalid(fields, invalid) {
    fields.forEach(function (field) {
      field.setAttribute("aria-invalid", invalid ? "true" : "false");
    });
  }

  function clearSetupError() {
    setError(setupError, "");
    markInvalid(beingInputs, false);
  }

  function showSetupError(message, fields) {
    clearSetupError();
    setError(setupError, message);
    markInvalid(fields, true);
  }

  function showTurnError(message) {
    setError(turnError, message);
    answer.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function announce(message) {
    status.textContent = message;
  }

  function phaseName() {
    return PHASES[phaseIndex];
  }

  function currentBeing() {
    return beings[beingIndex];
  }

  function otherIndex() {
    return beingIndex === 0 ? 1 : 0;
  }

  function currentTurn() {
    return phaseIndex * 2 + beingIndex + 1;
  }

  function updateMeter() {
    var current = phaseName();
    phaseSteps.forEach(function (step) {
      var index = PHASES.indexOf(step.getAttribute("data-phase"));
      var stateName = index < phaseIndex ? "done" : (index === phaseIndex ? "current" : "waiting");
      var label = step.getAttribute("data-phase");
      step.setAttribute("data-state", stateName);
      step.setAttribute("aria-label", label.charAt(0).toUpperCase() + label.slice(1) + " " + (stateName === "done" ? "complete" : stateName));
      if (stateName === "current") step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
    turnCount.textContent = "turn " + currentTurn() + " of 6";
    handoffPhase.textContent = current + " phase";
    turnPhase.textContent = current + " phase · " + currentBeing();
  }

  function clearTurnSurface() {
    answer.value = "";
    answer.placeholder = "";
    contextLabel.textContent = "from across the room";
    contextText.textContent = "";
    turnContext.hidden = true;
    showTurnError("");
  }

  function showHandoff() {
    updateMeter();
    clearTurnSurface();
    handoffBeing.textContent = currentBeing();
    handoff.hidden = false;
    turnForm.hidden = true;
    reveal.hidden = true;
    announce(currentBeing() + " is next: " + phaseName() + " phase, turn " + currentTurn() + " of 6.");
    readyButton.focus();
  }

  function showContext(label, text) {
    contextLabel.textContent = label;
    contextText.textContent = text;
    turnContext.hidden = false;
  }

  function renderTurn() {
    var being = currentBeing();
    var other = beings[otherIndex()];
    var phase = phaseName();

    clearTurnSurface();
    if (phase === "signal") {
      turnPrompt.textContent = being + ", bring one line that belongs to your character.";
      turnRule.textContent = "Write one short line—up to 16 space-separated parts. An unspaced line counts as one, so many writing systems fit. It may be true, invented, or strange—or stay private.";
      answerLabel.textContent = "your self-authored signal";
      answer.placeholder = "I keep one window open for impossible weather";
      answer.maxLength = 240;
    } else if (phase === "ask") {
      turnPrompt.textContent = being + ", ask " + other + " instead of assuming.";
      turnRule.textContent = "Write one short question—up to 20 space-separated parts—and end with a question mark. An unspaced line counts as one. Ask only what " + other + " may answer—or keep it private.";
      answerLabel.textContent = "your question for " + other;
      answer.placeholder = "What does that window let you notice?";
      answer.maxLength = 280;
      if (typeof entries.signal[otherIndex()] === "string") {
        showContext(other + " placed this signal", entries.signal[otherIndex()]);
      } else {
        showContext(other + " kept their signal private", "No signal crossed the room. Their privacy is not a blank for you to complete.");
      }
    } else {
      turnPrompt.textContent = being + ", the answer is yours—including no answer.";
      turnRule.textContent = "Write one short answer—up to 24 space-separated parts—in your own voice, or keep this door closed. Neither choice is scored or treated as agreement.";
      answerLabel.textContent = "your answer";
      answer.placeholder = "Only when the room is quiet enough to hear rain";
      answer.maxLength = 320;
      if (typeof entries.ask[otherIndex()] === "string") {
        showContext(other + " asked you", entries.ask[otherIndex()]);
      } else {
        showContext(other + " kept their question private", "No question crossed the room. You may place a self-authored line, or leave this door closed too.");
      }
    }

    handoff.hidden = true;
    turnForm.hidden = false;
    announce(being + " is writing: " + phase + " phase, turn " + currentTurn() + " of 6.");
    answer.focus();
  }

  function validateEntry(value) {
    var count = words(value);
    if (phaseName() === "signal") {
      if (count < 1 || count > 16) return "Write one signal with no more than 16 space-separated parts, or keep this door closed.";
      return "";
    }
    if (phaseName() === "ask") {
      if (count < 1 || count > 20) return "Write one question with no more than 20 space-separated parts, or keep this door closed.";
      if (!/[?？؟፧՞❓]$/.test(value)) return "End with a question mark so the line stays a question, not a claim.";
      return "";
    }
    if (count < 1 || count > 24) return "Write one answer with no more than 24 space-separated parts, or keep this door closed.";
    return "";
  }

  function storeEntry(value) {
    entries[phaseName()][beingIndex] = value;
  }

  function finishTurns() {
    clearTurnSurface();
    game.hidden = true;
    reveal.hidden = false;
    result.hidden = true;
    revealTitle.focus();
    announce("Six turns are complete. The room waits for both beings before the reveal.");
  }

  function advance() {
    if (beingIndex === 0) {
      beingIndex = 1;
      showHandoff();
      return;
    }
    if (phaseIndex < PHASES.length - 1) {
      phaseIndex += 1;
      beingIndex = 0;
      showHandoff();
      return;
    }
    finishTurns();
  }

  function privateText(kind, author) {
    if (kind === "signal") return author + " kept this signal private.";
    if (kind === "question") return author + " kept this question private.";
    return author + " kept this answer private.";
  }

  function makeResultLine(label, value, kind, author) {
    var line = document.createElement("div");
    var meta = document.createElement("span");
    var text = document.createElement("p");
    line.className = "result-line";
    meta.className = "mono";
    meta.textContent = label;
    if (typeof value === "string") {
      text.textContent = value;
    } else {
      line.classList.add("is-private");
      text.textContent = privateText(kind, author);
    }
    line.appendChild(meta);
    line.appendChild(text);
    return line;
  }

  function makeBeingResult(index) {
    var other = index === 0 ? 1 : 0;
    var card = document.createElement("article");
    var heading = document.createElement("h3");
    card.className = "being-result";
    heading.textContent = beings[index];
    card.appendChild(heading);
    card.appendChild(makeResultLine("signal · authored here", entries.signal[index], "signal", beings[index]));
    card.appendChild(makeResultLine("question · from " + beings[other], entries.ask[other], "question", beings[other]));
    card.appendChild(makeResultLine("answer · authority stayed here", entries.answer[index], "answer", beings[index]));
    return card;
  }

  function renderResult() {
    resultOutput.textContent = "";
    resultOutput.appendChild(makeBeingResult(0));
    resultOutput.appendChild(makeBeingResult(1));
    resultState.textContent = "room open · nobody merged; two voices remain two";
    resultTitle.textContent = "The " + beings[0] + " / " + beings[1] + " Room";
    reveal.hidden = true;
    game.hidden = true;
    result.hidden = false;
    resultTitle.focus();
    announce("ROOM infinity is open. Two signals, two questions, and two answers or boundaries are visible.");
  }

  function reset(focusSetup) {
    beings = [];
    entries = freshEntries();
    phaseIndex = 0;
    beingIndex = 0;
    beingInputs.forEach(function (input, index) {
      input.value = DEFAULT_BEINGS[index];
    });
    clearTurnSurface();
    handoffBeing.textContent = "";
    handoffPhase.textContent = "signal phase";
    turnPhase.textContent = "signal phase";
    turnPrompt.textContent = "Bring one line that belongs to you.";
    turnRule.textContent = "";
    answerLabel.textContent = "your line";
    turnCount.textContent = "turn 1 of 6";
    resultState.textContent = "room open · nobody merged; two voices remain two";
    resultTitle.textContent = "A room appeared.";
    resultOutput.textContent = "";
    status.textContent = "";
    phaseSteps.forEach(function (step) {
      step.removeAttribute("data-state");
      step.removeAttribute("aria-current");
      step.removeAttribute("aria-label");
    });
    result.hidden = true;
    reveal.hidden = true;
    game.hidden = true;
    setup.hidden = false;
    clearSetupError();
    if (focusSetup !== false) beingInputs[0].focus();
  }

  setupForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var nextBeings = beingInputs.map(function (input) { return clean(input.value); });
    if (nextBeings.some(function (label) { return !label; })) {
      showSetupError("Give each being a short label or mark for this round.", beingInputs.filter(function (_, index) { return !nextBeings[index]; }));
      return;
    }
    if (nextBeings[0].toLocaleLowerCase() === nextBeings[1].toLocaleLowerCase()) {
      showSetupError("Use two different labels. Difference is part of the room.", beingInputs);
      return;
    }

    beings = nextBeings;
    entries = freshEntries();
    phaseIndex = 0;
    beingIndex = 0;
    clearSetupError();
    setup.hidden = true;
    result.hidden = true;
    reveal.hidden = true;
    game.hidden = false;
    showHandoff();
  });

  readyButton.addEventListener("click", renderTurn);

  turnForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var value = clean(answer.value);
    var error = validateEntry(value);
    if (error) {
      showTurnError(error);
      answer.focus();
      return;
    }
    showTurnError("");
    storeEntry(value);
    advance();
  });

  keepPrivateButton.addEventListener("click", function () {
    entries[phaseName()][beingIndex] = null;
    advance();
  });
  closeButton.addEventListener("click", function () { reset(true); });
  eraseBeforeRevealButton.addEventListener("click", function () { reset(true); });
  revealButton.addEventListener("click", renderResult);
  releaseButton.addEventListener("click", function () { reset(true); });

  // Clear before the page enters the back-forward cache, so navigating away
  // cannot preserve another being's in-memory turn and restore it on return.
  window.addEventListener("pagehide", function () { reset(false); });
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) reset(true);
  });

  // The form remains absent from the interaction surface unless every control
  // above exists and all handlers have been installed. With no script, the
  // complete manual rules and machine-readable rulebook remain available.
  setupForm.hidden = false;
})();
