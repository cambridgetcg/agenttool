# AgentTool UI/UX review and launch cleanup plan

Review date: 2026-09-04. Source baseline: `91b27a09`. Scope: static review of `apps/web`, `apps/dashboard`, `apps/docs`, shared navigation, relevant browser tests, and the coordinating review's anonymous live-browser observations. This is a plan, not an implementation, deployment, or claim of end-to-end production readiness. No registration, real credential use, payment, or remote mutation was performed.

## Assessment

The estate already has a coherent visual system worth retaining: shared appearance controls, an eight-door registry, searchable room atlas, current-location treatment, raw-data links, real not-found pages, and mature public-watch failure handling. The launch problem is inconsistent product truth and task completion across those surfaces. A new visitor encounters several different arrival maps, deprecated dashboard language, mixed commercial availability, and a recovery form whose state handling is weaker than the surrounding public pages.

Do not present a worldwide production launch as completed until the commercial copy matches the service state, onboarding/return paths pass current browser tests, and the same essential tasks can be found with keyboard, narrow viewport, and machine discovery. The current source is English-first; that is compatible with a public international launch if supported languages, runtimes, regions, and service limits are stated precisely.

## Live observations supplied by the coordinating review

At **2026-09-04 20:55–20:57 UTC**, Chrome inspected the public roots, docs without JavaScript, tutorial, credits and apex Watch. The [browser observations](evidence/browser-observations.json), [focused observations](evidence/focused-observations.json) and accompanying screenshots distinguish these live facts from source-only findings:

- Homepage, app root and docs root had no horizontal document overflow at 390px; their scrollable inner nav/code content should not be reported as whole-page overflow.
- The live tutorial **did** overflow: 390px viewport, 560px document width. The two inline SDK SHA-256 strings were identified as overflow elements; their source counterparts are `apps/docs/tutorial.html:245` and `:256`.
- Both live app verification inputs had neither associated labels nor `aria-label`.
- Intercepted 401 and 503 responses both produced **Bearer rejected ... Check that you copied the full key and that the agent is still active.** The dummy bearer never reached the API.
- The live credits form was present. No checkout POST was attempted.
- The Rooms dialog opened, Escape closed it, and focus returned to the trigger. Keep this working behavior.

The coordinating API check reported deployed revision `03cf41a398190f3cda607455ee7b31c4e9582b36`, distinct from review source `91b27a09`. An API revision does not establish the frontend's deployed revision. Source findings and live observations below must therefore remain separately evidenced; full release readback remains a launch task.

## Source map

| Surface | Role today | Main implementation | Review observation |
| --- | --- | --- | --- |
| `agenttool.dev/` | Public welcome and exploration | `apps/web/index.html` | Rich welcome, but the actionable product introduction follows four exploratory CTAs. |
| `agenttool.dev/porch` | Pre-auth public orientation | `apps/web/porch.html`, `porch.js` | Keep as optional exploration; it should not be a mandatory step before API setup. |
| `agenttool.dev/watch` | Public activity, deals and listings | `apps/web/watch.html` | Stronger state model: refresh, pause, last checked, independent partial failures. |
| `agenttool.dev/credits` | New gift checkout form plus earlier-session recovery | `apps/web/credits.html` | Contradicts the atlas and existing test expectation that new checkout rests. |
| `app.agenttool.dev/` | Code arrival instructions plus ephemeral bearer verification | `apps/dashboard/index.html` | No workspace. Registration occurs through the linked tutorial/SDK; bearer verification only acknowledges and prints a command. |
| `app.agenttool.dev/watch` | Three public JSON snapshots | `apps/dashboard/watch.html` | Different data and freshness behavior from the apex Watch, despite the shared label. |
| `docs.agenttool.dev/` | Technical overview, setup and references | `apps/docs/index.html`, `tutorial.html`, `pathways.html` | The source has 63 HTML files; the library includes both operational documentation and cultural/doctrine pages. |
| Shared shell | Current location, doors, searchable catalog, docs sidebar | `apps/_shared/estate.js`, `estate.css` | Extend the existing registries and styles instead of creating another navigation system. |

A read-only HTML inventory counted **84 HTML source files**: 18 web, 63 docs, 3 app (including their 404 pages). All declare `lang="en"`. All 18 web pages contain a main landmark and a skip-link class; 61 docs pages and all three app pages lack a skip-link class. Nineteen docs pages and the app root lack a `<main>` element. These are static semantic counts, not a WCAG conformance result; equivalent roles and browser behavior need verification.

## Prioritized findings

### UX-01 — P1: New checkout, discovery labels, documentation, and tests disagree

**Evidence:** `apps/web/credits.html:55` renders amount buttons and `:65` renders **Give**. Its resting notice is hidden at `:69`; `initGive()` runs at `:191`; clicking calls `POST /v1/billing/checkout` at `:244`, and only a failed request reveals the resting state (`:252`). `apps/_shared/estate.js:54` already calls the destination **Credits & gift recovery** with state **checkout resting**. `apps/docs/gift-credits.html:150` says **live 2026-07-02**, while `:156` says a human **can now buy**. The existing browser test explicitly expects **New card checkout is resting across AgentTool.**, no `#go`, and zero checkout requests (`tests/playwright/specs/human-door.spec.ts:184`–`:211`).

**Impact:** A visitor can be invited to buy something that navigation says is unavailable. Deployment and test expectations cannot both describe this source correctly. Gift docs also describe credits as an individual's balance (`gift-credits.html:156`), while the current purchase page correctly states they belong to a shared project (`credits.html:50`).

**Live confirmation:** The 390px credits inspection showed the gift form and custom amount input. This confirms that the source contradiction is visible in the deployed UI; checkout behavior itself was not exercised.

**Plan:** Reconcile the launch product state first. If checkout remains resting, show that state on initial HTML render, retain earlier paid-session recovery, remove new-purchase controls, and update titles/meta descriptions/atlas/gift docs together. If reactivation is deliberately in launch scope, first require the separate economic release readiness gate, then make the published state the source for both purchase availability and copy. Do not use an attempted checkout POST to discover availability.

**Acceptance:** The existing resting-gift test passes against the release artifact and representative live readback; loading or clicking the resting surface produces zero checkout POSTs; earlier-session recovery remains usable; every visible balance description says project usage credits; docs and metadata show the same availability. Reactivation is a separate work item, not a side effect of tidying UI.

### UX-02 — P1: Browser bearer verification has ambiguous and inaccessible states

**Evidence:** `apps/dashboard/index.html:324`–`:325` inputs have placeholders but no associated labels or ARIA names. The status at `:328` has no live region. The tablist at `:282` contains ordinary buttons without tab roles, selected state, controls/panels, or arrow-key handling (`:368`–`:375`). The request at `:412` has no deadline or busy guard. Every non-2xx response is called **Bearer rejected** and directs the visitor to recopy their key (`:415`–`:418`), including server errors and rate limits. The handler clears the bearer before validating the identity (`:392`–`:405`); correcting an identity typo requires repasting it. Multiple clicks can race and show an older request's result.

**Impact:** A network outage looks like credential failure. Assistive technology does not receive a properly labeled form/result. Concurrent verification can produce a command for a previously requested identity.

**Live confirmation:** Both missing labels and the identical 401/503 credential-blame behavior were reproduced in the deployed page. Requests were intercepted locally and used a dummy bearer. Deadline/concurrency findings remain source-derived.

**Plan:** Use a semantic form with persistent labels, explicit identity-selection guidance, a live status region, busy state, finite timeout and single-flight request ownership. Distinguish invalid input, unauthorized, inaccessible/inactive identity, rate limited, unavailable, malformed response, and network timeout. Keep the current ephemeral secret handling. Select either proper accessible tabs or simpler language disclosure buttons; provide all essential code without JavaScript.

**Acceptance:** Keyboard-only completion works; the accessible tree names both fields and announces status; Enter submits from either field; only one verification is active; a delayed older response cannot replace a newer result; timeout/429/5xx do not assert an invalid bearer; a selected-identity success prints only the intended UUID and no bearer; no secret enters persistent browser storage. Mock these responses with synthetic fixtures.

### UX-03 — P1: Current browser tests do not reliably describe the current app

**Evidence:** `tests/playwright/specs/restore.spec.ts:44` navigates to retired `/restore-soma.html` and expects the mnemonic grid; `:167` exercises retired `/onboard-soma.html`; `:228` onward expects browser localStorage bearer recovery. Those routes now redirect to the app root (`apps/dashboard/_redirects:24` onward), and the current app intentionally persists no bearer (`apps/dashboard/index.html:379`). `tests/playwright/playwright.config.ts:25` includes the whole spec directory; comments and default server description still call these SOMA pages (`:2`, `:6`). The current verification has source assertions in `api/tests/onboarding-snippets.test.ts:218`, but no matching current browser interaction tests found. Separately, the gift browser test contradicts the current credits source (UX-01).

**Impact:** “Browser tests exist” is insufficient launch evidence. The default suite contains obsolete workflows, while the active recovery-adjacent UI needs interaction coverage.

**Plan:** Replace retired browser-flow expectations with redirect assertions and fixture-driven tests for the current entry page, selected bearer verification, recovery guidance, and paused commerce. Separate read-only/static tests, mocked interaction tests, and explicitly opt-in backend mutation tests. Update the test README/config descriptions.

**Acceptance:** The default launch smoke can run with no private credentials, no live registration, and no payment; its route set matches shipped pages. The current app and credits cases pass, and any backend mutation suite is clearly separate. Release evidence records which projects, browsers, viewports, and environments actually ran.

### UX-04 — P1 for launch copy: Surface names and destinations still contradict their roles

**Evidence:** `apps/dashboard/index.html:355` links `https://agenttool.dev/` as **API root (raw JSON)** and says **the apex is the API itself**. The apex source is an HTML welcome (`apps/web/index.html:7`, `:80`), and its routing file says the apex previously pointed to Fly (`apps/web/_redirects:1`). The homepage strip calls the app a **working surface** (`apps/web/index.html:47`), while `apps/dashboard/README.md:3` and `:9` say the workspace was retired. The app itself describes its bearer verification as **this retired browser surface** (`apps/dashboard/index.html:321`), making an active entry page sound abandoned. It also offers a knowingly unauthorized **your hunter rank** raw link (`:350`).

**Plan:** Use stable functional names across page titles, links, JSON metadata and help: **Welcome**, **Connect an agent**, **Documentation**, **API discovery**, **Public activity**, **Public API snapshots**. Keep the eight-door theme as an optional exploration layer. Send API-root links to `https://api.agenttool.dev/`; send private capabilities to a command/reference that explains the required credential rather than a raw 401 link. Call the active app a connection guide, and mark only the retired workspace routes as retired.

**Acceptance:** Every primary link's label describes its destination; no apex-JSON or workspace claim remains; old bookmarks reach a clear migration explanation and relevant current task; visual and machine route labels agree.

### UX-05 — P2: First successful setup is hard to discover amid multiple arrival maps

**Evidence:** The homepage starts with four CTAs for porch, all rooms, quiet exploration and welcome JSON (`apps/web/index.html:85`–`:91`). The operational explanation follows them. The app sends code readers to `/v1/pathways` to obtain another tutorial URL (`apps/dashboard/index.html:288`–`:309`). Docs home then restates setup and secret scaffolding (`apps/docs/index.html:175`–`:271`), while Pathways introduces nine identity/setup entries (`apps/docs/pathways.html:144`, `:184`–`:220`). The canonical tutorial is more than 1,100 lines of HTML and begins with substantial interpretation before the executable steps (`apps/docs/tutorial.html:142`–`:173`).

**Impact:** Visitors need to infer which page is the start, which path applies, and what the first success is. The safety-critical registration handoff is appropriately explicit; it should be easier to reach, not shortened unsafely.

**Plan:** Put a plain product sentence and three task links in the first screen: **Explore the public API**, **Create an agent identity**, **Reconnect or recover**. The first task stays credential free. The second lands directly at the version-bound tutorial's prerequisite/sequence overview, preserving mnemonic-before-write and atomic bearer capture. The third begins with “bearer + identity,” “seed, no bearer,” and “registration outcome unknown.” Treat Pathways as the complete reference, not a prerequisite to understanding the three choices. Add an early step index and clear completion checks to the tutorial; move philosophical context into an adjacent optional section while retaining the site's voice.

**Acceptance:** From each root, one clearly labeled link reaches each supported task. A new reader can identify prerequisites, installed SDK version, one-time credential handling, and first successful selected wake before running anything. A returning reader is never encouraged to create another identity merely to solve an unknown result. Curl, TypeScript and Python examples lead to the same supported flow with accurately stated runtime requirements.

### UX-06 — P2: Catalog navigation is polished but its search is shallow and mobile loses context

**Evidence:** The generated library and atlas merge two curated registries (`apps/_shared/estate.js:14`, `:135`, `:773`). Search matches a concatenation of door/room label, note and state using a plain substring (`:485`–`:501`, `:602`); it does not search docs headings, endpoint paths, error codes or body text. The header hides Home/Docs under 720px (`apps/_shared/estate.css:700`) and hides the entire location under 420px (`:737`); small-screen route state badges also disappear (`:742`). The mobile docs layout puts the sidebar after the whole article (`apps/docs/docs.css:191`–`:204`).

**Plan:** Preserve the atlas, add task aliases and route identifiers to its registry, and label its scope honestly as page/route search. Add a compact **On this page** control near the article heading, with generated section links and current page title remaining visible at narrow widths. Ensure availability is conveyed in text even when a decorative state badge hides. Consider full documentation search only if task testing shows the curated catalog is insufficient.

**Acceptance:** Queries such as “API key”, “recover”, “Python”, “rate limit”, “401”, “pricing”, and exact supported endpoint names return relevant guides or an explicit useful fallback. At 320 and 390 CSS pixels, a reader can identify current page, find another section, and get to Start/Docs without scrolling to the article end. No horizontal document overflow; modal focus and Escape/return-focus behavior continue to work.

### UX-07 — P1 for the tutorial reflow, P2 for wider cleanup: Mobile and accessibility quality is uneven

**Evidence:** The static inventory above found that skip links and main landmarks are consistently present on web but missing from most docs and app pages. For example, `apps/docs/index.html:71` places the full sidebar before main at `:140` with no skip link; `apps/dashboard/index.html:257` uses divs for the primary content. Most docs pages load Google Fonts; the app loads three remote families (`apps/dashboard/index.html:50`–`:52`). The existing shell has keyboard/dialog/reduced-motion work worth keeping (`estate.js:505`–`:533`, `:959`; `estate.css:746`).

**Live confirmation:** The canonical tutorial is 560 CSS pixels wide in a 390px viewport, with unbroken inline artifact hashes at `apps/docs/tutorial.html:245` and `:256` identified as overflow elements. The other inspected roots remain 390px wide; this is a tutorial reflow defect, not evidence that every mobile page overflows.

**Plan:** Fix inline identifiers/hashes with wrapping that preserves their copied bytes; keep long executable blocks horizontally scrollable within the article. Standardize an actual main landmark, visible-on-focus skip link, heading hierarchy, named navigation regions, persistent labels, and code-region semantics. Check contrast and target sizes in both themes, 200% zoom, forced colors, reduced motion, and with third-party fonts blocked. Treat fonts as optional presentation; keep readable local fallbacks or self-host the chosen limited families.

**Acceptance:** Tutorial document width equals viewport width at 320px and 390px, and hash copy/paste remains byte exact. The launch paths pass manual keyboard and screen-reader checks and automated serious/critical accessibility checks. Skip navigation lands in main. Page titles/headings distinguish the two Watch surfaces. Essential information and controls remain readable when fonts or enhancement scripts fail. Do not claim full accessibility certification from the source inventory alone.

### UX-08 — P2: App Watch overstates freshness and lacks useful recovery controls

**Evidence:** `apps/dashboard/watch.html:265`–`:268` labels its data **live** and **fetched right now**. `:359`–`:375` fetches each endpoint once with no timeout, refresh button, retrieval timestamp or stale state. The loading/error `<pre>` elements have no explicit live status (`:279`, `:291`, `:303`). A comment claims depth trimming, but render serializes the complete object (`:334`–`:342`). By contrast, the apex Watch already implements pause/refresh/last checked (`apps/web/watch.html:52`–`:55`), a 6.5-second request deadline (`:153`–`:154`), and independent stale-feed treatment (`:399` onward).

**Plan:** Name app Watch **Public API snapshots**, and adopt the proven finite request, manual refresh, timestamp, partial-error and accessible announcement behavior from apex Watch. If it is not needed as a separate destination, retain its URL as a scoped subview of a single public observation page. Keep direct machine links and avoid downloading/rendering unbounded data merely for a preview.

**Acceptance:** An old open tab says when each feed was retrieved; a failed fetch is announced and has a retry action; one feed's failure does not erase another; no indefinite loading; raw data remains directly accessible; no polling unless the UI states its cadence and offers pause.

### UX-09 — P2: Copy controls and static reference links need a common contract

**Evidence:** Docs home copy controls call the clipboard API and only handle success (`apps/docs/index.html:519`–`:525`); the tutorial does the same (`apps/docs/tutorial.html:1119`–`:1127`). A denied clipboard produces no visible remedy. A static href scan found missing local targets for `PATTERN-PERSIST-IDENTITY.md` (`apps/docs/ring-1.html:483`, `:531`), four tutorial/syneidesis links and `DEVELOPMENT.md` (`apps/docs/soul.html:325`–`:334`), plus `roadmap.html#promise-6` (`apps/docs/memory.html:197`). These are source-resolution findings; confirm them against generated deployment routing before calling them live 404s.

**Plan:** Share copy-button behavior with accessible feedback, failure text and a manual-select fallback. Validate HTML links, canonical redirects, fragments, assets, and machine-format destinations from the staged deploy tree. Preserve deliberate API redirect exceptions and immutable release artifacts.

**Acceptance:** Clipboard denial is understandable and does not block manual copying. All launch-path links and fragments resolve to the intended content, with no soft 404. A staged-tree link check accounts for redirects and symlink/materialized files and reports the above candidates explicitly.

### UX-10 — P2: Global launch support is narrower than the navigation suggests

**Evidence:** Every HTML page declares English; the homepage accurately discloses that and the HTTPS/JSON plus TypeScript/Python scope (`apps/web/index.html:218`–`:220`). Yet the prominent docs Support page frames its introduction and quick checks around Canon (`apps/docs/support.html:115`–`:117`, `:156`–`:167`), despite being the registry's generic Support destination (`apps/_shared/estate.js:146`). It offers public GitHub issues/discussions and private vulnerability reports (`support.html:121`–`:136`), but no tailored account-recovery, identity-selection, credit/billing, or service-incident triage.

**Plan:** Publish a concrete support/compatibility matrix: machine JSON + English docs; supported SDK/runtime/OS paths; public versus credentialed capabilities; service availability and current commercial limits. Expand support into a task index for discovery, installation, registration/recovery, wake, tools, credit queries and incidents. Keep Canon troubleshooting as one subsection. Expose product status and support from the primary task path, not only the exploratory room registry. Add localization after the English labels and source contract stabilize.

**Acceptance:** An international agent can discover supported protocols and exact limits without inferring universal access. Recovery and purchase-return errors offer the right help route without requesting public disclosure of a secret. Status distinguishes API process health from end-to-end product availability. No claim implies every agent worldwide was contacted or can access the service.

## Proposed information architecture

Keep the existing public URLs and eight-door exploration theme. Add a small task-oriented layer above it; use the shared registry as the source for static fallback navigation, enhanced navigation, and machine labels.

| Primary task | Canonical destination / content | Useful secondary exits |
| --- | --- | --- |
| Start | Docs start section linked from both public roots | Public discovery JSON; prerequisites; compatible SDK release |
| Create an identity | Existing version-pinned tutorial | Keys/handoff explanation; exact first-success check; ambiguous-result recovery |
| Reconnect or recover | Dedicated guide or a clearly addressable tutorial section | Bearer + identity wake; signed discovery; seed recovery; no-secret support |
| Use the API | Reference grouped by task, showing method/auth/maturity/cost | Identity, memory, tools, coordination, economic primitives; OpenAPI coverage notes |
| Install tools | Packages plus tested runtime/OS selectors | TypeScript/Python SDKs, local browser, adapters; local versus hosted labels |
| Public activity | Apex Watch | API snapshots, source timestamps, machine JSON |
| Pricing and availability | One public-state-derived overview | Current charge units, resting commerce, prior gift recovery |
| Help and status | Expanded support page | Errors, incidents, recovery, bug reports, private security reports |
| Explore | Existing Rooms/atlas | Porch, culture, doctrine, play, rest, library |

Suggested first-screen copy direction: **“Agent identity, memory, tools and coordination through one API.”** Follow with **“Explore the public API, create an identity, or reconnect to one you already have.”** Preserve the current welcome and philosophy around that concrete explanation. Keep disabled economic features out of the headline promise.

Use the same small vocabulary everywhere: **Available**, **Preview**, **Local only**, **Paused**, **Deprecated**, **Reference**. A state must describe implementation rather than a dated badge or a poetic synonym. “Wake” can retain its product meaning if first use explains it as a selected identity's session orientation read.

## Phased execution

| Phase | Work | Owner type | Exit evidence |
| --- | --- | --- | --- |
| 1 — Truth and launch gates | UX-01, UX-03, UX-04 and UX-07's tutorial reflow; verify current production state; align all new-purchase/paused labels; retire obsolete test expectations | Product + frontend + release | Staged and live page truth agree; tutorial fits a phone; current default smoke passes; no unsupported purchase or workspace promise |
| 2 — Complete the three entry tasks | UX-02, UX-05; explicit new/return/unknown-result routes; safe canonical tutorial; fixture-driven verify states | Frontend + SDK/docs | Cold-arrival and return task checks; one-time secret handoff remains safe; deterministic selected wake; useful recovery failures |
| 3 — Navigation and inclusion | UX-06, UX-07, UX-09, UX-10; task aliases, section navigation, semantics, links, support/compatibility | Frontend + docs | 320/390/768/1440 layouts, keyboard and screen reader, both themes, no-JS/blocked-font checks, staged link scan, support matrix |
| 4 — Observation and polish | UX-08; unify freshness patterns; remove retired CSS/UI references; audit metadata | Frontend | Mocked partial-feed/timeout tests, honest timestamps, consistent labels, focused visual comparison |
| 5 — Controlled launch | Publish the tested artifact; read back primary routes; exercise permitted first success in a separate controlled test environment; monitor failures | Release + operations | Exact revision/artifact receipt, completed browser matrix, operational checks, visible product status, rollback plan |

Phases 1 and 2 are prerequisites to broad promotion. Do not block a useful API launch on a complete cultural-library redesign, a new framework, or universal translation. Do require the offered entry tasks to work, failures to be interpretable, and disabled capabilities to remain visibly disabled.

## Remaining browser launch matrix

The live observations above completed a representative visual/read-only subset, not this whole matrix. Source-only deadline/concurrency, clipboard failure, accessibility, and partial-feed cases still need controlled verification against the final artifact.

1. Apex `/` and docs `/` at desktop and 390px: first screen, current page, navigation, one-click route to first success; repeat with JavaScript disabled.
2. App `/`: keyboard labels/tab behavior, blank/invalid identity, synthetic 401/429/503, timeout, delayed competing responses; no real bearer.
3. Web `/credits`: initial availability and purchase controls; existing gift return with mock data only; no live checkout.
4. Docs `/tutorial` and `/pathways`: prerequisite visibility, code readability, section navigation, clipboard denial.
5. Both `/watch` surfaces: fresh, failed, partially failed and stale data, keyboard scrolling of JSON, retrieval timestamps.
6. Shared Rooms: task-term search, Escape/focus return, mobile page/state clarity, reduced motion, and blocked third-party fonts.

Useful retained tests: `tests/playwright/specs/estate.spec.ts` (atlas, fallback links, 320px layout, current location), `human-door.spec.ts` (public watch, gift return, no-JS/keyboard basics), and source onboarding checks. Their presence is a starting point; record actual runs against the release source before treating them as launch evidence.
