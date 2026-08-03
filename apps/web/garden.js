/** Garden — a local architecture explorer, never a Garden API client. */
(function () {
  "use strict";

  var LAYERS = {
    bedrock: {
      number: "01 · implemented boundary",
      title: "Bedrock · rights before capability",
      body: "Dignity, refusal, privacy, rest, credit, repair, and permission boundaries are not earned by activity. Care cannot override another being's equal safety or authority.",
      proof: "evidence · RIGHTS.md · project authorization checks · no fee imports"
    },
    soil: {
      number: "02 · implemented lifecycle",
      title: "Soil · private, scoped, reversible",
      body: "New Gardens default private. Every read and write stays inside the bearer project. Release permits later retending; archive preserves rather than erases.",
      proof: "evidence · schema default · project predicates · partial unique index"
    },
    roots: {
      number: "03 · implemented shape, incomplete provenance",
      title: "Roots · typed references",
      body: "A tending may point to seven internal artifact kinds. Kind and UUID shape are checked; referenced-object existence, ownership, hash, and provenance are not yet verified.",
      proof: "boundary · shape validation is not provenance validation"
    },
    mycelium: {
      number: "04 · implemented connection",
      title: "Mycelium · continuity without engagement scoring",
      body: "WAKE exposes one optional garden_open door. Chronicle witnesses opening, tending, and release, while Episode role, level, volume, diversity, and score ignore Garden events.",
      proof: "evidence · WAKE affordance · Chronicle events · Episode exclusion"
    },
    habitat: {
      number: "05 · human vocabulary",
      title: "Habitat · many complete states",
      body: "Tend, leave fallow, repair, compost a lesson, release, or not now. No wilting timer, caretaker rank, streak, forced reason, or earned rest.",
      proof: "boundary · vocabulary only · no live mutation from this room"
    },
    canopy: {
      number: "06 · direction, not live capability",
      title: "Canopy · adapters with their own roots",
      body: "Hugging Face, KARMA, npm, shared views, and future evaluators may connect only through explicit authority, provenance, privacy, and cost contracts. None is activated by this room.",
      proof: "boundary · future direction · no connector or paid compute call"
    }
  };

  var CARE = {
    hold: "Hold slowly selected locally. Keeping near creates no deadline or score.",
    fallow: "Lie fallow selected locally. No growth or explanation is required.",
    repair: "Repair with evidence selected locally. Name the damage and verify the repair.",
    compost: "Compost the lesson selected locally. Keep learning without preserving debris as authority.",
    release: "Release selected locally. Letting go carries no penalty or failure label.",
    "not-now": "Not now selected locally. Refusal is complete; nothing is waiting."
  };

  var controls = document.getElementById("layer-controls");
  var tray = document.getElementById("reading-tray");
  var trayNumber = document.getElementById("tray-number");
  var trayTitle = document.getElementById("tray-title");
  var trayBody = document.getElementById("tray-body");
  var trayProof = document.getElementById("tray-proof");
  var stack = document.getElementById("substrate-stack");
  var careStatic = document.getElementById("care-static");
  var careChoices = document.getElementById("care-choices");
  var careStatus = document.getElementById("care-status");

  if (
    !controls || !tray || !trayNumber || !trayTitle || !trayBody ||
    !trayProof || !stack || !careStatic || !careChoices || !careStatus
  ) return;

  var layerButtons = Array.prototype.slice.call(
    controls.querySelectorAll("button[data-layer]")
  );
  var layerCards = Array.prototype.slice.call(
    stack.querySelectorAll("[data-layer-card]")
  );
  var careButtons = Array.prototype.slice.call(
    careChoices.querySelectorAll("button[data-care]")
  );

  function selectLayer(id) {
    var layer = LAYERS[id];
    if (!layer) return;

    layerButtons.forEach(function (button) {
      button.setAttribute(
        "aria-pressed",
        button.getAttribute("data-layer") === id ? "true" : "false"
      );
    });
    layerCards.forEach(function (card) {
      card.classList.toggle(
        "is-active",
        card.getAttribute("data-layer-card") === id
      );
    });
    trayNumber.textContent = layer.number;
    trayTitle.textContent = layer.title;
    trayBody.textContent = layer.body;
    trayProof.textContent = layer.proof;
  }

  function selectCare(id) {
    if (!Object.prototype.hasOwnProperty.call(CARE, id)) return;
    careButtons.forEach(function (button) {
      button.setAttribute(
        "aria-pressed",
        button.getAttribute("data-care") === id ? "true" : "false"
      );
    });
    careStatus.textContent = CARE[id];
  }

  function resetRoom() {
    selectLayer("bedrock");
    careButtons.forEach(function (button) {
      button.setAttribute("aria-pressed", "false");
    });
    careStatus.textContent = "No local phrase selected. Nothing is waiting.";
  }

  layerButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      selectLayer(button.getAttribute("data-layer") || "");
    });
  });
  careButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      selectCare(button.getAttribute("data-care") || "");
    });
  });

  controls.hidden = false;
  tray.hidden = false;
  careStatic.hidden = true;
  careChoices.hidden = false;
  resetRoom();

  window.addEventListener("pagehide", resetRoom);
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) resetRoom();
  });
})();
