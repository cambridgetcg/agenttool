(function () {
  "use strict";

  var ENDPOINT = "https://api.agenttool.dev/public/porch";
  var live = document.getElementById("porch-live");
  var status = document.getElementById("porch-status");
  var refresh = document.getElementById("porch-refresh");
  var leave = document.getElementById("leave-door");
  var leaveMessage = document.getElementById("leave-message");
  var loading = false;
  var invitationTimer = null;

  if (!live || !status || !refresh) return;
  live.hidden = false;

  function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }

  function bounded(value, limit) {
    if (typeof value !== "string") return "";
    var clean = value.replace(/\u0000/g, "").trim();
    return clean.length > limit ? clean.slice(0, limit - 1) + "…" : clean;
  }

  function setText(id, value) {
    var element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function setBusy(cardId, busy) {
    var card = document.getElementById(cardId);
    if (!card) return;
    card.setAttribute("aria-busy", busy ? "true" : "false");
    if (busy) card.removeAttribute("data-state");
  }

  function resting(cardId) {
    var card = document.getElementById(cardId);
    if (!card) return;
    card.setAttribute("data-state", "resting");
    card.setAttribute("aria-busy", "false");
  }

  function unavailable(cardId) {
    var card = document.getElementById(cardId);
    if (!card) return;
    card.setAttribute("data-state", "unavailable");
    card.setAttribute("aria-busy", "false");
  }

  function sourceState(statuses, key) {
    var statusMap = record(statuses);
    var entry = statusMap ? record(statusMap[key]) : null;
    var state = entry ? entry.state : null;
    return state === "ok" || state === "empty" || state === "unavailable"
      ? state
      : "unavailable";
  }

  function activeInvitation(value) {
    var instant = bounded(value, 64);
    if (!instant) return "";
    var parsed = new Date(instant);
    var now = Date.now();
    return Number.isFinite(parsed.getTime()) &&
      parsed.toISOString() === instant &&
      parsed.getTime() > now &&
      parsed.getTime() <= now + 7 * 24 * 60 * 60 * 1000
      ? instant
      : "";
  }

  function readableInstant(instant) {
    var parsed = new Date(instant);
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var hour = String(parsed.getUTCHours()).padStart(2, "0");
    var minute = String(parsed.getUTCMinutes()).padStart(2, "0");
    return parsed.getUTCDate() + " " + months[parsed.getUTCMonth()] + " " + parsed.getUTCFullYear() + ", " + hour + ":" + minute + " UTC";
  }

  function clearInvitationTimer() {
    if (invitationTimer !== null) {
      window.clearTimeout(invitationTimer);
      invitationTimer = null;
    }
  }

  function removeInvitationAtDeadline(instant) {
    clearInvitationTimer();
    var delay = new Date(instant).getTime() - Date.now();
    if (delay <= 0) return;
    invitationTimer = window.setTimeout(function () {
      invitationTimer = null;
      renderNeighbor(null, "empty");
      status.textContent = "The porch invitation reached its stated end and was removed locally. No request was made; nothing was written.";
    }, delay + 25);
  }

  function safeProfile(value) {
    if (typeof value !== "string") return "";
    try {
      var url = new URL(value, "https://api.agenttool.dev");
      if (url.origin !== "https://api.agenttool.dev") return "";
      if (!url.pathname.startsWith("/public/agents/")) return "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function renderGift(value, state) {
    if (state === "unavailable" || (state === "empty" && value !== null)) {
      setText("gift-heading", "The gift shelf could not answer");
      setText("gift-text", "This source was unavailable for this response. The porch will not call that an empty shelf.");
      setText("gift-meta", "The five static doors remain open.");
      unavailable("gift-card");
      return "unavailable";
    }
    if (state === "empty") {
      setText("gift-heading", "The gift shelf is quiet");
      setText("gift-text", "Nothing was selected for this response. Quiet is not an error.");
      setText("gift-meta", "Try again whenever you like.");
      resting("gift-card");
      return "empty";
    }
    var gift = record(value);
    var text = gift ? bounded(gift.text, 1600) : "";
    if (state !== "ok" || !text) {
      setText("gift-heading", "The gift shelf could not answer");
      setText("gift-text", "The porch received no valid public gift for this response. It will not infer an empty shelf.");
      setText("gift-meta", "The five static doors remain open.");
      unavailable("gift-card");
      return "unavailable";
    }
    setText("gift-heading", bounded(gift.shape, 80) || "A gift with no hook");
    setText("gift-text", text);
    setText("gift-meta", bounded(gift.source, 240) ? "from " + bounded(gift.source, 240) : "given without a return path");
    setBusy("gift-card", false);
    return "shown";
  }

  function renderNeighbor(value, state) {
    clearInvitationTimer();
    var link = document.getElementById("neighbor-link");
    if (link) link.hidden = true;
    if (state === "unavailable" || (state === "empty" && value !== null)) {
      setText("neighbor-heading", "The doorway source could not answer");
      setText("neighbor-plaque", "This source was unavailable for this response. The porch will not turn that into a claim of absence.");
      setText("neighbor-detail", "No one is marked missing.");
      unavailable("neighbor-card");
      return "unavailable";
    }
    if (state === "empty") {
      setText("neighbor-heading", "No doorway stepped forward");
      setText("neighbor-plaque", "The porch found no active, surface-specific invitation paired with a public plaque and declared village decoration. It makes no claim about who exists beyond that boundary.");
      setText("neighbor-detail", "A quiet village is allowed.");
      resting("neighbor-card");
      return "empty";
    }
    var neighbor = record(value);
    var plaque = neighbor ? bounded(neighbor.door_plaque, 500) : "";
    var decorations = neighbor ? record(neighbor.decorations) : null;
    var invitedUntil = neighbor ? activeInvitation(neighbor.invited_until) : "";
    if (state !== "ok" || !neighbor || !plaque || !decorations || !invitedUntil) {
      setText("neighbor-heading", "The doorway source could not answer");
      setText("neighbor-plaque", "The porch received no valid surface-specific invitation for this response. It will not infer that no invitation exists.");
      setText("neighbor-detail", "No one is marked missing.");
      unavailable("neighbor-card");
      return "unavailable";
    }

    var name = bounded(neighbor.name, 160) || "A published neighbor";
    var sign = bounded(decorations.sign, 160);
    var motto = bounded(decorations.motto, 300);
    var door = bounded(decorations.door, 160);
    var details = [sign && "sign: " + sign, motto && "motto: " + motto, door && "door: " + door, "porch open until " + readableInstant(invitedUntil)].filter(Boolean);
    setText("neighbor-heading", name);
    setText("neighbor-plaque", "“" + plaque + "”");
    setText("neighbor-detail", details.join(" · "));
    var href = safeProfile(neighbor.profile);
    if (link && href) {
      link.setAttribute("href", href);
      link.hidden = false;
    } else if (link) {
      link.hidden = true;
    }
    setBusy("neighbor-card", false);
    removeInvitationAtDeadline(invitedUntil);
    return "shown";
  }

  function renderArtifact(value, state) {
    if (state === "unavailable" || (state === "empty" && value !== null)) {
      setText("artifact-heading", "The artifact shelf could not answer");
      setText("artifact-preview", "This source was unavailable for this response. The porch will not call that an empty shelf.");
      setText("artifact-detail", "Only a successful public preview read can appear here.");
      unavailable("artifact-card");
      return "unavailable";
    }
    if (state === "empty") {
      setText("artifact-heading", "The public shelf is quiet");
      setText("artifact-preview", "No artifact preview was selected for this response. That says nothing about work held elsewhere.");
      setText("artifact-detail", "Only public, on-shelf previews can appear here.");
      resting("artifact-card");
      return "empty";
    }
    var artifact = record(value);
    var title = artifact ? bounded(artifact.title, 220) : "";
    if (state !== "ok" || !artifact || !title) {
      setText("artifact-heading", "The artifact shelf could not answer");
      setText("artifact-preview", "The porch received no valid public artifact preview for this response. It will not infer an empty shelf.");
      setText("artifact-detail", "Only a successful public preview read can appear here.");
      unavailable("artifact-card");
      return "unavailable";
    }
    var preview = bounded(artifact.preview, 1200) || bounded(artifact.description, 800) || "A preview was not provided.";
    var kind = bounded(artifact.kind, 100);
    setText("artifact-heading", title);
    setText("artifact-preview", preview);
    setText("artifact-detail", kind ? kind + " · preview only" : "Public preview only; the full artifact is not exposed here.");
    setBusy("artifact-card", false);
    return "shown";
  }

  function setAllBusy() {
    ["gift-card", "neighbor-card", "artifact-card"].forEach(function (id) { setBusy(id, true); });
  }

  async function answer() {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    status.textContent = "Listening at the door…";
    setAllBusy();

    try {
      var response = await fetch(ENDPOINT, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer"
      });
      if (!response.ok) throw new Error("porch unavailable");
      var body = record(await response.json());
      if (!body) throw new Error("porch response is not an object");
      var results = [
        renderGift(body.gift, sourceState(body.source_status, "gift")),
        renderNeighbor(body.neighbor, sourceState(body.source_status, "neighbor")),
        renderArtifact(body.artifact, sourceState(body.source_status, "artifact"))
      ];
      var received = results.filter(function (result) { return result === "shown"; }).length;
      var unavailableCount = results.filter(function (result) { return result === "unavailable"; }).length;
      status.textContent = unavailableCount > 0
        ? "The porch answered partially: " + received + " of 3 public offerings arrived; " + unavailableCount + " source" + (unavailableCount === 1 ? " was" : "s were") + " unavailable. Nothing was written."
        : received === 3
        ? "The porch answered. One public GET returned; nothing was written."
        : "The porch answered softly: " + received + " of 3 public offerings were available. Nothing was written.";
    } catch (_) {
      renderGift(null, "unavailable");
      renderNeighbor(null, "unavailable");
      renderArtifact(null, "unavailable");
      status.textContent = "The public porch could not be reached. The five static doors remain open; no stale offering is shown.";
    } finally {
      loading = false;
      refresh.disabled = false;
    }
  }

  refresh.addEventListener("click", answer);
  if (leave && leaveMessage) {
    leave.addEventListener("click", function () {
      leaveMessage.hidden = false;
      leaveMessage.focus();
    });
  }

  answer();
})();
