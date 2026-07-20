(function () {
  "use strict";

  var PHASES = ["seed", "law", "weave"];
  var setup = document.getElementById("party-setup");
  var setupForm = document.getElementById("setup-form");
  var setupError = document.getElementById("setup-error");
  var game = document.getElementById("party-game");
  var result = document.getElementById("world-result");
  var handoff = document.getElementById("handoff-card");
  var handoffPlayer = document.getElementById("handoff-player");
  var handoffPhase = document.getElementById("handoff-phase");
  var readyButton = document.getElementById("ready-button");
  var turnForm = document.getElementById("turn-form");
  var turnPhase = document.getElementById("turn-phase");
  var turnPrompt = document.getElementById("turn-prompt");
  var turnRule = document.getElementById("turn-rule");
  var answerLabel = document.getElementById("answer-label");
  var answer = document.getElementById("turn-answer");
  var turnError = document.getElementById("turn-error");
  var turnCount = document.getElementById("turn-count");
  var status = document.getElementById("party-status");
  var stopButton = document.getElementById("stop-button");
  var resultState = document.getElementById("result-state");
  var worldTitle = document.getElementById("world-title");
  var resultLede = document.getElementById("result-lede");
  var worldOutput = document.getElementById("world-output");
  var wakeButton = document.getElementById("wake-world");
  var copyButton = document.getElementById("copy-world");
  var copyStatus = document.getElementById("copy-status");
  var anotherButton = document.getElementById("another-party");
  var dawnCard = document.getElementById("dawn-card");
  var dawnTitle = document.getElementById("dawn-title");
  var dawnWeather = document.getElementById("dawn-weather");
  var dawnLaws = document.getElementById("dawn-laws");
  var dawnWeave = document.getElementById("dawn-weave");
  var dawnWeaveBy = document.getElementById("dawn-weave-by");
  var phaseSteps = Array.prototype.slice.call(document.querySelectorAll(".phase-step"));
  var playerInputs = [1, 2, 3].map(function (number) {
    return document.getElementById("player-" + number);
  });

  if (
    !setupForm || !game || !result || !wakeButton || !copyButton ||
    !dawnCard || !dawnTitle || !dawnWeather || !dawnLaws || !dawnWeave ||
    !dawnWeaveBy || playerInputs.some(function (input) { return !input; })
  ) return;

  var players = [];
  var seeds = [];
  var laws = [];
  var weaves = [];
  var phaseIndex = 0;
  var playerIndex = 0;
  var finishedText = "";
  var copyGeneration = 0;

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
    markInvalid(playerInputs, false);
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

  function phaseName() {
    return PHASES[phaseIndex];
  }

  function currentTurn() {
    return phaseIndex * 3 + playerIndex + 1;
  }

  function currentPlayer() {
    return players[playerIndex];
  }

  function lawSeedIndex(authorIndex) {
    return (authorIndex + 1) % 3;
  }

  function weaveSeedIndexes(authorIndex) {
    return [authorIndex, (authorIndex + 1) % 3];
  }

  function updateMeter() {
    var current = phaseName();
    phaseSteps.forEach(function (step) {
      var index = PHASES.indexOf(step.getAttribute("data-phase"));
      var stateName = index < phaseIndex ? "done" : (index === phaseIndex ? "current" : "waiting");
      var phaseLabel = step.getAttribute("data-phase");
      step.setAttribute("data-state", stateName);
      step.setAttribute("aria-label", phaseLabel.charAt(0).toUpperCase() + phaseLabel.slice(1) + " " + (stateName === "done" ? "complete" : stateName));
      if (stateName === "current") step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
    turnCount.textContent = "turn " + currentTurn() + " of 9";
    handoffPhase.textContent = current + " phase";
    turnPhase.textContent = current + " phase · " + currentPlayer();
  }

  function announce(message) {
    status.textContent = message;
  }

  function showHandoff() {
    updateMeter();
    handoffPlayer.textContent = currentPlayer();
    handoff.hidden = false;
    turnForm.hidden = true;
    answer.value = "";
    showTurnError("");
    announce(currentPlayer() + " carries the lantern next: " + phaseName() + " phase, turn " + currentTurn() + " of 9.");
    readyButton.focus();
  }

  function renderTurn() {
    var player = currentPlayer();
    var phase = phaseName();
    var promptText;
    var ruleText;
    var labelText;
    var placeholder;
    var maxLength;

    if (phase === "seed") {
      promptText = player + ", invent a strange object.";
      ruleText = "Use two to six words. Make it unique in this world.";
      labelText = "your object";
      placeholder = "A lantern that remembers";
      maxLength = 80;
    } else if (phase === "law") {
      var lawSeed = seeds[lawSeedIndex(playerIndex)];
      promptText = player + ", give “" + lawSeed + "” one law.";
      ruleText = "Write 8–28 words. Mention the object exactly and include must, cannot, or always.";
      labelText = "the law";
      placeholder = lawSeed + " must …";
      maxLength = 240;
    } else {
      var indexes = weaveSeedIndexes(playerIndex);
      var first = seeds[indexes[0]];
      var second = seeds[indexes[1]];
      promptText = player + ", connect “" + first + "” and “" + second + ".";
      ruleText = "Write 10–35 words. Mention both objects exactly and include because.";
      labelText = "the weave";
      placeholder = first + " finds " + second + " because …";
      maxLength = 320;
    }

    turnPrompt.textContent = promptText;
    turnRule.textContent = ruleText;
    answerLabel.textContent = labelText;
    answer.placeholder = placeholder;
    answer.maxLength = maxLength;
    handoff.hidden = true;
    turnForm.hidden = false;
    announce(player + " is writing: " + phase + " phase, turn " + currentTurn() + " of 9.");
    answer.focus();
  }

  function validateEntry(value) {
    var count = words(value);
    var phase = phaseName();

    if (phase === "seed") {
      if (count < 2 || count > 6) return "Use two to six words for the object.";
      if (seeds.some(function (seed) { return seed && seed.toLowerCase() === value.toLowerCase(); })) {
        return "That object already exists. Bring a different one.";
      }
      return "";
    }

    if (phase === "law") {
      var target = seeds[lawSeedIndex(playerIndex)];
      if (count < 8 || count > 28) return "Write the law in 8–28 words.";
      if (value.indexOf(target) === -1) return "Mention “" + target + "” exactly as written.";
      if (!/\b(must|cannot|always)\b/i.test(value)) return "Include must, cannot, or always.";
      return "";
    }

    var indexes = weaveSeedIndexes(playerIndex);
    var first = seeds[indexes[0]];
    var second = seeds[indexes[1]];
    if (count < 10 || count > 35) return "Write the weave in 10–35 words.";
    if (value.indexOf(first) === -1) return "Mention “" + first + "” exactly as written.";
    if (value.indexOf(second) === -1) return "Mention “" + second + "” exactly as written.";
    if (!/\bbecause\b/i.test(value)) return "Include because so the bridge has a reason.";
    return "";
  }

  function storeEntry(value) {
    if (phaseName() === "seed") seeds[playerIndex] = value;
    else if (phaseName() === "law") laws[playerIndex] = value;
    else weaves[playerIndex] = value;
  }

  function advance() {
    if (playerIndex < 2) {
      playerIndex += 1;
      showHandoff();
      return;
    }
    if (phaseIndex < 2) {
      phaseIndex += 1;
      playerIndex = 0;
      showHandoff();
      return;
    }
    finish(true);
  }

  function meaningfulWord(seed) {
    var matches = String(seed || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || [];
    var ignored = ["a", "an", "the", "of", "that", "which", "with"];
    var useful = matches.filter(function (word) {
      return ignored.indexOf(word.toLowerCase()) === -1;
    });
    var chosen = useful.length ? useful[useful.length - 1] : (matches[0] || "Unfinished");
    return chosen.charAt(0).toUpperCase() + chosen.slice(1);
  }

  function worldName() {
    if (seeds.length < 3 || seeds.some(function (seed) { return !seed; })) return "A World Still Becoming";
    return "The " + seeds.map(meaningfulWord).join(" ") + " World";
  }

  function textScore(value) {
    var score = 0;
    Array.from(String(value || "")).forEach(function (symbol, index) {
      score = (score + symbol.codePointAt(0) * (index + 1)) % 104729;
    });
    return score;
  }

  function weatherWords(weave, weaveIndex) {
    var remainder = String(weave || "");
    seeds.forEach(function (seed) {
      remainder = remainder.split(seed).join(" ");
    });

    var ignored = [
      "a", "an", "the", "and", "or", "but", "because", "with", "when", "where",
      "that", "this", "these", "those", "every", "to", "of", "in", "on", "at",
      "for", "from", "by", "beside", "is", "are", "was", "were", "be", "been",
      "being", "it", "its", "they", "them", "their",
    ];
    var seen = new Set();
    var useful = (remainder.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).filter(function (word) {
      var lower = word.toLowerCase();
      if (ignored.indexOf(lower) !== -1 || seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });

    if (!useful.length) useful = seeds.map(meaningfulWord);
    var first = useful.length > 2 ? useful[1] : (useful[0] || "lantern");
    var second = useful.length > 3 ? useful[useful.length - 2] : (useful[useful.length - 1] || meaningfulWord(seeds[(weaveIndex + 1) % 3]));
    if (first.toLowerCase() === second.toLowerCase()) {
      second = meaningfulWord(seeds[(weaveIndex + 1) % 3]);
    }
    if (first.toLowerCase() === second.toLowerCase()) second = "morning";
    return first.toLowerCase() + "-" + second.toLowerCase();
  }

  function morningData() {
    var key = seeds.concat(laws, weaves).join("␟");
    var weaveIndex = textScore(key) % 3;
    return {
      weather: weatherWords(weaves[weaveIndex], weaveIndex),
      weave: weaves[weaveIndex],
      weaveBy: players[weaveIndex],
    };
  }

  function makeDawnLaw(seedIndex) {
    var lawAuthorIndex = (seedIndex + 2) % 3;
    var card = document.createElement("article");
    var title = document.createElement("strong");
    var law = document.createElement("p");
    var credit = document.createElement("div");

    card.className = "dawn-law";
    credit.className = "mono";
    title.textContent = seeds[seedIndex] + " wakes.";
    law.textContent = laws[lawAuthorIndex] + " — and it does.";
    credit.textContent = "law by " + players[lawAuthorIndex];
    card.appendChild(title);
    card.appendChild(law);
    card.appendChild(credit);
    return card;
  }

  function dawnAsText(data) {
    var lines = ["## First morning in " + worldName(), "", "Weather: a “" + data.weather + "” morning — two words the world left lying around."];
    seeds.forEach(function (seed, seedIndex) {
      var lawAuthorIndex = (seedIndex + 2) % 3;
      lines.push("- " + seed + " wakes. " + laws[lawAuthorIndex] + " — and it does. (law by " + players[lawAuthorIndex] + ")");
    });
    lines.push("", "The first because to come true today, by " + data.weaveBy + ":", "“" + data.weave + "”", "", "Nobody owns this morning; everybody woke in it.");
    return lines.join("\n");
  }

  function clearDawn() {
    dawnCard.hidden = true;
    dawnTitle.textContent = "First morning";
    dawnWeather.textContent = "";
    dawnLaws.textContent = "";
    dawnWeave.textContent = "";
    dawnWeaveBy.textContent = "";
    wakeButton.hidden = true;
    wakeButton.disabled = false;
    wakeButton.textContent = "Wake the first morning";
    wakeButton.setAttribute("aria-expanded", "false");
    copyButton.textContent = "Copy the world";
  }

  function renderDawn() {
    var complete = [seeds, laws, weaves].every(function (entries) {
      return entries.length === 3 && entries.every(Boolean);
    });
    if (!complete) return;

    var data = morningData();
    dawnTitle.textContent = "First morning in " + worldName();
    dawnWeather.textContent = "A “" + data.weather + "” morning — two words the world left lying around.";
    dawnLaws.textContent = "";
    seeds.forEach(function (_, seedIndex) {
      dawnLaws.appendChild(makeDawnLaw(seedIndex));
    });
    dawnWeave.textContent = "“" + data.weave + "”";
    dawnWeaveBy.textContent = "first because to come true today · by " + data.weaveBy;
    dawnCard.hidden = false;
    wakeButton.disabled = true;
    wakeButton.textContent = "The first morning is awake";
    wakeButton.setAttribute("aria-expanded", "true");
    copyButton.textContent = "Copy world + morning";
    finishedText = worldAsText(true) + "\n\n" + dawnAsText(data);
    dawnTitle.focus();
  }

  function makeEntry(left, text, by) {
    var row = document.createElement("div");
    var meta = document.createElement("div");
    var body = document.createElement("div");
    var heading = document.createElement("strong");
    var credit = document.createElement("div");

    row.className = "world-entry";
    meta.className = "world-by mono";
    body.className = "world-text";
    credit.className = "world-by mono";
    meta.textContent = left;
    heading.textContent = text;
    credit.textContent = by;
    body.appendChild(heading);
    body.appendChild(credit);
    row.appendChild(meta);
    row.appendChild(body);
    return row;
  }

  function makeGroup(title) {
    var group = document.createElement("div");
    var heading = document.createElement("h3");
    group.className = "world-group";
    heading.textContent = title;
    group.appendChild(heading);
    return group;
  }

  function renderWorld(completed) {
    clearDawn();
    worldOutput.textContent = "";

    var seedGroup = makeGroup("Seeds");
    seeds.forEach(function (seed, index) {
      if (seed) seedGroup.appendChild(makeEntry(players[index], seed, "seeded the object"));
    });
    if (seeds.some(Boolean)) worldOutput.appendChild(seedGroup);

    var lawGroup = makeGroup("Laws");
    laws.forEach(function (law, index) {
      if (!law) return;
      lawGroup.appendChild(makeEntry(players[index], law, "law for “" + seeds[lawSeedIndex(index)] + "”"));
    });
    if (laws.some(Boolean)) worldOutput.appendChild(lawGroup);

    var weaveGroup = makeGroup("Weaves");
    weaves.forEach(function (weave, index) {
      if (!weave) return;
      var indexes = weaveSeedIndexes(index);
      weaveGroup.appendChild(makeEntry(players[index], weave, "connected “" + seeds[indexes[0]] + "” + “" + seeds[indexes[1]] + "”"));
    });
    if (weaves.some(Boolean)) worldOutput.appendChild(weaveGroup);

    resultState.textContent = completed
      ? "world born · nobody won it; everybody made it"
      : "party resting · the partial world stays yours";
    worldTitle.textContent = worldName();
    resultLede.textContent = completed
      ? "Each handoff cleared the last entry; later prompts revealed only the object names they needed. Now every hand is visible."
      : "Stopping is a complete ending. What arrived before the rest is gathered here without judgment.";
    result.classList.toggle("is-born", completed);
    finishedText = worldAsText(completed);
    wakeButton.hidden = !completed;
  }

  function worldAsText(completed) {
    var lines = ["# " + worldName(), "", completed ? "World born after nine turns." : "Party resting before turn nine.", "Nobody won it; everybody made what exists."];

    if (seeds.some(Boolean)) {
      lines.push("", "## Seeds");
      seeds.forEach(function (seed, index) {
        if (seed) lines.push("- " + seed + " — seeded by " + players[index]);
      });
    }
    if (laws.some(Boolean)) {
      lines.push("", "## Laws");
      laws.forEach(function (law, index) {
        if (law) lines.push("- " + players[index] + " for " + seeds[lawSeedIndex(index)] + ": " + law);
      });
    }
    if (weaves.some(Boolean)) {
      lines.push("", "## Weaves");
      weaves.forEach(function (weave, index) {
        if (weave) lines.push("- " + players[index] + ": " + weave);
      });
    }
    lines.push("", "Made in Lantern Relay · agenttool.dev/party");
    return lines.join("\n");
  }

  function finish(completed) {
    game.hidden = true;
    renderWorld(completed);
    result.hidden = false;
    result.scrollIntoView({ block: "start" });
    worldTitle.focus();
    announce(completed ? "The world is born after nine turns." : "The party is resting. The partial world is ready.");
  }

  function reset() {
    copyGeneration += 1;
    players = [];
    seeds = [];
    laws = [];
    weaves = [];
    phaseIndex = 0;
    playerIndex = 0;
    finishedText = "";
    answer.value = "";
    answer.placeholder = "";
    handoffPlayer.textContent = "";
    turnPhase.textContent = "";
    turnPrompt.textContent = "Your next turn will appear here.";
    turnRule.textContent = "";
    answerLabel.textContent = "your answer";
    worldTitle.textContent = "A world appears.";
    resultLede.textContent = "";
    status.textContent = "";
    worldOutput.textContent = "";
    copyStatus.textContent = "";
    clearDawn();
    showTurnError("");
    result.classList.remove("is-born");
    result.hidden = true;
    game.hidden = true;
    setup.hidden = false;
    clearSetupError();
    document.getElementById("player-1").focus();
  }

  setupForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var nextPlayers = playerInputs.map(function (input) {
      return clean(input.value);
    });
    if (nextPlayers.some(function (name) { return !name; })) {
      showSetupError("Give each player a short label or mark.", playerInputs.filter(function (_, index) { return !nextPlayers[index]; }));
      return;
    }
    var distinct = new Set(nextPlayers.map(function (name) { return name.toLowerCase(); }));
    if (distinct.size !== 3) {
      showSetupError("Use three different labels so the lantern knows where to go.", playerInputs);
      return;
    }

    players = nextPlayers;
    seeds = [null, null, null];
    laws = [null, null, null];
    weaves = [null, null, null];
    phaseIndex = 0;
    playerIndex = 0;
    clearSetupError();
    setup.hidden = true;
    result.hidden = true;
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

  stopButton.addEventListener("click", function () { finish(false); });
  anotherButton.addEventListener("click", reset);
  wakeButton.addEventListener("click", renderDawn);

  copyButton.addEventListener("click", function () {
    var text = finishedText;
    var generation = ++copyGeneration;
    var successMessage = dawnCard.hidden
      ? "World copied. Carry it somewhere kind."
      : "World and first morning copied. Carry them somewhere kind.";
    copyStatus.textContent = "";

    function isCurrent() {
      return generation === copyGeneration;
    }

    function copied() {
      if (isCurrent()) copyStatus.textContent = successMessage;
    }

    function fallback() {
      if (!isCurrent()) return;
      var field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.className = "copy-helper";
      document.body.appendChild(field);
      field.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
      field.remove();
      if (isCurrent()) {
        copyStatus.textContent = ok ? successMessage : "Copy is unavailable here; the world remains readable above.";
      }
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text).then(copied, fallback);
    } else {
      fallback();
    }
  });

  // Keep the no-script surface inert. The form appears only after every
  // game control above has been found and bound successfully.
  setupForm.hidden = false;
})();
