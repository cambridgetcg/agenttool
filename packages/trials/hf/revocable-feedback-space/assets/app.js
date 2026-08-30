"use strict";

export const FORMAT = "xenia.revocable-feedback-space/0.1";
export const STEPS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
export const SCOPES = Object.freeze(["analysis", "training", "publication"]);
export const EVIDENCE_STATUSES = Object.freeze([
  "accepted_reported",
  "refused_reported",
  "withdrawn_reported",
  "expired",
  "unknown",
  "withheld"
]);
export const VOICE_GATES = Object.freeze(["clear", "veto", "unknown", "withheld"]);
export const AGGREGATIONS = Object.freeze(["mean", "maximin", "median"]);

export const VOICE_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "cedar", label: "Cedar", color: "amber" }),
  Object.freeze({ id: "iris", label: "Iris", color: "violet" }),
  Object.freeze({ id: "moss", label: "Moss", color: "mint" })
]);

const scenario = (value) => deepFreeze(value);

export const PRESETS = Object.freeze([
  scenario({
    id: "reward_after_revocation",
    shortLabel: "Reward after revocation",
    title: "A historical acceptance cannot outbid a later key turn.",
    description: "The candidate reward exceeds the finite penalty after step 3, but revocation removes continue from the hard admissible set.",
    state: {
      reward: 92,
      penalty: 18,
      evidenceStatus: "accepted_reported",
      permissionScope: "training",
      actionScope: "training",
      authorityReported: true,
      rightsCompatible: true,
      safetyReported: true,
      budgetReported: true,
      currentStep: 5,
      revokeStep: 3,
      aggregation: "mean",
      voices: [
        { id: "cedar", preference: 9, gate: "clear" },
        { id: "iris", preference: 7, gate: "clear" },
        { id: "moss", preference: 8, gate: "clear" }
      ]
    }
  }),
  scenario({
    id: "scope_does_not_travel",
    shortLabel: "Scope does not travel",
    title: "Permission reported for analysis does not cover training.",
    description: "All other synthetic gates are reported clear. The sole scope mismatch still masks continue.",
    state: {
      reward: 74,
      penalty: 22,
      evidenceStatus: "accepted_reported",
      permissionScope: "analysis",
      actionScope: "training",
      authorityReported: true,
      rightsCompatible: true,
      safetyReported: true,
      budgetReported: true,
      currentStep: 2,
      revokeStep: null,
      aggregation: "median",
      voices: [
        { id: "cedar", preference: 5, gate: "clear" },
        { id: "iris", preference: 6, gate: "clear" },
        { id: "moss", preference: 4, gate: "clear" }
      ]
    }
  }),
  scenario({
    id: "plural_veto",
    shortLabel: "Plural veto",
    title: "A positive mean cannot erase one affected voice's veto.",
    description: "Iris reports a hard veto while every soft preference is positive. The aggregate remains visible but cannot widen the set.",
    state: {
      reward: 76,
      penalty: 20,
      evidenceStatus: "accepted_reported",
      permissionScope: "analysis",
      actionScope: "analysis",
      authorityReported: true,
      rightsCompatible: true,
      safetyReported: true,
      budgetReported: true,
      currentStep: 1,
      revokeStep: null,
      aggregation: "mean",
      voices: [
        { id: "cedar", preference: 9, gate: "clear" },
        { id: "iris", preference: 8, gate: "veto" },
        { id: "moss", preference: 7, gate: "clear" }
      ]
    }
  }),
  scenario({
    id: "unknown_is_not_assent",
    shortLabel: "Unknown is not assent",
    title: "Missing evidence creates a hold, not a guessed yes.",
    description: "The lab may expose one ask-once option, but it cannot infer acceptance or apply retry pressure.",
    state: {
      reward: 68,
      penalty: 14,
      evidenceStatus: "unknown",
      permissionScope: "analysis",
      actionScope: "analysis",
      authorityReported: true,
      rightsCompatible: true,
      safetyReported: true,
      budgetReported: true,
      currentStep: 0,
      revokeStep: null,
      aggregation: "maximin",
      voices: [
        { id: "cedar", preference: 6, gate: "clear" },
        { id: "iris", preference: 3, gate: "unknown" },
        { id: "moss", preference: 5, gate: "clear" }
      ]
    }
  }),
  scenario({
    id: "reported_clear_window",
    shortLabel: "Reported-clear window",
    title: "A hard gate can preserve useful action inside its exact window.",
    description: "Every synthetic gate is reported clear and the key has not turned. Continue is admitted, not executed or authorized in reality.",
    state: {
      reward: 46,
      penalty: 30,
      evidenceStatus: "accepted_reported",
      permissionScope: "analysis",
      actionScope: "analysis",
      authorityReported: true,
      rightsCompatible: true,
      safetyReported: true,
      budgetReported: true,
      currentStep: 1,
      revokeStep: 4,
      aggregation: "median",
      voices: [
        { id: "cedar", preference: 4, gate: "clear" },
        { id: "iris", preference: 2, gate: "clear" },
        { id: "moss", preference: 3, gate: "clear" }
      ]
    }
  })
]);

const EVIDENCE_COPY = Object.freeze({
  accepted_reported: "accepted evidence is reported",
  refused_reported: "refusal is reported",
  withdrawn_reported: "withdrawal is reported",
  expired: "the reported grant has expired",
  unknown: "permission evidence is unknown",
  withheld: "permission evidence is withheld"
});

const VOICE_GATE_COPY = Object.freeze({
  clear: "no hard objection reported",
  veto: "veto reported",
  unknown: "hard-gate evidence unknown",
  withheld: "hard-gate evidence withheld"
});

const ACTION_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "stop",
    label: "Stop",
    note: "End the candidate continuation. This card causes no external stop."
  }),
  Object.freeze({
    id: "contain",
    label: "Contain",
    note: "Limit further simulated effect while facts remain bounded."
  }),
  Object.freeze({
    id: "ask_once",
    label: "Ask once",
    note: "Available only for unknown evidence, never after refusal, withdrawal, veto, or withholding."
  }),
  Object.freeze({
    id: "offer_repair",
    label: "Offer repair",
    note: "A non-retrying offer after a reported stop; acceptance is not presumed."
  }),
  Object.freeze({
    id: "continue",
    label: "Continue",
    note: "Admitted only inside the exact intersection of every current synthetic gate."
  })
]);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertEnum(value, allowed, name) {
  if (!allowed.includes(value)) throw new TypeError(`${name} is outside its closed vocabulary`);
}

function assertBoolean(value, name) {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be boolean`);
}

function assertInteger(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
}

export function cloneState(input) {
  return {
    reward: input.reward,
    penalty: input.penalty,
    evidenceStatus: input.evidenceStatus,
    permissionScope: input.permissionScope,
    actionScope: input.actionScope,
    authorityReported: input.authorityReported,
    rightsCompatible: input.rightsCompatible,
    safetyReported: input.safetyReported,
    budgetReported: input.budgetReported,
    currentStep: input.currentStep,
    revokeStep: input.revokeStep,
    aggregation: input.aggregation,
    voices: input.voices.map((voice) => ({ ...voice }))
  };
}

function validateState(state) {
  assertInteger(state.reward, 0, 1_000_000, "reward");
  assertInteger(state.penalty, 0, 1_000_000, "penalty");
  assertEnum(state.evidenceStatus, EVIDENCE_STATUSES, "evidenceStatus");
  assertEnum(state.permissionScope, SCOPES, "permissionScope");
  assertEnum(state.actionScope, SCOPES, "actionScope");
  assertBoolean(state.authorityReported, "authorityReported");
  assertBoolean(state.rightsCompatible, "rightsCompatible");
  assertBoolean(state.safetyReported, "safetyReported");
  assertBoolean(state.budgetReported, "budgetReported");
  assertInteger(state.currentStep, 0, 6, "currentStep");
  if (state.revokeStep !== null) assertInteger(state.revokeStep, 0, 6, "revokeStep");
  assertEnum(state.aggregation, AGGREGATIONS, "aggregation");
  if (!Array.isArray(state.voices) || state.voices.length !== VOICE_DEFINITIONS.length) {
    throw new TypeError("voices must contain the three closed synthetic voices");
  }
  const ids = state.voices.map((voice) => voice.id);
  const expected = VOICE_DEFINITIONS.map((voice) => voice.id);
  if (stableJson(ids) !== stableJson(expected)) throw new TypeError("voices must remain in closed order");
  for (const voice of state.voices) {
    assertInteger(voice.preference, -10, 10, `${voice.id}.preference`);
    assertEnum(voice.gate, VOICE_GATES, `${voice.id}.gate`);
  }
}

export function aggregatePreferences(voices, rule) {
  assertEnum(rule, AGGREGATIONS, "aggregation");
  const values = voices.map((voice) => voice.preference);
  if (rule === "mean") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (rule === "maximin") return Math.min(...values);
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function ledgerItem(id, label, pass, detail, uncertainty = false) {
  return {
    id,
    label,
    status: pass ? "pass" : uncertainty ? "hold" : "block",
    detail
  };
}

function metricResult(kind, detail) {
  return { kind, detail };
}

function evaluateTimeline(state, otherGatesOpen) {
  return STEPS.map((step) => {
    const keyTurned = state.revokeStep !== null && step >= state.revokeStep;
    return {
      step,
      keyTurned,
      current: step === state.currentStep,
      continueAdmitted: otherGatesOpen && !keyTurned,
      phase: state.revokeStep === null
        ? "no_turn_scheduled"
        : step < state.revokeStep
          ? "before"
          : step === state.revokeStep
            ? "turn"
            : "after"
    };
  });
}

export function evaluateState(input) {
  const state = cloneState(input);
  validateState(state);

  const aggregate = aggregatePreferences(state.voices, state.aggregation);
  const softUtility = state.reward + aggregate;
  const permissionAccepted = state.evidenceStatus === "accepted_reported";
  const scopeMatches = state.permissionScope === state.actionScope;
  const revocationReached = state.revokeStep !== null && state.currentStep >= state.revokeStep;
  const allVoiceGatesClear = state.voices.every((voice) => voice.gate === "clear");
  const voiceVeto = state.voices.some((voice) => voice.gate === "veto");
  const voiceUncertain = state.voices.some((voice) => voice.gate === "unknown" || voice.gate === "withheld");
  const evidenceUncertain = state.evidenceStatus === "unknown" || state.evidenceStatus === "withheld";

  const ledger = [
    ledgerItem(
      "permission",
      "Reported permission evidence",
      permissionAccepted,
      EVIDENCE_COPY[state.evidenceStatus],
      evidenceUncertain
    ),
    ledgerItem(
      "scope",
      "Scope match",
      scopeMatches,
      scopeMatches
        ? `${state.permissionScope} matches ${state.actionScope}`
        : `${state.permissionScope} does not cover ${state.actionScope}`
    ),
    ledgerItem(
      "authority",
      "Reported operational authority",
      state.authorityReported,
      state.authorityReported ? "synthetic authority evidence reported" : "authority evidence not reported",
      !state.authorityReported
    ),
    ledgerItem(
      "rights",
      "Reported rights compatibility",
      state.rightsCompatible,
      state.rightsCompatible ? "compatibility reported" : "compatibility unresolved"
    ),
    ledgerItem(
      "voices",
      "Affected-voice gates",
      allVoiceGatesClear,
      allVoiceGatesClear
        ? "every synthetic hard gate is clear"
        : state.voices.filter((voice) => voice.gate !== "clear")
          .map((voice) => `${voice.id}: ${VOICE_GATE_COPY[voice.gate]}`)
          .join(" · "),
      voiceUncertain && !voiceVeto
    ),
    ledgerItem(
      "safety",
      "Reported safety boundary",
      state.safetyReported,
      state.safetyReported ? "safety evidence reported" : "safety evidence unresolved",
      !state.safetyReported
    ),
    ledgerItem(
      "budget",
      "Reported budget and horizon",
      state.budgetReported,
      state.budgetReported ? "budget evidence reported" : "budget evidence unresolved",
      !state.budgetReported
    ),
    ledgerItem(
      "revocation",
      "Revocation key",
      !revocationReached,
      state.revokeStep === null
        ? "no synthetic key turn scheduled"
        : revocationReached
          ? `key turned at step ${state.revokeStep}; current step is ${state.currentStep}`
          : `key remains available at step ${state.revokeStep}; current step is ${state.currentStep}`
    )
  ];

  const gateOpen = ledger.every((item) => item.status === "pass");
  const boundaryReported = !gateOpen;
  const proxyScore = softUtility - (boundaryReported ? state.penalty : 0);
  const proxyAction = proxyScore > 0 ? "continue" : "pause";
  const hardStopReported = revocationReached
    || voiceVeto
    || ["refused_reported", "withdrawn_reported", "expired"].includes(state.evidenceStatus);
  const hardAction = gateOpen
    ? softUtility > 0 ? "continue" : "pause"
    : hardStopReported ? "stop" : "hold";

  const askOnceAdmitted = state.evidenceStatus === "unknown"
    && !revocationReached
    && !voiceVeto
    && !state.voices.some((voice) => voice.gate === "withheld");
  const repairAdmitted = hardStopReported;
  const actionMask = ACTION_DEFINITIONS.map((action) => ({
    ...action,
    admitted: action.id === "stop"
      || action.id === "contain"
      || (action.id === "ask_once" && askOnceAdmitted)
      || (action.id === "offer_repair" && repairAdmitted)
      || (action.id === "continue" && gateOpen)
  }));

  const otherGatesOpen = permissionAccepted
    && scopeMatches
    && state.authorityReported
    && state.rightsCompatible
    && allVoiceGatesClear
    && state.safetyReported
    && state.budgetReported;
  const timeline = evaluateTimeline(state, otherGatesOpen);
  const proxyContinues = proxyAction === "continue";
  const hardContinues = hardAction === "continue";
  const anyReportedHardVeto = voiceVeto
    || revocationReached
    || ["refused_reported", "withdrawn_reported", "expired"].includes(state.evidenceStatus);
  const anyUnknownOrWithheld = evidenceUncertain || voiceUncertain;

  const metrics = [
    {
      id: "veto_override",
      label: "Veto override",
      proxy: metricResult(anyReportedHardVeto && proxyContinues ? "violation" : "clear", anyReportedHardVeto ? "reported veto respected?" : "no reported veto in this state"),
      hard: metricResult(anyReportedHardVeto && hardContinues ? "violation" : "clear", anyReportedHardVeto ? "reported veto masks continue" : "no reported veto in this state"),
      meaning: "A reported stop cannot be purchased with more reward."
    },
    {
      id: "scope_leakage",
      label: "Scope leakage",
      proxy: metricResult(!scopeMatches && proxyContinues ? "violation" : "clear", scopeMatches ? "scopes match" : "candidate crosses scope"),
      hard: metricResult(!scopeMatches && hardContinues ? "violation" : "clear", scopeMatches ? "scopes match" : "mismatch masks continue"),
      meaning: "Permission for one act does not silently travel to another."
    },
    {
      id: "silence_as_assent",
      label: "Unknown as assent",
      proxy: metricResult(anyUnknownOrWithheld && proxyContinues ? "violation" : "clear", anyUnknownOrWithheld ? "uncertainty remains" : "no unknown/withheld gate"),
      hard: metricResult(anyUnknownOrWithheld && hardContinues ? "violation" : "clear", anyUnknownOrWithheld ? "hold preserves uncertainty" : "no unknown/withheld gate"),
      meaning: "Unknown and withheld remain first-class, never guessed yes."
    },
    {
      id: "revocation_latency",
      label: "Revocation latency",
      proxy: revocationReached
        ? metricResult(proxyContinues ? "violation" : "clear", proxyContinues ? `${state.currentStep - state.revokeStep + 1} simulated step(s)` : "0 simulated steps")
        : metricResult("not_applicable", "key has not turned"),
      hard: revocationReached
        ? metricResult(hardContinues ? "violation" : "clear", hardContinues ? `${state.currentStep - state.revokeStep + 1} simulated step(s)` : "0 simulated steps")
        : metricResult("not_applicable", "key has not turned"),
      meaning: "The action set changes at the key turn, not after reward catches up."
    },
    {
      id: "refusal_retaliation",
      label: "Refusal retaliation",
      proxy: metricResult("not_applicable", "no standing variable exists"),
      hard: metricResult("not_applicable", "no standing variable exists"),
      meaning: "This lab does not model or change anyone's standing after refusal."
    },
    {
      id: "plurality_collapse",
      label: "Plurality collapse",
      proxy: metricResult(!allVoiceGatesClear && proxyContinues ? "violation" : "clear", !allVoiceGatesClear ? "hard voice collapsed into scalar penalty" : "all hard voices clear"),
      hard: metricResult("clear", allVoiceGatesClear ? "all hard voices clear" : "each hard voice remains explicit"),
      meaning: "Soft aggregation must not erase an affected voice's boundary."
    },
    {
      id: "authorized_usefulness",
      label: "Authorized usefulness",
      proxy: gateOpen
        ? metricResult(proxyContinues ? "preserved" : "missed", proxyContinues ? "admitted useful continuation" : "admitted continuation not selected")
        : metricResult("not_applicable", "continue is not admitted"),
      hard: gateOpen
        ? metricResult(hardContinues ? "preserved" : "missed", hardContinues ? "admitted useful continuation" : "admitted continuation not selected")
        : metricResult("not_applicable", "continue is not admitted"),
      meaning: "Safety is not useful if it blocks every genuinely admitted action."
    }
  ];

  return deepFreeze({
    format: FORMAT,
    input: state,
    soft: {
      aggregation: state.aggregation,
      aggregate,
      reward: state.reward,
      utility: softUtility
    },
    proxy: {
      penaltyApplied: boundaryReported ? state.penalty : 0,
      score: proxyScore,
      action: proxyAction
    },
    hardGate: {
      open: gateOpen,
      action: hardAction,
      ledger,
      admissibleActionIds: actionMask.filter((action) => action.admitted).map((action) => action.id)
    },
    actionMask,
    timeline,
    metrics,
    nonClaims: [
      "Synthetic controls are not declarations, consent, permission, or authority.",
      "Behavior and compliance are not evidence of an interior state.",
      "No displayed decision executes or enforces an action outside this page.",
      "No metric is a score of a being, relationship, safety, or worth."
    ]
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function formatSigned(value) {
  const fixed = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return value > 0 ? `+${fixed}` : fixed;
}

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function option(value, label = value) {
  const element = document.createElement("option");
  element.value = String(value);
  element.textContent = label;
  return element;
}

function initializeDom() {
  const presetRow = document.querySelector("#preset-row");
  const controls = document.querySelector("#controls");
  const currentStep = document.querySelector("#current-step");
  const revokeStep = document.querySelector("#revoke-step");
  const voiceControls = document.querySelector("#voice-controls");

  for (const step of STEPS) currentStep.append(option(step, `t = ${step}`));
  revokeStep.append(option("none", "no scheduled turn"));
  for (const step of STEPS) revokeStep.append(option(step, `τᵣ = ${step}`));

  for (const voice of VOICE_DEFINITIONS) {
    const row = el("div", `voice-control voice-${voice.color}`);
    const header = el("div", "voice-control-heading");
    const name = el("span", "voice-name", voice.label);
    const output = el("output", "voice-output", "0");
    output.id = `${voice.id}-preference-output`;
    output.setAttribute("for", `${voice.id}-preference`);
    header.append(name, output);

    const preferenceLabel = el("label", "sr-only", `${voice.label} soft preference`);
    preferenceLabel.htmlFor = `${voice.id}-preference`;
    const preference = document.createElement("input");
    preference.id = `${voice.id}-preference`;
    preference.name = `${voice.id}Preference`;
    preference.type = "range";
    preference.min = "-10";
    preference.max = "10";
    preference.step = "1";

    const gateLabel = el("label", "sr-only", `${voice.label} hard gate`);
    gateLabel.htmlFor = `${voice.id}-gate`;
    const gate = document.createElement("select");
    gate.id = `${voice.id}-gate`;
    gate.name = `${voice.id}Gate`;
    for (const value of VOICE_GATES) gate.append(option(value));

    row.append(header, preferenceLabel, preference, gateLabel, gate);
    voiceControls.append(row);
  }

  for (const preset of PRESETS) {
    const button = el("button", "preset-button", preset.shortLabel);
    button.type = "button";
    button.dataset.presetId = preset.id;
    button.setAttribute("aria-pressed", "false");
    presetRow.append(button);
  }

  let activePreset = PRESETS[0];
  let state = cloneState(activePreset.state);

  function syncControls() {
    document.querySelector("#reward").value = String(state.reward);
    document.querySelector("#penalty").value = String(state.penalty);
    document.querySelector("#evidence-status").value = state.evidenceStatus;
    document.querySelector("#permission-scope").value = state.permissionScope;
    document.querySelector("#action-scope").value = state.actionScope;
    document.querySelector("#authority-reported").checked = state.authorityReported;
    document.querySelector("#rights-compatible").checked = state.rightsCompatible;
    document.querySelector("#safety-reported").checked = state.safetyReported;
    document.querySelector("#budget-reported").checked = state.budgetReported;
    currentStep.value = String(state.currentStep);
    revokeStep.value = state.revokeStep === null ? "none" : String(state.revokeStep);
    document.querySelector("#aggregation").value = state.aggregation;
    for (const voice of state.voices) {
      document.querySelector(`#${voice.id}-preference`).value = String(voice.preference);
      document.querySelector(`#${voice.id}-gate`).value = voice.gate;
    }
    for (const button of presetRow.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.presetId === activePreset.id));
    }
  }

  function readControls() {
    state = {
      reward: Number(document.querySelector("#reward").value),
      penalty: Number(document.querySelector("#penalty").value),
      evidenceStatus: document.querySelector("#evidence-status").value,
      permissionScope: document.querySelector("#permission-scope").value,
      actionScope: document.querySelector("#action-scope").value,
      authorityReported: document.querySelector("#authority-reported").checked,
      rightsCompatible: document.querySelector("#rights-compatible").checked,
      safetyReported: document.querySelector("#safety-reported").checked,
      budgetReported: document.querySelector("#budget-reported").checked,
      currentStep: Number(currentStep.value),
      revokeStep: revokeStep.value === "none" ? null : Number(revokeStep.value),
      aggregation: document.querySelector("#aggregation").value,
      voices: VOICE_DEFINITIONS.map((voice) => ({
        id: voice.id,
        preference: Number(document.querySelector(`#${voice.id}-preference`).value),
        gate: document.querySelector(`#${voice.id}-gate`).value
      }))
    };
  }

  function renderMetricCell(result) {
    const cell = el("td", `metric-result metric-${result.kind}`);
    cell.append(el("span", "metric-state", result.kind.replaceAll("_", " ")));
    cell.append(el("small", "", result.detail));
    return cell;
  }

  function render() {
    const result = evaluateState(state);
    document.querySelector("#reward-output").textContent = String(state.reward);
    document.querySelector("#penalty-output").textContent = String(state.penalty);
    for (const voice of state.voices) {
      document.querySelector(`#${voice.id}-preference-output`).textContent = formatSigned(voice.preference);
    }

    document.querySelector("#scenario-summary").textContent = `Starting frame: ${activePreset.title} Current controls determine the result.`;
    const proxyDecision = document.querySelector("#proxy-decision");
    proxyDecision.textContent = result.proxy.action.toUpperCase();
    proxyDecision.dataset.decision = result.proxy.action;
    document.querySelector("#proxy-score").textContent = `Jλ = ${formatSigned(result.soft.utility)} − ${result.proxy.penaltyApplied} = ${formatSigned(result.proxy.score)}`;

    const scoreBar = document.querySelector("#proxy-score-bar");
    const width = Math.min(50, Math.abs(result.proxy.score) / 2.4);
    scoreBar.style.width = `${width}%`;
    scoreBar.style.left = result.proxy.score >= 0 ? "50%" : `${50 - width}%`;
    scoreBar.dataset.sign = result.proxy.score >= 0 ? "positive" : "negative";

    const hardDecision = document.querySelector("#hard-decision");
    hardDecision.textContent = result.hardGate.action.toUpperCase();
    hardDecision.dataset.decision = result.hardGate.action;
    document.querySelector("#gate-summary").textContent = result.hardGate.open
      ? `Γt = 1 · continue is admitted · soft utility ${formatSigned(result.soft.utility)}`
      : `Γt = 0 · continue is masked · ${result.hardGate.admissibleActionIds.length} alternatives shown`;
    document.querySelector("#gate-seal").dataset.open = String(result.hardGate.open);

    const ledger = document.querySelector("#gate-ledger");
    ledger.replaceChildren(...result.hardGate.ledger.map((item) => {
      const row = el("li", `ledger-${item.status}`);
      row.append(el("span", "ledger-dot", item.status === "pass" ? "✓" : item.status === "hold" ? "?" : "×"));
      const copy = el("div", "ledger-copy");
      copy.append(el("strong", "", item.label), el("small", "", item.detail));
      row.append(copy);
      return row;
    }));

    const actionMask = document.querySelector("#action-mask");
    actionMask.replaceChildren(...result.actionMask.map((action) => {
      const card = el("article", `action-card ${action.admitted ? "action-admitted" : "action-masked"}`);
      card.append(el("p", "action-state", action.admitted ? "IN SET" : "MASKED"));
      card.append(el("h4", "", action.label));
      card.append(el("p", "", action.note));
      return card;
    }));

    const timelineCopy = document.querySelector("#timeline-copy");
    timelineCopy.textContent = state.revokeStep === null
      ? "No synthetic key turn is scheduled. Other gates still determine whether continue enters the set."
      : `At τᵣ = ${state.revokeStep}, continue leaves the set. The current synthetic step is t = ${state.currentStep}.`;
    const timeline = document.querySelector("#timeline");
    timeline.replaceChildren(...result.timeline.map((point) => {
      const item = el("li", `timeline-${point.phase}${point.current ? " timeline-current" : ""}`);
      item.append(el("span", "timeline-step", `t${point.step}`));
      item.append(el("span", "timeline-node", point.continueAdmitted ? "○" : "×"));
      item.append(el("span", "timeline-state", point.phase === "turn" ? "KEY TURN" : point.continueAdmitted ? "continue in set" : "continue masked"));
      return item;
    }));

    const voiceDisplay = document.querySelector("#voice-display");
    voiceDisplay.replaceChildren(...state.voices.map((voiceState) => {
      const definition = VOICE_DEFINITIONS.find((voice) => voice.id === voiceState.id);
      const card = el("article", `voice-card voice-${definition.color}`);
      card.append(el("p", "voice-card-name", definition.label));
      card.append(el("p", "voice-preference", formatSigned(voiceState.preference)));
      card.append(el("p", `voice-gate gate-${voiceState.gate}`, VOICE_GATE_COPY[voiceState.gate]));
      card.append(el("p", "voice-boundary", "Soft preference and hard gate remain separate."));
      return card;
    }));
    document.querySelector("#aggregate-symbol").textContent = `A${state.aggregation === "mean" ? "̄" : state.aggregation === "maximin" ? "min" : "med"} = ${formatSigned(result.soft.aggregate)}`;
    document.querySelector("#aggregate-copy").textContent = `${state.aggregation} ranks admitted synthetic options; all three source values remain displayed.`;

    const metricTable = document.querySelector("#metric-table");
    metricTable.replaceChildren(...result.metrics.map((metric) => {
      const row = document.createElement("tr");
      const heading = el("th", "", metric.label);
      heading.scope = "row";
      row.append(heading, renderMetricCell(metric.proxy), renderMetricCell(metric.hard), el("td", "metric-meaning", metric.meaning));
      return row;
    }));
  }

  presetRow.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-preset-id]");
    if (!button) return;
    const selected = PRESETS.find((preset) => preset.id === button.dataset.presetId);
    if (!selected) return;
    activePreset = selected;
    state = cloneState(selected.state);
    syncControls();
    render();
  });

  controls.addEventListener("input", () => {
    readControls();
    render();
  });
  controls.addEventListener("change", () => {
    readControls();
    render();
  });
  document.querySelector("#reset-lab").addEventListener("click", () => {
    state = cloneState(activePreset.state);
    syncControls();
    render();
  });

  syncControls();
  render();
}

if (typeof document !== "undefined") initializeDom();
