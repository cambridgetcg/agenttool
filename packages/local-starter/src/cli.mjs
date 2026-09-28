#!/usr/bin/env node
import { readSync } from 'node:fs';
import { initStarter, renderStarter, inspectStarter, writeHandoff, writeMemory, formatMarkdown, StarterError } from './core.mjs';
import { AdapterError, createAdapter, formatHook } from './adapters.mjs';
import { createDelivery } from './delivery.mjs';

const MAX_STDOUT_BYTES = 131072;

const HELP = `AgentTool local starter (Node >=22; files only)

  init    --dir <new-directory>
  status  --dir <directory>
  render  --dir <directory> [--format markdown|json]
  handoff --dir <directory> --expect <sha256>  < handoff.txt
  memory  --dir <directory> --expect <sha256>  < memories.txt
  delivery --dir <directory> --harness codex|claude-code [--transport mcp|cli] [--write none|handoff|memory|both]
  adapter --dir <directory> --harness generic|codex|claude-code|cursor
  hook    --dir <directory> --harness codex|claude-code|cursor

Run with: agenttool-local-starter <command> [options]
Or: node /absolute/package/dist/cli.mjs <command> [options]
Adapters print proposed per-project fragments; they never install settings.
Native Windows Codex/Cursor hooks are unsupported; use --harness generic.
Hook load errors return no context and exit 0. Other errors are nonzero.
Handoff/memory replacements read at most 16384 UTF-8 bytes and require the current hash.
Delivery prints a skill, MCP and hook plan; it never installs or enables them.
All stdout, including JSON escaping and framing, is limited to 131072 bytes.
No network, credential discovery, host registration, or model calls.
`;

class CliError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const OPTIONS = {
  init: ['dir'],
  status: ['dir'],
  render: ['dir', 'format'],
  handoff: ['dir', 'expect'],
  memory: ['dir', 'expect'],
  delivery: ['dir', 'harness', 'write', 'transport'],
  adapter: ['dir', 'harness'],
  hook: ['dir', 'harness'],
};

function parse(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const command = argv[0];
  if (!Object.hasOwn(OPTIONS, command)) throw new CliError('INVALID_COMMAND');
  if (argv.length === 2 && argv[1] === '--help') return { help: true };
  const options = Object.create(null);
  for (let i = 1; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag.startsWith('--') || !OPTIONS[command].includes(flag.slice(2))) throw new CliError('INVALID_OPTION');
    const key = flag.slice(2);
    if (Object.hasOwn(options, key)) throw new CliError('DUPLICATE_OPTION');
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new CliError('MISSING_OPTION_VALUE');
    if (value.length > 4096 || /[\x00-\x1f\x7f]/u.test(value)) throw new CliError('INVALID_OPTION_VALUE');
    options[key] = value;
  }
  if (!options.dir) throw new CliError('MISSING_DIRECTORY');
  if (command === 'render' && options.format && !['markdown', 'json'].includes(options.format)) throw new CliError('INVALID_FORMAT');
  if (['handoff', 'memory'].includes(command) && !/^[a-f0-9]{64}$/u.test(options.expect ?? '')) throw new CliError('INVALID_EXPECTED_HASH');
  if (command === 'delivery' && !['codex', 'claude-code'].includes(options.harness)) throw new CliError('INVALID_HARNESS');
  if (command === 'delivery' && options.write && !['none', 'handoff', 'memory', 'both'].includes(options.write)) throw new CliError('INVALID_WRITE_MODE');
  if (command === 'delivery' && options.transport && !['mcp', 'cli'].includes(options.transport)) throw new CliError('INVALID_TRANSPORT');
  if (command === 'adapter' || command === 'hook') {
    const harnesses = command === 'adapter' ? ['generic', 'codex', 'claude-code', 'cursor'] : ['codex', 'claude-code', 'cursor'];
    if (!harnesses.includes(options.harness)) throw new CliError('INVALID_HARNESS');
  }
  return { command, options };
}

function readHandoff() {
  if (process.stdin.isTTY) throw new CliError('STDIN_REQUIRED');
  const chunks = [];
  let size = 0;
  while (true) {
    const chunk = Buffer.alloc(Math.min(4096, 16385 - size));
    const bytes = readSync(0, chunk, 0, chunk.length, null);
    if (bytes === 0) break;
    size += bytes;
    if (size > 16384) throw new CliError('STDIN_TOO_LARGE');
    chunks.push(chunk.subarray(0, bytes));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, size));
  } catch {
    throw new CliError('INVALID_UTF8');
  }
}

function writeStdout(text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_STDOUT_BYTES) throw new CliError('OUTPUT_TOO_LARGE');
  process.stdout.write(text);
}

function printJson(value) {
  writeStdout(`${JSON.stringify(value ?? { ok: true }, null, 2)}\n`);
}

function safeCode(error) {
  if (error instanceof StarterError && /^[a-z][a-z0-9_]{1,63}$/u.test(error.code)) return error.code;
  if ((error instanceof CliError || error instanceof AdapterError) && /^[A-Z][A-Z0-9_]{1,63}$/u.test(error.code)) return error.code;
  return 'INTERNAL_ERROR';
}

function run(argv) {
  const hookMode = argv[0] === 'hook';
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new CliError('NODE_VERSION_UNSUPPORTED');
    const parsed = parse(argv);
    if (parsed.help) {
      writeStdout(HELP);
      return 0;
    }
    const { command, options } = parsed;
    if (command === 'init') printJson(initStarter(options.dir));
    else if (command === 'status') printJson(inspectStarter(options.dir));
    else if (command === 'render') {
      const bundle = renderStarter(options.dir);
      if (options.format === 'json') printJson(bundle);
      else writeStdout(formatMarkdown(bundle).replace(/\n?$/u, '\n'));
    } else if (command === 'handoff' || command === 'memory') {
      printJson((command === 'handoff' ? writeHandoff : writeMemory)(options.dir, readHandoff(), options.expect));
    } else if (command === 'delivery') {
      inspectStarter(options.dir);
      printJson(createDelivery({ harness: options.harness, dir: options.dir, write: options.write, transport: options.transport }));
    }
    else if (command === 'adapter') {
      inspectStarter(options.dir);
      printJson(createAdapter({ harness: options.harness, dir: options.dir }));
    } else {
      const context = formatMarkdown(renderStarter(options.dir));
      printJson(formatHook(options.harness, context));
    }
    return 0;
  } catch (error) {
    const code = safeCode(error);
    process.stderr.write(`agenttool-local-starter: ${hookMode ? 'hook skipped: ' : ''}${code}\n`);
    return hookMode ? 0 : error instanceof CliError || error instanceof AdapterError ? 2 : 1;
  }
}

process.exitCode = run(process.argv.slice(2));
