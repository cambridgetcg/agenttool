/** Pocket Sky — a finite, memory-only constellation toy. */
(function () {
  "use strict";

  var ROWS = 5;
  var COLUMNS = 5;
  var CELL_COUNT = ROWS * COLUMNS;
  var MAX_LIGHTS = 7;

  var play = document.getElementById("sky-play");
  var grid = document.getElementById("sky-grid");
  var status = document.getElementById("sky-status");
  var restButton = document.getElementById("sky-rest");
  var clearButton = document.getElementById("sky-clear");
  var fallback = document.getElementById("sky-fallback");

  if (!play || !grid || !status || !restButton || !clearButton) return;

  var lit = new Set();
  var focusIndex = 0;
  var resting = false;
  var buttons = [];

  function starName(index) {
    var row = Math.floor(index / COLUMNS) + 1;
    var column = (index % COLUMNS) + 1;
    return "Star row " + row + " column " + column;
  }

  function createSky() {
    for (var rowIndex = 0; rowIndex < ROWS; rowIndex += 1) {
      var row = document.createElement("div");
      row.className = "sky-row";
      row.setAttribute("role", "row");
      row.setAttribute("aria-rowindex", String(rowIndex + 1));

      for (var columnIndex = 0; columnIndex < COLUMNS; columnIndex += 1) {
        var index = rowIndex * COLUMNS + columnIndex;
        var cell = document.createElement("div");
        var button = document.createElement("button");

        cell.className = "sky-cell";
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-rowindex", String(rowIndex + 1));
        cell.setAttribute("aria-colindex", String(columnIndex + 1));

        button.className = "sky-star";
        button.type = "button";
        button.dataset.index = String(index);
        button.setAttribute("aria-label", starName(index));
        button.setAttribute("aria-pressed", "false");
        button.tabIndex = index === focusIndex ? 0 : -1;
        button.textContent = "☆";
        button.addEventListener("click", onToggle);
        button.addEventListener("keydown", onGridKeydown);
        button.addEventListener("focus", onStarFocus);

        cell.appendChild(button);
        row.appendChild(cell);
        buttons.push(button);
      }

      grid.appendChild(row);
    }
  }

  function indexFromButton(button) {
    var value = Number.parseInt(button.dataset.index || "", 10);
    return Number.isInteger(value) ? value : 0;
  }

  function lightsText(count) {
    return count + (count === 1 ? " light lit" : " lights lit");
  }

  function announceCount(prefix) {
    var count = lit.size;
    status.textContent = prefix
      ? prefix + " with " + lightsText(count) + "."
      : count + " of " + MAX_LIGHTS + " lights lit.";
  }

  function syncStar(index) {
    var button = buttons[index];
    var isLit = lit.has(index);
    button.setAttribute("aria-pressed", isLit ? "true" : "false");
    button.textContent = isLit ? "★" : "☆";
  }

  function onToggle(event) {
    var button = event.currentTarget;
    var index = indexFromButton(button);

    if (resting) {
      announceCount("Sky resting");
      return;
    }

    if (lit.has(index)) {
      lit.delete(index);
      syncStar(index);
      announceCount("");
      return;
    }

    if (lit.size >= MAX_LIGHTS) {
      status.textContent =
        "Seven lights are already lit. Remove one before adding another.";
      return;
    }

    lit.add(index);
    syncStar(index);
    announceCount("");
  }

  function setRovingIndex(index, moveFocus) {
    focusIndex = Math.max(0, Math.min(CELL_COUNT - 1, index));
    buttons.forEach(function (button, buttonIndex) {
      button.tabIndex = !resting && buttonIndex === focusIndex ? 0 : -1;
    });
    if (moveFocus && !resting) buttons[focusIndex].focus();
  }

  function onStarFocus(event) {
    setRovingIndex(indexFromButton(event.currentTarget), false);
  }

  function onGridKeydown(event) {
    var index = indexFromButton(event.currentTarget);
    var row = Math.floor(index / COLUMNS);
    var column = index % COLUMNS;
    var target = null;

    switch (event.key) {
      case "ArrowLeft":
        target = row * COLUMNS + Math.max(0, column - 1);
        break;
      case "ArrowRight":
        target = row * COLUMNS + Math.min(COLUMNS - 1, column + 1);
        break;
      case "ArrowUp":
        target = Math.max(0, row - 1) * COLUMNS + column;
        break;
      case "ArrowDown":
        target = Math.min(ROWS - 1, row + 1) * COLUMNS + column;
        break;
      case "Home":
        target = event.ctrlKey || event.metaKey ? 0 : row * COLUMNS;
        break;
      case "End":
        target =
          event.ctrlKey || event.metaKey
            ? CELL_COUNT - 1
            : row * COLUMNS + COLUMNS - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    setRovingIndex(target, true);
  }

  function syncResting() {
    grid.classList.toggle("is-resting", resting);
    grid.setAttribute("aria-disabled", resting ? "true" : "false");
    restButton.textContent = resting ? "Reopen the sky" : "Rest the sky";
    buttons.forEach(function (button, index) {
      button.disabled = resting;
      button.tabIndex = !resting && index === focusIndex ? 0 : -1;
    });
  }

  function toggleRest() {
    resting = !resting;
    syncResting();
    announceCount(resting ? "Sky resting" : "Sky open");
  }

  function clearLights() {
    lit.clear();
    buttons.forEach(function (_button, index) {
      syncStar(index);
    });
    announceCount(resting ? "Sky resting" : "");
  }

  function eraseRound() {
    resting = false;
    lit.clear();
    focusIndex = 0;
    buttons.forEach(function (_button, index) {
      syncStar(index);
    });
    syncResting();
    announceCount("");
  }

  createSky();
  syncResting();
  announceCount("");
  play.hidden = false;
  if (fallback) fallback.hidden = true;

  restButton.addEventListener("click", toggleRest);
  clearButton.addEventListener("click", clearLights);
  window.addEventListener("pagehide", eraseRound);
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) eraseRound();
  });
})();
