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
 *  Two questions answered without running anything, and one answered only
 *  by running something:
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
 *  3. **Does the guard actually die?** `RHIZOME_MUTATE=1` breaks the guarded
 *     code in a shadow of the repository under the system temporary
 *     directory and runs the guard. Opt-in because it is the one thing in
 *     this package that executes what it reads, and because it is slow.
 *     Without it the probe reports the plan it did not run, rather than
 *     reporting nothing.
 *
 *     **Has anyone shown the detector firing?** used to be a fourth,
 *     static, question, and it was answered by matching a fixed list of
 *     English phrasings — "can still fail", "still sees" — against the
 *     whole text of the guard file, comments included. It was wrong in both
 *     directions and its own tests did not notice: a scanner with no
 *     negative control whatsoever was reported as `[sound] shows its own
 *     detector firing` because a comment in it happened to read "this scan
 *     can still fail when the checkout is shallow", and a genuine negative
 *     control worded outside the list — `test("the scanner rejects a
 *     planted secret", …)` — was reported as a gap. Reverting the list to
 *     match everything, or nothing, left `bun test tests/pretend.test.ts`
 *     at 14 pass / 0 fail either way.
 *
 *     A check that cannot do what its name says, sitting inside the probe
 *     that exists to name exactly that, is not a check. So it is gone, and
 *     the question it asked is now answered the way the executing half
 *     already answers everything else: the `plant-detector-match` operator
 *     copies a line this corpus already contains, which the guard's own
 *     detector matches, into a file the guard reads, and runs the guard.
 *     Firing is observed, not inferred from prose.
 *
 *  No scope in this file is typed. Guards, their surfaces, their patterns
 *  and their case collections all come out of `Scope`.
 */

import { RECOGNISER_LIMIT, WALKS_THE_TREE } from "../recognisers.js";
import { clip } from "../source.js";
import type { Finding, Probe, ProbeLimit, Scope } from "../types.js";
import { BINDING_FORMS, render, type BindingForm } from "./pretend/binding-forms.js";
import {
  codeOnly,
  DECLARES_CASES,
  fixtureArrays,
  generatesCases,
  guardsIn,
  inFileTables,
  literalPatterns,
  type CaseCollection,
  type Guard,
  type LiteralPattern,
} from "./pretend/guards.js";
import { buildShadow, guardCommand, LINKED_BACK_PHRASE, notCopiedDirectories, runGuard, type Edit } from "./pretend/harness.js";
import {
  aliasImportShadow,
  OPERATORS,
  plantDetectorMatch,
  shrinkFixture,
  type Mutant,
  type SharedHelperGuard,
} from "./pretend/mutants.js";

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

/** How many detector plants a single run derives. Bounded because building
 *  one means scanning the files a guard reads for a line its own detector
 *  matches, and the plan is derived even on a run that executes nothing. */
export const PLANT_BUDGET = 8;

/** How many files a guard's reading surface is expanded to before the
 *  search for a plantable line gives up. */
export const SURFACE_EXPANSION_LIMIT = 400;

/** Lines longer than this are not tested against a guard's own pattern.
 *  Repository patterns are run against repository text here — the first
 *  place in this package that does — and a pathological pattern on a
 *  minified line is the way that becomes a hung run rather than a finding. */
const MAX_WITNESS_LINE = 400;

const LIMITS: readonly ProbeLimit[] = [
  { ...RECOGNISER_LIMIT },
  {
    statement:
      "a detector is found only where a guard binds a regular-expression literal to a name; a pattern written inline at its use site, built by new RegExp() from strings at run time, or held as a property of an object or class is not read as a detector, so the guard carrying it is neither measured nor named",
    why:
      "recovering those would mean executing the guard, and rhizome never executes what it reads. The narrowing used to be twice this size and undeclared: the reader accepted SCREAMING_CASE names only, in both dialects, which is a house style rather than a language rule — a guard spelling its detector `const localDefinition = /…/` had no detector at all as far as this probe was concerned and produced no output, which reads as nothing to report. Any named binding counts now, and what is still outside is this sentence",
    file: "packages/rhizome/src/probes/pretend/guards.ts",
    line: 199,
  },
  {
    statement:
      "whether a guard actually fires is only answered on a run with RHIZOME_MUTATE=1; a default run derives the plant and does not execute it, and reports no verdict at all about any guard's falsifiability",
    why:
      "the question 'has anyone shown this detector firing?' had a static answer here for a while — a fixed list of English phrasings matched against the guard's whole file text, comments included — and it was wrong in both directions: a scanner with no negative control read as sound because a comment in it contained the words 'can still fail', and a real negative control worded differently read as a gap. Neither error made any test red. There is no static form of this question that is not that, so it is asked by planting a line the detector matches into a file the guard reads and watching, and the price is that it is silent unless the executing half runs",
    file: "packages/rhizome/src/probes/pretend/mutants.ts",
    line: 0,
  },
  {
    statement:
      "the planted line is copied verbatim from somewhere else in this corpus, so a detector with no matching line anywhere in the files its guard reads gets no plant and no verdict",
    why:
      "a line generated from the pattern would satisfy the regular expression and not the compiler, and a guard that goes red because the shadow stopped building has not shown its detector firing. A run that produces no pass/fail counts at all is reported as inconclusive rather than as the guard firing, for the same reason",
    file: "packages/rhizome/src/probes/pretend.ts",
    line: 0,
  },
  {
    statement: `a shadow copies everything except the directories the repository's own .gitignore marks as directory-only, of which ${LINKED_BACK_PHRASE} are symlinked back rather than reproduced`,
    why: `an installed dependency tree costs minutes to reproduce and is read-only to every mutant this package writes, so it is linked; a dist/ is rebuilt by the guard's own runner and a .git must not be reachable from a shadow at all, or a git invocation inside the shadow would be operating on the real repository. The not-copied set is derived from the corpus rather than typed — it was a literal list of six names, which is the same shape as the SCAN_DIRS this package exists to report — and the linked-back pair is asserted, exported, and checked by tests/pretend.test.ts against the derived set`,
    file: "packages/rhizome/src/probes/pretend/harness.ts",
    line: 76,
  },
  {
    statement:
      "the binding-form catalogue is a literal list of grammar, not a derivation; a way of binding a name that nobody in this tree has written yet is not checked",
    why: "a corpus can only show the forms somebody already used, and the forms that matter are the ones nobody has used yet — so the list is asserted, and every entry carries a witness regex so a form this tree does not contain is reported as absent rather than asserted",
    file: "packages/rhizome/src/probes/pretend/binding-forms.ts",
    line: 62,
  },
  {
    statement:
      `there are ${OPERATORS.length} mutant operators, aimed at ${OPERATORS.length} properties; an operator nobody wrote finds nothing, and the survival rate reported here is a fact about these operators rather than about the guards`,
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

/** Compile a guard's own pattern.
 *
 *  Run against the short synthetic strings this package writes, and — only
 *  when deriving a detector plant — against single lines of repository text
 *  shorter than `MAX_WITNESS_LINE`. Never against a whole file: an unbounded
 *  repository-authored pattern over a whole file is how a read-only probe
 *  turns into a hung process.
 *
 *  `g` and `y` are dropped because both make `.test()` stateful, and a
 *  stateful detector answers differently on its second call — which would
 *  make the coverage table depend on the order the forms happen to be in. */
function compile(pattern: LiteralPattern): RegExp | null {
  const flags = pattern.flags.replace(/[gy]/g, "");
  try {
    return new RegExp(pattern.source, flags.includes("m") ? flags : `${flags}m`);
  } catch {
    return null;
  }
}

interface FormWitnesses {
  /** Forms the corpus contains, with the place it writes each. */
  found: Map<string, { form: BindingForm; at: string }>;
  /** Forms the catalogue names and this corpus does not contain. */
  absent: BindingForm[];
}

function witnessedForms(scope: Scope, language: "ts" | "py"): FormWitnesses {
  const extension = language === "ts" ? /\.tsx?$/ : /\.py$/;
  const found = new Map<string, { form: BindingForm; at: string }>();
  const absent: BindingForm[] = [];
  for (const form of BINDING_FORMS) {
    if (form.language !== language) continue;
    let witness: string | null = null;
    for (const file of scope.files) {
      if (!extension.test(file)) continue;
      const text = scope.read(file);
      if (text === null) continue;
      const match = form.witness.exec(text);
      if (match === null) continue;
      witness = `${file}:${text.slice(0, match.index).split("\n").length}`;
      break;
    }
    // A form with no witness is neither covered nor missed — the guard's
    // pattern is simply never run against it. That was true before and it
    // was true silently: `py/module-assignment` has no witness in this tree,
    // so it appeared in neither list while binding-forms.ts claimed a form
    // the corpus does not contain "is reported as absent rather than
    // asserted". It was reported as nothing. Now it comes back here.
    if (witness === null) absent.push(form);
    else found.set(form.id, { form, at: witness });
  }
  return { found, absent };
}

function checkBindingForms(scope: Scope): Finding[] {
  const findings: Finding[] = [];
  const guards = sharedHelperGuards(scope);
  const byLanguage = new Map<"ts" | "py", FormWitnesses>();

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
    for (const entry of witnesses.found.values()) {
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

  // One finding per language actually measured, naming the catalogue
  // entries this corpus has no witness for. Every "matches every binding
  // form" verdict above is bounded by this list, and it belongs in the
  // report rather than in a reader's head.
  for (const [language, witnesses] of byLanguage) {
    if (witnesses.absent.length === 0) continue;
    findings.push({
      probe: ID,
      title: `${witnesses.absent.length} ${language} binding form(s) were not checked against any guard: this tree contains no example of them`,
      file: "packages/rhizome/src/probes/pretend/binding-forms.ts",
      line: 59,
      verdict: "limit",
      evidence: witnesses.absent
        .map((form) => `${form.id}\n${render(form, "example")}\n  witness: /${form.witness.source}/ matched no ${language} file in the corpus\n  → ${form.why}`)
        .join("\n\n"),
      detail:
        `Each form above binds a name, and no ${language} file in this corpus writes it, so no guard's pattern was run against it and no verdict here covers it. ` +
        "The catalogue refuses to assert a form it cannot point at — that is the staleness check working — but until now the refusal was silent: an unwitnessed form appeared in neither the covered list nor the missed list, while the catalogue's own header claimed such a form 'is reported as absent rather than asserted'. This is that report. A guard described above as matching every binding form matches every binding form this tree contains, which is a smaller claim.",
    });
  }

  return findings;
}

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
    // `generatesCases` is the same question `inFileTables` asks, asked by
    // the same function: a loop that runs INSIDE one test declares
    // assertions, not cases, and shrinking its collection shortens a test
    // that still runs rather than shortening the suite.
    if (loop.test(line) && generatesCases(lines, i) && lines.slice(i, i + 10).some((next) => DECLARES_CASES.test(next))) {
      return true;
    }
    // A parametrised table is spread into the decorator rather than looped
    // over, so the key access sits INSIDE the case declaration instead of
    // above it. Both spellings generate one case per entry.
    if (access.test(line) && lines.slice(Math.max(0, i - 10), i + 10).some((near) => /parametrize|\.each\(/.test(near))) {
      return true;
    }
  }
  return false;
}

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
    if (!WALKS_THE_TREE.test(codeOnly(scope.read(guard.file) ?? ""))) continue;
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

// ── 3 · does the guard actually die? ────────────────────────────────────────

/** The corpus files a guard reads, expanded from the path literals in its
 *  own source. A surface entry that names a directory stands for every
 *  corpus file under it, bounded so a guard pointed at the repository root
 *  does not turn one plant into a full-tree scan. */
function surfaceFiles(scope: Scope, guard: Guard): string[] {
  const out: string[] = [];
  for (const path of guard.surface) {
    if (scope.files.includes(path)) {
      out.push(path);
      continue;
    }
    for (const file of scope.files) {
      if (!file.startsWith(`${path}/`)) continue;
      out.push(file);
      if (out.length >= SURFACE_EXPANSION_LIMIT) return out;
    }
  }
  return out;
}

/** The first line of `files` that `pattern` matches, with where it lives.
 *  Line-at-a-time and length-bounded on purpose: this is the one place a
 *  repository-authored pattern meets repository text. */
function firstMatchingLine(
  scope: Scope,
  files: readonly string[],
  pattern: RegExp,
): { file: string; line: number; text: string } | null {
  for (const file of files) {
    const lines = scope.lines(file);
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i] ?? "";
      if (text.trim() === "" || text.length > MAX_WITNESS_LINE) continue;
      if (pattern.test(text)) return { file, line: i + 1, text };
    }
  }
  return null;
}

/** Derive the negative controls: for each guard that sweeps the tree with a
 *  named detector, a line this corpus already contains that the detector
 *  matches, and a file the guard reads that does not currently contain one.
 *
 *  This is the whole of what used to be the "falsifiability" check, and the
 *  difference is that it produces something runnable instead of a verdict
 *  derived from whether the guard's prose used a particular idiom. */
function detectorPlants(scope: Scope, guards: readonly Guard[]): Array<{ mutant: Mutant; guardFiles: string[] }> {
  const out: Array<{ mutant: Mutant; guardFiles: string[] }> = [];
  for (const guard of guards) {
    if (out.length >= PLANT_BUDGET) break;
    if (!WALKS_THE_TREE.test(codeOnly(scope.read(guard.file) ?? ""))) continue;
    const patterns = literalPatterns(scope.lines(guard.file)).filter(
      (pattern) => pattern.source.length > 25 && !/\bimport\b/.test(pattern.source),
    );
    if (patterns.length === 0) continue;
    const files = surfaceFiles(scope, guard).filter((file) => file !== guard.file);
    if (files.length === 0) continue;

    for (const pattern of patterns) {
      const compiled = compile(pattern);
      if (compiled === null) continue;
      const witness = firstMatchingLine(scope, files, compiled);
      if (witness === null) continue;
      const extension = witness.file.slice(witness.file.lastIndexOf("."));
      const target = files.find(
        (file) => file !== witness.file && file.endsWith(extension) && !firstMatchingLineIn(scope, file, compiled),
      );
      if (target === undefined) continue;
      const mutant = plantDetectorMatch(scope, {
        guardFile: guard.file,
        patternName: pattern.name,
        patternLine: pattern.line,
        witnessFile: witness.file,
        witnessLine: witness.line,
        text: witness.text,
        target,
      });
      if (mutant === null || mutant.copies.length === 0) continue;
      out.push({ mutant, guardFiles: [guard.file] });
      break;
    }
  }
  return out;
}

function firstMatchingLineIn(scope: Scope, file: string, pattern: RegExp): boolean {
  return firstMatchingLine(scope, [file], pattern) !== null;
}

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

  out.push(...detectorPlants(scope, guards));

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

/** One guard, one mutant, both runs. Collected rather than reported as it
 *  happens, because whether a survival means anything is not known until
 *  every control in the run has been executed. */
interface Outcome {
  mutant: Mutant;
  guardFile: string;
  command: { cwd: string; command: string[] };
  before: ReturnType<typeof runGuard>;
  after: ReturnType<typeof runGuard>;
}

/** The sentence carried by every survival verdict in a run whose harness
 *  control did not die. It used to live only in its own separate finding —
 *  which meant the survival findings printed above it, at full confidence,
 *  each stating that a guard is green while the property it claims is
 *  broken. A reader who stopped after the first page read a page of
 *  conclusions the run had already invalidated. */
function controlCaveat(brokenControls: readonly string[]): string {
  return (
    `UNRELIABLE: the harness control mutant survived in this run (${brokenControls.join("; ")}), which means an edit may not have reached the shadow ` +
    "or the command may not have been running the guard named here. A survival verdict is only evidence when a mutant every loader explicitly refuses is shown to die first, and in this run it was not. Treat this finding as unmeasured, not as a gap."
  );
}

function mutate(scope: Scope, guards: readonly Guard[]): Finding[] {
  const findings: Finding[] = [];
  const all = plan(scope, guards);
  const chosen = all.slice(0, MUTANT_BUDGET);
  const skipped: string[] = [];
  const notCopied = notCopiedDirectories(scope);
  const outcomes: Outcome[] = [];
  const brokenControls: string[] = [];

  for (const { mutant, guardFiles } of chosen) {
    const commands = guardFiles
      .map((file) => ({ file, command: guardCommand(scope, file) }))
      .filter((entry): entry is { file: string; command: { cwd: string; command: string[] } } => entry.command !== null);
    if (commands.length === 0) {
      skipped.push(`${mutant.description} — no runner derivable for ${guardFiles.join(", ")}`);
      continue;
    }

    const copies = [...new Set([...mutant.copies, ...commands.map((entry) => entry.command.cwd)])];
    const baseline = buildShadow(scope.root, copies, [], notCopied);
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

    const shadow = buildShadow(scope.root, copies, mutant.edits as Edit[], notCopied);
    const after = new Map<string, ReturnType<typeof runGuard>>();
    try {
      for (const entry of green) after.set(entry.file, runGuard(shadow, entry.command.cwd, entry.command.command));
    } finally {
      shadow.dispose();
    }

    const died = green.filter((entry) => after.get(entry.file)?.ok !== true);

    if (mutant.expectation === "control") {
      // Broken means NOTHING died. A collection read by two guards need not
      // be read by both for the same reason — emptying the walls array kills
      // the walls bijection and leaves the commitments one untouched — so
      // requiring every guard to die would report the harness broken every
      // time two suites share a file and not a subject.
      const broken = died.length === 0;
      if (broken) brokenControls.push(mutant.description);
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
      outcomes.push({
        mutant,
        guardFile: entry.file,
        command: entry.command,
        before: before.get(entry.file)!,
        after: after.get(entry.file)!,
      });
    }
  }

  // Every survival is reported only now, when it is known whether the
  // harness proved itself in this run.
  const caveat = brokenControls.length === 0 ? null : controlCaveat(brokenControls);
  for (const outcome of outcomes) {
    const { mutant, after: result, before: start } = outcome;
    const operator = OPERATORS.find((candidate) => candidate.id === mutant.operator);
    const base = outcome.guardFile.slice(outcome.guardFile.lastIndexOf("/") + 1);
    const evidence =
      `mutant:   ${mutant.description}\n` +
      `guard:    ${outcome.command.cwd} $ ${outcome.command.command.join(" ")}\n` +
      `baseline: ${start.passed ?? "?"} pass / ${start.failed ?? 0} fail\n` +
      `mutated:  ${result.passed ?? "?"} pass / ${result.failed ?? 0} fail\n\n${result.tail}`;

    // A planted line is source text, and source text can stop a package
    // building. A run that produced no pass/fail counts at all did not show
    // this guard's detector firing — it showed the shadow failing to build —
    // and calling that "the guard fired" is exactly the mutant-dies-for-the
    // -wrong-reason failure this package refuses elsewhere.
    if (!result.ok && result.failed === null && result.passed === null) {
      findings.push({
        probe: ID,
        title: `${base}: inconclusive — ${mutant.description}`,
        file: mutant.file,
        line: mutant.line,
        verdict: "limit",
        evidence,
        detail:
          "The guard exited non-zero without reporting a single pass or fail, so the mutated shadow most likely did not build. Nothing was learned about whether this guard's detector fires; it is not evidence in either direction.",
      });
      continue;
    }

    findings.push({
      probe: ID,
      title: result.ok
        ? `${base} survives: ${mutant.description}${caveat === null ? "" : " (harness control failed; see detail)"}`
        : `${base} dies on: ${mutant.description}`,
      file: result.ok ? mutant.file : outcome.guardFile,
      line: result.ok ? mutant.line : 1,
      verdict: result.ok && caveat !== null ? "limit" : result.ok ? "gap" : "sound",
      evidence,
      detail: result.ok
        ? `${caveat === null ? "" : `${caveat}\n\n`}The property this guard claims — ${operator?.property ?? mutant.operator} — does not hold, and the guard is green anyway. Applied in a shadow of the repository under the system temporary directory; nothing inside the checkout was written.`
        : `The guard goes red when the property breaks. That is what a guard is for, and it is worth recording by name: ${operator?.property ?? mutant.operator}.`,
    });
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
    const findings = [...checkBindingForms(scope), ...checkCaseFloors(scope, guards)];

    if (process.env[MUTATE_ENV] === "1") {
      findings.push(...mutate(scope, guards));
    } else {
      const candidates = plan(scope, guards);
      const plants = candidates.filter((entry) => entry.mutant.operator === "plant-detector-match");
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
      // Said separately, because this is the question that used to have a
      // static answer here and no longer does. Silence about it would read
      // as "no guard has that problem".
      findings.push({
        probe: ID,
        title: `no guard was shown firing or failing to fire in this run; ${plants.length} negative control(s) were derived`,
        file: "packages/rhizome/src/probes/pretend/mutants.ts",
        line: 0,
        verdict: "limit",
        evidence:
          plants.length === 0
            ? "no guard in this corpus offered both a named detector, a line somewhere it matches, and a file it reads without one"
            : plants
                .slice(0, 6)
                .map((entry) => `  ${entry.mutant.description}`)
                .join("\n") + (plants.length > 6 ? `\n  … and ${plants.length - 6} more` : ""),
        detail:
          "Whether a guard's verdict actually depends on its own detector is answered by planting a line the detector matches into a file the guard reads and running the guard. Until this session that question had a static answer — a list of English phrasings matched against the guard's file — which reported a scanner with no negative control as sound because a comment in it read 'can still fail', and reported a real negative control as a gap because it was worded differently. Neither error made a test red. A check that cannot do what its name says is worse than no check, so it is gone, and this is what stands in its place: unanswered by default, answered under RHIZOME_MUTATE=1.",
      });
    }

    return findings;
  },
};
