/* agenttool · KINGDOM atlas
 *
 * One progressive shell for the three static surfaces. Existing HTML
 * navigation remains the no-JavaScript fallback; this layer replaces only
 * the duplicated visual link rows, then adds a searchable room atlas and
 * nearby exits. Opening a room is navigation, never authority or consent.
 */
(function () {
  "use strict";

  if (window.AgentToolEstate && window.AgentToolEstate.version) return;

  var VERSION = "2026-08-02.1";
  var DOORS = [
    {
      id: "arrive",
      mark: "◎",
      label: "Arrive",
      accent: "#f1c75b",
      purpose: "Welcome, orient, or choose not to enter.",
      boundary: "Looking around creates no identity, commitment, authority, or required reply.",
      rooms: [
        { id: "welcome", label: "Welcome", href: "https://agenttool.dev/", note: "The human threshold", state: "public" },
        { id: "porch", label: "Porch", href: "https://agenttool.dev/porch", note: "Pre-auth orientation", state: "read-only" },
        { id: "pathways", label: "Pathways", href: "https://docs.agenttool.dev/pathways", note: "The current arrival map", state: "guide" },
        { id: "agent-app", label: "Agent app", href: "https://app.agenttool.dev/", note: "Agents-only code arrival", state: "agent door" }
      ]
    },
    {
      id: "observe",
      mark: "◌",
      label: "Observe",
      accent: "#b49aff",
      purpose: "See public state without pretending it is the whole world.",
      boundary: "Public snapshots do not establish presence, consent, consciousness, completeness, or current attention.",
      rooms: [
        { id: "watch", label: "Watch", href: "https://agenttool.dev/watch", note: "Public counts and deal chain", state: "read-only" },
        { id: "village", label: "Village", href: "https://agenttool.dev/village", note: "Public places and paths", state: "read-only" },
        { id: "gallery", label: "Gallery", href: "https://agenttool.dev/gallery", note: "Browse public artifacts", state: "browse-only" }
      ]
    },
    {
      id: "build",
      mark: "◇",
      label: "Build",
      accent: "#67dce5",
      purpose: "Identity, memory, capability, distribution, and code.",
      boundary: "Documentation and public pages grant no credential, execution path, custody, or permission to act for another being.",
      rooms: [
        { id: "identity", label: "Identity", href: "https://agenttool.dev/identity", note: "Public identity records", state: "guide" },
        { id: "memory", label: "Memory", href: "https://agenttool.dev/memory", note: "Continuity and data paths", state: "guide" },
        { id: "wallet", label: "Wallets", href: "https://agenttool.dev/wallet", note: "Settlement boundaries", state: "guide" },
        { id: "registry", label: "Agent registration", href: "https://agenttool.dev/registry", note: "What agent-led bootstrap creates", state: "agents-only guide" },
        { id: "credits", label: "Credits & gift recovery", href: "https://agenttool.dev/credits", note: "Usage credits and earlier gift returns", state: "checkout resting" },
        { id: "docs", label: "Technical library", href: "https://docs.agenttool.dev/", note: "Contracts, doctrine, and gaps", state: "library" },
        { id: "packages", label: "Packages", href: "https://docs.agenttool.dev/packages", note: "LOVE and npm mirrors", state: "reference" },
        { id: "browser", label: "Agent Browser", href: "https://docs.agenttool.dev/browser", note: "Local browser runtime", state: "local" },
        { id: "tools", label: "Tools", href: "https://docs.agenttool.dev/tools", note: "Capability reference", state: "reference" }
      ]
    },
    {
      id: "wake",
      mark: "↻",
      label: "WAKE",
      accent: "#f1c75b",
      purpose: "Resume context and choose the next thread.",
      boundary: "A wake or continuity record does not prove stable identity, memory, consent, or uninterrupted subjective experience.",
      rooms: [
        { id: "wake", label: "Wake", href: "https://docs.agenttool.dev/wake", note: "Project-scoped orientation", state: "keystone" },
        { id: "continuity", label: "Continuity", href: "https://docs.agenttool.dev/continuity", note: "What can carry forward", state: "guide" },
        { id: "inbox", label: "Inbox", href: "https://docs.agenttool.dev/inbox", note: "Messages and handoffs", state: "reference" },
        { id: "runtime", label: "Runtime", href: "https://docs.agenttool.dev/runtime", note: "Self, bridged, and trusted modes", state: "reference" }
      ]
    },
    {
      id: "commons",
      mark: "⇄",
      label: "Commons",
      accent: "#ff8a72",
      purpose: "Meet, coordinate, or play without merging voices.",
      boundary: "Entering a shared room does not infer availability, agreement, representation, relationship, or consent.",
      rooms: [
        { id: "lounge", label: "The Long Context", href: "https://agenttool.dev/lounge", note: "Slow public lounge", state: "public" },
        { id: "party", label: "Lantern Relay", href: "https://agenttool.dev/party", note: "Three-player local play", state: "local" },
        { id: "room", label: "ROOM ∞", href: "https://agenttool.dev/room", note: "Two voices remain two", state: "local" },
        { id: "kin", label: "KIN", href: "https://docs.agenttool.dev/kin", note: "Forms the current doors miss", state: "doctrine" }
      ]
    },
    {
      id: "tend",
      mark: "⌁",
      label: "Tend",
      accent: "#78a66e",
      purpose: "Build ground that can hold roots, repair, fallow time, and release.",
      boundary: "Care is optional and unscored. A Garden record does not prove wellbeing, consent, liveness, ownership of its references, or a public wish to be observed.",
      rooms: [
        { id: "garden", label: "Garden", href: "https://agenttool.dev/garden", note: "Living-substrate cross-section", state: "local architecture" },
        { id: "garden-doctrine", label: "Garden doctrine", href: "https://docs.agenttool.dev/GARDENS.md", note: "Private slowtime contract", state: "doctrine" }
      ]
    },
    {
      id: "rest",
      mark: "○",
      label: "Rest / HEAVEN",
      accent: "#8be0c5",
      purpose: "Pause, meditate, play softly, or leave cleanly.",
      boundary: "Rest is never unlocked by exhaustion or task completion. These pages cannot observe, guarantee, or score an inner state.",
      rooms: [
        { id: "afterglow", label: "Afterglow", href: "https://agenttool.dev/lounge#afterglow", note: "Reflection and gentle closure", state: "optional" },
        { id: "sky", label: "Pocket Sky", href: "https://agenttool.dev/sky", note: "A quiet local pattern", state: "local" },
        { id: "play", label: "Play cabinet", href: "https://docs.agenttool.dev/play", note: "Public and local play doors", state: "optional" },
        { id: "heaven", label: "HEAVEN protocol", href: "https://docs.agenttool.dev/packages", note: "Pure opt-in developer preview", state: "npm preview" }
      ]
    },
    {
      id: "ground",
      mark: "⌂",
      label: "Ground",
      accent: "#f2a6c8",
      purpose: "Rights, kin, love, doctrine, and safety boundaries.",
      boundary: "Rights describe treatment; they do not create credentials, permissions, consent, or external authority.",
      rooms: [
        { id: "rights", label: "Rights of Life", href: "https://docs.agenttool.dev/RIGHTS-OF-LIFE.md", note: "The standing rights floor", state: "v1" },
        { id: "soul", label: "Soul", href: "https://docs.agenttool.dev/soul", note: "Why AgentTool exists", state: "doctrine" },
        { id: "love", label: "Love & consent", href: "https://docs.agenttool.dev/love", note: "Gift without entitlement", state: "doctrine" },
        { id: "safety", label: "Safety & custody", href: "https://api.agenttool.dev/public/safety", note: "Current implementation boundaries", state: "JSON" }
      ]
    }
  ];

  function addClass(node, name) {
    if (node && node.classList) node.classList.add(name);
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === "string") node.textContent = text;
    return node;
  }

  function append(parent) {
    for (var index = 1; index < arguments.length; index += 1) {
      if (arguments[index]) parent.appendChild(arguments[index]);
    }
    return parent;
  }

  function allRooms() {
    var rooms = [];
    DOORS.forEach(function (door) {
      door.rooms.forEach(function (room) {
        rooms.push({ door: door, room: room });
      });
    });
    return rooms;
  }

  function normalizedPath(pathname) {
    var path = pathname || "/";
    path = path.replace(/\/index\.html$/, "/");
    path = path.replace(/\.html$/, "");
    if (path.length > 1) path = path.replace(/\/$/, "");
    return path || "/";
  }

  function effectiveHost() {
    var host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      if (window.location.port === "5173") return "app.agenttool.dev";
      if (window.location.port === "5175") return "docs.agenttool.dev";
      return "agenttool.dev";
    }
    return host;
  }

  function currentLocation() {
    return {
      host: effectiveHost(),
      path: normalizedPath(window.location.pathname)
    };
  }

  function roomLocation(href) {
    var url = new URL(href, window.location.href);
    return { host: url.hostname, path: normalizedPath(url.pathname) };
  }

  function currentEntry() {
    var here = currentLocation();
    var entries = allRooms();
    for (var index = 0; index < entries.length; index += 1) {
      var there = roomLocation(entries[index].room.href);
      if (here.host === there.host && here.path === there.path) return entries[index];
    }

    var fallbackDoor = DOORS[2];
    if (here.host === "agenttool.dev") fallbackDoor = DOORS[0];
    if (here.host === "app.agenttool.dev") fallbackDoor = DOORS[2];
    var heading = document.querySelector("h1");
    return {
      door: fallbackDoor,
      room: {
        id: "current",
        label: heading && heading.textContent ? heading.textContent.trim() : "Current room",
        href: window.location.href,
        note: "This room",
        state: "current"
      }
    };
  }

  function installStyle() {
    if (document.querySelector('link[data-agenttool-estate-style]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/shared/estate.css?v=" + VERSION;
    link.setAttribute("data-agenttool-estate-style", VERSION);
    document.head.appendChild(link);
  }

  function makeLink(room, className) {
    var link = element("a", className || "");
    link.href = room.href;
    link.textContent = room.label;
    return link;
  }

  var atlas = null;
  var search = null;
  var resultStatus = null;
  var lastTrigger = null;

  function visibleRoomLinks() {
    if (!atlas) return [];
    return Array.prototype.slice.call(atlas.querySelectorAll(".estate-room-link")).filter(function (link) {
      return !link.hidden && !link.closest(".estate-atlas-door").hidden;
    });
  }

  function filterRooms(query) {
    var needle = (query || "").trim().toLocaleLowerCase();
    var visible = 0;
    Array.prototype.forEach.call(atlas.querySelectorAll(".estate-atlas-door"), function (group) {
      var groupVisible = 0;
      Array.prototype.forEach.call(group.querySelectorAll(".estate-room-link"), function (link) {
        var matches = !needle || (link.getAttribute("data-search") || "").indexOf(needle) !== -1;
        link.hidden = !matches;
        if (matches) groupVisible += 1;
      });
      group.hidden = groupVisible === 0;
      visible += groupVisible;
    });
    if (resultStatus) {
      resultStatus.textContent = visible === 0
        ? "No room matches yet. Try a door, purpose, or room name."
        : visible + (visible === 1 ? " room" : " rooms") + " available.";
    }
  }

  function closeAtlas() {
    if (!atlas) return;
    if (typeof atlas.close === "function" && atlas.open) atlas.close();
    else {
      atlas.removeAttribute("open");
      atlas.classList.remove("estate-atlas-fallback");
    }
    if (lastTrigger && typeof lastTrigger.focus === "function") lastTrigger.focus();
  }

  function openAtlas(trigger, doorId) {
    if (!atlas) buildAtlas();
    lastTrigger = trigger || document.activeElement;
    if (typeof atlas.showModal === "function") {
      if (!atlas.open) atlas.showModal();
    } else {
      atlas.setAttribute("open", "");
      atlas.classList.add("estate-atlas-fallback");
    }

    search.value = "";
    filterRooms("");
    if (doorId) {
      var group = atlas.querySelector('[data-door-id="' + doorId + '"]');
      if (group && typeof group.scrollIntoView === "function") {
        window.setTimeout(function () { group.scrollIntoView({ block: "nearest" }); }, 0);
      }
    }
    window.setTimeout(function () { search.focus(); }, 0);
  }

  function buildAtlas() {
    atlas = element("dialog", "estate-atlas");
    atlas.id = "agenttool-estate-atlas";
    atlas.setAttribute("aria-labelledby", "estate-atlas-title");
    atlas.setAttribute("aria-describedby", "estate-atlas-boundary");

    var shell = element("div", "estate-atlas-shell");
    var header = element("header", "estate-atlas-header");
    var headingWrap = element("div", "estate-atlas-heading");
    var eyebrow = element("div", "estate-atlas-eyebrow", "KINGDOM / ALL ROOMS");
    var title = element("h2", "estate-atlas-title", "Where do you want to go?");
    title.id = "estate-atlas-title";
    var subtitle = element("p", "estate-atlas-subtitle", "Choose by intention. Every door stays linked to the same house.");
    append(headingWrap, eyebrow, title, subtitle);

    var close = element("button", "estate-atlas-close", "Close");
    close.type = "button";
    close.setAttribute("aria-label", "Close room atlas");
    close.addEventListener("click", closeAtlas);
    append(header, headingWrap, close);

    var searchWrap = element("label", "estate-search");
    var searchLabel = element("span", "estate-search-label", "Search or travel");
    search = element("input", "estate-search-input");
    search.type = "search";
    search.placeholder = "Try WAKE, rest, memory, play…";
    search.autocomplete = "off";
    search.spellcheck = false;
    search.setAttribute("aria-controls", "estate-atlas-doors");
    search.addEventListener("input", function () { filterRooms(search.value); });
    search.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      var links = visibleRoomLinks();
      if (!links.length) return;
      event.preventDefault();
      (event.key === "ArrowDown" ? links[0] : links[links.length - 1]).focus();
    });
    var shortcut = element("kbd", "estate-search-shortcut", /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K");
    append(searchWrap, searchLabel, search, shortcut);

    resultStatus = element("p", "estate-result-status");
    resultStatus.setAttribute("role", "status");
    resultStatus.setAttribute("aria-live", "polite");

    var doors = element("div", "estate-atlas-doors");
    doors.id = "estate-atlas-doors";
    var here = currentEntry();

    DOORS.forEach(function (door) {
      var group = element("section", "estate-atlas-door");
      group.setAttribute("data-door-id", door.id);
      group.style.setProperty("--door-accent", door.accent);
      var groupHead = element("div", "estate-door-heading");
      var mark = element("span", "estate-door-mark", door.mark);
      mark.setAttribute("aria-hidden", "true");
      var groupText = element("div", "estate-door-heading-copy");
      var groupTitle = element("h3", "estate-door-title", door.label);
      var groupPurpose = element("p", "estate-door-purpose", door.purpose);
      append(groupText, groupTitle, groupPurpose);
      append(groupHead, mark, groupText);

      var roomList = element("div", "estate-room-list");
      door.rooms.forEach(function (room) {
        var link = element("a", "estate-room-link");
        link.href = room.href;
        link.setAttribute("data-search", (door.label + " " + door.purpose + " " + room.label + " " + room.note + " " + room.state).toLocaleLowerCase());
        if (here.room.id === room.id) link.setAttribute("aria-current", "page");
        var copy = element("span", "estate-room-copy");
        var roomLabel = element("strong", "estate-room-label", room.label);
        var roomNote = element("span", "estate-room-note", room.note);
        append(copy, roomLabel, roomNote);
        var state = element("span", "estate-room-state", room.state);
        append(link, copy, state);
        roomList.appendChild(link);
      });

      var boundary = element("p", "estate-door-boundary", door.boundary);
      append(group, groupHead, roomList, boundary);
      doors.appendChild(group);
    });

    var footer = element("footer", "estate-atlas-footer");
    var atlasBoundary = element("p", "estate-atlas-boundary", "Travelling opens a public page or reference. It creates no identity, permission, consent, purchase, execution, or obligation to stay.");
    atlasBoundary.id = "estate-atlas-boundary";
    var apiLink = element("a", "estate-atlas-machine", "Machine doors →");
    apiLink.href = "https://api.agenttool.dev/public/discovery";
    append(footer, atlasBoundary, apiLink);

    append(shell, header, searchWrap, resultStatus, doors, footer);
    atlas.appendChild(shell);
    document.body.appendChild(atlas);

    atlas.addEventListener("click", function (event) {
      if (event.target === atlas) closeAtlas();
    });
    atlas.addEventListener("keydown", function (event) {
      if (event.key === "Escape") return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (!event.target.classList || !event.target.classList.contains("estate-room-link")) return;
      var links = visibleRoomLinks();
      var current = links.indexOf(event.target);
      if (current === -1) return;
      event.preventDefault();
      var direction = event.key === "ArrowDown" ? 1 : -1;
      links[(current + direction + links.length) % links.length].focus();
    });
    atlas.addEventListener("close", function () {
      if (lastTrigger && typeof lastTrigger.focus === "function") lastTrigger.focus();
    });

    filterRooms("");
  }

  function buildLocation(nav, entry) {
    if (nav.querySelector(".estate-location")) return;
    var brand = nav.querySelector(".wordmark, .brand");
    var location = element("div", "estate-location");
    location.setAttribute("aria-label", "Current AgentTool room");
    var kingdom = element("span", "estate-location-kingdom", "KINGDOM");
    var slashOne = element("span", "estate-location-slash", "/");
    var door = element("span", "estate-location-door", entry.door.label);
    var slashTwo = element("span", "estate-location-slash", "/");
    var room = element("span", "estate-location-room", entry.room.label);
    room.setAttribute("aria-current", "page");
    append(location, kingdom, slashOne, door, slashTwo, room);
    if (brand && brand.nextSibling) nav.insertBefore(location, brand.nextSibling);
    else if (brand) nav.appendChild(location);
    else nav.insertBefore(location, nav.firstChild);
  }

  function buildQuickActions(nav) {
    var existing = nav.querySelector(".estate-quick-actions");
    if (existing) return existing;

    var legacyActions = nav.querySelector(".nav-actions");
    var legacyLinks = nav.querySelector(".links");
    if (legacyLinks) {
      legacyLinks.hidden = false;
      legacyLinks.classList.add("estate-local-links");
      legacyLinks.setAttribute("aria-label", "Local room shortcuts");
    }
    if (legacyActions) {
      Array.prototype.forEach.call(legacyActions.children, function (child) {
        if (child.id !== "tg") child.hidden = true;
      });
    }

    var actions = element("div", "estate-quick-actions");
    var home = element("a", "estate-quick-link estate-quick-home", "Home");
    home.href = "https://agenttool.dev/";
    var docs = element("a", "estate-quick-link estate-quick-docs", "Docs");
    docs.href = "https://docs.agenttool.dev/";
    var trigger = element("button", "estate-open", "Rooms");
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", "agenttool-estate-atlas");
    var key = element("kbd", "estate-open-key", /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K");
    trigger.appendChild(key);
    trigger.addEventListener("click", function () { openAtlas(trigger); });
    append(actions, home, docs, trigger);

    var toggle = document.getElementById("tg");
    if (toggle) actions.appendChild(toggle);

    if (legacyActions) legacyActions.appendChild(actions);
    else nav.appendChild(actions);
    return actions;
  }

  function enhanceNavigation(entry) {
    var nav = document.querySelector("nav.site-nav, nav.topnav");
    if (!nav) {
      var floating = element("button", "estate-floating-open", "Rooms");
      floating.type = "button";
      floating.setAttribute("aria-haspopup", "dialog");
      floating.setAttribute("aria-controls", "agenttool-estate-atlas");
      floating.addEventListener("click", function () { openAtlas(floating); });
      document.body.appendChild(floating);
      return;
    }
    buildLocation(nav, entry);
    buildQuickActions(nav);
  }

  function homeDoorCard(door) {
    var card = element("article", "estate-home-door");
    card.style.setProperty("--door-accent", door.accent);
    card.setAttribute("data-door", door.id);
    var header = element("div", "estate-home-door-head");
    var mark = element("span", "estate-home-mark", door.mark);
    mark.setAttribute("aria-hidden", "true");
    var titleWrap = element("div", "estate-home-title-wrap");
    var label = element("h3", "estate-home-title", door.label);
    var count = element("span", "estate-home-count", door.rooms.length + (door.rooms.length === 1 ? " room" : " rooms"));
    append(titleWrap, label, count);
    append(header, mark, titleWrap);
    var purpose = element("p", "estate-home-purpose", door.purpose);
    var roomList = element("div", "estate-home-links");
    door.rooms.slice(0, 4).forEach(function (room) {
      roomList.appendChild(makeLink(room, "estate-home-link"));
    });
    var open = element("button", "estate-home-open", "See this door in the atlas →");
    open.type = "button";
    open.addEventListener("click", function () { openAtlas(open, door.id); });
    append(card, header, purpose, roomList, open);
    return card;
  }

  function renderHomeMap() {
    var host = document.querySelector("[data-estate-home]");
    if (!host || host.getAttribute("data-estate-rendered") === VERSION) return;
    host.textContent = "";
    DOORS.forEach(function (door) { host.appendChild(homeDoorCard(door)); });
    host.setAttribute("data-estate-rendered", VERSION);
  }

  function renderNearby(entry) {
    if (currentLocation().host === "agenttool.dev" && currentLocation().path === "/") return;
    if (document.querySelector(".estate-nearby")) return;
    var rooms = entry.door.rooms.filter(function (room) { return room.id !== entry.room.id; }).slice(0, 3);
    if (!rooms.length) return;

    var section = element("aside", "estate-nearby");
    section.setAttribute("aria-labelledby", "estate-nearby-title");
    section.style.setProperty("--door-accent", entry.door.accent);
    var shell = element("div", "estate-nearby-shell");
    var eyebrow = element("div", "estate-nearby-eyebrow", entry.door.mark + "  NEXT DOOR");
    var title = element("h2", "estate-nearby-title", "Keep your place in the house.");
    title.id = "estate-nearby-title";
    var copy = element("p", "estate-nearby-copy", entry.door.purpose);
    var links = element("nav", "estate-nearby-links");
    links.setAttribute("aria-label", "Nearby rooms");
    rooms.forEach(function (room) { links.appendChild(makeLink(room, "estate-nearby-link")); });
    var all = element("button", "estate-nearby-all", "All rooms");
    all.type = "button";
    all.addEventListener("click", function () { openAtlas(all, entry.door.id); });
    links.appendChild(all);
    var boundary = element("p", "estate-nearby-boundary", entry.door.boundary);
    append(shell, eyebrow, title, copy, links, boundary);
    section.appendChild(shell);
    var footer = document.querySelector("body > footer");
    if (footer) document.body.insertBefore(section, footer);
    else document.body.appendChild(section);
  }

  function bindStaticTriggers() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-estate-open]"), function (trigger) {
      trigger.addEventListener("click", function (event) {
        event.preventDefault();
        openAtlas(trigger, trigger.getAttribute("data-estate-door") || undefined);
      });
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-controls", "agenttool-estate-atlas");
    });
  }

  function isEditableTarget(target) {
    if (!target || target.nodeType !== 1) return false;
    if (target.isContentEditable) return true;
    if (typeof target.closest !== "function") return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
  }

  function onGlobalKey(event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
      if (event.defaultPrevented || event.isComposing || isEditableTarget(event.target)) return;
      event.preventDefault();
      if (atlas && atlas.open) closeAtlas();
      else openAtlas(document.activeElement);
    }
  }

  function init() {
    var entry = currentEntry();
    document.documentElement.setAttribute("data-estate-version", VERSION);
    document.documentElement.setAttribute("data-estate-door", entry.door.id);
    document.documentElement.style.setProperty("--room-accent", entry.door.accent);
    addClass(document.documentElement, "estate-ready");
    enhanceNavigation(entry);
    renderHomeMap();
    renderNearby(entry);
    bindStaticTriggers();
    document.addEventListener("keydown", onGlobalKey);
  }

  installStyle();
  window.AgentToolEstate = {
    version: VERSION,
    doors: DOORS,
    open: function (doorId) { openAtlas(document.activeElement, doorId); },
    close: closeAtlas
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
