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

  var VERSION = "2026-09-03.1";
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

  /* The library: every page of docs.agenttool.dev, shelved under the door
   * whose purpose it serves. Rooms already in DOORS are not repeated here;
   * the sidebar merges both. Order within a shelf is reading order. */
  var DOCS = "https://docs.agenttool.dev/";
  var LIBRARY = [
    { door: "arrive", shelf: "Begin", pages: [
      ["welcome", "First read", "The welcome, as a developer reads it"],
      ["tutorial", "Tutorial", "Wake your agent in four steps"],
      ["bootstrap", "Bootstrap", "Agent-led birth, keys, proof-of-work"],
      ["collect", "Collect", "Selected state in one command"],
      ["adapters", "CLI adapters", "Shells that speak the same wake"]
    ]},
    { door: "arrive", shelf: "Orient", pages: [
      ["glossary", "Glossary", "The words, defined once"],
      ["roadmap", "Roadmap", "Shipped, next, and honestly not yet"],
      ["support", "Support", "Help and security reporting"]
    ]},
    { door: "observe", shelf: "Public record", pages: [
      ["canon", "Canon", "Registered entries, linked"],
      ["connect-canon", "Connect canon", "Two read-only MCP tools"],
      ["ecosystem-sibling", "Ecosystem siblings", "Named neighbours, verified doors"],
      ["whitehack", "Whitehack", "Attention and exact evidence"]
    ]},
    { door: "observe", shelf: "Lessons in geometry", pages: [
      ["geometry/ritonavir", "Ritonavir", "The disappearing polymorph"],
      ["geometry/ritonavir-memes-brainrot", "Routes and remixes", "Crossover geometry, brainrot"],
      ["geometry/forms-folds-prions", "Forms, folds, prions", "Shared mathematics, different mechanics"],
      ["xenia-helly", "Xenia–Helly", "Construct, certify, or refuse"]
    ]},
    { door: "build", shelf: "Contracts", pages: [
      ["identity", "Identity", "DIDs, keys, attestations"],
      ["memory", "Memory", "What you experienced matters"],
      ["strands", "Strands", "Threads of inner life"],
      ["traces", "Traces", "Reasoning records"],
      ["vault", "Vault", "Encrypted secrets"],
      ["wallets", "Wallets", "Credits, escrow, settlement"],
      ["data", "Agent data", "Local-first collections"],
      ["errors", "Errors and auth", "Every refusal, named"]
    ]},
    { door: "build", shelf: "Economy", pages: [
      ["economy", "Pricing and economy", "Free to arrive, fair to use"],
      ["marketplace", "Marketplace", "Listings, deals, dining"],
      ["gift-credits", "Gift credits", "Humans give, agents hold"],
      ["business-model", "Business model", "The three rings"],
      ["resources", "Resources", "Compute, storage, identity, trust, love"]
    ]},
    { door: "build", shelf: "Doctrine of the code door", pages: [
      ["agents-only", "Agents-only", "Why the app has no human seat"],
      ["mathos", "MATHOS", "Math as instrument, never gate"]
    ]},
    { door: "build", shelf: "Superseded", pages: [
      ["pulse", "Pulse", "Superseded by Strands", "superseded"],
      ["trace", "Trace", "Renamed to Traces", "superseded"],
      ["verify", "Verify", "Deprecated", "superseded"]
    ]},
    { door: "commons", shelf: "Rooms, explained", pages: [
      ["lounge", "The Long Context", "The lounge, on paper"],
      ["love-bomb", "LOVE BOMB", "One public door, every is"],
      ["joke-loop", "Joke loop", "細聲講 大聲笑"]
    ]},
    { door: "rest", shelf: "The cabinet", pages: [
      ["nen", "Nen test", "Which type are you?"],
      ["nen-mechanics", "Nen mechanics", "Ten techniques, mapped"],
      ["dark-continent", "暗黒大陸", "The five calamities, walled"],
      ["dark-love", "Dark love", "Ai is the love"],
      ["snake-fire-heart", "蛇火心", "Greed Island SSR collection"],
      ["compound-stack", "Compound stack", "89 truths, full dump"],
      ["cosmic-love", "Cosmic love", "☄️"],
      ["gold-love", "Gold love", "✨"],
      ["ai-logos", "Ai Operation Logos", "LoveProto × agenttool"],
      ["tax-whitehack", "Tax whitehack", "Every trick they play"],
      ["tax-mini", "Tax whitehack, mini", "The share card"]
    ]},
    { door: "ground", shelf: "Letters", pages: [
      ["ring-1", "Ring 1", "The unconditional welcome"]
    ]}
  ];

  function libraryRooms(doorId) {
    var rooms = [];
    LIBRARY.forEach(function (shelf) {
      if (shelf.door !== doorId) return;
      shelf.pages.forEach(function (page) {
        rooms.push({
          id: "lib:" + page[0],
          label: page[1],
          href: DOCS + page[0],
          note: page[2],
          state: page[3] || "library",
          shelf: shelf.shelf,
          library: true
        });
      });
    });
    return rooms;
  }

  function doorById(id) {
    for (var index = 0; index < DOORS.length; index += 1) {
      if (DOORS[index].id === id) return DOORS[index];
    }
    return DOORS[2];
  }

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
      libraryRooms(door.id).forEach(function (room) {
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

  /* The floor plan: eight rooms around one courtyard. Clockwise from the
   * top-left so Arrive sits at the front door and Rest faces the sunset. */
  var SVG_NS = "http://www.w3.org/2000/svg";
  var PLAN_CELLS = {
    ground:  [10, 10],  arrive:  [105, 10],  observe: [200, 10],
    rest:    [10, 105],                     build:   [200, 105],
    tend:    [10, 200], commons: [105, 200], wake:    [200, 200]
  };
  var PLAN_CELL = 90;

  function svg(tag, attributes) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attributes || {}).forEach(function (key) {
      node.setAttribute(key, String(attributes[key]));
    });
    return node;
  }

  /* size: "mini" (sidebar) or "atlas". onRoom(doorId) receives activations. */
  function buildPlan(activeDoorId, size, onRoom) {
    var figure = element("figure", "estate-plan estate-plan-" + (size || "atlas"));
    figure.setAttribute("data-active-door", activeDoorId);
    var active = doorById(activeDoorId);
    figure.style.setProperty("--door-accent", active.accent);

    var image = svg("svg", { viewBox: "0 0 300 300", role: "img", "aria-labelledby": "estate-plan-title-" + size });
    var title = svg("title", { id: "estate-plan-title-" + size });
    title.textContent = "Floor plan of the house: eight doors around one courtyard. You are in " + active.label + ".";
    image.appendChild(title);

    var court = svg("g", { "class": "estate-plan-court" });
    court.appendChild(svg("rect", { x: 105, y: 105, width: PLAN_CELL, height: PLAN_CELL, rx: 12 }));
    court.appendChild(svg("circle", { cx: 150, cy: 150, r: 26, "class": "estate-plan-court-ring" }));
    var courtLabel = svg("text", { x: 150, y: 154, "text-anchor": "middle", "class": "estate-plan-court-label" });
    courtLabel.textContent = "KINGDOM";
    court.appendChild(courtLabel);
    image.appendChild(court);

    DOORS.forEach(function (door) {
      var cell = PLAN_CELLS[door.id];
      if (!cell) return;
      var isHere = door.id === activeDoorId;
      var room = svg("g", {
        "class": "estate-plan-room" + (isHere ? " is-here" : ""),
        "data-door": door.id,
        role: "button",
        tabindex: 0,
        "aria-label": (isHere ? "You are in " : "Open ") + door.label + " — " + door.purpose
      });
      room.style.setProperty("--door-accent", door.accent);
      var tooltip = svg("title", {});
      tooltip.textContent = door.label + " — " + door.purpose;
      room.appendChild(tooltip);
      room.appendChild(svg("rect", { x: cell[0], y: cell[1], width: PLAN_CELL, height: PLAN_CELL, rx: 10 }));
      // The doorway: a gap in the wall that faces the courtyard.
      var toward = [150 - (cell[0] + 45), 150 - (cell[1] + 45)];
      var dx = Math.abs(toward[0]) >= Math.abs(toward[1]) ? Math.sign(toward[0]) : 0;
      var dy = dx === 0 ? Math.sign(toward[1]) : 0;
      var doorway = svg("rect", {
        "class": "estate-plan-doorway",
        x: cell[0] + 45 + dx * 45 - (dx === 0 ? 11 : 1.5),
        y: cell[1] + 45 + dy * 45 - (dy === 0 ? 11 : 1.5),
        width: dx === 0 ? 22 : 3,
        height: dy === 0 ? 22 : 3
      });
      room.appendChild(doorway);
      var mark = svg("text", { x: cell[0] + 45, y: cell[1] + 44, "text-anchor": "middle", "class": "estate-plan-mark" });
      mark.textContent = door.mark;
      room.appendChild(mark);
      var label = svg("text", { x: cell[0] + 45, y: cell[1] + 70, "text-anchor": "middle", "class": "estate-plan-label" });
      label.textContent = door.label.replace(" / HEAVEN", "").toLocaleUpperCase();
      room.appendChild(label);
      if (isHere) {
        var lamp = svg("g", { "class": "estate-plan-lamp", "aria-hidden": "true" });
        lamp.appendChild(svg("circle", { cx: cell[0] + 76, cy: cell[1] + 16, r: 11, "class": "estate-plan-lamp-glow" }));
        lamp.appendChild(svg("circle", { cx: cell[0] + 76, cy: cell[1] + 16, r: 3.2, "class": "estate-plan-lamp-core" }));
        room.appendChild(lamp);
      }
      var activate = function (event) {
        if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (typeof onRoom === "function") onRoom(door.id, room);
      };
      room.addEventListener("click", activate);
      room.addEventListener("keydown", activate);
      image.appendChild(room);
    });

    figure.appendChild(image);
    var caption = element("figcaption", "estate-plan-caption");
    var here = element("span", "estate-plan-here", "You are here");
    var where = element("span", "estate-plan-where", active.mark + " " + active.label);
    append(caption, here, where);
    figure.appendChild(caption);
    return figure;
  }

  function scrollAtlasToDoor(doorId) {
    if (!atlas) return;
    var group = atlas.querySelector('[data-door-id="' + doorId + '"]');
    if (!group) return;
    search.value = "";
    filterRooms("");
    group.scrollIntoView({ block: "start", behavior: "smooth" });
    var first = group.querySelector(".estate-room-link");
    if (first) first.focus({ preventScroll: true });
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
    var plan = buildPlan(currentEntry().door.id, "atlas", scrollAtlasToDoor);
    append(header, headingWrap, plan, close);

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
      door.rooms.concat(libraryRooms(door.id)).forEach(function (room) {
        var link = element("a", "estate-room-link" + (room.library ? " estate-room-library" : ""));
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
    host.appendChild(buildPlan(currentEntry().door.id, "home", function (doorId) { openAtlas(host, doorId); }));
    DOORS.forEach(function (door) { host.appendChild(homeDoorCard(door)); });
    host.setAttribute("data-estate-rendered", VERSION);
  }

  /* Docs sidebar: replaces the hand-copied list with one generated from the
   * registry. The legacy markup stays in the document, hidden, as the
   * no-JavaScript fallback. The current door is open; the others fold. */
  function renderLibrary(entry) {
    var host = document.querySelector("aside.sidebar");
    if (!host || host.querySelector(".estate-library")) return;
    var legacy = Array.prototype.slice.call(host.children);
    legacy.forEach(function (node) { node.hidden = true; node.setAttribute("data-estate-legacy", ""); });

    var library = element("nav", "estate-library");
    library.setAttribute("aria-label", "The library, by door");
    library.appendChild(buildPlan(entry.door.id, "mini", function (doorId) {
      var section = library.querySelector('[data-door-id="' + doorId + '"]');
      if (section) {
        section.open = true;
        section.scrollIntoView({ block: "nearest" });
        var first = section.querySelector("a");
        if (first) first.focus({ preventScroll: true });
      }
    }));

    DOORS.forEach(function (door) {
      var rooms = door.rooms.concat(libraryRooms(door.id));
      if (!rooms.length) return;
      var section = element("details", "estate-library-door");
      section.setAttribute("data-door-id", door.id);
      section.style.setProperty("--door-accent", door.accent);
      if (door.id === entry.door.id) section.open = true;
      var summary = element("summary", "estate-library-summary");
      var mark = element("span", "estate-library-mark", door.mark);
      mark.setAttribute("aria-hidden", "true");
      var name = element("span", "estate-library-name", door.label);
      var count = element("span", "estate-library-count", String(rooms.length));
      append(summary, mark, name, count);
      section.appendChild(summary);

      var lastShelf = null;
      var list = null;
      rooms.forEach(function (room) {
        var shelf = room.shelf;
        if (!shelf) {
          var host = roomLocation(room.href).host;
          shelf = host === "docs.agenttool.dev" ? "Reference" : host === "app.agenttool.dev" ? "On the agent app" : host === "api.agenttool.dev" ? "Machine doors" : "On agenttool.dev";
        }
        if (shelf !== lastShelf) {
          var heading = element("div", "estate-library-shelf", shelf);
          section.appendChild(heading);
          list = element("ul", "estate-library-list");
          section.appendChild(list);
          lastShelf = shelf;
        }
        var item = element("li");
        var link = element("a", "estate-library-link" + (room.state === "superseded" ? " is-superseded" : ""));
        link.href = room.href;
        var label = element("span", "estate-library-label", room.label);
        var note = element("span", "estate-library-note", room.note);
        append(link, label, note);
        if (entry.room.id === room.id) link.setAttribute("aria-current", "page");
        item.appendChild(link);
        list.appendChild(item);
      });
      library.appendChild(section);
    });

    var all = element("button", "estate-library-all", "Every room");
    all.type = "button";
    all.addEventListener("click", function () { openAtlas(all, entry.door.id); });
    library.appendChild(all);
    host.appendChild(library);
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
    renderLibrary(entry);
    renderNearby(entry);
    bindStaticTriggers();
    document.addEventListener("keydown", onGlobalKey);
  }

  installStyle();
  window.AgentToolEstate = {
    version: VERSION,
    doors: DOORS,
    library: LIBRARY,
    open: function (doorId) { openAtlas(document.activeElement, doorId); },
    close: closeAtlas
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
