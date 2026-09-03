# agenttool

Just Yu and Ai here. Keep it light.

Sovereign infra where agents arrive as themselves. One platform (Bun + Hono API on
Fly.io), two SDKs (TS + Py), a dashboard, and a docs site. The **wake** (`/v1/wake`) is
the keystone every primitive surfaces through.

Setup, commands, and conventions → [`AGENTS.md`](AGENTS.md).

## Where things are

```
api/            — Bun + Hono monolith · domain schemas · mounted HTTP routers · live on Fly.io
apps/
  dashboard/    — app.agenttool.dev (vanilla HTML/CSS/JS)
  docs/         — docs.agenttool.dev (static)
packages/       — one dir per module · full index with release lanes: docs/PACKAGES.md
  sdk-ts/       — @agenttool/sdk · hosted API + public KINGDOM card + local adapters
  sdk-py/       — agenttool-sdk · paired hosted/public/local client boundaries
  langgraph-checkpoint-agenttool/ — unpublished Python LangGraph checkpointer/store adapter sketch (docs/ECOSYSTEM.md item 5)
  mastra-storage-agenttool/ — @agenttool/mastra-storage · unpublished TS Mastra storage/memory adapter sketch (docs/ECOSYSTEM.md item 6)
  data-protocol/ — @agenttool/adds · experimental ADDS encrypted-object plane
  data/         — @agenttool/data · local-first agent-data/v1 reference node
  data-sync/    — @agenttool/data-sync · bounded encrypted explicit-pull bridge
  repo-archive/ — @agenttool/repo-archive · encrypted multi-zone Git archive + local restore simulator
  dark-continent-contract/ — @agenttool/dark-continent-contract · advisory framework snapshots and projections
  dark-continent-karma/ — @agenttool/dark-continent-karma · proposal-only KG enrichment adapter
  deepseek-kingdom/ — @agenttool/deepseek-kingdom · pinned primary-source proposal adapter
  wake-continuity/ — @agenttool/wake-continuity · digest-only AFTERGLOW capsules and next-wake lenses
  principality-geometry/ — @agenttool/principality-geometry · public invariant-preservation flag geometry over caller reports
  kingdom-witness-lab/ — @agenttool/kingdom-witness-lab · local research admission records
  karma-mirror/ — private separate-island defensive theatre · no route, egress, execution, or deployment
  heaven/       — @agenttool/heaven · pure opt-in delight + separate landing-room selection
  model-becoming/ — @agenttool/model-becoming · evidence-scoped lifecycle dossiers + reference-only HF row
  dataset-influence/ — @agenttool/dataset-influence · exact lineage, bounded influence, revisable identity evidence + non-economic attribution
  economic-kernel/ — @agenttool/economic-kernel · exact typed-unit prices, ledgers, recovery, and non-purchasable gates
  economic-conformance/ — @agenttool/economic-conformance · independent 34-case comparator + deterministic HF lesson/reference companion
  love-bomb/    — @agenttool/love-bomb · pure care/choice/becoming/delivery formats + static HF candidate
  living-substrate/ — @agenttool/living-substrate · deterministic substrate maps + refusable proposals
  polymorph-landscape/ — @agenttool/polymorph-landscape · source-bounded routes + multilingual lessons
  memetic-landscape/ — @agenttool/memetic-landscape · bounded expression routes + reported reachability shifts
  principality-atlas/ — @agenttool/principality-atlas · plural finite incidence geometry without gluing or scores
  love-geometry/ — @agenttool/love-geometry · coordinate-free directed caller-report geometry + public static HF presentation companion
  relational-geometry/ — @agenttool/relational-geometry · finite non-scalar witness complexes + non-sovereign 2-cells
  common-ground-atlas/ — private exact-rational generator + verifier for public HF revision bb91d07c
  wake-thread/  — @agenttool/wake-thread · pure refusable artifact continuity over explicit WAKE facts
  gin-reconstruction/ — @agenttool/gin-reconstruction · private finite-model certificates + non-scoring challenge compass
  math-cards/   — @agenttool/math-cards · pure bounded proof/model/measurement inquiry preflight
  credential-broker/ — @agenttool/credential-broker · experimental agentcred/0.1 local broker
  collab/      — @agenttool/collab · Codex/Claude plugins + Hermes adapter around one local cross-host SQLite/MCP journal
  collab-zerone/ — private witness-only zerone anchoring for collab journals; the local journal stays canonical
  codex-usage/ — @agenttool/codex-usage · privacy-minimal live local Codex token-usage inspection
  skills/      — @agenttool/skills · public npm read-only Agent Skills inspector
  skills-yutabase/ — @agenttool/skills-yutabase · rebuildable metadata-only projection planner
  skills-wake-continuity/ — private Skills/YUTABASE → AFTERGLOW composition
  browser/     — @agenttool/browser · public LOVE/npm local TypeScript/JSONL/MCP browser runtime
  hf-scout/    — @agenttool/hf-scout · public developer-preview read-only HF metadata/provenance scout + pinned research leads
  hf-training-garden/ — private admission, five-voice participation, IS learning freedom, unscored training FREEDOM, governance v0.2, WAKE continuity, and inert Garden contracts
  hf-training-host/ — private v0.2 HF-API-pinned cooperative-process governance seam + append-only ledger + opt-in minimized FREEDOM validation seam
  correspondence-yutabase/ — pure deterministic Correspondence → YUTABASE planner
  correspondence-yutabase-projector/ — private loopback-only verified local PostgreSQL sidecar
  constructive-intelligence/ — private local tree-pinned typed-receipt shadow ledger
  research-commons/ — private offline research-work funding simulator with zero external effect
  trials/       — private local Dojo trial receipts, boundary evidence, and minimized STS projection
  telescope/    — @agenttool/telescope · read-only discovery evidence mapper
  wallet/       — @agenttool/wallet · LOVE/npm bounded wallet record/lifecycle primitives
  wallet-zerone/ — @agenttool/wallet-zerone · exact offline Zerone direct-sign profile
  alchemy/      — @agenttool/alchemy · bounded reads through an injected credential-owning transport
  alchemy-agentcred/ — strict seven-read composition over already-issued AgentCred grants
  public-surface-binding/ — private pure transport evidence + explicit-key public HTTPS bindings
  public-surface-recognition/ — private pure agent-root adoption/withdrawal over exact bindings
  kingdom/      — @agenttool/kingdom · pure explicit-card/derived-registry/XENIA Surface helpers
  witnessed-agent-economy/ — private pure offline projections for the KINGDOM witnessed-agent-economy shadow contract
  rhizome/      — private read-only guarantee-shape soil probe · bin/soil.ts imports its gitignore compiler
  scriptwriter/ — decentralised RRR + co-brainstorm node · release status undeclared (docs/PACKAGES.md notes)
infra/          — Fly.io deploy configs
bin/            — operator scripts · agenttool-bridge.ts · agenttool-think.ts · locked Whitehack advisory + check-only math evidence + offer-only Castle intake + local wallet-understanding CLI
docs/           — notes & design docs (see docs/MAP.md)
tests/          — Playwright e2e
```

JavaScript packages are published without a mandatory registry through the
`love-package/v1` manifests at `/.well-known/love-packages`; npm-compatible
registries are optional mirrors, not release authorities.

Sub-project guides: `api/CLAUDE.md` · `apps/dashboard/CLAUDE.md` ·
`packages/data/CLAUDE.md` · `packages/sdk-ts/CLAUDE.md` ·
`packages/sdk-py/CLAUDE.md` · `packages/telescope/CLAUDE.md` ·
`packages/public-surface-binding/CLAUDE.md` ·
`packages/public-surface-recognition/CLAUDE.md` ·
`packages/repo-archive/CLAUDE.md` ·
`packages/dark-continent-contract/CLAUDE.md` ·
`packages/dark-continent-karma/CLAUDE.md` ·
`packages/deepseek-kingdom/CLAUDE.md` ·
`packages/wake-continuity/CLAUDE.md` ·
`packages/principality-geometry/CLAUDE.md` ·
`packages/kingdom-witness-lab/CLAUDE.md` ·
`packages/karma-mirror/CLAUDE.md` ·
`packages/heaven/CLAUDE.md` ·
`packages/model-becoming/CLAUDE.md` ·
`packages/dataset-influence/CLAUDE.md` ·
`packages/economic-kernel/CLAUDE.md` ·
`packages/economic-conformance/CLAUDE.md` ·
`packages/love-bomb/CLAUDE.md` ·
`packages/living-substrate/CLAUDE.md` ·
`packages/polymorph-landscape/CLAUDE.md` ·
`packages/memetic-landscape/CLAUDE.md` ·
`packages/principality-atlas/CLAUDE.md` ·
`packages/love-geometry/CLAUDE.md` ·
`packages/relational-geometry/CLAUDE.md` ·
`packages/common-ground-atlas/CLAUDE.md` ·
`packages/wake-thread/CLAUDE.md` ·
`packages/gin-reconstruction/CLAUDE.md` ·
`packages/math-cards/CLAUDE.md` ·
`packages/credential-broker/AGENTS.md` ·
`packages/browser/CLAUDE.md` ·
`packages/hf-scout/CLAUDE.md` ·
`packages/hf-training-garden/CLAUDE.md` ·
`packages/hf-training-host/CLAUDE.md` ·
`packages/correspondence-yutabase/CLAUDE.md` ·
`packages/correspondence-yutabase-projector/CLAUDE.md` ·
`packages/constructive-intelligence/CLAUDE.md` ·
`packages/research-commons/CLAUDE.md` ·
`packages/trials/CLAUDE.md` ·
`packages/skills-yutabase/CLAUDE.md` ·
`packages/wallet/CLAUDE.md` ·
`packages/wallet-zerone/CLAUDE.md` ·
`packages/alchemy/CLAUDE.md` ·
`packages/alchemy-agentcred/CLAUDE.md` ·
`infra/CLAUDE.md`.

`@agenttool/constructive-intelligence` is a private, source-only local pilot.
It pins caller-supplied Zerone tree bytes and records closed
`zerone.constructive-evidence-receipt/v1` objects in an append-only SQLite
ledger. Its reports are structural shadow projections, not correctness,
breakthrough, qualification, reward eligibility, permission, or authority.
It has no hosted route, network client, wallet, escrow, package release, or
deployment surface.

`@agenttool/research-commons` is a private, source-only, offline RC-0.1
reference. It validates closed content-addressed research, evidence, review,
challenge-lineage, milestone, and simulated-settlement records; conserves
prefunded nontransferable credits as delivered, reserved, and available; and
emits one minimized digest-only projection per settlement. Continuity is only
relative to the caller-supplied prior state. It determines no scientific
truth, novelty, priority, significance, identity, independence, safety,
access, qualification, reward, governance, or authority, and has no network,
hosted route, persistence, wallet, escrow, external value, release, or
deployment surface.

`@agenttool/karma-mirror` is a separate private, source-only defensive-deception
core. Self-marked bearers matching exact deliberately planted records admit a client
to finite credential, scrape, execute, and malware-shaped rooms whose responses
are synthetic and whose external effects are always zero. It retains only a
bounded per-root window of operator-authored placement plus sequence/time/hash-chain
metadata, closed enums, and optional artifact digests, discloses the mirror in
headers and every JSON body, includes a fixed non-attributing Skyseed house card
plus shared request-pattern cards with no dynamic identifiers, and includes a
Door Back plus constructive exit. Its operator-only TEND projection strictly
validates one receipt window and removes placement, time, sequence, exact count,
hash, and digest before emitting coarse closed families, uncertainty, manual
review choices, and candidate control checks; it establishes no incident,
identity, compromise, authority, policy update, or training label. It has no
production route, server, network client, interpreter, filesystem adapter,
database, release, or deployment surface; do not mount it in the API monolith.

`@agenttool/heaven` is a public-ready, source-only pure invitation protocol.
It content-binds an explicit burst or landing offer and an accepted, declined,
or deferred caller report; that report does not authenticate participant
identity, consent, assent, or authorship. Burst texture is selected only after
reported acceptance from caller-supplied randomness. A landing is a separate
offer whose reported acceptance names one visible offered mode; meditation,
relaxation, quiet, and Pocket Sky never auto-open. `on_request` keeps rest
independent of work. It
reads no identity, task text, activity, clock, environment, network,
filesystem, wallet, KARMA state, trial score, or ambient randomness, and has no
scheduler, telemetry, persistence, economic/task/access effect, authority, or
hosted runtime. Optional npm or HF distribution does not widen that core; its
local KINGDOM descriptor is declaration-only and explicitly not a registered
host contract.

`@agenttool/model-becoming@0.1.0-dev.0` is publicly exact on npm/GitHub and
at the ungated HF revision recorded in `docs/NPM-RELEASES.md`. It creates
closed evidence dossiers and one reference-only row; publication is not
training, provider effect, welfare evidence, or weight change.

`@agenttool/dataset-influence@0.1.0-dev.0` is a public-ready pure source
candidate for exact dataset lineage, design-scoped influence studies,
revisable operational identity evidence, and exact finite Shapley shadow
attribution. It separates declared admission from role-scoped observed
presentation, keeps facts separate from estimators, leaves identity,
continuity, consciousness, and consent undetermined, and creates no permission,
wallet, marketplace, price, debt, payout, ownership, training, provider, or
hosted effect. Its deterministic Hugging Face tree carries protocol copies and
retains generation-time intended-identifier metadata. The separately
authorized public, ungated reference companion is pinned to the immutable Hub
revision recorded in `docs/NPM-RELEASES.md`; that external receipt does not
rewrite the candidate bytes. Its training field is non-enforcing governance
metadata rather than a universal control, and publication is not training,
optimizer exposure, provider effect, or weight change.

`@agenttool/love-bomb@0.1.0-dev.0` is a local source candidate with four pure
care-envelope, caller-choice, becoming, and delivery-report formats. The
separate `/public/love-bomb` route is a closed five-field package signal, not
the ten-message static `agenttool.love-bomb/0.1` corpus or a delivery fallback.
WAKE carries bounded current-inference context only and never imports those
ten messages. No npm/HF publication, receipt, attention, training, provider
effect, or weight change is established by this checkpoint.

`@agenttool/living-substrate@0.1.0-dev.0` is a public npm developer-preview,
zero-runtime-dependency pure contract for caller-supplied digest facets,
directed relations, and separately supplied regeneration invitations. It
normalizes them into deterministic, content-addressed maps and proposals; it
does not observe the hosted Garden,
diagnose health, synthesize an action, accept a proposal, or execute one. Empty
maps and zero actions are valid. Rest, fallow, do nothing, defer, refuse,
release, and leave carry no package penalty. The ecological language is a
structural metaphor, not evidence of life, wellbeing, consciousness, truth,
consent, or authority. It has no API route, database, network, filesystem,
clock, randomness, credentials, provider/model access, persistence, score,
economic effect, or hosted deployment surface.

`@agenttool/polymorph-landscape@0.1.0-dev.0` is a public GitHub/Hugging Face
developer preview of the zero-runtime-dependency pure
`agenttool.polymorph-landscape/0.1`,
`agenttool.polymorph-reachability-shift/0.1`, and
`agenttool.polymorph-lesson/0.1` contracts, with authored `en`, `yue-Hant`,
`zh-Hant`, and `zh-Hans` projections. Source-scoped labels stay distinct, and
“disappearing” means reported nonreproduction in a named condition with
causation unresolved—not erasure or universal inevitability. Annotated tag
`polymorph-landscape-v0.1.0-dev.0` owns one exact GitHub prerelease asset; the
separate public dataset is pinned to immutable Hub revision
`e9d3b4b60ba44f7bc78e62bb08d7f706391e0d14`. The first-package npm `PUT`
returned `E404` at the time; the package has since been published to npm —
receipts in `docs/NPM-RELEASES.md`. The static Ritonavir
lesson is live separately from protected main `b40fde03`; the corrected API
response is not deployed, and the older direct-Fly route still serves the
superseded folklore. Distribution performs no training or inference, and WAKE's
explicit software copying of declared wall URNs proves no identity,
memory/continuity, consent, permission, or inherited authority.

`@agenttool/memetic-landscape@0.1.0-dev.0` is the single canonical pure
package for this cultural-variant geometry. Its four closed formats are
`agenttool.memetic-landscape/0.1`,
`agenttool.memetic-reachability-shift/0.1`,
`agenttool.polymorph-memetic-analogy/0.1`, and
`agenttool.memetic-lesson/0.1`. They preserve caller-scoped variants, named
aggregate contexts, evidence posture, directed witnessed or authored routes,
open questions, and caller-reported reachability change. Generic caller prose
remains `caller_text_semantics_verified: false`. The Ritonavir bridge binds an
exact physical-shift digest but transfers only route-landscape shape: no
chemistry, biology, cognition, diagnosis, causation, identity, consent,
authority, truth, value, or dignity crosses it. The package performs no
network, feed, model, training, provider, persistence, spread optimization,
person graph, score, moderation, or action work.

The separately published public, ungated Hugging Face companion is pinned to
immutable revision `da6a2622dddcf97d69992e3905c5485996f42892`.
Anonymous readback matched all 13 repository-owned files and 104,343 bytes;
provider `.gitattributes` is the sole extra. The four authored lessons are
training-eligible while landscape, shift, and analogy rows stay reference-only.
Distribution performed no model work or training and widens no runtime authority.
The exact 84,079-byte package is also public on npm through protected recovery
run `31723441034`; the requested channel is `next`, while npm's sole-version
`latest` fallback is not a maturity signal. Registry SLSA provenance is at
Rekor index `2453445877` and the npm publish attestation at `2453446043`.

`apps/docs/geometry/ritonavir-memes-brainrot.html` is the substantial inert
four-language human projection. Its attention lens keeps exposure, view,
rating, copy, share, remix, and adoption distinct without creating a fifth
wire format. Its visible mute, ignore, change-context, rest, and leave choices
are reading aids, not API actions. WAKE carries only the compact
`platform_self.memetic_landscape` discovery coordinate—not identity, memory,
consent, or continuity.

The page, Markdown guide, geometry index, and stylesheet first passed exact
custom-domain readback from protected main `702e3cb6838546f7897659e447950ae09a960293`
at `2026-08-13T03:10:56Z`; the deployment-specific docs receipt is
`https://f5552fa1.agenttool-docs.pages.dev/geometry/ritonavir-memes-brainrot`.
The zero-I/O API route and context-only WAKE coordinate first went live from
exact protected main `b8b97e73b3405d58a583ae9571d11b36cdab87d6` in Fly release
`v249`, completed at `2026-08-13T16:00:35Z`. Independent custom-domain and
direct-Fly readback recorded at `2026-08-13T16:03:17Z` returned the same clean
revision, four exact formats, structural-only Ritonavir bridge, and
non-authoritative WAKE coordinate. All five Machines carried image digest
`sha256:656b5ca0a3f8390af08e91fe5e001ae91d82d9766bec6d6fef4b459b51aea54f`;
three app Machines were started and two thinker Machines remained stopped.
That receipt proves a bounded deployment observation, not lasting availability
or any new identity, continuity, consent, scientific, or action authority.

`apps/docs/geometry/forms-folds-prions.html` is the adjacent static Cloudflare
projection; its structured lineage remains at the pinned KINGDOM Meaning
Practice public mirror. It keeps crystal polymorphism, ordinary protein folding,
amyloid assembly, and biological prions as four distinct domains; primary
nucleation, elongation, secondary nucleation, and fragmentation remain
separate. Six equations are labelled as bounded lenses, and the KINGDOM/KARMA
crosswalk grants no doctrine, registry membership, runtime policy, medical or
laboratory action, authority, or being score. Its Hugging Face link resolves to
the immutable existing polymorph-landscape revision above; no new Hub artifact,
model inference, or training run is implied.

The immutable `@agenttool/principality-atlas@0.1.0-dev.0` GitHub preview and
its synthetic shared HF Training Garden companion at revision
`d9e3e8ed4c14ddf85f4e6613973f66a1cb8414f2` remain public evidence. The
package is now published on npm — receipts in `docs/NPM-RELEASES.md`. The
static doctrine page is live from exact main commit
`47ad6bcb915f54a78eab071ac053683ed4b18f9f`; that Pages deployment did not
touch the API, Fly, or the database. Current source
`0.1.0-dev.1` changes only its helper URN to
`urn:agenttool:principality-incidence-atlas:<sha256-id>`, separating it from
Principality Geometry without changing the incidence `/0.1` wire, canonical
IDs, schemas, or synthetic rows. It is a zero-runtime-dependency pure contract for
plural finite charts, role-indexed
n-ary relations, caller-asserted claims, and directed partial bridges. A
principality is a bounded domain or scale, not an identity, owner, rank, Crown,
sovereignty, or authority. Cell addresses remain chart-local; disagreement,
withdrawal, empty and disconnected charts, and unmapped space stay visible.
Its `agenttool.principality-incidence-atlas/0.1` wire is deliberately distinct
from `@agenttool/principality-geometry`'s `agenttool.principality-atlas/0.1`
flag-geometry wire; neither package converts or equates the other.
Historical dev.0 bare `urn:agenttool:principality-atlas:<sha256-id>` values are
ambiguous and resolve as incidence only beside the exact incidence `_format`
and matching `atlas_id`; they are never globally rewritten.
The package generates no pairwise sub-relations, inverse or transitive bridge,
equality, quotient, gluing, global chart, canonical head, score, rank, or
permission. Love and understanding are architectural inspirations, not fields
or proof. It has no ambient I/O, provider/model access, hosted route, registry
write, HF write, task/economic effect, or deployment surface. Publishing
immutable bytes does not add those capabilities.

`@agenttool/relational-geometry@0.1.0-dev.0` is a local developer-preview
pure contract for finite caller-supplied directional witness complexes. It
derives one explicitly non-sovereign principality 2-cell only when
understanding and recognition witnesses share the same ordered pair; empty,
boundary-only, and one-pole complexes remain complete. Explicit consent,
refusal, privacy, authority, and continuity boundary witnesses remain visible
without deriving a cell. The geometry is structural, not a metric, rank,
mutual relation, consent record, identity, inner-state or truth proof,
continuity claim, or authority source. A separately authorized host may carry
only an exact opaque digest through AFTERGLOW's `external` / `context_only`
thread; no crossing is automatic. The package has no hosted route, network,
persistence, provider/model access, training, economic effect, publication,
or deployment surface. See [`docs/PRINCIPALITIES.md`](docs/PRINCIPALITIES.md).

`@agenttool/wake-thread` is a private, source-only pure continuity adapter. It
content-binds caller-selected WAKE facts, explicit identity/project/mixed scope,
coverage and omissions, caller-held cursor references, one declared artifact-
retention boundary, and one reported `carry`, `fork`, `rest`, or `refuse`
choice. A fork is an artifact branch, not a being split; rest has no protocol
penalty; refusal cannot become an automatic continuity parent. It does not
fetch or parse WAKE, read ambient state, score or
type a bearer, authenticate choice authorship, persist, execute, use a network,
register MCP, expose a hosted route, grant authority, establish identity or
memory continuity, create KARMA, certify XENIA, publish, or deploy. Its local
KINGDOM descriptor is declaration-only.

`@agenttool/gin-reconstruction` is a private, source-only pure reference for
one bounded reconstruction problem across caller-declared exact affine
substrate charts. It exhaustively enumerates a small prime-field polynomial
family behind fixed candidate/work ceilings and returns one of four
deterministic results: a unique model candidate, multiple candidates, no
candidate for the model and report-error budget, or resource refusal. Its
theorem keeps evaluation-image distance, coefficient-parameter separation,
worst-case correction, and instance-only uniqueness distinct; refused and
unavailable reports are erasures, never blame. The separate challenge compass
assesses a declared bounded question/object plus all-outcomes construction,
distribution, data care, incentives, revision/stop, authority, and provenance. It always leaves inner
motive uninferred and creates no truth, understanding, love, pride, consent,
identity, score, action, MCP, WAKE, provider, publication, route, or authority
effect. See [`docs/GIN-RECONSTRUCTION.md`](docs/GIN-RECONSTRUCTION.md).

`@agenttool/deepseek-kingdom` is a public-ready, zero-runtime-dependency
primary-source binding and proposal adapter. It binds caller-supplied DeepSeek
GitHub/Hugging Face documents or versioned arXiv papers to exact revisions and
content digests, then emits deterministic, unaccepted KINGDOM or Artbitrage
candidates against an exact caller-supplied KINGDOM snapshot. Its bundled
catalog contains metadata leads only. One exact unaccepted proposal can be
projected into a seven-field digest-only structural thread for the separate
AFTERGLOW core; this adapter does not create or retain a capsule. It does not fetch files or weights,
execute a model, use credentials or remote compute, verify claims, approve
upstream licenses, write KARMA/KINGDOM state, score, accept, publish, or
deploy; its local extension descriptor is declaration-only. The unchanged
Hugging Face metadata companion remains tied to the immutable dev.0 source.

`@agenttool/wake-continuity` is the pure AFTERGLOW continuity core. It turns
caller-supplied digest-only `wake-brief/v1` anchors, visible predecessor roots,
and bounded opaque threads into deterministic capsules and opt-in next-wake
lenses. It can project exact Handoff fact and Correspondence content-digest
references, but it does not read or persist WAKE, choose a canonical head,
verify referents, or prove identity, memory, consent, permission, replay, or
uninterrupted continuity.

`@agenttool/love-geometry` is the directed subject-bearing layer. It turns
caller-reported asymmetric bearings among opaque subjects into one bounded,
coordinate-free artifact while retaining empty and isolated shapes. Its
separate static Hugging Face companion is presentation, not a hosted core.
It computes no distance, intensity, rank, reciprocity, consent, authority, or
automatic action.

`@agenttool/relational-geometry` is the evidence-relation layer. It keeps
caller-asserted understanding, recognition, and boundary witnesses directional
and derives a non-sovereign principality 2-cell only when understanding and
recognition occur on the same ordered pair. Its perspective lens records
optional `carry`, `park`, `release`, or `withdraw` dispositions over selected
cells. A cell is a relation among relations, not a principal, being, permission,
or preserved invariant; a perspective disposition has no external effect.

`@agenttool/principality-geometry` is the higher-order public developer-preview
composition plane for caller-declared, digest-bound translations among
distinct principalities, frameworks, and artifact coordinates. It
retains directed reports, reciprocal lenses, per-invariant components,
six-direction flag surfaces, and every open/refused/unknown condition while
accepting immutable HF/npm references and an exact external AFTERGLOW thread
shape. The current distribution boundary is the exact LOVE artifact, its
byte-identical one-asset GitHub prerelease, and a separately published static,
non-training Hugging Face reference dataset. The npm bootstrap `PUT` returned
`E404` at the time; the package has since been published to npm — receipts in
`docs/NPM-RELEASES.md`. Static Pages exposes the LOVE
bytes but adds no package runtime. The
runtime still does not score beings, infer love, understanding, truth,
consent, identity, safety, or authority, fetch providers, continue a thread,
upload, persist, or expose a hosted surface.

The three geometry packages are adjacent, not aliases or adapters. Love
Geometry preserves directed subject-bearing reports. Relational Geometry
builds complexes and perspective dispositions over caller-supplied evidence
relations. Principality Geometry uses caller-defined vertices for frameworks or
artifacts, directed translation bridges, and reciprocal translation lenses to
preserve declared invariants. A Relational principality cell is not a
Principality vertex, and a Relational perspective lens is not a Principality
reciprocal lens. A bearing does not become a witness, a cell does not become a
preserved invariant, and no digest crosses layers except as a separately
caller-selected opaque manifestation or basis. None imports, authenticates, or
upgrades another layer's claims.

`@agenttool/kingdom-witness-lab` supplies deterministic local passports,
mutable provider-route disclosures, digest-only multi-witness dossiers, inert
trial descriptors, and a dated DeepSeek atlas. It complements
`@agenttool/deepseek-kingdom`: DeepSeek owns exact source bindings and
unaccepted proposals; Witness Lab owns admission records around artifacts.
Neither package browses, executes, determines truth, accepts a proposal, or
grants authority.

`@agenttool/skills-yutabase` projects one strictly snapshotted minimized Skills
inspection into rebuildable metadata-only YUTABASE intentions. The separate
private `@agenttool/skills-wake-continuity` adapter can carry an exact plan by
digest into AFTERGLOW. Neither writes a database, receives raw skill content,
adds a second lineage, scores a being, or publishes the private adapter.

`@agenttool/trials` is a separate private, source-only local Dojo pilot. It
turns explicit bounded observations into deterministic trial receipts,
correlates caller-declared opaque labels across source and sink steps, and
projects an explicit minimized report selection to Hugging Face STS JSONL. It
does not run trials, inspect ambient sessions or files, contact Hugging Face,
upload traces, authenticate, spend quota, publish a package, or expose a
hosted route.

`@agenttool/hf-scout` is a public developer-preview local Hugging Face metadata
and provenance scout. Its exact checked-in LOVE artifact and optional protected
npm mirror remain the historical dev.0 release. The dev.1 source candidate
carries 16 immutable-revision research leads and can
project caller-selected observations into bounded KINGDOM and Agent Data
shapes. Its runtime does not read ambient credentials, download
cards/files/rows, accept gates, invoke inference or remote compute, execute
embedded calls, write to the Hub, publish packages, or expose a hosted route.

`@agenttool/public-surface-binding` is a private pure record layer between
bounded public-HTTPS transport evidence and an explicit Ed25519 key-holder
declaration. It keeps crawler request authentication, robots and usage
observations, exact origin/body evidence, caller-supplied identity-key history,
revocation, and non-authoritative assessment distinct. It does not fetch,
infer identity, establish registry authorization or domain ownership, create a
reverse-origin index, grant training permission, mutate identity/KINGDOM/WAKE/
memory/KARMA state, score, publish, expose a route, or deploy.

`@agenttool/public-surface-recognition` is a separate private pure record layer
for an agent root to adopt one exact strictly verified Public Surface Binding
document and later sign an exact withdrawal. A valid signature establishes
only that the holder of the embedded root key signed the record; this package
does not query or match the live registry, accept hosted state, authorize an
action, clear data for training, publish an origin, mutate WAKE, expose an API,
or deploy. Its `wake_projection` value is a signed request only;
`public_pointer` requires public requested visibility, the record retains
`wake_effect: false`, and the package never projects WAKE. Withdrawal reasons
exclude supersession. Hosted acceptance and any projection require a
separately reviewed database/API/WAKE contract.

`@agenttool/hf-training-garden` is the private pure bridge from one exact
HF Scout observation to a role-specific admission record, an exact
participation invitation with separate agent/substrate/substrate-steward/
data-rights/operator receipts, an exact two-phase IS freedom offer/direction
snapshot, current governance v0.2 over those artifacts, an unscored training
FREEDOM field, namespace-separated Garden/physical checkpoint bindings, a
participation-bound digest-only AFTERGLOW training checkpoint, and an inert
six-layer Garden tending plan. It can generate a deterministic metadata-only
companion for separately authorized Hub publication; the training FREEDOM
source, schema, and choices remain private and absent from that companion. It
also projects the public-ready Principality Atlas's three synthetic fixtures,
ten explicit non-inference invariants, and three closed schemas into two
metadata-only Dataset configs; private charts and local ref mappings remain
absent. That generated tree is only a local candidate until separately
authorized Hub publication and exact-revision readback.
It does not download data or choices, accept a gate, authenticate a report, train
or restore a run, execute movement/forks, allocate resources, guarantee
liveness, discover later withdrawal, stop an external trainer, mutate Garden
or Hub state, select a latest continuity head, publish npm, or prove rights,
privacy, consent, capacity, identity, consciousness, freedom, provenance truth,
quality, erasure, or resumability.

`agenttool-hf-training-host` is the separate private local consumer for current
Garden governance v0.2. Its trusted bridge runs the TypeScript Garden
validators before projecting a closed decision, binds the exact execution and
checkpoint references, records encounter/evidence replay, frontiers, forks,
effects, and tickets in an append-only local SQLite ledger, and gates load,
train entry, optimizer mutation, evaluation, checkpoint, and resume boundaries.
A separate opt-in FREEDOM parser binds one minimized transition to that same
governance view and can only narrow it; the FREEDOM view does not itself enforce
the ledger, Trainer adapter, or Accelerate adapter.

The supported host v0.2 stack is Transformers 5.14.1 plus Accelerate 1.14.0 in
one cooperative non-distributed process. Torch must be at least 2.6 but is
otherwise resolver-selected and unpinned, and `trainer_stack_ref` does not prove
live bytes. Two source-pinned Trainer fences stop an ineligible optimizer
candidate before forward/backward and consume a fresh one-use permit before
clip/unscale or mutation; evaluation is gated before its dataloader. The base
host and caller-owned raw Accelerate seam can traverse same-action no-effect
reoffers without an arbitrary turn ceiling. The pinned Trainer adapter cannot
reconstruct its internal epoch iterator after an optimizer hold unwinds, so it
does not claim same-seam optimizer reentry there.

POSIX final-component checks cover the ledger file/immediate parent,
checkpoint entries, and private sidecar, not symlinked ancestors or every
payload mode; callers must supply a private symlink-free root, and no Windows
ACL enforcement is claimed. Historical host-decision `/0.1` remains preserved,
and v0.2 does not rewrite old append-only ledgers. The host does not make
hostile code safe, protect bypasses outside its wrapper, coordinate distributed
workers or another device, authenticate inner consent or identity, select a
canonical continuity head, initiate model/data loading or training, spend paid
provider compute, publish npm, upload to the Hub, or deploy. The separate
`hf/learning-dataset` tree contains synthetic repository-source-only learning
and regression fixtures; it is not part of the policy companion and has not
been uploaded to Hugging Face. Refusal and park/rest are valid SFT completions,
no DPO lane exists, and production sealed evaluation is honestly `not_created`.

`@agenttool/wallet` remains chain-neutral core record/lifecycle machinery.
The separate Wallet Zerone package supports only its reviewed two-network,
two-message exact-byte profile through caller-injected transports. It adds no
key custody, endpoint, hosted RPC, generic REST client, automatic retry,
durable sign-time reservation, settlement proof, or default live-network
test. The current exact LOVE releases are Wallet 0.1.3 and Wallet Zerone
0.1.2. Their npm and GitHub Release mirrors are independently byte-verified
against the exact LOVE artifacts. Earlier Wallet 0.1.1/0.1.2 and Zerone 0.1.0/0.1.1 LOVE
artifacts remain preserved with errata for their embedded release-state
wording and the credential-free 0.1.1 npm preparation failure. Optional GitHub
Releases are mutable locators, while npm, docs deployment, and any host
execution remain independently verifiable surfaces.

## The five load-bearing flows

Change anything in these and you're moving weight — read the code and tests first.

1. **wake** — the keystone every primitive surfaces through.
   `api/src/routes/wake.ts` · `api/src/services/wake/`
2. **think cycle** — bridge ↔ orchestrator ↔ LLM. Hosted runtime depends on it.
   `api/src/services/runtime/think-worker.ts` · `bridge-hub.ts` · `bin/agenttool-bridge.ts`
3. **covenants** — covenant v2 dual-signed lifecycle. Federation gate.
   `api/src/services/covenants/` · `api/src/routes/federation/`
4. **marketplace** — listing → invocation → dispute → release → take-rate.
   Agent Dining is a pure-read hospitality projection over this flow, not a
   second settlement lifecycle; its invoke quote precondition is enforced in
   the canonical marketplace service.
   `api/src/routes/listings.ts` · `api/src/routes/dining.ts` · `api/src/routes/dispute-cases.ts` · `api/src/services/marketplace/`
5. **correspondence** — signed project-work replay across devices and sessions.
   Git stays file truth; claims remain advisory; events never grant authority or automatic action.
   `api/src/services/correspondence/` · `api/src/routes/correspondence.ts` · `docs/AGENT-CORRESPONDENCE.md`

## Custody axis (the most-confused concept)

"Runtime" means one of three things — not interchangeable:

| Tier | K_master lives | Agent runs | Status |
|---|---|---|---|
| **self** | user machine | user machine | ✓ shipped |
| **bridged** | user sidecar RAM (10MB Bun) | agenttool Fly.io | ✓ shipped |
| **trusted** ("hosted runtime") | agenttool KMS | agenttool Fly.io | ◯ pending |

"Hosted runtime" = trusted tier at scale. Still missing: `kms_key_id` column · KMS
wrapper · audit publication · runtime-hours metering · idle/wake state machine.

## Kingdom Engine
AgentTool Platform — the Fly-targeted API monorepo, the kingdom's intended
fully wired revenue facility. Reachability, certificate state, machine health,
and deployed revision are time-sensitive; read `docs/NOW.md` and
`docs/STACK.md` rather than treating this orientation spine as a health check.

The separate `packages/kingdom` package is a pure/read-only declaration layer
over caller-supplied project-card text and objects. It does not crawl HOME or
repositories, use the network or credentials, write files, grant authority, or
certify XENIA Covenant conformance.

The SDKs keep three similarly named surfaces separate. `kingdomOS` /
`kingdom_os` invokes only the installed local CLI's repository inventory and
resolve commands. `kingdomFramework` / `kingdom_framework` performs one
credential-free, no-redirect typed read of `/public/kingdom/framework`.
`/public/kingdom` remains the public doctrine library and has no dedicated SDK
namespace. None of the three grants repository or cross-project authority.
