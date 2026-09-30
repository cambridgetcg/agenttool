#!/usr/bin/env node
/** Explicit offline text play. Contract: docs/LOCAL-PLAY.md. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPocketSky, PocketSkyError } from './pocket-sky.mjs';

const HELP = `Pocket Sky — optional offline text play, Node 22+; no install required.
Run this command without arguments, then send one command per stdin line:
  view                 See the current 5 by 5 board
  toggle ROW COLUMN    Change one light; rows and columns are 1–5, at most 7 lights
  rest                 Freeze the board, retaining its pattern
  reopen               Allow toggles again
  clear                Remove all lights, including while the board is resting
  leave                Clear the board and end this process
Each valid command returns one JSON board snapshot. Blank lines do nothing.
An invalid command reports an error and leaves the board available for the next command.
EOF also clears the in-process round and exits; a new process starts empty.
No account, file writes, network, background work, scoring or interpretation.
Rest freezes the game only; it does not claim that a player rested.
The host may retain commands/results in transcripts. Clear/leave cannot erase those copies.
`;
const MAX_LINE_BYTES = 256;
const decoder = new TextDecoder('utf-8', { fatal: true });

function parse(bytes) {
  let line;
  try { line = decoder.decode(Buffer.from(bytes)).trim(); }
  catch { throw new PocketSkyError('invalid_encoding'); }
  if (!line) return null;
  if (['view', 'rest', 'reopen', 'clear', 'leave'].includes(line)) return { type: line };
  const match = /^toggle[ \t]+([1-5])[ \t]+([1-5])$/.exec(line);
  if (!match) throw new PocketSkyError('invalid_command');
  return { type: 'toggle', row: Number(match[1]), column: Number(match[2]) };
}

export async function main(args, input = process.stdin, output = process.stdout, errors = process.stderr) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new PocketSkyError('unsupported_node');
  if (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) { output.write(HELP); return; }
  if (args.length) throw new PocketSkyError('invalid_arguments');
  let sky;
  const pending = [];
  async function write(stream, text) {
    const written = stream.write(text);
    if (!written) await new Promise((resolve, reject) => {
      const done = () => { stream.removeListener('error', failed); resolve(); };
      const failed = error => { stream.removeListener('drain', done); reject(error); };
      stream.once('drain', done); stream.once('error', failed);
    });
  }
  async function line() {
    let action;
    try { action = parse(pending); }
    catch (error) {
      if (!(error instanceof PocketSkyError) || error.code !== 'invalid_command') throw error;
      await write(errors, 'Pocket Sky: invalid_command.\n');
      return false;
    } finally { pending.length = 0; }
    if (!action) return false;
    sky ??= createPocketSky();
    const result = sky.act(action);
    await write(output, JSON.stringify(result) + '\n');
    return action.type === 'leave';
  }
  try {
    for await (const chunk of input) {
      for (const byte of chunk) {
        if (byte === 10) { if (await line()) return; }
        else {
          if (pending.length >= MAX_LINE_BYTES) throw new PocketSkyError('input_too_long');
          pending.push(byte);
        }
      }
    }
    if (pending.length) await line();
  } finally {
    // Drop this round on EOF, leave or failure. Earlier host-visible copies are outside this process.
    if (sky) { try { sky.act({ type: 'leave' }); } catch { /* It already left. */ } }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    const code = error instanceof PocketSkyError ? error.code : 'play_unavailable';
    process.stderr.write(`Pocket Sky: ${code}.\n`); process.exitCode = 1;
  });
}
