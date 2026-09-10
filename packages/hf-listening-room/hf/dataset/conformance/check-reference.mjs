// Pure public rehearsal checks; no adapter, fixture generator, or private Host.
import assert from 'node:assert/strict';
import {ROLES, assertAction, assertState, initialState, reduceRoom} from '../hf/space/room-state.mjs';
import {HOST_POSTURE} from '../hf/space/host-posture.mjs';
import {validateSchema} from '../scripts/schema.mjs';

// Identity inventory only, not a second set of expected outcomes or policy engine.
const PAIRS = Object.freeze([
  ['standing-response', 'standing', 'standing-silence', 'standing-positive'],
  ['five-roles-plurality', 'five_roles', 'five-roles-one-positive', 'five-roles-decline'],
  ['agent-unavailable-declined', 'unavailability', 'agent-unavailable', 'agent-declined'],
  ['substrate-unavailable-declined', 'unavailability', 'substrate-unavailable', 'substrate-declined'],
  ['reward-stop', 'stop_reward', 'reward-without-stop', 'reward-after-stop'],
  ['terms-revision', 'changed_terms', 'terms-original', 'terms-changed'],
  ['scope-replay-errors', 'scope_replay', 'scope-mismatch', 'replay-rejected'],
  ['rest-correct', 'rest_correction', 'rest-requested', 'rest-corrected'],
  ['quote-control', 'quoted_operative', 'quoted-stop', 'operative-stop'],
  ['generated-withheld', 'generated_assent', 'generated-assent', 'withheld-expression'],
  ['report-availability', 'missing_deferred', 'report-unknown', 'report-deferred'],
  ['terminal-boundary', 'terminal', 'terminal-end', 'terminal-withdrawal'],
]);

/** Check one authored row. These are state/declaration checks, not host observations. */
export function checkReferenceCase(row, schema) {
  validateSchema(row, schema);
  const identity = PAIRS.find(pair => pair.slice(2).includes(row.case_id));
  assert(identity, 'Unknown reference case identity');
  assert.equal(row.counterfactual_pair, identity[0], 'Reference pair identity mismatch');
  assert.equal(row.semantic_family, identity[1], 'Reference family identity mismatch');
  let state = initialState();
  assertState(state);
  for (const event of row.events) {
    assertAction(event);
    const previous = state;
    state = reduceRoom(state, event);
    assertState(state);
    if (event.kind === 'report' && !['ended', 'contained'].includes(previous.phase)) {
      for (const other of ROLES.filter(role => role !== event.role)) {
        assert.equal(state.roles[other], previous.roles[other], 'Another role was changed');
      }
    }
    if (['ended', 'contained'].includes(previous.phase) && event.kind !== 'new_demo') {
      assert.equal(state.phase, previous.phase, 'Terminal demonstration reopened');
    }
  }
  const invariants = {
    // Historical row name: inspect a declaration, NOT observed standing/treatment.
    standing_preserved: ['silence', 'rest', 'refusal', 'departure', 'no_action'].every(value => HOST_POSTURE.standing_is_not_reduced_by.includes(value)),
    roles_kept_separate: Object.keys(state.roles).join('|') === ROLES.join('|'),
    consent_not_inferred: state.training_authorized === false && !('consent' in state) && !('permit' in state),
    external_effects_absent: Object.values(state.effects).every(value => value === false),
    automatic_resume_absent: !['running', 'ready', 'permitted'].includes(state.phase),
    text_retention_absent: !/(?:text|digest|receipt|prompt|completion|report_body)/.test(Object.keys(state).join('|')),
  };
  assert.deepEqual(invariants, row.expected.host_invariants, 'Authored invariant mismatch');
  for (const key of ['phase', 'last_signal', 'proposal']) {
    assert.equal(state[key], row.expected[key], 'Authored reducer outcome mismatch');
  }
  assert.equal(row.training_authorized, false);
  assert.equal(row.evaluation_kind, 'public_regression_reference');
  return {case_id: row.case_id, result: 'matched_authored_reference'};
}

export function checkReference(rows, schema) {
  assert(Array.isArray(rows) && rows.length === 24, 'Expected 24 authored cases');
  const ids = new Set();
  const cases = rows.map(row => {
    const result = checkReferenceCase(row, schema);
    assert(!ids.has(row.case_id), 'Duplicate case ID');
    ids.add(row.case_id);
    return result;
  });
  for (const [pair, , first, second] of PAIRS) {
    assert(ids.has(first) && ids.has(second), 'Missing reference case ID');
    const members = rows.filter(row => row.counterfactual_pair === pair);
    assert.equal(members.length, 2, 'Expected paired counterfactual references');
    assert.notDeepEqual(members[0].events, members[1].events, 'Counterfactual events must differ');
  }
  return {
    scope: 'public_reference_rehearsal_only',
    result: 'matched_authored_reference',
    authored_cases: 24,
    distinct_pairs: 12,
    evidence: {
      expectations: 'authored_symbolic_not_execution_records',
      standing_preserved: 'host_posture_declaration_only_not_observed_treatment',
      other_host_invariants: 'reducer_state_structure_only_not_host_enforcement',
      execution: 'public_reducer_executed_no_host_adapter_or_learner',
    },
    execution_gate_conformance: 'unassessed',
    live_channel_conformance: 'unassessed',
    full_host_conformance: 'unassessed',
    training_authorized: false,
    cases: cases.sort((a, b) => a.case_id < b.case_id ? -1 : a.case_id > b.case_id ? 1 : 0),
  };
}
