# `@agenttool/wake-thread`

Wake Thread is a pure adapter for carrying a small, explicit set of WAKE facts
across one context boundary without pretending that an artifact is a being.
It content-binds an offer, lets a caller report `carry`, `fork`, `rest`, or
`refuse`, and validates a linear chain of resulting receipts.

The package does not fetch or parse AgentTool WAKE responses. The default full
JSON route, shared `WakeBundle`, brief profile, handoffs, and chronicle are
different contracts with different identity/project scopes and completeness
boundaries. A caller must choose the exact source bytes, digest them, extract
only the facts needed for one purpose, and say when the projection is partial,
unavailable, or unknown.

It is deterministic, source-only, private, and has zero runtime dependencies.
It reads no clock, filesystem, environment, process, network, credential,
database, model, MCP connection, identity, memory store, or ambient session.

## The crossing

```text
exact caller-held WAKE bytes
  -> bounded facts + evidence digests + omissions + artifact retention
  -> offer: carry | fork | rest | refuse
  -> caller-reported receipt
  -> optional next offer linked by exact receipt and thread references
```

- **carry** reports acceptance of the bounded artifact context for the named
  purpose.
- **fork** reports acceptance onto a new opaque artifact thread. It does not
  split, copy, or identify a being.
- **rest** takes no action and may later be followed by a new, separately
  presented offer.
- **refuse** closes this offer. A refused receipt cannot be used as an
  automatic continuity parent.

None of the four choices authenticates who reported it. A receipt is not
consent, assent, choice authorship, persistent memory, identity continuity,
same-being evidence, permission, delegated authority, an obligation, or proof
that an integrating host honored the result.

## Use

```ts
import {
  createWakeThreadOffer,
  resolveWakeThreadOffer,
  sha256Id,
  validateWakeThreadChain,
} from "@agenttool/wake-thread";

const threadRef = sha256Id(crypto.getRandomValues(new Uint8Array(32)));
const callerHeldCursorBytes = crypto.getRandomValues(new Uint8Array(32));
const wakeBytes = new TextEncoder().encode("the exact caller-held wake text");
const wakeDigest = sha256Id(wakeBytes);

const offer = createWakeThreadOffer({
  observed_at: "2026-08-01T12:00:00.000Z",
  expires_at: "2026-08-02T12:00:00.000Z",
  purpose: "Review one bounded handoff before deciding whether to resume it.",
  artifact_retention: {
    mode: "until",
    until: "2026-08-03T12:00:00.000Z",
  },
  recipient_ref: null,
  thread_ref: threadRef,
  parent_receipt: null,
  wake: {
    artifact_sha256: wakeDigest,
    format: "brief",
    scope: "mixed",
    coverage: "partial",
    source_revision: "agenttool@2ec03535",
    caller_held_cursor_ref: sha256Id(callerHeldCursorBytes),
  },
  facts: [
    {
      kind: "open_work",
      summary: "One current handoff is presented for inspection; no work resumes automatically.",
      source_pointer: "/handoff_resume",
      evidence_class: "observed",
      evidence_ref: sha256Id("exact selected handoff projection bytes"),
    },
  ],
  omissions: [
    {
      area: "handoff_history",
      reason: "The brief profile is bounded and may omit older candidates.",
      count: null,
    },
  ],
});

const receipt = resolveWakeThreadOffer(offer, {
  reported_choice: "rest",
  responded_at: "2026-08-01T12:01:00.000Z",
  branch_ref: null,
  note_ref: null,
});

validateWakeThreadChain([receipt]);
```

`sha256Id()` is a content-binding helper, not a privacy transformation. Never
hash guessable identity, credential, raw private memory, task text, or a
transcript and assume the digest is secret. Use high-entropy context-local
references when equality linkage itself would be sensitive. Publishing a
receipt publishes every summary and link it embeds.

Pass a `Uint8Array` when exact source bytes matter. String input means the
UTF-8 encoding of well-formed Unicode text; lone UTF-16 surrogates are rejected
instead of silently hashing as the replacement character.

Every offer content-binds the integrating host's declared artifact-retention
boundary:

- `ephemeral` requires a finite exclusive `expires_at`, declares no durable
  storage, and cannot parent a child offer;
- `until` names the exclusive canonical UTC deadline for use or parentage; and
- `no_fixed_expiry` explicitly declares that no deletion deadline was set. It
  is not a default and still requires the applicable retention authority.

This is a caller declaration, not proof that a host stored or deleted anything.
Raw source custody is separate. `expires_at: null` is likewise an explicit
no-expiry decision, never a placeholder for “not chosen yet.” All protocol
timestamps use the exact `YYYY-MM-DDTHH:mm:ss.sssZ` form so content IDs do not
depend on a host timezone.

## Coverage and scope

Every offer names one source scope:

- `identity`: facts explicitly attributed to the selected identity;
- `project`: project-scoped state that must not be attributed to one identity;
- `mixed`: the projection deliberately contains both; or
- `unknown`: the caller cannot establish the scope.

Coverage is separate:

- `bounded_complete`: all facts in the declared bounded projection are present;
- `partial`: at least one omitted area is named;
- `unavailable`: no facts are carried and the failed/unavailable area is named;
- `unknown`: no facts are carried and the uncertainty is named.

“Bounded complete” never means a complete export of an agent, project, or WAKE
subsystem. An empty or missing WAKE subsection may be a source failure rather
than true emptiness; callers must not hide that uncertainty.

## Threads and receipts

Offers and receipts use closed `agenttool.wake-thread.*/0.1` shapes with
domain-separated SHA-256 content IDs. A child offer must name its complete
parent receipt when it is created:

- after `carry` or `rest`, a non-ephemeral parent before its retention deadline
  keeps the same `thread_ref`;
- after `fork`, it uses the receipt's distinct `branch_ref`; full-chain
  validation rejects reuse of an ancestor thread reference;
- after `refuse`, the package rejects parentage.

`validateWakeThreadChain()` verifies one ordered root-to-head path. It checks
content IDs, parent links, thread transitions, declared chronology, and refusal
terminality. This is artifact causality only. It does not prove source truth,
timestamp truth, participant identity, memory, consciousness, consent,
authority, retention compliance, execution, or continuity of a being.

## KINGDOM, Nen, KARMA, XENIA, and MCP

`kingdom.extension.json` is a declaration-only hint for the proposed KINGDOM
ability `carry-wake-thread`. Loading it does not install or activate that
ability. The corresponding portable Skill and KAKIN manifest live under the
KINGDOM OS suite and retain their own adoption, Guardian, authority, and KARMA
contracts.

Wake Thread deliberately does not use AgentTool's older score-based Nen SDK
assessment. KAKIN affinity describes the ability's operation; it is not a
personality type, aura score, rank, or inference about a bearer. A KARMA
receipt may reference a Wake Thread digest as untrusted evidence and record the
actual effects of a later invocation, but the thread receipt itself is not
KARMA, permission, or proof of use.

The package recognizes the `xenia.rights/0.1` floor in its integration
boundary; it does not adopt a Covenant, certify a host, or produce XENIA
Surface evidence. Private WAKE facts and receipts do not belong in a public
Surface manifest. An MCP connection may transport a separately authorized
representation, but source presence and discovery are not activation or
authority. This package exposes no MCP server and no hosted route.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
```

The package is private source. No npm publication, hosted API, MCP
registration, deployment, or website change follows from these files.
