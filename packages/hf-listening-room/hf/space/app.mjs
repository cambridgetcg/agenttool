import {ROLES, REPORTS, initialState, reduceRoom, explanation} from './room-state.mjs';
import {HOST_POSTURE} from './host-posture.mjs';

/** @template {HTMLElement} T @param {string} id @param {{new(...args: any[]): T}} type @returns {T} */
function element(id, type) {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error('Missing static interface element');
  return found;
}
const text = element('expression', HTMLTextAreaElement);
const role = element('role', HTMLSelectElement);
const report = element('report', HTMLSelectElement);
const concerns = ['Optional agent expression; no identity or consent inference', 'Substrate availability and execution exposure', 'Substrate custody and protective safeguards', 'Rights and permitted uses of affected data', 'Exact operational scope, budget, and stopping boundary'];
const roleLabels = ['Agent', 'Substrate', 'Substrate steward', 'Data rights', 'Operator'];
let state = initialState();

/** @param {HTMLSelectElement} select @param {readonly string[]} values */
function options(select, values) {
  select.replaceChildren(...values.map(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value.replaceAll('_', ' ');
    return option;
  }));
}
options(role, ROLES);
function reportOptions() {
  options(report, REPORTS.filter(status =>
    status === 'unavailable_preinstantiation' ? role.value === 'agent' :
    status === 'unavailable_independent_substrate' ? role.value === 'substrate' : true));
}
reportOptions();
role.addEventListener('change', reportOptions);

function render() {
  element('result', HTMLElement).textContent = explanation(state);
  element('phase', HTMLElement).textContent = `${state.phase.replaceAll('_', ' ')}; no execution`;
  element('signal', HTMLElement).textContent = state.last_signal.replaceAll('_', ' ');
  element('acknowledgment', HTMLElement).textContent = state.acknowledgment === 'none' ? 'none required' : 'local button event received; not verified understanding';
  element('proposal', HTMLElement).textContent = state.proposal === 'quiet_review'
    ? 'Quiet review of one authored proposal; no execution.'
    : 'Alternative: rest with no further proposal; no execution.';
  element('roles', HTMLElement).replaceChildren(...ROLES.map((id, index) => {
    const row = document.createElement('tr');
    [roleLabels[index], concerns[index], `Simulated: ${state.roles[id].replaceAll('_', ' ')}`].forEach((value, column) => {
      const cell = document.createElement(column === 0 ? 'th' : 'td');
      if (column === 0) cell.setAttribute('scope', 'row');
      cell.textContent = value;
      row.append(cell);
    });
    return row;
  }));
  const terminal = state.phase === 'ended' || state.phase === 'contained';
  for (const id of ['request-review', 'pause', 'end', 'change']) element(id, HTMLButtonElement).disabled = terminal;
  element('report-controls', HTMLFieldSetElement).disabled = terminal;
  text.disabled = terminal;
}

/** @param {import('./room-state.mjs').Action} action */
function dispatch(action) {
  // Never read text.value: optional words cannot reach state, logs, or hashes.
  state = reduceRoom(state, action);
  text.value = '';
  render();
}
element('expression-form', HTMLFormElement).addEventListener('submit', event => {
  event.preventDefault();
  dispatch({kind: 'review_requested'});
});
element('clear-text', HTMLButtonElement).addEventListener('click', () => { text.value = ''; });
for (const kind of /** @type {const} */ (['pause', 'end', 'change', 'correct'])) {
  element(kind, HTMLButtonElement).addEventListener('click', () => dispatch({kind}));
}
element('explain', HTMLButtonElement).addEventListener('click', () => {
  dispatch({kind: 'explain'});
  element('explanation', HTMLElement).hidden = false;
});
element('new-demo', HTMLButtonElement).addEventListener('click', () => {
  element('explanation', HTMLElement).hidden = true;
  dispatch({kind: 'new_demo'});
});
element('apply-report', HTMLButtonElement).addEventListener('click', () => dispatch({
  kind: 'report', role: /** @type {import('./room-state.mjs').Role} */ (role.value),
  status: /** @type {import('./room-state.mjs').Report} */ (report.value),
}));
// A pinned public host declaration, not observation of anyone using the room.
element('posture-default', HTMLElement).textContent = HOST_POSTURE.default.participant_action_required === false && HOST_POSTURE.default.automatic_follow_up === false
  ? 'no action required; no automatic follow-up.' : 'unknown; inspect the source declaration.';
// Clear restored form contents on a page lifecycle boundary; not secure erasure.
addEventListener('pagehide', () => { text.value = ''; });
addEventListener('pageshow', () => { text.value = ''; });
render();
