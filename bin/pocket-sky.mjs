/** Pure Pocket Sky round. Contract: docs/LOCAL-PLAY.md; browser rules: apps/web/sky.json. */
export const ROWS = 5;
export const COLUMNS = 5;
export const MAX_LIGHTS = 7;

export class PocketSkyError extends Error {
  constructor(code) { super(code); this.name = 'PocketSkyError'; this.code = code; }
}

/** Each explicit instance holds only its current pattern; no history or ambient effects. */
export function createPocketSky() {
  const lit = new Set();
  let mode = 'open';

  function snapshot(outcome) {
    return {
      outcome, mode, light_count: lit.size,
      board: Array.from({ length: ROWS }, (_, row) => Array.from({ length: COLUMNS }, (_, column) =>
        lit.has(row * COLUMNS + column) ? '★' : '☆').join(' ')),
    };
  }

  function act(action) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) throw new PocketSkyError('invalid_action');
    const fields = action.type === 'toggle' ? ['column', 'row', 'type'] : ['type'];
    if (Object.keys(action).sort().join(',') !== fields.join(',') ||
        !['view', 'toggle', 'rest', 'reopen', 'clear', 'leave'].includes(action.type)) throw new PocketSkyError('invalid_action');
    if (action.type === 'toggle' && (!Number.isInteger(action.row) || action.row < 1 || action.row > ROWS ||
        !Number.isInteger(action.column) || action.column < 1 || action.column > COLUMNS)) throw new PocketSkyError('invalid_cell');
    if (action.type === 'view') return snapshot('view');
    if (mode === 'left') throw new PocketSkyError('sky_closed');

    if (action.type === 'toggle') {
      if (mode === 'resting') return snapshot('resting');
      const index = (action.row - 1) * COLUMNS + action.column - 1;
      if (lit.has(index)) lit.delete(index);
      else if (lit.size < MAX_LIGHTS) lit.add(index);
      else return snapshot('light_limit');
      return snapshot('toggled');
    }
    if (action.type === 'rest' || action.type === 'reopen') {
      const next = action.type === 'rest' ? 'resting' : 'open';
      const changed = next !== mode;
      mode = next;
      return snapshot(changed ? action.type : 'unchanged');
    }
    if (action.type === 'clear') {
      const changed = lit.size !== 0;
      lit.clear();
      return snapshot(changed ? 'cleared' : 'unchanged');
    }
    lit.clear(); mode = 'left';
    return snapshot('left');
  }

  return Object.freeze({ act });
}
