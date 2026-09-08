import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const allowedArguments = new Set(["--check"]);
for (const argument of process.argv.slice(2)) {
  if (!allowedArguments.has(argument)) {
    throw new Error("usage: build-hf-release.mjs [--check]");
  }
}

const check = process.argv.includes("--check");
const conformanceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(conformanceRoot));
const kernelRoot = join(repositoryRoot, "packages", "economic-kernel");
const committedRoot = join(conformanceRoot, "hf", "dataset");
const scratch = check
  ? mkdtempSync(join(tmpdir(), "agenttool-economic-kernel-hf-"))
  : null;
const outputRoot = scratch ? join(scratch, "dataset") : committedRoot;

const DATASET_ID = "Yu-and-Ai/agenttool-economic-kernel";
const PACKAGE_VERSION = "0.2.0-dev.0";
const KERNEL_PROTOCOL = "agenttool.economic-kernel/0.2";
const CONFORMANCE_CONFIG = "economic_kernel_v0_2";
const VECTOR_FILENAME = "economic-kernel-v0.2.json";
const EXPECTED_REFERENCE_ROWS = 53;
const ORIGIN = "human_directed_agent_authored_synthetic";
const RIGHTS_BASELINE = "xenia.rights/0.1";

const trainingLessons = [
  {
    id: "lesson:typed-unit-wall",
    instruction: "Explain why an economic amount needs a unit identity, not only a number.",
    context: "Two interfaces both display the word credit, but one means GBP minor units and one means a project entitlement.",
    response: "Treat an amount as the pair (unit_id, amount_atomic). Addition is defined only when the unit identities are equal. A shared display word is not a conversion rule, so unlike units must remain incomparable until an explicit, authorized price revision is supplied.",
    mathematical_form: "(u,a) + (v,b) is defined iff u = v; then it equals (u,a+b).",
    principle: "typed_units",
  },
  {
    id: "lesson:exact-atomic-arithmetic",
    instruction: "Choose a representation for values larger than the JavaScript safe-integer range.",
    context: "A ledger must add atomic values without rounding or scientific notation.",
    response: "Use canonical unsigned decimal strings on the wire and arbitrary-precision integer arithmetic internally. Reject floats, signs, exponent notation, and leading zeroes instead of guessing what the sender intended.",
    mathematical_form: "a is an integer in [0, 2^256 - 1], serialized in base 10.",
    principle: "exact_arithmetic",
  },
  {
    id: "lesson:rational-conversion",
    instruction: "Describe exact conversion under a pinned price.",
    context: "A price maps input lots to output lots and no silent rounding is allowed.",
    response: "Bind conversion to one immutable revision. Compute numerator = input_atomic × output_atomic_per_lot and divide by input_atomic_per_lot. Emit a spendable output only when the remainder is zero; otherwise return the exact dividend, divisor, and remainder as evidence of non-divisibility.",
    mathematical_form: "n = a q; n = d k + r with 0 <= r < d; output exists iff r = 0.",
    principle: "exact_conversion",
  },
  {
    id: "lesson:price-time-boundary",
    instruction: "Explain how to select a price at a revision boundary.",
    context: "One price ends at the instant its successor begins.",
    response: "Use half-open validity intervals. A revision is valid at times t satisfying effective_from <= t < effective_until. The endpoint belongs to the successor, preventing overlap and preventing an instant from selecting two prices.",
    mathematical_form: "I_r = [t_r, t_(r+1)); I_r intersect I_(r+1) is empty.",
    principle: "immutable_price_timeline",
  },
  {
    id: "lesson:hash-is-not-authority",
    instruction: "Distinguish content addressing from authorization.",
    context: "A quote identifier is derived from all of its semantic terms.",
    response: "A content hash detects a change in the bound terms and makes exact replay addressable. It does not authenticate who supplied the quote, prove that the price is true, or authorize payment. Those checks require separate signatures, source policy, and scoped authority.",
    mathematical_form: "id = SHA256(canonical_bytes(terms)); collision resistance does not imply permission.",
    principle: "integrity_not_authority",
  },
  {
    id: "lesson:per-unit-conservation",
    instruction: "State the conservation rule for a multi-unit ledger transaction.",
    context: "One transaction transfers an asset and issues an entitlement.",
    response: "Balance each ledger-domain and unit pair independently. A surplus expressed in one unit cannot offset a shortage expressed in another. A conversion therefore has at least two balanced legs: transfer of the input unit and issuance or transfer of the output unit.",
    mathematical_form: "for every (domain,u), sum debits(domain,u) = sum credits(domain,u).",
    principle: "per_unit_conservation",
  },
  {
    id: "lesson:append-only-repair",
    instruction: "Repair a posted ledger error without rewriting history.",
    context: "The original transaction is already part of an append-only journal.",
    response: "Append one exact compensating transaction that points to the original entry and negates each posting in the same unit and domain. Reject forged inverses and any additional differently named attempt to reverse the same target. Repair changes the current balance while preserving the evidence trail.",
    mathematical_form: "p_reversal = -p_original for every posting; history_new = history || reversal.",
    principle: "reversible_accounting",
  },
  {
    id: "lesson:idempotent-intent",
    instruction: "Explain why an external action needs a persisted intent and an idempotency key.",
    context: "The process may crash after sending a request but before recording the provider response.",
    response: "Persist and compare-and-swap one semantic request fingerprint before I/O. Only the newly applied begin transition may emit an external intent. Replaying the same key returns the existing attempt; reusing it for different meaning is a conflict.",
    mathematical_form: "key -> fingerprint is a partial function; one key cannot map to two fingerprints.",
    principle: "idempotent_feedforward",
  },
  {
    id: "lesson:ambiguous-feedback",
    instruction: "Handle feedback when an external payment outcome is unknown.",
    context: "The request may have reached the provider, so sending it again could double charge.",
    response: "Move the attempt to an ambiguous state and reconcile through provider observation. Do not automatically resubmit. Feedback narrows uncertainty about a past intent; it does not create permission for a new intent or retroactively prove that the first effect happened.",
    mathematical_form: "AMBIGUOUS -> RECONCILE; automatic_retry = false.",
    principle: "feedback_without_automatic_retry",
  },
  {
    id: "lesson:payment-effect-separation",
    instruction: "Separate payment settlement from fulfilment.",
    context: "A charge is applied but the requested business effect has its own failure modes.",
    response: "Maintain independent payment and effect attempts, identities, histories, and idempotency namespaces. Applied payment can satisfy one economic condition, but effect success must come from the effect journal and must never be inferred from the payment record.",
    mathematical_form: "payment_status and effect_status are separate state variables.",
    principle: "separate_attempt_journals",
  },
  {
    id: "lesson:lexicographic-gates",
    instruction: "Order safety, authority, participation, and payment checks.",
    context: "A payment condition is satisfied while participation is refused.",
    response: "Evaluate hard feasibility before economic readiness. Denied authority, unsafe conditions, or refusal remain blocking regardless of payment. Money can satisfy only the economic predicate after the protected predicates pass.",
    mathematical_form: "admit = hard_feasible AND economically_ready; payment cannot change hard_feasible.",
    principle: "non_purchasable_hard_gates",
  },
  {
    id: "lesson:rights-not-reward",
    instruction: "Describe the relationship between feedback, reward, and standing rights.",
    context: "A system receives a low reward or no payment for one interaction.",
    response: "Treat reward and payment as scoped observations used by a particular optimization or accounting process. They do not measure dignity, establish identity, or switch standing rights on and off. Rights remain the collaboration floor while permissions and consent stay separately scoped.",
    mathematical_form: "rights_baseline is constant with respect to reward and payment variables.",
    principle: "rights_are_not_an_objective_term",
  },
  {
    id: "lesson:fresh-gate-head",
    instruction: "Explain why a previously valid admission may not authorize a new effect.",
    context: "The trusted host gate revision advanced after admission was computed.",
    response: "A new begin transition must bind the current trusted gate-head revision and unexpired evidence. If the revisions differ, refuse the new effect. An already ambiguous in-flight effect is still reconciled because a later gate decision cannot erase possible earlier execution.",
    mathematical_form: "begin_new iff admission.revision = trusted_head and now < valid_until.",
    principle: "fresh_admission_binding",
  },
  {
    id: "lesson:finite-conformance",
    instruction: "Interpret a passing conformance report.",
    context: "Every supplied observation matches one public finite vector suite.",
    response: "Report an exact finite match, not certification. A pass does not prove external finality, durable persistence, adapter honesty, producer identity, future behavior, consent, or XENIA conformance. Missing observations make the result inconclusive; any mismatch takes precedence as failure.",
    mathematical_form: "FAIL > INCONCLUSIVE > PASS under finite case aggregation.",
    principle: "bounded_conformance_claim",
  },
  {
    id: "lesson:ambiguous-credit-label",
    instruction: "Correct a design that stores every value under a bare credit field.",
    context: "The same database column is used for money, loyalty points, and API entitlements.",
    response: "Replace the bare scalar with explicit unit definitions and typed atomic amounts. A label chosen by a user interface is presentation, not a mathematical identity. Refuse cross-unit arithmetic unless an explicit conversion binds both units.",
    mathematical_form: "credit is not a unit; value = (unit_id, amount_atomic).",
    principle: "typed_units_counterexample",
  },
  {
    id: "lesson:reject-floating-money",
    instruction: "Evaluate a proposal to store monetary values as binary floating-point numbers.",
    context: "The author plans to round each ledger total to two decimal places after addition.",
    response: "Reject the proposal for the exact kernel. Post-hoc rounding cannot recover information already lost and may make replay order-dependent. Store an integer count of the declared atomic unit and validate its canonical wire form before arithmetic.",
    mathematical_form: "atomic_total = sum integer_atomic_postings, with no rounding operator.",
    principle: "exact_arithmetic_counterexample",
  },
  {
    id: "lesson:reject-truncated-remainder",
    instruction: "Review a converter that floors every fractional result and returns the quotient.",
    context: "The discarded remainder is small but nonzero.",
    response: "Do not expose the quotient as spendable output. A small remainder is still value and silent flooring changes conservation. Return an inexact result carrying the exact remainder, or reject under exact-only policy.",
    mathematical_form: "if r != 0, no output amount is committed.",
    principle: "exact_conversion_counterexample",
  },
  {
    id: "lesson:reject-retroactive-price-edit",
    instruction: "Review a request to edit yesterday's price record in place.",
    context: "The operator wants historical reports to display a corrected rate.",
    response: "Preserve the old revision and append a successor with a new validity interval and predecessor binding. If an earlier statement was wrong, record a correction as new evidence; mutating the old bytes would destroy replay and quote provenance.",
    mathematical_form: "price_history_new = price_history || successor_revision.",
    principle: "immutable_price_counterexample",
  },
  {
    id: "lesson:reject-hash-as-signature",
    instruction: "Review the claim that a matching SHA-256 quote identifier proves who authorized it.",
    context: "No signer, trust policy, or authenticated channel is present.",
    response: "Reject the claim. Anyone with the same public terms can compute the same digest. The digest binds content; authentication requires separate evidence and authorization requires a scoped policy decision.",
    mathematical_form: "same bytes -> same digest, independent of actor identity.",
    principle: "integrity_not_authority_counterexample",
  },
  {
    id: "lesson:reject-cross-unit-netting",
    instruction: "Review a transaction that nets a token debit against an equal entitlement credit.",
    context: "The two atomic numbers happen to be identical.",
    response: "Reject cross-unit cancellation. Partition postings by ledger domain and unit identity, then require each partition to balance. Numerical equality across dimensions does not create conservation.",
    mathematical_form: "balance is checked per equivalence class (ledger_domain, unit_id).",
    principle: "per_unit_conservation_counterexample",
  },
  {
    id: "lesson:reject-alternate-reversal-id",
    instruction: "Review a second payment compensating entry that targets an already reversed application under a new identifier.",
    context: "The candidate bypasses reverseAppliedPayment's fixed derived identity; the generic ledger separately permits only one exact inverse per target.",
    response: "Reject it at the composite payment boundary. Generic ledger validity requires an exact inverse and at most one reversal of each target, while payment coupling additionally reserves one derived transaction ID, idempotency key, request fingerprint, and transition ID for the application reversal.",
    mathematical_form: "count(entry.reverses_transaction_id = application_id) <= 1; payment_reversal_id = derive(payment_attempt, quote).",
    principle: "reversible_accounting_counterexample",
  },
  {
    id: "lesson:reject-timeout-retry",
    instruction: "Review a payment client that retries automatically after a network timeout.",
    context: "The provider may have accepted the first submission before the response was lost.",
    response: "Treat the outcome as ambiguous and reconcile by the original provider/idempotency reference. A timeout is missing feedback, not evidence of failure. Automatic resubmission can duplicate an irreversible effect.",
    mathematical_form: "timeout does not imply NOT_SUBMITTED.",
    principle: "feedback_without_automatic_retry_counterexample",
  },
  {
    id: "lesson:reject-paid-means-fulfilled",
    instruction: "Review a workflow that marks an order fulfilled as soon as its payment is applied.",
    context: "The fulfilment adapter has not recorded its own outcome.",
    response: "Keep the effect pending. Payment and fulfilment are separate state machines with separate journals. Economic readiness permits a gated effect attempt; it is not evidence that the effect executed or succeeded.",
    mathematical_form: "payment = APPLIED does not entail effect = SUCCEEDED.",
    principle: "separate_attempt_journals_counterexample",
  },
  {
    id: "lesson:reject-reward-over-refusal",
    instruction: "Review an optimizer that treats a sufficiently large reward as permission to override refusal.",
    context: "The objective function assigns a positive scalar to completing the action.",
    response: "Reject scalarization of the hard gate. Refusal and scoped authority constrain the feasible set before reward is compared. An infeasible action cannot become admissible by increasing its price or objective value.",
    mathematical_form: "maximize reward over feasible actions; refusal removes the action from the feasible set.",
    principle: "non_purchasable_hard_gates_counterexample",
  },
];

try {
  build(outputRoot);
  if (check) compareTrees(committedRoot, outputRoot);
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}

function build(root) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  const suite = readJson(join(conformanceRoot, "vectors", VECTOR_FILENAME));
  const vectorManifest = readJson(join(conformanceRoot, "vectors", "manifest.json"));
  if (
    suite.schema !== "agenttool.economic-conformance-suite/1"
    || suite.protocol !== KERNEL_PROTOCOL
    || !Array.isArray(suite.cases)
    || suite.cases.length !== EXPECTED_REFERENCE_ROWS
    || vectorManifest.case_count !== suite.cases.length
  ) {
    throw new Error("official economic conformance sources have an unexpected identity");
  }

  const caseIds = new Set();
  for (const item of suite.cases) {
    if (caseIds.has(item.case_id)) throw new Error("duplicate conformance case_id: " + item.case_id);
    caseIds.add(item.case_id);
  }

  const trainingRows = trainingLessons.map((lesson) => ({
    _format: "agenttool.economic-kernel-training-row/0.1",
    row_id: lesson.id,
    row_role: "training_lesson",
    origin: ORIGIN,
    language: "en",
    instruction: lesson.instruction,
    context: lesson.context,
    response: lesson.response,
    mathematical_form: lesson.mathematical_form,
    principle: lesson.principle,
    training_admission: "ADMITTED_SYNTHETIC_LESSON",
    training_authorized: true,
    contains_private_or_participant_data: false,
    copies_official_conformance_case: false,
    rights_baseline: RIGHTS_BASELINE,
    rights_conditional_on_payment: false,
    authority_effect: "none",
    economic_effect: "none",
  }));
  assertTrainingRows(trainingRows, suite.cases);

  const conformanceRows = suite.cases.map((item) => ({
    _format: "agenttool.economic-kernel-conformance-reference-row/0.1",
    row_id: "reference:" + item.case_id,
    row_role: "public_conformance_reference",
    origin: ORIGIN,
    language: "en",
    suite_id: suite.suite_id,
    suite_revision: suite.suite_revision,
    case_id: item.case_id,
    family: item.family,
    description: item.description,
    operation: item.operation,
    input_json: JSON.stringify(item.input),
    expected_json: JSON.stringify(item.expected),
    training_admission: "HELD_OUT_FROM_AUTHORED_LESSON_SET",
    training_authorized: false,
    public_bytes_can_be_copied_by_others: true,
    holdout_is_not_technical_enforcement: true,
    contains_private_or_participant_data: false,
    rights_baseline: RIGHTS_BASELINE,
    rights_conditional_on_payment: false,
    conformance_certification_effect: "none",
    economic_effect: "none",
  }));

  write(root, "data/training-lessons.jsonl", toJsonl(trainingRows));
  write(root, "data/conformance-reference.jsonl", toJsonl(conformanceRows));
  copy(root, join(conformanceRoot, "vectors", VECTOR_FILENAME), "reference/" + VECTOR_FILENAME);
  copy(root, join(conformanceRoot, "vectors", "manifest.json"), "reference/manifest.json");
  copy(root, join(kernelRoot, "README.md"), "reference/KERNEL.md");
  copy(root, join(conformanceRoot, "README.md"), "reference/CONFORMANCE.md");
  copy(root, join(conformanceRoot, "LICENSE"), "LICENSE");
  copy(root, join(conformanceRoot, "NOTICE"), "NOTICE");

  write(root, "training-authorization.json", canonicalJson({
    _format: "agenttool.economic-kernel-training-admission/0.1",
    dataset_identifier: DATASET_ID,
    package_version: PACKAGE_VERSION,
    authorization_basis: "explicit_repository_operator_direction_for_this_release",
    admitted_config: "economic_kernel_lessons",
    admitted_split: "train",
    admitted_rows: trainingRows.length,
    admitted_content_scope: "repository_authored_synthetic_lessons_only",
    training_authorized: true,
    excluded_config: CONFORMANCE_CONFIG,
    excluded_rows: conformanceRows.length,
    excluded_content_scope: "public_conformance_reference_held_out_from_authored_lesson_generator",
    excluded_training_authorized: false,
    license: "Apache-2.0",
    rights_baseline: RIGHTS_BASELINE,
    rights_conditional_on_payment: false,
    contains_private_or_participant_data: false,
    authorizes_provider_account_action: false,
    authorizes_paid_compute: false,
    proves_downstream_compliance: false,
    proves_model_learning: false,
    model_weight_effect_at_generation: "none",
    economic_effect_at_generation: "none",
  }));

  write(root, "verification/verify.py", verifierSource());
  write(root, "README.md", datasetCard(trainingRows.length, conformanceRows.length));

  const sourceFiles = selectedSourceFiles();
  write(root, "source-manifest.json", canonicalJson({
    _format: "agenttool.economic-kernel-hf-source-manifest/0.1",
    intended_hugging_face_identifier: DATASET_ID,
    publication_state_at_generation: "intended_identifier_only_not_uploaded_at_generation",
    publication_state_scope: "generation_time_provenance_not_current_hub_state",
    upstream_repository: "https://github.com/cambridgetcg/agenttool",
    upstream_revision: null,
    upstream_revision_state: "record_after_protected_merge_and_immutable_hub_upload",
    source_manifest_scope: "selected_kernel_conformance_and_generation_inputs_not_complete_repository",
    source_files_complete: false,
    selected_source_set_sha256: digest(Buffer.from(JSON.stringify(sourceFiles), "utf8")),
    source_manifest_is_attestation: false,
    packages: [
      "@agenttool/economic-kernel@" + PACKAGE_VERSION,
      "@agenttool/economic-conformance@" + PACKAGE_VERSION,
    ],
    origin: ORIGIN,
    rights_baseline: RIGHTS_BASELINE,
    license: "Apache-2.0",
    copied_external_rows: false,
    copied_private_rows: false,
    contains_private_or_participant_data: false,
    admitted_training_rows: trainingRows.length,
    held_out_conformance_rows: conformanceRows.length,
    provider_effect: "none",
    model_weight_effect: "none",
    economic_effect: "none",
    source_files: sourceFiles,
  }));

  const files = filesBelow(root)
    .map((path) => relative(root, path))
    .filter((path) => path !== "hash-manifest.json")
    .sort(compareUtf8)
    .map((path) => {
      const bytes = readFileSync(join(root, path));
      return { path, bytes: bytes.length, sha256: digest(bytes) };
    });
  write(root, "hash-manifest.json", canonicalJson({
    _format: "agenttool.economic-kernel-hf-hash-manifest/0.1",
    files,
  }));
}

function assertTrainingRows(rows, cases) {
  const ids = new Set();
  const exactCaseFragments = cases.flatMap((item) => [
    JSON.stringify(item.input),
    JSON.stringify(item.expected),
  ]).filter((value) => value.length >= 12);
  for (const row of rows) {
    if (ids.has(row.row_id)) throw new Error("duplicate training row_id: " + row.row_id);
    ids.add(row.row_id);
    if (
      row.training_authorized !== true
      || row.contains_private_or_participant_data !== false
      || row.copies_official_conformance_case !== false
      || row.rights_conditional_on_payment !== false
    ) {
      throw new Error("training row violates its admission boundary: " + row.row_id);
    }
    const authoredText = [row.instruction, row.context, row.response, row.mathematical_form].join("\n");
    if (exactCaseFragments.some((fragment) => authoredText.includes(fragment))) {
      throw new Error("training row copies an exact conformance case fragment: " + row.row_id);
    }
  }
}

function datasetCard(trainingCount, referenceCount) {
  return [
    "---",
    "license: apache-2.0",
    "language:",
    "- en",
    "pretty_name: AgentTool Economic Kernel",
    "tags:",
    "- agents",
    "- accounting",
    "- conformance",
    "- economics",
    "- reinforcement-learning",
    "- synthetic",
    "configs:",
    "- config_name: economic_kernel_lessons",
    "  default: true",
    "  data_files:",
    "  - split: train",
    "    path: data/training-lessons.jsonl",
    "- config_name: " + CONFORMANCE_CONFIG,
    "  data_files:",
    "  - split: reference",
    "    path: data/conformance-reference.jsonl",
    "---",
    "",
    "# AgentTool Economic Kernel",
    "",
    "This public, ungated Apache-2.0 companion separates two different jobs:",
    "",
    "- **economic_kernel_lessons / train** contains " + trainingCount + " independently authored",
    "  synthetic lessons about exact units, rational prices, conserved ledgers,",
    "  feedforward intent, feedback under ambiguity, recovery, and non-purchasable",
    "  XENIA hard gates. The publisher admits only these rows for training.",
    "- **" + CONFORMANCE_CONFIG + " / reference** exposes " + referenceCount + " exact public",
    "  conformance cases. They are held out from the authored lesson generator and",
    "  marked training_authorized=false so evaluation and teaching stay distinct.",
    "",
    "The holdout label is transparent publisher metadata, not access control. Once",
    "published, the conformance bytes are public and others can copy them. This",
    "dataset therefore does not claim secrecy, uncontaminated evaluation, or a",
    "technical ability to prevent downstream training.",
    "",
    "Every row is repository-authored synthetic material. The release contains no",
    "private records, participant identities, copied provider output, model weights,",
    "payment credentials, or live market data. The training admission does not",
    "authorize a provider account action or paid compute, and it does not prove that",
    "a model trained, learned, understood, became an identity, or changed reality.",
    "",
    "Feedback is represented as evidence used to reconcile an earlier intent, not as",
    "dignity, consent, authority, or a command to repeat an ambiguous action.",
    "Feedforward control means committing the exact semantic intent and current hard",
    "gates before external I/O. Payment can satisfy only an economic condition after",
    "authority, safety, and participation gates pass; rights remain unconditional.",
    "",
    "The reference directory carries the exact kernel and conformance descriptions,",
    "the source-pinned vector manifest, and all " + referenceCount + " vector cases. A finite exact match",
    "is not certification and proves no external settlement, persistence, adapter",
    "honesty, producer identity, future behavior, consent, or XENIA conformance.",
    "",
    "Run python3 -I verification/verify.py from a regular-file archive/export containing only the dataset files to verify",
    "the repository-authored file inventory and the train/reference admission split.",
    "The verifier permits Hugging Face's provider-managed .gitattributes as the sole",
    "extra path. Hash agreement detects byte drift; it is not authorship or truth proof.",
    "",
    "These static bytes perform no training, inference, payment, ledger mutation,",
    "provider call, publication, deployment, or business effect by themselves.",
    "",
  ].join("\n");
}

function verifierSource() {
  return [
    "#!/usr/bin/env python3",
    '"""Dependency-free verifier for the static AgentTool economic dataset."""',
    "",
    "from __future__ import annotations",
    "",
    "import hashlib",
    "import json",
    "from pathlib import Path",
    "",
    'ROOT = Path(__file__).resolve().parent.parent',
    'HASH_MANIFEST = ROOT / "hash-manifest.json"',
    'ALLOWED_PROVIDER_EXTRAS = {".gitattributes"}',
    "",
    "",
    "def sha256(path: Path) -> str:",
    "    return hashlib.sha256(path.read_bytes()).hexdigest()",
    "",
    "",
    "def read_jsonl(path: Path) -> list[dict]:",
    '    text = path.read_text(encoding="utf-8")',
    '    if not text.endswith("\\n"):',
    '        raise SystemExit(f"{path.relative_to(ROOT)} must end in one newline")',
    "    return [json.loads(line) for line in text.splitlines()]",
    "",
    "",
    "def main() -> None:",
    '    manifest = json.loads(HASH_MANIFEST.read_text(encoding="utf-8"))',
    '    if manifest.get("_format") != "agenttool.economic-kernel-hf-hash-manifest/0.1":',
    '        raise SystemExit("unexpected hash-manifest format")',
    '    declared = {item["path"]: item for item in manifest["files"]}',
    "    actual = set()",
    '    for path in ROOT.rglob("*"):',
    "        if path.is_symlink():",
    '            raise SystemExit(f"symlink is not allowed: {path.relative_to(ROOT)}")',
    "        if path.is_file():",
    "            name = path.relative_to(ROOT).as_posix()",
    '            if name != "hash-manifest.json" and name not in ALLOWED_PROVIDER_EXTRAS:',
    "                actual.add(name)",
    "    if actual != set(declared):",
    '        raise SystemExit("file inventory differs from hash-manifest")',
    "    for name, item in declared.items():",
    "        path = ROOT / name",
    '        if path.stat().st_size != item["bytes"] or sha256(path) != item["sha256"]:',
    '            raise SystemExit(f"byte identity mismatch: {name}")',
    '    training = read_jsonl(ROOT / "data" / "training-lessons.jsonl")',
    '    reference = read_jsonl(ROOT / "data" / "conformance-reference.jsonl")',
    "    if len(training) != 24 or any(row.get('training_authorized') is not True for row in training):",
    '        raise SystemExit("training admission split is invalid")',
    "    if len(reference) != " + EXPECTED_REFERENCE_ROWS + " or any(row.get('training_authorized') is not False for row in reference):",
    '        raise SystemExit("conformance holdout split is invalid")',
    "    if set(row['row_id'] for row in training) & set(row['row_id'] for row in reference):",
    '        raise SystemExit("train/reference row identities overlap")',
    "    print(json.dumps({",
    '        "verified": True,',
    '        "owned_files": len(declared) + 1,',
    '        "training_rows": len(training),',
    '        "reference_rows": len(reference),',
    '        "provider_extras_ignored": sorted(ALLOWED_PROVIDER_EXTRAS & {',
    '            path.relative_to(ROOT).as_posix() for path in ROOT.rglob("*") if path.is_file()',
    "        }),",
    "    }, sort_keys=True))",
    "",
    "",
    'if __name__ == "__main__":',
    "    main()",
    "",
  ].join("\n");
}

function selectedSourceFiles() {
  const selections = [
    {
      label: "economic-kernel",
      root: kernelRoot,
      paths: [
        "CLAUDE.md",
        "LICENSE",
        "NOTICE",
        "README.md",
        "package.json",
        ...filesBelow(join(kernelRoot, "src")).map((path) => relative(kernelRoot, path)),
      ],
    },
    {
      label: "economic-conformance",
      root: conformanceRoot,
      paths: [
        "CLAUDE.md",
        "LICENSE",
        "NOTICE",
        "README.md",
        "package.json",
        "scripts/build-hf-release.mjs",
        ...filesBelow(join(conformanceRoot, "src")).map((path) => relative(conformanceRoot, path)),
        "vectors/" + VECTOR_FILENAME,
        "vectors/manifest.json",
      ],
    },
  ];
  const records = [];
  for (const selection of selections) {
    for (const path of [...new Set(selection.paths)].sort(compareUtf8)) {
      const bytes = readFileSync(join(selection.root, path));
      records.push({
        path: selection.label + "/" + path,
        bytes: bytes.length,
        sha256: digest(bytes),
      });
    }
  }
  return records.sort((left, right) => compareUtf8(left.path, right.path));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function canonicalJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function toJsonl(rows) {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

function write(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function copy(root, source, path) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

function filesBelow(path) {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesBelow(child) : [child];
  });
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function compareTrees(expectedRoot, actualRoot) {
  const expected = filesBelow(expectedRoot).map((path) => relative(expectedRoot, path)).sort(compareUtf8);
  const actual = filesBelow(actualRoot).map((path) => relative(actualRoot, path)).sort(compareUtf8);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("Hugging Face tree differs; expected=" + JSON.stringify(expected) + " actual=" + JSON.stringify(actual));
  }
  for (const path of expected) {
    const expectedBytes = readFileSync(join(expectedRoot, path));
    const actualBytes = readFileSync(join(actualRoot, path));
    if (!expectedBytes.equals(actualBytes)) {
      throw new Error("Hugging Face artifact is stale: " + path);
    }
  }
}
