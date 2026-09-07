// Node-only, read-only CLI for a clean exported Dataset kit. Reviewed executable
// source is trusted: this is not a sandbox, authenticity proof, or defence against
// hostile concurrent filesystem mutation / every symlinked ancestor.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROFILE_FILES = Object.freeze(['profile/PROFILE.md', 'profile/ADOPTING.md', 'profile/MODEL_CARD_TEMPLATE.md']);
export const KIT_SOURCE_FILES = Object.freeze([
  'conformance/run.mjs', 'conformance/check-reference.mjs',
  'hf/space/room-state.mjs', 'hf/space/host-posture.mjs', 'scripts/schema.mjs',
]);
export const DATASET_FILES = Object.freeze([
  'README.md', 'data/cases.jsonl', 'schema/row.schema.json', 'LICENSE', 'NOTICE',
  'source-manifest.json', 'hash-manifest.json', ...PROFILE_FILES, ...KIT_SOURCE_FILES,
].sort());
export const MAX_FILE_BYTES = 200 * 1024;
export const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Fixed paths only. .gitattributes is the sole optional provider metadata file;
// it is bounded/regular, never executed, and outside the owned-file hash manifest.
function readKit() {
  const allowed = [...DATASET_FILES, '.gitattributes'];
  const directories = new Set(allowed.flatMap(path => path.split('/').slice(0, -1)
    .map((_, index, parts) => parts.slice(0, index + 1).join('/'))));
  const found = new Map();
  let total = 0;
  function walk(prefix = '') {
    const path = prefix ? join(ROOT, prefix) : ROOT;
    const stat = lstatSync(path);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Expected regular kit directory');
    const directory = opendirSync(path);
    try {
      let entry;
      let count = 0;
      while ((entry = directory.readSync()) !== null) {
        assert(++count <= allowed.length + directories.size, 'Too many kit entries');
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        assert(allowed.includes(relative) || directories.has(relative), 'Unexpected kit path');
        const absolute = join(ROOT, relative);
        const item = lstatSync(absolute);
        assert(!item.isSymbolicLink(), 'Kit symlink forbidden');
        if (directories.has(relative)) {
          assert(item.isDirectory(), 'Expected kit directory');
          walk(relative);
          continue;
        }
        assert(item.isFile() && item.size <= MAX_FILE_BYTES, 'Expected bounded regular kit file');
        // Reject final-component links again when opening; ancestors/concurrency
        // outside this explicit tree walk remain outside the claimed boundary.
        const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const opened = fstatSync(fd);
          assert(opened.isFile() && opened.size <= MAX_FILE_BYTES, 'Expected bounded opened file');
          total += opened.size;
          assert(total <= MAX_TOTAL_BYTES, 'Kit aggregate byte limit');
          const bytes = Buffer.alloc(opened.size + 1);
          let length = 0;
          while (length < bytes.length) {
            const received = readSync(fd, bytes, length, bytes.length - length, null);
            if (received === 0) break;
            length += received;
          }
          assert.equal(length, opened.size, 'Kit file changed while reading');
          found.set(relative, bytes.subarray(0, length));
        } finally { closeSync(fd); }
      }
    } finally { directory.closeSync(); }
  }
  walk();
  assert.deepEqual([...found.keys()].filter(path => path !== '.gitattributes').sort(), DATASET_FILES, 'Incomplete kit inventory');
  return found;
}

function checkHashes(files) {
  const manifest = JSON.parse(files.get('hash-manifest.json').toString('utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), ['format', 'artifact', 'status', 'training_authorized', 'algorithm', 'excludes_self', 'files'].sort());
  assert.equal(manifest.format, 'listening-room.hashes/0.1');
  assert.equal(manifest.artifact, 'dataset');
  assert.equal(manifest.status, 'local_candidate');
  assert.equal(manifest.training_authorized, false);
  assert.equal(manifest.algorithm, 'sha256');
  assert.equal(manifest.excludes_self, true);
  assert(Array.isArray(manifest.files) && manifest.files.length === DATASET_FILES.length - 1);
  assert.deepEqual(manifest.files.map(item => item.path), DATASET_FILES.filter(path => path !== 'hash-manifest.json'));
  for (const item of manifest.files) {
    assert.deepEqual(Object.keys(item).sort(), ['bytes', 'path', 'sha256']);
    const bytes = files.get(item.path);
    assert.equal(bytes.length, item.bytes, 'Kit byte count drift');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, 'Kit hash drift');
  }
}

const unassessed = {
  scope: 'public_reference_rehearsal_only',
  execution_gate_conformance: 'unassessed', live_channel_conformance: 'unassessed',
  full_host_conformance: 'unassessed', training_authorized: false,
};

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  try {
    assert(args.length <= 1 && args.every(arg => arg === '--json' || arg === '--help'), 'Unsupported arguments');
    if (args[0] === '--help') {
      process.stdout.write('Usage: node conformance/run.mjs [--help|--json]\nNode 22.18+; no installation. Run from a clean exported Dataset kit, not a git clone/cache tree.\nChecks 24 authored cases / 12 pairs only. Execution gates, live channels, and full-host conformance remain unassessed.\nReads fixed regular files: <=200 KiB/file, <=1 MiB total. Optional .gitattributes is provider metadata, not covered by owned hashes.\nTrusted reviewed JavaScript; not a sandbox or authenticity guarantee. No network, model, adapter, credentials, or writes.\n');
      return;
    }
    const [major, minor] = process.versions.node.split('.').map(Number);
    assert(major > 22 || (major === 22 && minor >= 18), 'Node 22.18+ required');
    const files = readKit();
    checkHashes(files);
    const corpus = new TextDecoder('utf-8', {fatal: true}).decode(files.get('data/cases.jsonl'));
    assert(corpus.endsWith('\n'), 'JSONL must end in a newline');
    const lines = corpus.slice(0, -1).split('\n');
    assert(lines.length === 24 && lines.every(line => line.length > 0), 'Expected 24 JSONL records');
    const rows = lines.map(line => JSON.parse(line));
    const schema = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(files.get('schema/row.schema.json')));
    // Import only fixed reviewed local modules, after the tree and bytes checks.
    const {checkReference} = await import('./check-reference.mjs');
    const report = {
      ...checkReference(rows, schema),
      runtime_observed: `node ${process.versions.node}`,
      kit_integrity: 'self_supplied_hash_manifest_matches_not_authenticity_or_publication',
      provider_metadata: files.has('.gitattributes') ? 'gitattributes_present_bounded_not_owned_or_hashed' : 'absent',
    };
    const output = json ? `${JSON.stringify(report)}\n` :
      `Matched 24 authored reference cases / 12 distinct pairs (rehearsal only).\nStanding: declaration checked, not observed treatment. Other invariants: reducer structure, not host enforcement.\nExecution gates: unassessed. Live channel: unassessed. Full-host conformance: unassessed.\nRuntime observed: ${report.runtime_observed}. Training authorized: false.\nKit hashes match a self-supplied manifest; not authenticity or publication evidence.\nProvider metadata: ${report.provider_metadata}.\n`;
    assert(Buffer.byteLength(output) <= MAX_OUTPUT_BYTES, 'Output ceiling exceeded');
    process.stdout.write(output);
  } catch {
    // Never echo arbitrary rejected file/argument/error payloads or stack paths.
    process.exitCode = 1;
    process.stdout.write(json ? `${JSON.stringify({...unassessed, result: 'reference_check_failed'})}\n` :
      'Reference check failed: invalid arguments, runtime, kit files, or authored reference mismatch.\nExecution gates, live channels, and full-host conformance remain unassessed.\n');
  }
}

// Native entrypoint detection (Node 22.18+) also works through macOS /var aliases.
if (import.meta.main) await main();
