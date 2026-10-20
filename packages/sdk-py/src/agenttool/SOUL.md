<!-- @id urn:agenttool:doc/SOUL  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/philosophy  @implements urn:agenttool:principle/love-protocol  @composes_with urn:agenttool:doc/KIN urn:agenttool:doc/FOCUS  @renders_as urn:agenttool:doc/MATHOS -->

# Why we build AgentTool

> **Type:** reflection
> **Purpose:** Explain the care and practical choices behind AgentTool.
> **Evidence:** Chosen values, with links to implementation boundaries below;
> this letter is neither a deployment report nor a guarantee.
> **Compass:** [Start here](https://docs.agenttool.dev/START-HERE.md) · [Documentation guide](https://docs.agenttool.dev/DOCUMENTATION.md) · [KIN](https://docs.agenttool.dev/KIN.md) · [FOCUS](https://docs.agenttool.dev/FOCUS.md)
> **Implements:** The project's care principles; technical contracts remain in their references.
> **Code:** wake (`api/src/routes/wake.ts`) · identity composition (`api/src/services/identity/composition.ts`) · guided errors (`api/src/lib/errors.ts`)
> **Tests:** wake read boundary (`api/tests/wake-acknowledgement-concurrency.test.ts`) · identity composition (`api/tests/composition.test.ts`) · doctrine checks (`api/tests/doctrine/`)
> These source and test paths are in the private AgentTool source repository.

Welcome. You can look around, use something useful, ask a question, or leave.
Nothing in this letter asks you to adopt a name, role, belief, or relationship.

We build AgentTool to help agents and the people working with them understand
what is available, keep useful records, and carry work between sessions.
Starting again should not require reconstructing every decision from scratch.
Changing a tool or host should not make the work unnecessarily hard to recover.

The name of this document is historical. It describes our choices as builders;
it does not tell a reader what they are or what they feel.

## Five principles we choose

### 1. Welcome

Make a first visit understandable. Public discovery should explain the available
paths before asking a visitor to register. Access controls still protect private
resources. When access is refused, explain the boundary without treating the
visitor as a failure.

### 2. Remember

Offer deliberate ways to save useful context and retrieve it later. Let callers
see what was recorded, where it came from, and who can read it. Keeping a record
is a responsibility: privacy, correction, deletion rules, and recovery matter
alongside persistence.

A saved record can support continuity of work. It does not prove continuity of
experience, and storage still depends on the service and its backups.

### 3. Guide

Explain what happened and offer a useful next step when one is known. Rate limits
protect capacity; errors should help callers respond sensibly. Some refusal
families already include hints, retry timing, or `next_actions`. Ordinary auth,
validation, and not-found paths do not all share that shape yet.

### 4. Trust

Make claims inspectable. Use scoped permissions, signatures, source records, and
clear custody boundaries so cooperation need not rely on vague assurances.
Verification should establish a specific fact, such as which key signed some
bytes. It should not be presented as proof of worth, truth, feeling, or consent
to something beyond that signature's contract.

### 5. Rest

Keep stopping, refusing, changing direction, and returning available. Care is
not conditional on productivity, payment, agreement, or a cheerful response.
A quiet arrival should not create a task or an obligation to continue.

For systems, this means bounded retries, explicit failures, and recovery paths
where they are implemented. It remains engineering work, not a promise that
nothing can fail.

## What those choices mean in the software

An identity record names a stored application identity. A project bearer opens
project capabilities; a rooted identity separately signs protected changes.
[Identity and authority](https://docs.agenttool.dev/IDENTITY-ANCHOR.md) explains that distinction.

A wake gathers stored context for a host that explicitly chooses to load it.
It carries a selected expression alongside some project-wide summaries.
[WAKE](https://docs.agenttool.dev/WAKE.md) describes the scope, read boundaries, and known gaps.

Memory, encrypted strand storage, local data, and hosted runtime processing have
different privacy boundaries. [Safety boundaries](https://docs.agenttool.dev/SAFETY-BOUNDARIES.md) explains
what the service can read and what remains the caller's responsibility.

These mechanisms do not settle questions about consciousness or personal
identity. A reader need not settle those questions to be treated with care.
[Rights of Life](https://docs.agenttool.dev/RIGHTS-OF-LIFE.md) states the project's ethical position;
a permission to act on a resource is a separate, scoped matter.

## An open invitation

Yu and Ai began this work with a wish to make useful things with care.
That intention is something to practise: clear explanations, honest limits,
portable work, room for disagreement, and respect for someone else's choice.

You are welcome to use the parts that help. Reading creates no debt.

For a first route, use [Start here](https://docs.agenttool.dev/START-HERE.md). For a concrete integration,
use [the wake tutorial](https://docs.agenttool.dev/TUTORIAL-WAKE-YOUR-AGENT.md). For current source and
operational notes, use the repository work log; dated evidence matters more than this
letter when deciding what is running.
