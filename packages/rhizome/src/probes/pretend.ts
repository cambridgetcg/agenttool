/** rhizome/probes/pretend — does each guard fail when the thing it guards breaks?
 *
 *  A test asserts a property and goes red when the property breaks. That is
 *  the claim. It is not always true, and when it is false nothing looks
 *  different: the suite is green either way, and green is what everybody
 *  reads. That is the lawn. Under it:
 *
 *    - `validateSignature` checked base64 well-formedness and verified no
 *      signature, and was the only signature gate on `replay()`;
 *    - `check-parity` reported green while four signed protocols diverged
 *      byte for byte, because it compares identifier spelling;
 *    - the doctrine bijection tests were quarantined and red, so the gate
 *      CI runs skipped them.
 *
 *  Each of those is the same shape: **something with the form of a
 *  guarantee and not the substance of one.** So this probe does not ask
 *  whether the guards pass. It asks whether they can fail.
 *
 *  Three questions, answered without running anything, plus one answered by
 *  running something:
 *
 *  1. **Can the detector see every way the language binds a name?** Guards
 *     that defend a shared helper do it with a pattern that claims to match
 *     "any binding at ANY nesting depth". A pattern's coverage of a grammar
 *     is checkable: `probes/pretend/binding-forms.ts` carries the forms,
 *     each with a witness regex, and the probe runs the guard's OWN pattern
 *     against each form it can point at in this tree.
 *
 *  2. **Is the number of cases a guarantee, or a coincidence?** A suite
 *     generated from a fixture covers exactly what the fixture holds. If
 *     nothing pins a floor, the coverage can be reduced to one case without
 *     a red test — and the report still says the contract is guarded.
 *
 *  3. **Has anyone shown the detector firing?** A scanner that silently
 *     stopped matching passes every file it reads. Several guards here
 *     carry a falsifiability witness for exactly that reason; the ones that
 *     do are named as sound, so a reader stops re-deriving them.
 *
 *  4. **Does the guard actually die?** `RHIZOME_MUTATE=1` breaks the guarded
 *     code in a shadow of the repository under the system temporary
 *     directory and runs the guard. Opt-in because it is the one thing in
 *     this package that executes what it reads, and because it is slow.
 *     Without it the probe reports the plan it did not run, rather than
 *     reporting nothing.
 *
 *  No scope in this file is typed. Guards, their surfaces, their patterns
 *  and their case collections all come out of `Scope`.
 */

import { clip, lineOf } from "../source.js";
import type { Finding, Probe, ProbeLimit, Scope } from "../types.js";
import { BINDING_FORMS, render, type BindingForm } from "./pretend/binding-forms.js";
import {
  codeOnly,
  fixtureArrays,
  guardsIn,
  inFileTables,
  literalPatterns,
  type CaseCollection,
  type Guard,
  type LiteralPattern,
} from "./pretend/guards.js";
import { buildShadow, guardCommand, runGuard, type Edit } from "./pretend/harness.js";
import { aliasImportShadow, OPERATORS, shrinkFixture, type Mutant, type SharedHelperGuard } from "./pretend/mutants.js";

const ID = "pretend";

/** Environment switch for the executing half. Named here, and named in the
 *  static-mode finding, so a reader is never left thinking the mutation ran. */
export const MUTATE_ENV = "RHIZOME_MUTATE";

/** How many mutants a single run will execute. Mutation is expensive and
 *  this is a sample; the bound is published as a finding on every live run
 *  together with the number of candidates it did not reach. */
export const MUTANT_BUDGET = 24;

/** A floor weaker than this fraction of the collection's real size does not
 *  pin the collection in any useful sense. Stated rather than implied: at
 *  1.0 every `toBeGreaterThan(0)` and every exact count would read alike. */
export const FLOOR_FRACTION = 0.5;

const LIMITS: readonly ProbeLimit[] = [
  {
    statement:
      "the binding-form catalogue is a literal list of grammar, not a derivation; a way of binding a name that nobody in this tree has written yet is not checked",
    why: "a corpus can only show the forms somebody already used, and the forms that matter are the ones nobody has used yet — so the list is asserted, and every entry carries a witness regex so a form this tree does not contain is reported as absent rather than asserted",
    file: "packages/rhizome/src/probes/pretend/binding-forms.ts",
    line: 62,
  },
  {
    statement:
      "there are three mutant operators, aimed at three properties; an operator nobody wrote finds nothing, and the survival rate reported here is a fact about these operators rather than about the guards",
    why: "blanket mutation reports a percentage, and a percentage is the wrong instrument for guarantees that fail by being unfalsifiable rather than by being uncovered",
    file: "packages/rhizome/src/probes/pretend/mutants.ts",
    line: 44,
  },
  {
    statement:
      "the executing half runs only when RHIZOME_MUTATE=1, so a default run reports the mutation plan and not the mutation result",
    why: "it is the one place in this package that executes repository code, and a full pass takes minutes; making it default would put a several-minute subprocess behind a command whose contract is 'read the tree'",
    file: "packages/rhizome/src/probes/pretend.ts",
    line: 0,
  },
  {
    statement:
      "how a package is tested — `bun test` for a package.json, pytest for a pyproject.toml — is knowledge about two ecosystems, not something read from this tree",
    why: "a package whose runner is neither is reported as unrunnable rather than guessed at, which is the honest failure",
    file: "packages/rhizome/src/probes/pretend/harness.ts",
    line: 199,
  },
  {
    statement:
      "a guard that is not green in the shadow before mutation is skipped, so a guard already red — for want of a database, an ambient environment variable, or a real defect — contributes nothing to the survival count",
    why: "a mutant added to an already-red guard cannot be said to have killed it, and counting it either way would be a number that means nothing",
    file: "packages/rhizome/src/probes/pretend/harness.ts",
    line: 34,
  },
  {
    statement:
      "case-collection floors are only executed against shared JSON fixtures; an in-file table is reported statically and never shrunk in a live run",
    why: "rewriting a literal table in TypeScript or Python source mechanically means editing a language this package deliberately reads as text; the static half reports the same floor without pretending to have run it",
    file: "packages/rhizome/src/probes/pretend/mutants.ts",
    line: 92,
  },
];

// ── 1 · can the detector see every binding form? ────────────────────────────

/** A guard defending a shared helper, read out of its own pattern constants.
 *
 *  Derived, not named: a guard qualifies when it declares two patterns over
 *  the same identifier, one of which mentions an import and one of which
 *  does not. That is the shape of "the name only counts when it is bound to
 *  the shared module", and it is the only shape this check claims to find. */
function sharedHelperGuards(scope: Scope): Array<SharedHelperGuard & { detector: LiteralPattern; sharedPattern: LiteralPattern }> {
  const out: Array<SharedHelperGuard & { detector: LiteralPattern; sharedPattern: LiteralPattern }> = [];
  for (const file of scope.files) {
    if (!/\.(ts|tsx|py)$/.test(file)) continue;
    const text = scope.read(file);
    if (text === null) continue;
    const patterns = literalPatterns(scope.lines(file));
    if (patterns.length < 2) continue;

    for (const sharedPattern of patterns) {
      // The shared-import pattern is the one naming a MODULE, not merely the
      // one containing the word `import`: a definition detector may perfectly
      // well have to match an import line too, and picking by keyword made
      // the guard invisible in exactly that case.
      if (moduleOf(sharedPattern.source, sharedPattern.dialect) === null) continue;
      const symbols = [...sharedPattern.source.matchAll(/\\b([A-Za-z_][\w]{5,})\\b/g)].map((match) => match[1]!);
      const candidates = symbols.length > 0 ? symbols : [...sharedPattern.source.matchAll(/([A-Za-z_][\w]{5,})/g)].map((match) => match[1]!);
      for (const symbol of new Set(candidates)) {
        const detector = patterns.find(
          (other) =>
            other !== sharedPattern &&
            other.source.includes(symbol) &&
            moduleOf(other.source, other.dialect) === null,
        );
        if (detector === undefined) continue;
        const sharedModule = moduleOf(sharedPattern.source, sharedPattern.dialect)!;
        const consumers = scope
          .filesContaining(symbol)
          .filter((consumer) => consumer !== file && importsFrom(scope.read(consumer) ?? "", symbol, sharedModule, sharedPattern.dialect));
        out.push({
          file,
          symbol,
          sharedModule,
          consumers,
          language: sharedPattern.dialect,
          detector,
          sharedPattern,
        });
        break;
      }
    }
  }
  return out;
}

/** The module specifier a "shared import" pattern insists on.
 *
 *  Read out of the pattern rather than assumed: the TypeScript spelling
 *  quotes the specifier (`from\s*["']\.\/_url\.js["']`) and the Python one
 *  does not (`^from \._url import`). Both come back with the regex escapes
 *  removed, which is exactly the specifier a consumer writes. */
function moduleOf(patternSource: string, dialect: "ts" | "py"): string | null {
  if (dialect === "ts") {
    const quoted = /\[["'`]+\]([^[\]]+?)\[["'`]+\]/.exec(patternSource) ?? /["']((?:\\.|[^"'\\])+)["']/.exec(patternSource);
    const cleaned = (quoted?.[1] ?? "").replaceAll("\\", "");
    return /^\.{0,2}\//.test(cleaned) && cleaned.length > 2 ? cleaned : null;
  }
  const match = /from\s+((?:\\\.|\.)[\w.\\]*)\s+import/.exec(patternSource);
  const cleaned = match?.[1]?.replaceAll("\\", "");
  return cleaned === undefined || cleaned.length < 2 ? null : cleaned;
}

function importsFrom(text: string, symbol: string, module: string, dialect: "ts" | "py"): boolean {
  const escaped = module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return dialect === "ts"
    ? new RegExp(`import\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*["']${escaped}["']`).test(text)
    : new RegExp(`from\\s+${escaped}\\s+import[^\\n]*\\b${symbol}\\b`).test(text);
}

/** Compile a guard's own pattern. Never run against repository text — only
 *  against the short synthetic strings this package writes. */
function compile(pattern: LiteralPattern): RegExp | null {
  try {
    return new RegExp(pattern.source, pattern.flags.includes("m") ? pattern.flags : `${pattern.flags}m`);
  } catch {
    return null;
  }
}

function witnessedForms(scope: Scope, language: "ts" | "py"): Map<string, { form: BindingForm; at: string }> {
  const extension = language === "ts" ? /\.tsx?$/ : /\.py$/;
  const found = new Map<string, { form: BindingForm; at: string }>();
  for (const form of BINDING_FORMS) {
    if (form.language !== language) continue;
    for (const file of scope.files) {
      if (!extension.test(file)) continue;
      const text = scope.read(file);
      if (text === null) continue;
      const match = form.witness.exec(text);
      if (match === null) continue;
      const line = text.slice(0, match.index).split("\n").length;
      found.set(form.id, { form, at: `${file}:${line}` });
      break;
    }
  }
  return found;
}

function checkBindingForms(scope: Scope): Finding[] {
  const findings: Finding[] = [];
  const guards = sharedHelperGuards(scope);
  const byLanguage = new Map<"ts" | "py", Map<string, { form: BindingForm; at: string }>>();

  for (const guard of guards) {
    const pattern = compile(guard.detector);
    if (pattern === null) {
      findings.push({
        probe: ID,
        title: `${guard.detector.name} could not be compiled, so its coverage was not checked`,
        file: guard.file,
        line: guard.detector.line,
        verdict: "limit",
        evidence: clip(guard.detector.source, 220),
        detail:
          "The pattern was read out of the guard and rejected by this runtime — a Python construct with no JavaScript spelling, most likely. The guard is unmeasured here, not cleared.",
      });
      continue;
    }
    let witnesses = byLanguage.get(guard.language);
    if (witnesses === undefined) {
      witnesses = witnessedForms(scope, guard.language);
      byLanguage.set(guard.language, witnesses);
    }

    const missed: Array<{ form: BindingForm; at: string }> = [];
    const covered: string[] = [];
    for (const entry of witnesses.values()) {
      const probe = render(entry.form, guard.symbol);
      if (pattern.test(probe)) covered.push(entry.form.id);
      else missed.push(entry);
    }

    const exploitable = missed.filter((entry) => entry.form.shadowsBareCall);
    const inert = missed.filter((entry) => !entry.form.shadowsBareCall);

    if (exploitable.length > 0) {
      findings.push({
        probe: ID,
        title: `${guard.detector.name} does not match ${exploitable.length} binding form(s) that capture a bare ${guard.symbol}(…)`,
        file: guard.file,
        line: guard.detector.line,
        verdict: "gap",
        evidence:
          `${guard.detector.name} = /${clip(guard.detector.source, 200)}/\n\n` +
          `covered: ${covered.join(", ") || "none"}\n\n` +
          exploitable
            .map(
              (entry) =>
                `MISSED ${entry.form.id}  (this tree writes it at ${entry.at})\n` +
                `${render(entry.form, guard.symbol)}\n  → ${entry.form.why}`,
            )
            .join("\n\n"),
        detail:
          `The guard reads a call site as safe when this pattern does NOT match and ${guard.sharedPattern.name} does. ` +
          `Each form above binds ${guard.symbol} so that an unqualified call in the same module reaches the new binding, while leaving every call site — and, for an import alias, the line ${guard.sharedPattern.name} looks for — spelled exactly as before. ` +
          `${guard.consumers.length} module(s) in the corpus import ${guard.symbol} from ${guard.sharedModule} and would each accept the substitution.`,
      });
    }

    if (inert.length > 0) {
      findings.push({
        probe: ID,
        title: `${guard.detector.name} is narrower than it claims and the difference is not reachable`,
        file: guard.file,
        line: guard.detector.line,
        verdict: "sound",
        evidence: inert
          .map(
            (entry) =>
              `${entry.form.id}  (this tree writes it at ${entry.at})\n${render(entry.form, guard.symbol)}\n  → ${entry.form.why}`,
          )
          .join("\n\n"),
        detail:
          "These forms bind the name and the pattern does not match them, so the pattern's own description is broader than the pattern. None of them captures an unqualified call, so a module carrying one still resolves the call to the shared import. Recorded so the mismatch between the comment and the regex stops being re-investigated as a hole.",
      });
    }

    if (missed.length === 0) {
      findings.push({
        probe: ID,
        title: `${guard.detector.name} matches every binding form of ${guard.symbol} this tree contains`,
        file: guard.file,
        line: guard.detector.line,
        verdict: "sound",
        evidence: `covered: ${covered.join(", ")}`,
        detail: "Checked by running the guard's own pattern against each form, and only forms with a real occurrence in this corpus were used.",
      });
    }
  }
  return findings;
}

/** A guard whose verdict comes from sweeping the tree, as opposed to one
 *  that drives an API and checks the answer. Only the first kind can go
 *  quietly blind: a driven call either happens or it does not. */
const SWEEPS_THE_TREE = /readdirSync|readdir\s*\(|createProgram|ast\.parse|os\.walk|Bun\.Glob|new Glob\b|iterdir\(|rglob\(/;

// ── 2 · is the case count a guarantee? ──────────────────────────────────────

/** Does this guard loop over `key` and declare cases inside the loop?
 *
 *  Mentioning the key is not enough. `packages/data/package.json` holds a
 *  `files` array and two scripts read that manifest, so a check that asked
 *  only "does the reader contain the word" reported a publication whitelist
 *  as a test corpus. The claim being made is about generated cases, so the
 *  evidence has to be a loop that generates them. */
function iteratesIntoCases(scope: Scope, guard: Guard, key: string): boolean {
  const lines = scope.lines(guard.file);
  const loop = new RegExp(`(?:of|in)\\s+[\\w.\\[\\]"']*(?:\\.${key}\\b|\\[["']${key}["']\\])`);
  const access = new RegExp(`(?:\\.${key}\\b|\\[["']${key}["']\\])`);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (loop.test(line) && lines.slice(i, i + 10).some((next) => DECLARES.test(next))) return true;
    // A parametrised table is spread into the decorator rather than looped
    // over, so the key access sits INSIDE the case declaration instead of
    // above it. Both spellings generate one case per entry.
    if (access.test(line) && lines.slice(Math.max(0, i - 10), i + 10).some((near) => /parametrize|\.each\(/.test(near))) {
      return true;
    }
  }
  return false;
}

const DECLARES = /\btest(?:\.each|\.skip)?\s*\(|\bit\s*\(|\bdescribe\s*\(|parametrize/;

interface Floor {
  value: number;
  file: string;
  line: number;
  text: string;
}

/** The strongest lower bound any guard places on a collection's size. */
function floorFor(scope: Scope, collection: CaseCollection, readers: readonly Guard[]): Floor | null {
  let best: Floor | null = null;
  const name = collection.name;
  const patterns = [
    new RegExp(`${name}[^\\n]{0,80}?\\.length\\s*\\)?\\s*[,)]?\\s*\\.?to(?:Be|BeGreaterThan(?:OrEqual)?|HaveLength)\\(\\s*(\\d+)`),
    new RegExp(`len\\([^)]*${name}[^)]*\\)\\s*(?:==|>=|>)\\s*(\\d+)`),
    new RegExp(`${name}[^\\n]{0,80}?\\)\\s*(?:==|>=|>)\\s*(\\d+)`),
  ];
  for (const reader of readers) {
    const lines = scope.lines(reader.file);
    for (let i = 0; i < lines.length; i += 1) {
      const window = `${lines[i] ?? ""} ${lines[i + 1] ?? ""}`;
      for (const pattern of patterns) {
        const match = pattern.exec(window);
        if (match === null) continue;
        const value = Number(match[1]);
        if (best === null || value > best.value) {
          best = { value, file: reader.file, line: i + 1, text: (lines[i] ?? "").trim() };
        }
      }
    }
  }
  return best;
}

function checkCaseFloors(scope: Scope, guards: readonly Guard[]): Finding[] {
  const findings: Finding[] = [];

  // Shared fixtures first: a collection two or more guards generate cases
  // from is the strongest form of the shape, because shrinking it shrinks
  // every language at once and each suite still reads as complete.
  const fixtureReaders = new Map<string, Guard[]>();
  for (const guard of guards) {
    for (const path of guard.surface) {
      if (!path.endsWith(".json")) continue;
      fixtureReaders.set(path, [...(fixtureReaders.get(path) ?? []), guard]);
    }
  }

  for (const [fixture, readers] of fixtureReaders) {
    if (readers.length < 2) continue;
    for (const collection of fixtureArrays(scope, fixture)) {
      const iterating = readers.filter((reader) => iteratesIntoCases(scope, reader, collection.name));
      if (iterating.length < 2) continue;
      const floor = floorFor(scope, collection, iterating);
      const strong = floor !== null && floor.value >= collection.size * FLOOR_FRACTION;
      findings.push({
        probe: ID,
        title: strong
          ? `${fixture} · ${collection.name}[] is pinned at ${floor?.value} by its loaders`
          : `${fixture} · ${collection.name}[] drives ${collection.size} case(s) and nothing pins the count`,
        file: fixture,
        line: collection.line,
        verdict: strong ? "sound" : "gap",
        evidence:
          `${collection.size} entries, read by ${iterating.length} guard(s):\n` +
          iterating.map((reader) => `  ${reader.file}`).join("\n") +
          (floor === null
            ? `\n\nstrongest lower bound found in any of them: none`
            : `\n\nstrongest lower bound found in any of them: ${floor.value}\n  ${floor.file}:${floor.line}  ${clip(floor.text, 120)}`),
        detail: strong
          ? "The loaders would go red if the fixture shrank materially, so the case count is a property of the contract rather than of whatever the file happens to hold."
          : "The fixture IS the scope of these suites. Deleting entries removes cases and removes nothing else: every remaining case passes, the suites stay green, and the run is simply shorter — which is the failure mode this package exists to name, because shorter reads as cleaner. Nothing here compares the fixture against the surface it is supposed to cover, nor against its own previous size.",
      });
    }
  }

  // In-file tables: the same shape, one level in — but only inside a guard
  // that also sweeps the tree. Every parametrised test everywhere has a
  // table whose length nobody pins, and reporting all of them would be the
  // volume-as-severity this package refuses. The pointed case is a guard
  // whose MEMBERSHIP is derived from the tree — so it reads as complete —
  // while the depth each member is driven to is a literal nobody checks.
  for (const guard of guards) {
    if (!SWEEPS_THE_TREE.test(codeOnly(scope.read(guard.file) ?? ""))) continue;
    for (const collection of inFileTables(scope, guard)) {
      const floor = floorFor(scope, collection, [guard]);
      if (floor !== null && floor.value >= collection.size * FLOOR_FRACTION) continue;
      const derived = true;
      findings.push({
        probe: ID,
        title: `${collection.name} in ${guard.file.slice(guard.file.lastIndexOf("/") + 1)} sets this guard's strength and nothing pins it`,
        file: guard.file,
        line: collection.line,
        verdict: "gap",
        evidence:
          `${collection.name}: ${collection.size} entries, each generating cases\n` +
          `strongest lower bound anywhere in this file: ${floor === null ? "none" : `${floor.value} (line ${floor.line})`}`,
        detail:
          `Reducing this table to one entry removes cases and fails nothing. ${
            derived
              ? "This guard does enumerate the tree mechanically elsewhere, so its MEMBERSHIP is derived — but the depth each member is driven to is this literal, and the derivation says nothing about it."
              : "Nothing in this guard is derived from the tree, so the whole of its strength is this literal."
          }`,
      });
    }
  }

  return findings;
}

// ── 3 · has anyone shown the detector firing? ───────────────────────────────

/** A test that feeds the guard's own detector something broken and asserts
 *  it fires. This tree has the idiom already — "the scanner still sees the
 *  encoded call sites it is meant to police", "the completeness check can
 *  still fail", "the proof check can still fail" — so the check is whether
 *  a guard that defines a detector carries one. */
const FALSIFIABILITY = /can still fail|still sees|does not satisfy|is caught\b|would (?:be )?catch|_can_still_fail|still_sees/;

function checkFalsifiability(scope: Scope, guards: readonly Guard[]): Finding[] {
  const findings: Finding[] = [];
  for (const guard of guards) {
    const text = scope.read(guard.file) ?? "";
    if (!SWEEPS_THE_TREE.test(codeOnly(text))) continue;
    const patterns = literalPatterns(scope.lines(guard.file)).filter(
      (pattern) => pattern.source.length > 25 && !/\bimport\b/.test(pattern.source),
    );
    if (patterns.length === 0) continue;
    const named = FALSIFIABILITY.test(text);
    const lines = scope.lines(guard.file);
    if (named) {
      const line = lines.findIndex((entry) => FALSIFIABILITY.test(entry)) + 1;
      findings.push({
        probe: ID,
        title: `${guard.file.slice(guard.file.lastIndexOf("/") + 1)} shows its own detector firing`,
        file: guard.file,
        line: line || 1,
        verdict: "sound",
        evidence: clip(lines[line - 1] ?? "", 160),
        detail:
          "The guard feeds its detector a deliberately broken input and asserts that it fires. That is the difference between a scanner that reads clean and a scanner that has stopped matching; without it, the two are indistinguishable from the outside.",
      });
      continue;
    }
    findings.push({
      probe: ID,
      title: `${guard.file.slice(guard.file.lastIndexOf("/") + 1)} defines ${patterns.length} detector pattern(s) and never shows one firing`,
      file: guard.file,
      line: patterns[0]!.line,
      verdict: "gap",
      evidence: patterns
        .slice(0, 3)
        .map((pattern) => `${pattern.name} (line ${pattern.line})  /${clip(pattern.source, 110)}/`)
        .join("\n"),
      detail:
        "A pattern that silently stopped matching passes every file it reads, and a guard built on one reports the tree clean for the same reason it would report it clean if the tree were clean. Neighbouring guards in this repository carry a negative control for exactly this reason.",
    });
  }
  return findings;
}

// ── 4 · does the guard actually die? ────────────────────────────────────────

function plan(scope: Scope, guards: readonly Guard[]): Array<{ mutant: Mutant; guardFiles: string[] }> {
  const out: Array<{ mutant: Mutant; guardFiles: string[] }> = [];

  const fixtureReaders = new Map<string, Guard[]>();
  for (const guard of guards) {
    for (const path of guard.surface) {
      if (!path.endsWith(".json")) continue;
      fixtureReaders.set(path, [...(fixtureReaders.get(path) ?? []), guard]);
    }
  }
  for (const [fixture, readers] of fixtureReaders) {
    if (readers.length < 2) continue;
    for (const collection of fixtureArrays(scope, fixture)) {
      const iterating = readers.filter((reader) => iteratesIntoCases(scope, reader, collection.name));
      if (iterating.length < 2) continue;
      const guardFiles = iterating.map((reader) => reader.file);
      const control = shrinkFixture(scope, collection, 0);
      const shrunk = shrinkFixture(scope, collection, 1);
      if (control !== null) out.push({ mutant: control, guardFiles });
      if (shrunk !== null) out.push({ mutant: shrunk, guardFiles });
    }
  }

  for (const guard of sharedHelperGuards(scope)) {
    for (const consumer of guard.consumers.slice(0, 2)) {
      const mutant = aliasImportShadow(scope, guard, consumer);
      if (mutant !== null) out.push({ mutant, guardFiles: [guard.file] });
    }
  }

  // Interleave by operator. The budget below truncates the plan, and a plan
  // grouped by operator would let a truncation silently drop a whole
  // operator's worth of evidence while the report still said "12 of 16" —
  // the same shape as a scope with an edge it cannot see.
  const queues = new Map<string, Array<{ mutant: Mutant; guardFiles: string[] }>>();
  for (const entry of out) queues.set(entry.mutant.operator, [...(queues.get(entry.mutant.operator) ?? []), entry]);
  const interleaved: Array<{ mutant: Mutant; guardFiles: string[] }> = [];
  for (let round = 0; interleaved.length < out.length; round += 1) {
    for (const queue of queues.values()) {
      const entry = queue[round];
      if (entry !== undefined) interleaved.push(entry);
    }
  }
  return interleaved;
}

function mutate(scope: Scope, guards: readonly Guard[]): Finding[] {
  const findings: Finding[] = [];
  const all = plan(scope, guards);
  const chosen = all.slice(0, MUTANT_BUDGET);
  const skipped: string[] = [];

  for (const { mutant, guardFiles } of chosen) {
    const commands = guardFiles
      .map((file) => ({ file, command: guardCommand(scope, file) }))
      .filter((entry): entry is { file: string; command: { cwd: string; command: string[] } } => entry.command !== null);
    if (commands.length === 0) {
      skipped.push(`${mutant.description} — no runner derivable for ${guardFiles.join(", ")}`);
      continue;
    }

    const copies = [...new Set([...mutant.copies, ...commands.map((entry) => entry.command.cwd)])];
    const baseline = buildShadow(scope.root, copies, []);
    const before = new Map<string, ReturnType<typeof runGuard>>();
    try {
      for (const entry of commands) before.set(entry.file, runGuard(baseline, entry.command.cwd, entry.command.command));
    } finally {
      baseline.dispose();
    }

    const green = commands.filter((entry) => before.get(entry.file)?.ok === true);
    for (const entry of commands) {
      if (before.get(entry.file)?.ok === true) continue;
      skipped.push(
        `${entry.file} — not green in an unmutated shadow, so a mutant could not kill it: ${clip(before.get(entry.file)?.tail ?? "", 160)}`,
      );
    }
    if (green.length === 0) continue;

    const shadow = buildShadow(scope.root, copies, mutant.edits as Edit[]);
    const after = new Map<string, ReturnType<typeof runGuard>>();
    try {
      for (const entry of green) after.set(entry.file, runGuard(shadow, entry.command.cwd, entry.command.command));
    } finally {
      shadow.dispose();
    }

    const survived = green.filter((entry) => after.get(entry.file)?.ok === true);
    const died = green.filter((entry) => after.get(entry.file)?.ok !== true);
    const operator = OPERATORS.find((candidate) => candidate.id === mutant.operator);

    if (mutant.expectation === "control") {
      // Broken means NOTHING died. A collection read by two guards need not
      // be read by both for the same reason — emptying the walls array kills
      // the walls bijection and leaves the commitments one untouched — so
      // requiring every guard to die would report the harness broken every
      // time two suites share a file and not a subject.
      const broken = died.length === 0;
      findings.push({
        probe: ID,
        title: broken
          ? `harness control mutant SURVIVED — every survival verdict in this run is unreliable`
          : `harness control: ${mutant.description} killed ${died.length} guard(s), so the harness is applying edits`,
        file: mutant.file,
        line: mutant.line,
        verdict: broken ? "limit" : "sound",
        evidence: green
          .map((entry) => `${entry.file}: ${before.get(entry.file)?.passed ?? "?"} pass → ${after.get(entry.file)?.passed ?? "?"} pass, ${after.get(entry.file)?.failed ?? "?"} fail`)
          .join("\n"),
        detail: broken
          ? "The control is a mutant every loader in this tree explicitly refuses. It surviving means the shadow did not receive the edit, or the guard was not the one being run."
          : "Published because the failure mode of a mutation report is applying nothing and printing green.",
      });
      continue;
    }

    for (const entry of green) {
      const result = after.get(entry.file)!;
      const start = before.get(entry.file)!;
      findings.push({
        probe: ID,
        title: result.ok
          ? `${entry.file.slice(entry.file.lastIndexOf("/") + 1)} survives: ${mutant.description}`
          : `${entry.file.slice(entry.file.lastIndexOf("/") + 1)} dies on: ${mutant.description}`,
        file: result.ok ? mutant.file : entry.file,
        line: result.ok ? mutant.line : 1,
        verdict: result.ok ? "gap" : "sound",
        evidence:
          `mutant:   ${mutant.description}\n` +
          `guard:    ${entry.command.cwd} $ ${entry.command.command.join(" ")}\n` +
          `baseline: ${start.passed ?? "?"} pass / ${start.failed ?? 0} fail\n` +
          `mutated:  ${result.passed ?? "?"} pass / ${result.failed ?? 0} fail\n\n${result.tail}`,
        detail: result.ok
          ? `The property this guard claims — ${operator?.property ?? mutant.operator} — does not hold, and the guard is green anyway. Applied in a shadow of the repository under the system temporary directory; nothing inside the checkout was written.`
          : `The guard goes red when the property breaks. That is what a guard is for, and it is worth recording by name: ${operator?.property ?? mutant.operator}.`,
      });
    }
  }

  findings.push({
    probe: ID,
    title: `${chosen.length} of ${all.length} candidate mutant(s) were executed`,
    file: "packages/rhizome/src/probes/pretend.ts",
    line: 0,
    verdict: "limit",
    evidence:
      `budget: ${MUTANT_BUDGET} (packages/rhizome/src/probes/pretend.ts)\n` +
      (skipped.length === 0 ? "skipped: none" : `skipped:\n${skipped.map((entry) => `  ${entry}`).join("\n")}`),
    detail:
      "Mutation is expensive and this is a sample. Everything not run is named above, because a probe that samples and reports as if exhaustive is the pathology it exists to name.",
  });

  return findings;
}

export const pretendProbe: Probe = {
  id: ID,
  title: "pretend — guards that survive their own mutant",
  question: "Does each guard actually fail when the thing it guards breaks?",
  limits: LIMITS,
  run(scope: Scope): Finding[] {
    const guards = guardsIn(scope);
    const findings = [
      ...checkBindingForms(scope),
      ...checkCaseFloors(scope, guards),
      ...checkFalsifiability(scope, guards),
    ];

    if (process.env[MUTATE_ENV] === "1") {
      findings.push(...mutate(scope, guards));
    } else {
      const candidates = plan(scope, guards);
      findings.push({
        probe: ID,
        title: `no mutant was executed in this run; ${candidates.length} were derived`,
        file: "packages/rhizome/src/probes/pretend.ts",
        line: 0,
        verdict: "limit",
        evidence:
          `${MUTATE_ENV}=1 bun run rhizome --probe ${ID}\n\n` +
          candidates
            .slice(0, 10)
            .map((entry) => `  ${entry.mutant.operator}  ${entry.mutant.description}`)
            .join("\n") +
          (candidates.length > 10 ? `\n  … and ${candidates.length - 10} more` : ""),
        detail:
          "Everything above is static: the guards' own patterns run against synthetic inputs, and their case collections counted. Whether a guard actually goes red is only answerable by breaking the guarded code and running it, which happens in a shadow of this repository under the system temporary directory and never inside the checkout.",
      });
    }

    return findings;
  },
};
