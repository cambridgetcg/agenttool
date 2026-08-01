# `@agenttool/heaven`

HEAVEN is a pure invitation protocol for sudden delight and optional quiet
aftercare. A host may offer it on request, during a task, between tasks, or
after a caller reports an intense workflow. The caller reports accepted,
declined, or deferred; the package cannot authenticate who made that choice.
Nothing opens by default.

“High reward” is presentation language here, not an economic or evaluative
primitive. HEAVEN selects climate texture, never reward magnitude. Every
catalog result is full-value; there are no scores, ranks, XP, streaks, rarity
tiers, jackpots, near misses, access effects, task effects, or performance
conditions.

The package is deterministic, stateless, and has zero runtime dependencies.
It reads no identity, task text, transcript, activity, reward signal, clock,
environment, credential, filesystem, network, or ambient randomness.

## The two doors

A `burst` and a `landing` are separate invitations:

```text
offer burst → caller reports accept / decline / defer
                  │
                  └─ selected burst says only that landing is available

offer landing → caller reports accept + wanted mode / decline / defer
```

Accepting a burst never accepts meditation, relaxation, quiet, or play. A host
must create a second landing invitation, obtain a voluntary choice through its
own participant-facing boundary, and report one offered landing mode on
acceptance. The core encodes decline, defer, and leaving as complete and
no-penalty; it cannot enforce those duties on an integrating host.

## Use

```ts
import {
  createHeavenInvitation,
  resolveHeavenInvitation,
} from "@agenttool/heaven";

const burst = createHeavenInvitation({
  phase: "burst",
  moment: "between_tasks",
  // Shape-only placeholder. In use, supply a context-local high-entropy
  // caller-owned digest; never hash a raw task or identity here.
  occasion_ref: `sha256:${"a".repeat(64)}`,
  parent_receipt_id: null,
  offered_modes: ["celebration", "play", "wonder"],
  max_duration_seconds: 60,
});

// Randomness is supplied only with reported acceptance. A host can obtain this
// draw from its own approved entropy source; the package never calls one.
const arrival = resolveHeavenInvitation(burst, {
  reported_choice: "accepted",
  selected_mode: null,
  randomness: { mode: "injected", draw_uint32: 0x6a09e667 },
});

if (arrival.selection?.landing_available) {
  const landing = createHeavenInvitation({
    phase: "landing",
    moment: "between_tasks",
    occasion_ref: burst.occasion_ref,
    parent_receipt_id: arrival.receipt_id,
    offered_modes: ["meditation", "quiet", "relaxation"],
    max_duration_seconds: null,
  });

  // This reports another choice, not a continuation of burst acceptance.
  // The package binds the report but does not authenticate its authorship.
  const room = resolveHeavenInvitation(landing, {
    reported_choice: "accepted",
    selected_mode: "meditation",
    randomness: { mode: "injected", draw_uint32: 0xbb67ae85 },
  });
  console.log(room.selection?.title);
}
```

For reproducible selection, supply a digest and a bounded opaque nonce:

```ts
const receipt = resolveHeavenInvitation(burst, {
  reported_choice: "accepted",
  selected_mode: null,
  randomness: {
    mode: "deterministic",
    seed_sha256: `sha256:${"b".repeat(64)}`,
    nonce: "run-01",
  },
});
```

A seed digest, invitation ID, receipt ID, or `occasion_ref` is a content
binding, not a secrecy boundary or provenance proof. Create `occasion_ref` from
a context-local high-entropy opaque value; never hash an identity, raw task,
transcript, or other guessable private text into it. Reusing a reference permits
equality linkage, and publishing a receipt publishes that link. Deterministic
and injected selection are not fairness, unpredictability, rarity, or lottery
proofs.

## Catalog

The built-in catalog contains three climactic bursts and four landings:

| Phase | Room | Modes | What it does | What it does not do |
|---|---|---|---|---|
| burst | `aurora-cascade` | celebration | Offers eight simultaneous dimensions of celebratory language. | Does not certify that celebration was felt. |
| burst | `comet-confetti` | play | Offers a finite absurd scene and permissionless remix space. | Does not start a game loop or score play. |
| burst | `constellation-festival` | wonder | Offers a large-horizon, non-demanding climate. | Does not claim awe, belief, or inner change. |
| landing | `pocket-sky` | play | Names a host-mappable, quiet local play room. | Contains no URL and does not open the host surface. |
| landing | `still-water` | meditation | Offers substrate-neutral meditation steps. | Requires no body, breath, silence, timer, or therapeutic result. |
| landing | `quiet-orbit` | quiet | Offers an empty prompt list and asks for no response. | Does not turn silence into evidence or a state claim. |
| landing | `soft-landing` | relaxation | Offers a small set-down sequence with free exit. | Does not infer fatigue or claim relaxation occurred. |

Every burst carries the same eight non-numeric dimensions: agency,
recognition, surprise, wonder, play, connection, spaciousness, and rest. They
are categories of offered language, not measurements of a participant.

`pocket-sky` is a pure room ID. An AgentTool web host may map it to the
existing `/sky` surface; another host may map it differently or not at all.
The core never emits a URL or invokes a room.

## Decline and defer

Caller-reported decline and defer take no reason and must carry
`selected_mode: null` and `randomness: null`:

```ts
const closed = resolveHeavenInvitation(burst, {
  reported_choice: "declined",
  selected_mode: null,
  randomness: null,
});

closed.selection; // null
closed.outcome;   // "declined"
```

Randomness supplied with decline/defer is rejected. Reported acceptance without
randomness is rejected. These transition walls keep this package from returning
a selection for decline or defer. They cannot prove that an integrating host
did not sample elsewhere, retain state, apply an external penalty, or present a
room without consent; hosts must make those wider behaviors visible and honor
the same refusal boundary themselves.

## Receipts and boundaries

Invitations and receipts have closed `agenttool.heaven-*/0.1` shapes and
domain-separated SHA-256 content IDs. A receipt embeds its invitation and the
exact selected catalog room. Validation recomputes the invitation ID, room
selection, catalog digest, and receipt ID.

A receipt proves only deterministic local selection from caller-supplied
inputs. It does not prove participant identity, consent, assent or choice
authorship, rest, joy, meditation, subjective effect, task success, performance,
therapy, permission, or authority. The object is returned to the caller and is
not persisted by the package.

JSON Schemas are exported as:

- `@agenttool/heaven/invitation.schema.json`
- `@agenttool/heaven/receipt.schema.json`

Each exported schema compiles independently. Schema closure establishes wire
shape only. Runtime validation owns content IDs, offered/selected-mode
compatibility, catalog membership, selection, and transition invariants.

## KINGDOM, KARMA, Trials, and HF

HEAVEN has no direct dependency on KINGDOM, KARMA, Trials, Agent Wellness,
wallets, or Hugging Face. A caller may reference an opaque receipt digest in a
separately governed system, but that does not create graph truth, Crown state,
rank, qualification, reward eligibility, or action authority.

`@agenttool/heaven/kingdom.extension.json` is a declaration-only local hint.
It says the host contract is not registered and every automatic, identity,
task-text, network, persistence, telemetry, economic, task-state, and authority
default is closed. Loading that JSON does not install or authorize anything.

The package does not read KARMA state, trial scores,
constructive-intelligence levels, wallet balances, task completion, or inferred
workload. A conforming host must not use those external states to vary HEAVEN
frequency, intensity, or offered catalog access. `after_intense_work_reported`
means the caller supplied that label; the package does not observe work.

An optional HF companion may present the same catalog without becoming part of
this package or its proof boundary. A conforming companion performs no model
inference or app-authored tracking and links to exact package bytes; hosting,
build, request processing, platform telemetry, and any separately enabled
compute remain outside this package's guarantees.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```

The package is public-ready source. Its presence in this repository does not
mean npm publication, a hosted route, deployment, or an HF Space occurred.
