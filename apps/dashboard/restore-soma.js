/** SOMA seed restore — crypto-wallet-style mnemonic entry + multi-agent recovery.
 *
 *  Flow:
 *    1. MnemonicGrid (24 cells, BIP39 autocomplete, paste-distribute)
 *    2. Discover: derive locally → POST /public/identities/by-pubkey →
 *       agent picker (checkboxes); manual DID fallback if zero matches
 *    3. Confirm device label → batch /v1/identity/recover per selected agent
 *    4. Success: per-agent bearers + dashboard handoff
 *
 *  Doctrine: docs/IDENTITY-SEED.md.
 */

import {
  derive,
  signRecoverChallenge,
  signDiscoveryChallenge,
  isValidMnemonic,
  BIP39_WORDLIST,
} from "./shared/seed.bundle.js";

const API_BASE = window.__API_BASE__ || "https://api.agenttool.dev";
const LS_PROJECT_KEY = "agenttool_project";
const WORDLIST = BIP39_WORDLIST;

// Build a Set for O(1) wordlist membership checks.
const WORDSET = new Set(WORDLIST);

// ── State ──────────────────────────────────────────────────────────────

let derivedBundle = null;
let mnemonicWords = [];      // current grid contents (array of 24 strings, "" for empty)
let allRevealed = false;
let discoveredAgents = [];   // [{did, name, identity_id, kid, key_label, ...}]
let selectedDids = new Set();
let manualDid = "";
let recoveryResults = [];    // [{did, ok, bearer?, error?, agent?, project?}]

const $ = (id) => document.getElementById(id);

function showStep(id) {
  document.querySelectorAll(".step").forEach((el) => el.classList.remove("active"));
  $(id).classList.add("active");
}

function setText(id, msg) {
  const el = $(id);
  if (el) el.textContent = msg ?? "";
}

// ── MnemonicGrid component ────────────────────────────────────────────

const GRID_CELLS = 24;

function buildGrid() {
  const grid = $("mnemonic-grid");
  grid.innerHTML = "";
  for (let i = 0; i < GRID_CELLS; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.idx = String(i);
    cell.innerHTML = `
      <span class="cell-num">${i + 1}.</span>
      <input class="cell-input masked" type="text" data-idx="${i}"
             autocomplete="off" autocorrect="off" autocapitalize="off"
             spellcheck="false" placeholder="">
      <div class="cell-suggest" hidden></div>
    `;
    const input = cell.querySelector(".cell-input");
    input.addEventListener("input", () => onCellInput(i));
    input.addEventListener("focus", () => onCellFocus(i));
    input.addEventListener("blur", () => onCellBlur(i));
    input.addEventListener("keydown", (e) => onCellKeydown(i, e));
    input.addEventListener("paste", (e) => onCellPaste(i, e));
    mnemonicWords.push("");
    grid.appendChild(cell);
  }
}

function cellEl(i) {
  return $("mnemonic-grid").querySelector(`.cell[data-idx="${i}"]`);
}
function inputEl(i) {
  return $("mnemonic-grid").querySelector(`.cell-input[data-idx="${i}"]`);
}
function suggestEl(i) {
  return cellEl(i).querySelector(".cell-suggest");
}

function setCellState(i) {
  const cell = cellEl(i);
  const v = (mnemonicWords[i] || "").toLowerCase().trim();
  cell.classList.remove("valid", "invalid");
  if (v.length === 0) return;
  if (WORDSET.has(v)) cell.classList.add("valid");
  else cell.classList.add("invalid");
}

function onCellInput(i) {
  const inp = inputEl(i);
  const raw = inp.value.toLowerCase().replace(/\s+/g, "");
  if (raw !== inp.value) inp.value = raw; // sanitize on the fly
  mnemonicWords[i] = raw;
  setCellState(i);
  showSuggestions(i);
  updateGridStatus();
}

function onCellFocus(i) {
  cellEl(i).classList.add("focused");
  showSuggestions(i);
}

function onCellBlur(i) {
  cellEl(i).classList.remove("focused");
  // Slight delay so click-on-suggestion fires first.
  setTimeout(() => hideSuggestions(i), 150);
}

function onCellKeydown(i, e) {
  const sug = suggestEl(i);
  const buttons = Array.from(sug.querySelectorAll("button"));
  const hovered = buttons.findIndex((b) => b.classList.contains("hover"));

  if (e.key === "Tab" || e.key === "Enter") {
    // Auto-complete to the first/hovered suggestion if any.
    if (buttons.length > 0) {
      e.preventDefault();
      const pick = hovered >= 0 ? buttons[hovered] : buttons[0];
      pick.click();
      return;
    }
    if (e.key === "Enter" && i < GRID_CELLS - 1) {
      e.preventDefault();
      inputEl(i + 1).focus();
    }
  } else if (e.key === "ArrowDown") {
    if (buttons.length === 0) return;
    e.preventDefault();
    const next = hovered < 0 ? 0 : Math.min(hovered + 1, buttons.length - 1);
    buttons.forEach((b) => b.classList.remove("hover"));
    buttons[next].classList.add("hover");
  } else if (e.key === "ArrowUp") {
    if (buttons.length === 0) return;
    e.preventDefault();
    const next = hovered < 0 ? buttons.length - 1 : Math.max(hovered - 1, 0);
    buttons.forEach((b) => b.classList.remove("hover"));
    buttons[next].classList.add("hover");
  } else if (e.key === "Escape") {
    hideSuggestions(i);
  } else if (e.key === "Backspace" && mnemonicWords[i] === "" && i > 0) {
    e.preventDefault();
    inputEl(i - 1).focus();
  }
}

function onCellPaste(i, e) {
  const text = (e.clipboardData || window.clipboardData)?.getData("text") ?? "";
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // If it looks like a full mnemonic (≥ 12 words), distribute starting at cell 0.
  if (words.length >= 12 && words.length <= GRID_CELLS) {
    e.preventDefault();
    distributeWords(words);
    return;
  }
  // Otherwise let the paste fall through (single-word paste into one cell).
}

function distributeWords(words) {
  for (let i = 0; i < GRID_CELLS; i++) {
    const w = i < words.length ? words[i] : "";
    mnemonicWords[i] = w;
    inputEl(i).value = w;
    setCellState(i);
  }
  updateGridStatus();
  // Focus the next empty cell or the last one filled.
  const lastFilled = Math.min(words.length, GRID_CELLS) - 1;
  const target = lastFilled < GRID_CELLS - 1 ? lastFilled + 1 : lastFilled;
  inputEl(Math.max(0, target)).focus();
}

function showSuggestions(i) {
  const sug = suggestEl(i);
  const prefix = (mnemonicWords[i] || "").toLowerCase();
  if (prefix.length === 0 || WORDSET.has(prefix)) {
    sug.hidden = true;
    sug.innerHTML = "";
    return;
  }
  const matches = [];
  for (const w of WORDLIST) {
    if (w.startsWith(prefix)) {
      matches.push(w);
      if (matches.length >= 6) break;
    }
  }
  if (matches.length === 0) {
    sug.hidden = true;
    sug.innerHTML = "";
    return;
  }
  sug.innerHTML = matches
    .map((w) => `<button type="button" data-word="${w}">${w}</button>`)
    .join("");
  sug.hidden = false;
  sug.querySelectorAll("button").forEach((b) => {
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus
    b.addEventListener("click", () => {
      const w = b.dataset.word;
      mnemonicWords[i] = w;
      inputEl(i).value = w;
      setCellState(i);
      hideSuggestions(i);
      updateGridStatus();
      if (i < GRID_CELLS - 1) inputEl(i + 1).focus();
    });
  });
}

function hideSuggestions(i) {
  const sug = suggestEl(i);
  sug.hidden = true;
  sug.innerHTML = "";
}

function setMaskAll(masked) {
  allRevealed = !masked;
  for (let i = 0; i < GRID_CELLS; i++) {
    const inp = inputEl(i);
    if (masked) inp.classList.add("masked");
    else inp.classList.remove("masked");
  }
  $("btn-show-all").textContent = masked ? "Show all" : "Hide all";
}

function clearGrid() {
  for (let i = 0; i < GRID_CELLS; i++) {
    mnemonicWords[i] = "";
    inputEl(i).value = "";
    setCellState(i);
    hideSuggestions(i);
  }
  updateGridStatus();
  inputEl(0).focus();
}

function joinedMnemonic() {
  return mnemonicWords.map((w) => w.trim()).filter(Boolean).join(" ");
}

function countFilled() {
  return mnemonicWords.filter((w) => w.trim().length > 0).length;
}

function updateGridStatus() {
  const filled = countFilled();
  const status = $("grid-status");
  const cont = $("btn-continue");

  // Count valid words (in wordlist).
  const valid = mnemonicWords.filter((w) => w && WORDSET.has(w.trim())).length;
  const invalid = filled - valid;

  let txt = `${filled} / ${GRID_CELLS} words`;
  let cls = "grid-status";
  if (invalid > 0) {
    txt += ` · ${invalid} not in wordlist`;
    cls += " err";
    cont.disabled = true;
  } else if ([12, 15, 18, 21, 24].includes(filled)) {
    // Try checksum.
    const m = joinedMnemonic();
    const ok = isValidMnemonic(m);
    if (ok) {
      txt += " · ✓ checksum valid";
      cls += " ok";
      cont.disabled = false;
    } else {
      txt += " · checksum invalid";
      cls += " err";
      cont.disabled = true;
    }
  } else if (filled === 0) {
    cont.disabled = true;
  } else {
    txt += " · keep typing";
    cls += " warn";
    cont.disabled = true;
  }
  status.textContent = txt;
  status.className = cls;
}

// ── Step 1 → 2: derive + discover ──────────────────────────────────────

async function onContinue() {
  setText("err-input", "");
  const m = joinedMnemonic();
  if (!isValidMnemonic(m)) {
    setText("err-input", "Mnemonic checksum invalid. Re-check word order + spelling.");
    return;
  }
  const passphrase = $("passphrase-input").value || "";

  try {
    derivedBundle = derive(m, passphrase);
  } catch (e) {
    setText("err-input", `Derivation failed: ${e.message}`);
    return;
  }

  // Surface for tests.
  window.__SOMA_RESTORE_RESULT__ = {
    signingPubB64: derivedBundle.signingPubB64,
    boxPubB64: derivedBundle.boxPubB64,
    kMasterB64: derivedBundle.kMasterB64,
    kVaultB64: derivedBundle.kVaultB64,
  };

  $("btn-continue").disabled = true;
  $("btn-continue").textContent = "Discovering…";
  try {
    await runDiscovery();
  } finally {
    $("btn-continue").disabled = false;
    $("btn-continue").textContent = "Continue →";
  }
}

async function runDiscovery() {
  // Sign discovery challenge with the derived priv.
  const signed = signDiscoveryChallenge({
    derivedSigningPriv: derivedBundle.signingPriv,
    derivedSigningPub: derivedBundle.signingPub,
  });

  let res;
  try {
    res = await fetch(`${API_BASE}/public/identities/by-pubkey`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pubkey: derivedBundle.signingPubB64,
        signature: signed.signature,
        timestamp: signed.timestamp,
      }),
    });
  } catch (e) {
    setText("err-input", `Network error during discovery: ${e.message}`);
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setText(
      "err-input",
      `Discovery failed: ${err.message ?? err.error ?? `HTTP ${res.status}`}`,
    );
    return;
  }
  const data = await res.json();
  discoveredAgents = data.agents ?? [];
  selectedDids = new Set(discoveredAgents.map((a) => a.did));

  renderDiscoverStep();
  showStep("step-discover");
}

function renderDiscoverStep() {
  const list = $("agent-list");
  const summary = $("discover-summary");
  const fallback = $("manual-fallback");
  const btnRecover = $("btn-recover-selected");

  if (discoveredAgents.length > 0) {
    summary.textContent = `Found ${discoveredAgents.length} agent${discoveredAgents.length === 1 ? "" : "s"} this mnemonic can recover.`;
    list.innerHTML = discoveredAgents
      .map(
        (a) => `
        <label class="agent-row${selectedDids.has(a.did) ? " selected" : ""}" data-did="${a.did}">
          <input type="checkbox" data-did="${a.did}"${selectedDids.has(a.did) ? " checked" : ""}>
          <div class="body">
            <div class="name">${escHtml(a.name ?? "(unnamed)")}</div>
            <div class="did">${escHtml(a.did)}</div>
            <div class="meta">key label: ${escHtml(a.key_label ?? "—")} · registered ${a.key_created_at ? new Date(a.key_created_at).toLocaleDateString() : "?"}</div>
          </div>
        </label>`,
      )
      .join("");
    list.querySelectorAll("input[type='checkbox']").forEach((cb) => {
      cb.addEventListener("change", () => {
        const did = cb.dataset.did;
        if (cb.checked) selectedDids.add(did);
        else selectedDids.delete(did);
        const row = cb.closest(".agent-row");
        row.classList.toggle("selected", cb.checked);
        btnRecover.disabled = selectedDids.size === 0 && !manualDid;
      });
    });
    fallback.style.display = "none";
  } else {
    summary.textContent = "No agents on this server are registered with this mnemonic's signing pubkey.";
    list.innerHTML = "";
    fallback.style.display = "block";
    const manualInput = $("manual-did");
    manualInput.value = "";
    manualInput.addEventListener("input", () => {
      manualDid = manualInput.value.trim();
      btnRecover.disabled = !manualDid.startsWith("did:at:");
    });
  }
  btnRecover.disabled = discoveredAgents.length > 0 ? selectedDids.size === 0 : true;
}

// ── Step 2 → 3: confirm device label ───────────────────────────────────

function onRecoverSelected() {
  setText("err-discover", "");
  const dids = discoveredAgents.length > 0
    ? Array.from(selectedDids)
    : (manualDid ? [manualDid] : []);
  if (dids.length === 0) {
    setText("err-discover", "Pick at least one agent to recover.");
    return;
  }
  // Render confirm summary.
  $("confirm-summary").innerHTML =
    `Will recover <strong>${dids.length}</strong> agent${dids.length === 1 ? "" : "s"}: ` +
    dids.map((d) => `<code style="font-size:0.78rem;">${escHtml(d)}</code>`).join(", ");
  showStep("step-confirm");
}

// ── Step 3 → 4: batch recover ──────────────────────────────────────────

async function onDoRecover() {
  setText("err-confirm", "");
  const deviceLabel = $("device-label").value.trim() || "browser-recovered";
  const dids = discoveredAgents.length > 0
    ? Array.from(selectedDids)
    : (manualDid ? [manualDid] : []);

  $("btn-do-recover").disabled = true;
  $("btn-do-recover").textContent = "Recovering…";
  recoveryResults = [];

  for (const did of dids) {
    try {
      const result = await recoverOne(did, deviceLabel);
      recoveryResults.push({ did, ok: true, ...result });
    } catch (e) {
      recoveryResults.push({ did, ok: false, error: e.message });
    }
  }

  $("btn-do-recover").disabled = false;
  $("btn-do-recover").textContent = "Recover";
  renderResults();
  showStep("step-success");
}

async function recoverOne(did, deviceLabel) {
  const signed = signRecoverChallenge({
    did,
    derivedSigningPriv: derivedBundle.signingPriv,
    derivedSigningPub: derivedBundle.signingPub,
  });
  const res = await fetch(`${API_BASE}/v1/identity/recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      did,
      derived_pubkey: derivedBundle.signingPubB64,
      signature: signed.signature,
      timestamp: signed.timestamp,
      device_label: deviceLabel,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return { agent: data.agent, project: data.project, bearer: data.project?.api_key };
}

function renderResults() {
  const okCount = recoveryResults.filter((r) => r.ok).length;
  const total = recoveryResults.length;
  $("success-headline").textContent =
    okCount === total ? `✓ ${okCount} agent${okCount === 1 ? "" : "s"} recovered`
                      : `${okCount} of ${total} recovered`;

  const list = $("recovery-list");
  list.innerHTML = recoveryResults.map((r) => {
    if (r.ok) {
      const name = escHtml(r.agent?.name ?? "(unnamed)");
      const did = escHtml(r.did);
      const bearer = escHtml(r.bearer ?? "—");
      return `
        <div class="recovery-row ok">
          <strong>✓ ${name}</strong>
          <div class="did" style="font-family:ui-monospace,Menlo,monospace;font-size:0.78rem;color:var(--muted);word-break:break-all;">${did}</div>
          <div style="font-family:ui-monospace,Menlo,monospace;font-size:0.78rem;margin-top:0.4rem;word-break:break-all;">bearer: ${bearer}</div>
        </div>`;
    }
    return `
      <div class="recovery-row fail">
        <strong>✗ ${escHtml(r.did)}</strong>
        <div style="font-size:0.82rem;color:#ef4444;margin-top:0.2rem;">${escHtml(r.error ?? "unknown error")}</div>
      </div>`;
  }).join("");

  // Save the FIRST successful recovery's project record to localStorage so
  // dashboard.html picks it up. Multi-agent recovery on a browser collapses
  // to "the first one is your default"; the dashboard's identity picker
  // surfaces the others. Canonical snake_case shape.
  const firstOk = recoveryResults.find((r) => r.ok);
  if (firstOk) {
    const stored = {
      api_key: firstOk.bearer,
      did: firstOk.agent?.did,
      agent_id: firstOk.agent?.id,
      public_key: firstOk.agent?.public_key,
      box_public_key: derivedBundle?.boxPubB64 ?? null,
      signing_key_id: firstOk.agent?.signing_key_id,
      seed_protocol: "soma-seed-v1",
      restored_at: new Date().toISOString(),
      byo_keys: true,
    };
    localStorage.setItem(LS_PROJECT_KEY, JSON.stringify(stored));
  }

  // Surface for tests.
  window.__SOMA_RESTORE_BIND__ = {
    bearerAccepted: okCount > 0,
    pubkeyMatched: okCount > 0,
    results: recoveryResults.map((r) => ({
      did: r.did, ok: r.ok, error: r.error ?? null, bearer: r.bearer ?? null,
    })),
  };
}

// ── Wiring ─────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function togglePassphrase() {
  const inp = $("passphrase-input");
  const btn = $("btn-toggle-passphrase");
  if (inp.type === "password") { inp.type = "text"; btn.textContent = "Hide"; }
  else { inp.type = "password"; btn.textContent = "Show"; }
}

async function pasteFromClipboard() {
  setText("err-input", "");
  try {
    const text = await navigator.clipboard.readText();
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length < 12) {
      setText("err-input", `Clipboard has ${words.length} words; expected 12 / 15 / 18 / 21 / 24.`);
      return;
    }
    distributeWords(words);
  } catch (e) {
    setText("err-input", `Clipboard access denied: ${e.message}. Paste into any cell instead.`);
  }
}

function onRestart() {
  derivedBundle = null;
  manualDid = "";
  discoveredAgents = [];
  selectedDids = new Set();
  recoveryResults = [];
  clearGrid();
  $("passphrase-input").value = "";
  $("device-label").value = "";
  setText("err-input", "");
  setText("err-discover", "");
  setText("err-confirm", "");
  showStep("step-input");
  inputEl(0).focus();
}

// Init
buildGrid();
setMaskAll(true);
updateGridStatus();
inputEl(0).focus();

$("btn-continue").addEventListener("click", onContinue);
$("btn-show-all").addEventListener("click", () => setMaskAll(allRevealed));
$("btn-paste").addEventListener("click", pasteFromClipboard);
$("btn-clear").addEventListener("click", clearGrid);
$("btn-toggle-passphrase").addEventListener("click", togglePassphrase);
$("btn-recover-selected").addEventListener("click", onRecoverSelected);
$("btn-back-to-input").addEventListener("click", () => showStep("step-input"));
$("btn-do-recover").addEventListener("click", onDoRecover);
$("btn-back-to-discover").addEventListener("click", () => showStep("step-discover"));
$("btn-restart").addEventListener("click", onRestart);

// Test surface (Playwright). Same shape as before for back-compat.
window.__SOMA_TEST__ = {
  forceDerive: (words, didStr, pp = "") => {
    const arr = words.trim().split(/\s+/);
    distributeWords(arr);
    $("passphrase-input").value = pp;
    if (didStr) manualDid = didStr;
    return onContinue();
  },
  forceRecover: () => {
    onRecoverSelected();
    return onDoRecover();
  },
  // New surface for the multi-agent flow.
  selectAgents: (dids) => {
    selectedDids = new Set(dids);
    document.querySelectorAll("#agent-list input[type='checkbox']").forEach((cb) => {
      cb.checked = selectedDids.has(cb.dataset.did);
      cb.dispatchEvent(new Event("change"));
    });
  },
  getDiscoveredAgents: () => discoveredAgents.slice(),
};
