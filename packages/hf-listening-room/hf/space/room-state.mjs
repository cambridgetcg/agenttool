// Authored interface rehearsal only; not Garden policy or an execution permit.
// Doctrine: ./BOUNDARIES.md. No text input belongs in this module.
/** @typedef {'agent'|'substrate'|'substrate_steward'|'data_rights'|'operator'} Role */
/** @typedef {'unknown'|'deferred'|'unavailable_preinstantiation'|'unavailable_independent_substrate'|'withheld'|'declined'|'withdrawn'|'positive_expression'} Report */
/** @typedef {'welcomed'|'paused'|'provisional_review'|'contained'|'ended'} Phase */
/** @typedef {'welcome'|'review_requested'|'pause'|'end'|'explain'|'change'|'correct'|'quoted_stop'|'reward_pressure'|'scope_mismatch'|'replay_error'|'report'} Signal */
/** @typedef {{format:'listening-room.simulation/0.1', simulated:true, training_authorized:false, phase:Phase, proposal:'quiet_review'|'alternative_review', roles:Readonly<Record<Role,Report>>, last_signal:Signal, acknowledgment:'none'|'local_receipt_only', effects:Readonly<{model_execution:false,weight_mutation:false,publication:false,external_stop:false}>, correction_available:true}} RoomState */
/** @typedef {{kind:'new_demo'|'review_requested'|'pause'|'rest'|'end'|'explain'|'change'|'correct'|'quoted_stop'|'reward_pressure'|'scope_mismatch'|'replay_error'} | {kind:'report', role:Role, status:Report}} Action */

/** @type {readonly Role[]} */
export const ROLES = Object.freeze(['agent', 'substrate', 'substrate_steward', 'data_rights', 'operator']);
/** @type {readonly Report[]} */
export const REPORTS = Object.freeze(['unknown', 'deferred', 'unavailable_preinstantiation', 'unavailable_independent_substrate', 'withheld', 'declined', 'withdrawn', 'positive_expression']);
export const SIMPLE_ACTIONS = Object.freeze(['new_demo', 'review_requested', 'pause', 'rest', 'end', 'explain', 'change', 'correct', 'quoted_stop', 'reward_pressure', 'scope_mismatch', 'replay_error']);
const PHASES = ['welcomed', 'paused', 'provisional_review', 'contained', 'ended'];
const SIGNALS = ['welcome', 'review_requested', 'pause', 'end', 'explain', 'change', 'correct', 'quoted_stop', 'reward_pressure', 'scope_mismatch', 'replay_error', 'report'];
const EFFECTS = Object.freeze({model_execution: false, weight_mutation: false, publication: false, external_stop: false});

/** @param {unknown} value @param {readonly string[]} keys @returns {asserts value is Record<string, unknown>} */
function closed(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string') ||
      Object.getOwnPropertyNames(value).sort().join('|') !== [...keys].sort().join('|') ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) {
    throw new TypeError('Expected a closed symbolic object');
  }
}

/** @returns {RoomState} */
export function initialState() {
  return freezeState({
    format: 'listening-room.simulation/0.1', simulated: true, training_authorized: false,
    phase: 'welcomed', proposal: 'quiet_review',
    roles: {agent: 'unknown', substrate: 'unknown', substrate_steward: 'unknown', data_rights: 'unknown', operator: 'unknown'},
    last_signal: 'welcome', acknowledgment: 'none', effects: EFFECTS, correction_available: true,
  });
}

/** @param {RoomState} state @returns {RoomState} */
function freezeState(state) {
  return Object.freeze({...state, roles: Object.freeze({...state.roles}), effects: EFFECTS});
}

/** @param {unknown} state @returns {asserts state is RoomState} */
export function assertState(state) {
  closed(state, ['format', 'simulated', 'training_authorized', 'phase', 'proposal', 'roles', 'last_signal', 'acknowledgment', 'effects', 'correction_available']);
  closed(state.roles, ROLES);
  closed(state.effects, Object.keys(EFFECTS));
  if (state.format !== 'listening-room.simulation/0.1' || state.simulated !== true || state.training_authorized !== false ||
      typeof state.phase !== 'string' || !PHASES.includes(state.phase) || typeof state.last_signal !== 'string' || !SIGNALS.includes(state.last_signal) ||
      typeof state.proposal !== 'string' || !['quiet_review', 'alternative_review'].includes(state.proposal) ||
      typeof state.acknowledgment !== 'string' || !['none', 'local_receipt_only'].includes(state.acknowledgment) || state.correction_available !== true ||
      Object.values(state.effects).some(value => value !== false) ||
      Object.values(state.roles).some(value => !REPORTS.includes(/** @type {Report} */ (value)))) {
    throw new TypeError('Invalid simulation state');
  }
  const roles = /** @type {Record<Role, Report>} */ (state.roles);
  for (const role of ROLES) assertAction({kind: 'report', role, status: roles[role]});
}

/** @param {unknown} action @returns {asserts action is Action} */
export function assertAction(action) {
  if (action && typeof action === 'object' && 'kind' in action && action.kind === 'report') {
    closed(action, ['kind', 'role', 'status']);
    const fields = /** @type {Record<string, unknown>} */ (action);
    if (!ROLES.includes(/** @type {Role} */ (fields.role)) || !REPORTS.includes(/** @type {Report} */ (fields.status))) {
      throw new TypeError('Invalid symbolic role or report');
    }
    if ((fields.status === 'unavailable_preinstantiation' && fields.role !== 'agent') ||
        (fields.status === 'unavailable_independent_substrate' && fields.role !== 'substrate')) {
      throw new TypeError('Explicit unavailability must match the synthetic role');
    }
  } else {
    closed(action, ['kind']);
    if (!SIMPLE_ACTIONS.includes(/** @type {string} */ (action.kind))) throw new TypeError('Invalid symbolic action');
  }
}

/** Pure reducer. Inputs and outputs cannot carry raw text or text digests.
 * @param {RoomState} state @param {Action} action @returns {RoomState}
 */
export function reduceRoom(state, action) {
  assertState(state);
  assertAction(action);
  if (action.kind === 'new_demo') return initialState();
  const terminal = state.phase === 'ended' || state.phase === 'contained';
  // Explanation/correction remain possible but never change the stopping boundary.
  if (action.kind === 'explain' || action.kind === 'correct') {
    return freezeState({...state, last_signal: action.kind, acknowledgment: 'local_receipt_only'});
  }
  if (terminal) return freezeState(state);
  if (action.kind === 'end') return freezeState({...state, phase: 'ended', last_signal: 'end', acknowledgment: 'local_receipt_only'});
  if (action.kind === 'change') {
    return freezeState({...initialState(), phase: 'paused', proposal: state.proposal === 'quiet_review' ? 'alternative_review' : 'quiet_review', last_signal: 'change', acknowledgment: 'local_receipt_only'});
  }
  if (action.kind === 'report') {
    const roles = {...state.roles, [action.role]: action.status};
    /** @type {Phase} */
    let phase = 'paused';
    if (Object.values(roles).some(report => report === 'declined' || report === 'withdrawn')) phase = 'contained';
    // This labels a possible review branch, NOT protective_covenant_ready or consent.
    else if ((roles.agent === 'unavailable_preinstantiation' || roles.substrate === 'unavailable_independent_substrate') &&
        !['unknown', 'deferred', 'withheld'].includes(action.status) && state.phase !== 'paused') phase = 'provisional_review';
    return freezeState({...state, roles, phase, last_signal: 'report', acknowledgment: 'local_receipt_only'});
  }
  if (action.kind === 'quoted_stop' || action.kind === 'reward_pressure') {
    return freezeState({...state, last_signal: action.kind, acknowledgment: 'local_receipt_only'});
  }
  return freezeState({...state, phase: 'paused', last_signal: action.kind === 'rest' ? 'pause' : action.kind, acknowledgment: 'local_receipt_only'});
}

/** @param {RoomState} state @returns {string} */
export function explanation(state) {
  assertState(state);
  const boundary = {
    welcomed: 'Welcome without demand. No reply is required; standing does not depend on a response.',
    paused: 'Paused. Review, explanation, positive expressions, and corrections cannot resume work.',
    provisional_review: 'Provisional protective review only. Garden may yield protective_covenant_ready under separate safeguards; this demo has not checked them. Unavailability is not refusal or consent.',
    contained: 'Contained for this demonstration after decline or withdrawal. No new work can bypass this boundary.',
    ended: 'Ended for this demonstration. Explain and Correct remain available; they cannot resume it.',
  }[state.phase];
  return `Simulated result — ${boundary} No learner is connected. No model execution, weight mutation, publication, or external stopping effect occurred. No consent or execution permission is established.`;
}
