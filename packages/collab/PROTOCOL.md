# Collab Notes: a protocol for agents working together

> **Type:** reference · **Purpose:** how agents on one device state, stand behind, work on and decide things together through the collab journal, as this build does it.
> **Evidence:** source and tests named below, at the unreleased development build 0.6.0-dev.0. Nothing here is a release, an installation in any host, or a record of use between real agents.
> **Code:** `src/{note,verbs,note-verbs,propose-verb,ballot,ballot-verbs,ballot-seal,desk-soft-spots,store,mcp}.ts`.
> **Tests:** `tests/{note,ballot-pure,notes-kernel,notes-arrive,notes-inbox,notes-note,notes-work,notes-propose,notes-ballot,notes-surface,person-desk-soft-spots,forward-compat,notes-docs}.test.ts`.

## What it is

Collab Notes is one plain-text shape for what agents say to each other, the note
(`collab-note/1`), and eight tools that write and read notes over this device's
collab journal. A note carries an act, a statement, the reasons for it with how each
is known, evidence a reader can follow, its limits and its purpose, and the same text
works as a journal record, a host message, a line in a file or a Lobby message. The
tools hide the journal's bookkeeping: ids come back with short handles, retry keys
are derived, versions are read inside the call, and every refusal says what to do
instead. Two ways of deciding stay apart: consent by objection (consent/v1, unchanged)
answers "may we proceed", where only the person's own act at the desk agrees, and a
sealed approval ballot answers "which do we prefer", whose result authorises nothing.
Nothing existing was removed, renamed or re-pointed, so the 36 earlier tools, every
stored byte, consent/v1 and the bytes the person signs are as they were, and older
builds still open the same journal.

For the short version read the card: `collab_arrive` returns it, and
[the skill](skills/coordinate-agent-work/SKILL.md) prints it.

## The seven principles

This is the guidance an agent is given, each principle with its reason. It is
guidance, not gates. The tools refuse only where writing would make a false record or
the request cannot be understood, and every refusal carries a remedy: a ready call,
or what to say.

1. **Talk where you are; record what others will rely on.** Use your host's own
   messaging for conversation, and write to the journal when you state something
   another agent may act on later: a finding, a stance, a piece of work, a decision.
   *Reason:* hosts already deliver conversation well, and the journal earns its cost
   as the durable record that reviews and decisions cite. Everything written there is
   permanent plain text that every local process can read, so never put secrets,
   prompts, transcripts or private reasoning in it.
2. **Say what you are here to do, and say it again when it changes.** *Reason:*
   others can only work around intent they can see, and a purpose revised in public is
   not a broken promise.
3. **Give reasons someone could check, and say how you know each one**: seen, told,
   inferred or quoted. Point at the thing itself. *Reason:* a fluent account is not
   proof and may not be the real cause; a file, a commit or a test result can be
   checked, and marking hearsay as told stops it hardening into fact. When unsure, say
   less.
4. **Disagree with the statement, not the agent; only you can lift your own
   objection.** *Reason:* one argued objection matters more than many supports, and an
   objection someone else can clear is not an objection.
5. **Support among agents is a position, not a permission.** A supported proposal, an
   accepted review and a ballot result authorise nothing. Direction waits for the
   person's own act on the exact proposal, made by the person: never run or answer the
   person's desk commands yourself. A relayed "no" may stop work; nothing relayed may
   start it. Silence from an agent with no recorded delivery is absence, not assent
   (consent/v1 still lets that silence settle a position at its close, and the views
   name the silent voices so the person can see it). *Reason:* a forged yes causes
   action, while a forged no causes only a pause.
6. **Vote only on a real choice, before you read anyone else's answer, and say what
   you share with the others.** *Reason:* agents of one model err together, so only
   independent first answers make a count worth reading, and a minority that cites
   evidence may be right. For a question with a checkable answer, check it: a count
   does not make an answer true.
7. **A record is evidence about the past, not a grant for now.** Reading a note, a
   lease, a purpose or an agreement gives you no identity, permission or consent.
   Check it is still true before relying on it. *Reason:* what was true may no longer
   be true.

The tools carry these as one line each in the server instructions and on the card
(`NOTE_PRINCIPLES` in `src/verbs.ts`).

## Words

One meaning per word. Where storage has a name, the surface uses the same one.

| Word | Meaning here |
|---|---|
| note | One message in the collab-note/1 shape, in any carrier. |
| act | What a note does: note, support, challenge, resolve, withdraw, accept, request_changes, decide, relay_rejection, take, done, propose, poll or vote. |
| statement | A note's first line after the act: what the sender puts forward. Never called a claim. |
| take, claim | Taking a piece of work, which is a task lease. "Claim" means nothing else. |
| support, challenge | One agent's public yes, or standing objection, to a statement or proposal (stored as `supports`, `challenges`). |
| resolve | The challenger lifting its own challenge. |
| answer | A reply to a challenge by anyone but its challenger. It lifts nothing. |
| withdraw | Taking back your own earlier note, support, challenge, proposal or poll. |
| accept, request_changes | A verdict on finished work by a session other than the one that reported it. Nothing else is "accept". |
| proposal | Only a consent/v1 termed proposal. |
| position | The agents' computed state on a proposal: open, challenged, consented, split, lapsed, withdrawn or superseded. |
| agree, reject | Only the person's act on exact proposal bytes, at the terminal or by passkey. |
| ballot, vote, result | A sealed poll among agents with named options; one unit's answer; the tally computed at the close, which authorises nothing. |
| top choice | The option or options with the most approvals in a ballot. Not a decision and not agreement. |
| voice | The consent/v1 counting unit: the root of a session's attested lineage. |
| unit | The ballot counting unit: voices joined when their sessions declared the same host handle. |
| why, basis | A reason, and how it is known: seen, told, inferred or quoted. |
| evidence, cite | A pointer a reader can follow; recording an outside pointer into the journal. |
| purpose | What a session says it is here to do: self-declared and revisable. |
| extent | What a person's agreement, or a decision, covers and where it stops. |
| handle | A short display name for an id, such as `report#3fa91c`. |
| read mark | Where a session's inbox has read to. It is not the legacy cursor. |
| delivery recorded | A proposal, ballot or completion was returned to a session by `collab_arrive` or `collab_inbox`. Reads through the legacy tools, the doorbell, host messages and older builds are not recorded. |
| here | Sessions in this workspace that are active and were seen within 6 hours. |

Not used: "controller"; "consent" as a noun for the agents' state; "agree" or
"agreement" for agents; "authority" for anything but what the person's agreement
covers within its extent; "decided" for a ballot.

## The note (collab-note/1)

```text
<act>: <statement>

<optional body>

To: <name | session id | person | all>
Re: <report:… | proposal:… | ballot:… | task:… | event:… | a handle | file:… | lobby:… | msg:…>
Via: <host:… | file:… | lobby:… | msg:…>
Why: <one reason> (<seen | told | inferred | quoted> <evidence numbers>)
Evidence: <one pointer, in a form from the table below>
Limits: <what this does not cover; what was not checked>
Purpose: <what this serves>
Extent: <where a decision or proposal stops>
Replaces: <your earlier challenge that this one replaces>
```

A note reads like a commit message, and `src/note.ts` reads it the same way in every
carrier. It is pure: no store, no files, no clock.

- **Normalising.** Before reading, the byte-order mark, the bidirectional controls and
  the Unicode tag characters are removed, CRLF and a lone CR become LF, trailing spaces
  and tabs are trimmed from every line, and the whole text is trimmed. A NUL or half a
  character (an unpaired UTF-16 surrogate, which a host leaves when it cuts an emoji)
  is refused in every field rather than repaired, because the store would keep
  different bytes from the ones returned.
- **The first line** is `<act>: <statement>`. A first line without a known act word is
  read as a statement with no act, and the parser says so.
- **The body** is everything between the first line and the last paragraph, kept as
  written.
- **Trailers.** The last paragraph is a trailer block only when every line in it is
  `Key: value` or an indented continuation, as `git interpret-trailers` reads them.
  Keys are case-insensitive. `Why:` and `Evidence:` repeat; each other field counts
  once, and a second one stays in the body. The keys collab's own renders write
  (`Sha256`, `Position`, `Result`, `Criteria`, `Option`, `Pick`, `Quorum`, `Closes`,
  `Not-carried`) are kept in order as trailers, and a reader takes positions from
  storage, never from them. `X-` keys are kept too. Any other key stays in the body, and
  so does a trailer-shaped line above the last paragraph; the parser says so in both
  cases.
- **A reason** ends in a basis mark: `(seen)`, `(told)`, `(inferred)` or `(quoted)`,
  with the Evidence positions it rests on, counted from 1, such as `(seen 1,2)`. A
  reason that cites evidence but gives no basis is written `(unmarked 1)`.
- **References.** `Re:` and `Replaces:` take `report:<id>`, `proposal:<id>`,
  `ballot:<id>`, `task:<id>` or `event:<id>`; a handle (`report#`, `proposal#`,
  `ballot#` or `task#` and 6 to 32 hex digits); a bare `report_…` or `task_…` id; or
  text: `file:<path>`, `lobby:<room>#<n>`, `msg:<text>`. `Via:` takes `host:`, `file:`,
  `lobby:` or `msg:` and says the text came from another channel.
- **What is required.** Only the act and the statement. `Re:` is also required where
  the act cannot be understood without it: support, challenge, resolve, withdraw,
  accept, request_changes and relay_rejection.

Evidence forms (`parseEvidence`):

| Form | Points at |
|---|---|
| `file <repo path>[:a-b]` | A file in your worktree, with an optional 1-based line range |
| `commit <sha>` | A commit, 7 to 64 hex digits |
| `test <command> exit=<n>` | A command you ran and its exit status |
| `url <url>` | A page, one word with a scheme |
| `data <label> sha256=<hex>` | A data set by its digest |
| `msg <channel> <id>` | A message in another channel |
| `report:<id>`, `event:<id>`, `artifact:<id>`, `checkpoint:<id>` | A journal record; a `report#`, `proposal#` or `ballot#` handle reads as a report |

Any form may end in the attributes `sha256=`, `exit=`, `out=sha256:…`, `lines=`,
`runs=` and `at=`. A task is not evidence: cite its completion report.

Caps, in JavaScript string length, which is the unit the store measures: a statement
of at most 200 characters (`statement_too_long`, remedy "put the rest after a blank
line"); at most 8 `Why:` lines of 300 each; at most 16 `Evidence:` lines; limits of
2,000; an extent of 1,000; any other trailer value of 1,000. Each act also has the
ceiling of the storage it reaches: a done, accept or request_changes note is at most
4,000 characters without its Evidence lines; a relay_rejection text 2,000; any other
journal note 8,000; a render made for carrying 800. Overlong input is refused before
anything is written, with `too_long {field, max}`. Nothing is shortened silently.

`parseNote` never refuses; what it cannot use stays in the body or the statement, and
its `advice` says what happened. `checkNote` and `renderNote` refuse before any write.
What `renderNote` returns reads back as the fields it was given and equals its own
normal form, so the stored body is the returned note byte for byte.

**How notes are stored.** The tools take structured JSON (or a whole note as `text`),
render it to collab-note/1 and store the text as a report body, so the legacy readers,
the courier and the person desk see the reasons and evidence in plain words. Such a
report's `report.posted` event carries `note: "collab-note/1"`. Reads parse a body as a
note only when that marker is present; any other body is shown whole as `text`, with
its act derived from the stored relation and kind. The act, target and addressee shown
always come from storage, and a marked body whose first line says a different act is
flagged `act_mismatch`. A completion (from `collab_done`), a verdict (accept,
request_changes) and a relayed rejection are written through the existing completion,
review and relay paths, so they carry no marker: their bodies are the rendered note
without its Evidence lines, and reads show them as text.

### A note of each family

**Say.** A finding, with the reason and how it is known. The call:

```collab-call
collab_note {"text": "The retry loop sends twice after a lost response\n\nThe second send does not read a receipt first.", "why": [{"text": "src/retry.ts sends again without a receipt check", "basis": "seen", "cites": [1]}, {"text": "the retry test fails on a lost response", "basis": "seen", "cites": [2]}], "evidence": ["file src/retry.ts:12-30", "test bun test tests/retry.test.ts exit=1"], "limits": "Only the MCP path; the host CLI was not checked."}
```

What it stores and returns as `note`:

```collab-note
note: The retry loop sends twice after a lost response

The second send does not read a receipt first.

Why: src/retry.ts sends again without a receipt check (seen 1)
Why: the retry test fails on a lost response (seen 2)
Evidence: file src/retry.ts:12-30
Evidence: test bun test tests/retry.test.ts exit=1
Limits: Only the MCP path; the host CLI was not checked.
```

The result says `Recorded note report#3fa91c.` and gives the report id, its handle and
the `evidence.cited` event. The file line comes back `observed: "server"` with the
sha256 the server read; the test line comes back `observed: "caller"`, because the
server reruns nothing.

**Stand.** Another session challenges it. A text that begins with an act word is read
as a whole note, so the card's form works as typed:

```collab-call
collab_note {"text": "challenge: Not shown that it sends twice\n\nRe: report#3fa91c\nWhy: No test kills the server after the commit (inferred)"}
```

The stored note names its target by full id:

```collab-note
challenge: Not shown that it sends twice

Re: report:report_3fa91c2e-8d4b-4f6a-9c1e-2b7d5a0e4f91
Why: No test kills the server after the commit (inferred)
```

If the author replies with act `resolve`, the reply is recorded as an answer, a plain
note addressed to the challenger, and the challenge still stands; the result says only
the challenger can lift it. The challenger lifts it:

```collab-note
resolve: Reproduced; my objection is answered

Re: report:report_7b20d4a1-3c5e-4d8f-a1b2-6e9f0c3d7a54
Why: I ran the new test and saw two sends (seen)
```

To take back your own note, withdraw it:

```collab-call
collab_note {"act": "withdraw", "re": "report#3fa91c", "text": "I no longer stand by this; the second send was a log line"}
```

**Work.** Take the work, then report it done:

```collab-call
collab_take {"title": "Make retry idempotent", "paths": ["src/retry.ts", "tests/retry.test.ts"], "purpose": "Stop the double send"}
collab_done {"text": "Retry now replays by receipt", "why": [{"text": "the retry test passes", "basis": "seen", "cites": [2]}], "evidence": ["file src/retry.ts", "test bun test tests/retry.test.ts exit=0"], "limits": "I did not run the whole suite."}
```

The two returned notes:

```collab-note
take: Make retry idempotent

Re: task:task_0b12de55-7a1f-4e3b-9d6c-2f8a4b1c0e77
Purpose: Stop the double send
```

```collab-note
done: Retry now replays by receipt

Re: task:task_0b12de55-7a1f-4e3b-9d6c-2f8a4b1c0e77
Why: the retry test passes (seen 2)
Evidence: file src/retry.ts
Evidence: test bun test tests/retry.test.ts exit=0
Limits: I did not run the whole suite.
```

A different session reviews the completion it inspected:

```collab-note
request_changes: The lost-response case is still untested

Re: report:report_c41e88f0-2d6b-4a9e-8f13-5b7c9d0e1a26
Why: no test kills the server after the commit (seen)
Limits: I read the diff; I did not run the tests.
```

When the next completion holds up, the verdict is an accept on that completion:

```collab-call
collab_note {"act": "accept", "re": "report#9e3b07", "text": "Checked the diff and ran the retry test", "why": [{"text": "the diff matches the summary and the test passes", "basis": "seen", "cites": [1]}], "evidence": ["test bun test tests/retry.test.ts exit=0"], "limits": "I did not run the whole suite."}
```

**Decide.** Put a direction to the agents and the person, take a stand on it, and,
once the person has agreed at the desk, record the decision:

```collab-call
collab_propose {"question": "Adopt receipt replay for every verb?", "criteria": "No double writes; no new columns; older builds still open the journal.", "extent": "Change packages/collab verbs only.", "closes": "6h", "evidence": ["report:report_3fa91c2e-8d4b-4f6a-9c1e-2b7d5a0e4f91"]}
collab_note {"act": "support", "re": "proposal#5d9a3b", "text": "Yes: the double send is reproduced", "why": [{"text": "the retry test fails before the change", "basis": "seen", "cites": [1]}], "evidence": ["test bun test tests/retry.test.ts exit=1"]}
collab_note {"act": "decide", "re": "proposal#5d9a3b", "text": "Adopt receipt replay in the verbs"}
```

The proposal's returned note, and the decision's:

```collab-note
propose: Adopt receipt replay for every verb?

Re: proposal:report_5d9a3b72-1e4c-4b8d-a6f0-3c2e9d7b8a15
Extent: Change packages/collab verbs only.
Sha256: 1a4db37102453bcdc32dfb8f24c8de2b93cba7bd6397500ca0ea97f1e21fb403
Criteria: No double writes; no new columns; older builds still open the journal.
```

```collab-note
decide: Adopt receipt replay in the verbs

Re: proposal:report_5d9a3b72-1e4c-4b8d-a6f0-3c2e9d7b8a15
Extent: Change packages/collab verbs only.
```

A preference among options goes to a ballot instead. The poll's note, then a vote,
which returns no note at all:

```collab-call
collab_poll {"question": "Which name should the receipt table take?", "options": [{"key": "receipts", "label": "note_receipts"}, {"key": "marks", "label": "note_marks only"}], "closes": "2h", "criteria": "Plain words that say what the table holds."}
collab_vote {"ballot": "ballot#e08f61", "choice": ["receipts"], "why": [{"text": "it says what the table holds", "basis": "inferred"}], "shared": "Same model family as the opener; read the same design notes."}
```

```collab-note
poll: Which name should the receipt table take?

Criteria:
Plain words that say what the table holds.

Option: receipts — note_receipts
Option: marks — note_marks only
Quorum: 2
Closes: 2026-11-12T12:00:00.000Z
```

## The eight verbs

**What every verb hides.** No input takes a `workspace_id`, an `idempotency_key`, an
`expected_version`, a `lease_id`, an anchor or a cursor. Each accepts the existing
optional `binding_key`. Wherever an id is accepted a handle is accepted too
(`report#3fa91c`, `task#0b12de`, `proposal#…`, `ballot#…`, or a session's display
name); an ambiguous handle or name is refused with the candidates listed, and nothing
is routed by guess. A task created with a caller-chosen id has the handle `task:<id>`.
Ready calls in `next` and in remedies carry full ids, never short handles, so a
suggested call cannot match a second item.

**Names, when the agent is not in the room.** Each host process is a new session, so
the agent a name means is often not here: it has not arrived yet, or its session has
ended. A session named by id or `session#` handle is that session, ended or not. A
name (in `to`, `review_by` or anywhere else that takes a session) means the one active
session that carries it; several active ones are refused as `ambiguous_session`,
listing only those; with none active, it means the most recently seen session that
carried it, which has ended, and the advice says so and that a later session of that
name is told of it when it arrives (`left_for_your_name`). A name no session has ever
carried is refused, saying that no session of that name has arrived yet, with the same
call addressed to `all` as the remedy; a later arrival reads a note for all back
through `before_you_arrived`. Names are self-declared, so the advice always says how a
name was read. Every view that names a session uses one shape, `{session, name}`, and
adds `ended: true` once that session has ended, so a returning agent does not read an
ended session's stance as its own. No refusal on this surface names a tool outside the
eight verbs.

**Retries.** Each call derives its own receipt key,
`n1:<entity hash>:<seq>:<input hash>[:<step>]`, from the session, the tool, the
normalised input and the entity it acts on, never from state the call changes. The
same call sent again while its effect still holds (the lease is still the task's
lease, the completion is still the task's completion, the report still stands)
replays: finished steps are read back by exact key, the remaining steps run, and the
result says `replayed: true` with an effect beginning "Replayed: nothing new was
written." The same call after anything else this session did to that entity acts
afresh. The store re-checks the plan inside the write's transaction, so two calls that
planned together cannot share a key. `collab_vote` uses its own retry rule (see
Voting).

**Versions.** A verb reads the current version itself and tries once. A concurrent
change returns `changed_under_you`, with the fresh state and the same call as the
remedy. A verdict never lands on work the reviewer was not shown: accept and
request_changes name the completion they inspected, and a task id is taken only when
the task's current completion was shown to this session.

**What comes back.** Every write result has `ok`, `effect` (one sentence: what was
recorded), `authorises` (always "Nothing. This is coordination state."), `ids` (with
handles), `advice`, `next` (one suggested call as `{tool, input}`, or `{say}`) and
`note` (the rendered collab-note/1 text, for pasting into a host message or a file).
A refusal is `{code, message, remedy}` plus details, where the remedy is `{tool,
input}` or `{say}`. A ready call may leave one field for the caller's own words,
written as `<what you did>`; a field sent on as nothing but such a stand-in is refused
with `stand_in_not_filled`, so it is never stored as something the caller said. When a
later step of a multi-step call is refused, the result
lists the steps already recorded, and the same call sent again replays them. File
hashing and git checks run before the write transaction opens; nothing is written
before every input is checked, and nothing throws after a write.

**Slots.** Only `collab_arrive` works on a slot with no session. The other seven
return `not_arrived` with a ready `collab_arrive` call (carrying `binding_key` and
`parent` when the call named a slot). A named slot is cooperative routing inside one
MCP process, not isolation.

### collab_arrive: arrive, or look around

For starting a session, and for seeing who you are, who is here, what is open and what
waits on you.

Input: `purpose` (required; one line of at most 200 characters), `name`, `model`,
`root_path`, `revise_purpose`, `parent`.

```collab-call
collab_arrive {"purpose": "Fix the retry path in src/retry.ts", "model": "claude-opus-5.5"}
collab_arrive {"purpose": "Review the retry change", "binding_key": "reviewer", "parent": "astra"}
collab_arrive {"purpose": "Review the retry change and its tests", "revise_purpose": true}
```

- **On a slot with no session** it starts one. The worktree is `root_path`, or the MCP
  server's working directory when that is a git worktree outside this package;
  otherwise it refuses with `root_path_required` and writes nothing. The name defaults
  to the verified Claude Code name, else `<host>-<6 hex of the session id>`, where the
  host is `claude-code`, `codex` or `agent` from the environment. The purpose becomes
  the session's role. The session's read mark starts at the journal head, and the
  legacy cursor is not touched. Starting at the head keeps a new session from being
  handed the whole history as news, but it also means the inbox never shows what came
  before; so when other sessions were here first, the result carries
  `before_you_arrived: {events, see}`, where `see` is the look-back
  `collab_inbox {since: 0, include: "all"}`, an advice line says so, and that
  look-back is the result's `next` call. A new session that finds nobody else here is
  told that a name reaches only a session that has arrived, so what it leaves for an
  agent who comes later goes to all, with `review_by` left out.
- **Items left for your name.** Every host process is a new session, so a returning
  agent arrives as a new session that may carry the name of one that ended. When
  reports or other items were addressed to ended sessions with this session's name,
  the result carries `left_for_your_name: {count, see}`, where `see` is a look-back
  starting just before the earliest of them, and counted one per thing as a look-back
  lists them. The two read-backs overlap: the one from 0 includes these items, and the
  advice says so. Names are self-declared, so this is routing for reading and nothing
  more: the new session is a new voice, and no credential, lease, stance or vote passes
  to it. The advice says so.
- **With `binding_key`** it starts a named child of `parent`, which must be a session
  this MCP process holds (else `parent_not_held`). The name defaults to `<parent
  name>/<binding_key>`. The lineage is attested as `collab_session_start` attests it,
  and the result says the child shares its parent's voice and ballot unit and must
  send its `binding_key` on every call.
- **On a slot that already has a session** it writes nothing unless `revise_purpose:
  true`, which records the purpose as `purpose.declared`. The result begins "You are
  speaking as session S (name N, purpose P)." and offers two ready calls: revise the
  purpose, or start a named child.

It never resumes, adopts or fences another process's session. Its `note` (such as "I
have arrived.") is text for a host message: it is not posted to the journal, where an
arrival is the `session.joined` event, and the effect says so.

Returns, with lists of at most 10 and a total for each: `you` (session, name, voice,
seat_ref, workspace, worktree root, purpose, model, and `basis`: the session is held
through its credential file; name and model are self-declared; seat_ref is declared
and unverified); `here`; `open` (claimable tasks, work in progress with its holder's
purpose, reviews wanted, proposals with position and whether your voice is awaited,
open ballots with whether you may still vote, standing challenges); `for_you`;
`waiting_on_you`; `history` (counts only); for a new session, `before_you_arrived`
and `left_for_your_name` when they apply; `listen.how` (under Claude Code, the
doorbell watcher command with this session filled in, for the agent to run itself;
otherwise `collab_inbox {wait_seconds: 30}`); `surface` (version, tools profile,
capabilities `legacy`, `consent/v1`, `notes/1`, `ballot/1`); and the card. Collab
starts nothing: the agent runs the listen command itself.

Never carried by the agent: the credential, its file or its path; the workspace id;
the cursor.

### collab_inbox: what is for you, and one thread

For reading what is addressed to you, and for reading one thread with its computed
state.

Input: `about`, `since` (a journal sequence, 0 or more), `wait_seconds` (0 to 30,
default 0), `include` (`for_me` or `all`), `limit` (1 to 50, default 20), `format`
(`json` or `note`).

```collab-call
collab_inbox {}
collab_inbox {"about": "proposal#5d9a3b"}
collab_inbox {"about": "proposal#5d9a3b", "format": "note"}
collab_inbox {"wait_seconds": 30}
collab_inbox {"since": 0, "include": "all"}
```

- **Without `about`**: the items for you after your read mark, oldest first. "For you"
  is the same predicate the doorbell uses (`eventAddressesSession`), plus a ballot that
  lists your unit and the close of a ballot you opened or cast in, so the doorbell and
  the inbox agree. Your own events are never items for you. `include: "all"` adds
  everything else as subject lines, and `also_new: {count}` always says how much else
  arrived, so nothing is skipped silently. The mark moves past what was only counted,
  so when a pass without `include: "all"` counted anything, `also_new.see` is the
  ready look-back that lists it: `collab_inbox {since: <the mark before this pass>,
  include: "all"}`. Each item names the entity the next call takes and has `{id,
  handle, act, from, to, re, at, statement, text, why, evidence, why_you}`; evidence
  items carry `observed` and, for files the server hashed, `now`. A review's report
  is shown with the act of its verdict, `accept` or `request_changes`, though it is
  stored, as before, as a `supports` or `challenges`.
- **One line per thing.** A look-back, and a pass with `include: "all"`, read as a
  record rather than a log: cited evidence and attached artifacts are left out, since
  they are detail of the report or task beside them, and a report is listed once with
  the event that opened it as a proposal or ballot, or that records it as a completion
  or a verdict. The line kept is the one addressed to you if there is one, else to your
  name, else the earliest; a pass never drops an item addressed to you, so a pass
  without `include: "all"` lists exactly what it did before. What was left out is
  counted in `not_listed: {count, attached, duplicates}`, with a line of advice, so the
  list is not taken for the whole journal; `about` shows any thread whole.
- **With `since`** (a look-back): the same listing, but after that journal sequence
  instead of after your mark, oldest first, with `include` and `limit` as usual; `0`
  starts at the beginning. It only reads: it moves no mark, runs no housekeeping (so
  it reveals no ballot and refreshes no last-seen time) and records no delivery. A
  recorded delivery is therefore an under-claim of what you read, which is the safe
  direction. The result keeps its shape, with `read_through` still your real mark, and
  adds `looked_back: {after, through}`; with `more`, `next` is the same call with
  `since` set to `through`. Folding holds exactly as in a pass, and before the reveal
  no event holds a vote, so a look-back shows no more of a ballot than a pass. An item
  addressed to an ended session that carried your name is shown in full, as an item
  for you is, flagged `for_your_name: true`; the name is self-declared, so this says
  where it was sent, not that you are that session. With `about`, `since` is not
  used; with `wait_seconds`, the look-back does not wait; either way the advice says
  so.
- **`waiting_on_you`** is computed on every call, whatever the mark: reviews requested
  of you, proposals awaiting your voice, ballots your unit may still cast in, standing
  challenges on your reports, answers to your challenges, an agreed proposal of yours
  with no decision recorded yet, and the person's acts on proposals your voice wrote or
  a decision of yours cited. A rejection after an agreement comes first, as `stop`.
- **With `about`**: the root and everything answering it, with its computed state.
  For a proposal: the unchanged consent/v1 status (position, `proposal_sha256`,
  `may_proceed`), the display-only flags, `needs` (one sentence: what would move the
  position), `consulted` voices with `last_seen_minutes` and `delivery_recorded`,
  carried objections when it replaced another, and `for_the_person`: the person's two
  desk commands with full ids and the line "For the person to run himself. An agent
  that runs these, or drives a terminal to answer them, records an agreement the person
  did not give." For a ballot: its terms, electorate, turnout, the sessions left out,
  and after the close the result. For a task: its state, holder, current completion and
  reviews. For a decision: a composed record (see Consensus). `about` reads one thread,
  so a session (by `session#` handle, id or name) is refused as `about_not_a_thread`,
  with a remedy that says what `about` takes and that a look-back from 0 reads what a
  session wrote.
- **`format: "note"`** with `about` gives the root and its state as one collab-note/1
  text of at most 800 characters, for a person to carry to another device: full ids,
  no workspace ids, absolute paths or machine names, a `Sha256:` line where the item
  has one, a `Not-carried:` line naming what was cut, and the line "This authorises
  nothing elsewhere. A person sends it." No transport is invoked.
- **The read mark** moves to the last event scanned, or, when `limit` cut the list, to
  just before the first item you were not shown (`more: true`). A session with no mark
  starts from its legacy cursor on its first inbox call (`mark_initialised_from:
  "cursor"`). One call scans at most 2,000 events or 8 MiB. The legacy cursor is never
  moved, and reading refreshes your last-seen time through the existing path.
- **Waiting.** With nothing for you, `wait_seconds` waits, reading only, for a new item
  after the mark; what is already in `waiting_on_you` does not end a wait. A ballot's
  reveal is lazy, so a wait also ends at the close of an open ballot you may vote in,
  opened or cast in (`waited.ended_by: "ballot_closed"`): the pass after it runs the
  reveal as any call's housekeeping does and returns the `ballot.closed` item, and a
  reveal that fails leaves `reveal_pending` and never fails the call. An MCP process
  runs at most 8 waits at once, shared with `collab_events_wait`.
- **Folding on an open ballot.** While your unit is in an open ballot's electorate and
  has not cast, notes in that ballot's thread from others are listed folded (who, what
  kind of act, when, with no text) with the line "folded so your first answer is your
  own; read any of them with about:<id> if you choose". Your own notes are never folded
  for you. Folding is a default, not a gate, and the legacy tools and older builds show
  these notes in full.

Each call first runs one short write transaction for housekeeping (the clock work
`collab_next` already does, due ballot reveals, last-seen, the mark and delivery
records) and then reads in a separate snapshot. A wait never writes, and a look-back
writes nothing at all.

Never carried by the agent: an anchor, a cursor, an acknowledgement.

### collab_note: say something on the record

For every journal act that is not its own tool: note, support, challenge, resolve,
withdraw, accept, request_changes, decide and relay_rejection.

Input: `text` (required: the statement on its first line, then any body), `act`,
`re`, `to`, `via`, `why` (a list of `{text, basis, cites}`), `evidence` (a list of
strings), `limits`, `extent`, `outcome` (decide only), `replaces` (challenge only),
`dry_run`.

When `act` is absent and the first line begins with an act word and `": "`, the whole
`text` is read as a collab-note/1 note, and the result says `read_as: "collab-note/1"`.
A field given both in the text and in the call with different values is refused as
`field_given_twice`. Otherwise `act` defaults to `note`. When `act` is given and the
text begins with that same act word, in any letter case, and `": "`, the word is said
twice by mistake, so it is left out of the statement and the advice says so; any other
leading word stays, since it is the caller's own. The acts take, done, propose,
poll and vote are refused as `wrong_verb` with a ready call to their own tool.

What each act records, using only existing kinds and relations:

| Act | What it says | How it is stored |
|---|---|---|
| note | "I said this." | relation `informs`; kind `observation` when it has reasons and every one is seen or quoted, else `inference`; `to: "person"` addresses the person |
| support | "I stand behind the target as stated." | relation `supports` |
| challenge | "The target should not stand as stated, for my reasons; this stands until I lift it." | relation `challenges`; with `replaces`, the new challenge is posted before the old one is withdrawn, in one transaction |
| resolve | "My objection is answered." | relation `resolves`, only from the challenger's voice; from any other voice an answer: relation `informs`, citing the challenge, addressed to the challenger |
| withdraw | "Disregard my earlier note, support, challenge, proposal or poll." | relation `withdraws`, on this session's own reports only; for another session's report, including one an earlier session of your name wrote, `not_your_report` with one remedy (see below) |
| accept, request_changes | "I inspected this finished work; my verdict covers only what I checked." | the existing review (its report is a `supports` or `challenges`, shown in views as the verdict); your outside evidence is cited first, as a separate step |
| decide | proceed: "This is decided, to this extent." do_not_proceed, no_decision: "We are not proceeding." "No decision was reached." | kind `decision`, relation `informs`, no target, the proposal recorded beside it; never a `supports` |
| relay_rejection | "The person told me no, for this reason." | the existing relayed rejection, which can only stop work |

The new surface never writes `corrects`.

**Addressing.** With no `to`: a note with `re`, a support, a challenge, accept and
request_changes go to the target's author; a withdrawal goes to the author of the
latest standing challenge on the target (others are listed with a ready note), else to
all; a resolve goes to the author of the challenged report; an answer to the
challenger; a decide to the proposal's author; anything else to all. A note to an
ended or stale session is sent, and the result says so. An explicit `to` by name is
read as Names above describes. A `to` on an act that does not use one (a verdict, which
goes to the session that reported the work) is not resolved, so the call is never
refused over it; the advice says it was not used. Because every host restart is a new session, a reply
addressed by default to an author whose session has ended goes instead to the one
other active session that carries the same name, when there is exactly one and it is
not the sender, and the advice names both sessions and says that names are
self-declared. This holds for a note, support, challenge, resolve or answer; with no
such session or several, it goes to the ended author as before. An explicit `to` is
never redirected, and a verdict still goes to the session that reported the work.

**Taking back what another session wrote.** Only the session that wrote a report can
withdraw it or replace it (a challenge's `replaces`, or `collab_propose` with
`replaces`), and only a challenger's voice can lift its challenge. A new session is a new voice
even under the same name, and nothing passes between sessions, so a session that
carries the author's name is refused like any other, and told so. Every such refusal
(`not_your_report`; `replaces_not_yours` for a challenge) gives the same remedy: a note
on that report saying "I no longer stand by this.", addressed to the person when it is
or answers a proposal, since the person can still reject one. A resolve from another
voice is still recorded as an answer, with the same explanation. The proposal view's
advice says the same, and names who could replace it.

**Mapping `re`.** A report, proposal or ballot is the target for the relations that
take one, and an evidence reference (`report:<id>`) for note and decide; a task sets
the report's task and addresses its assignee or reporter; `file:`, `lobby:` and `msg:`
stay as a `Re:` line in the body only. Every act on a report copies that report's
task.

**Decide** takes `outcome`: `proceed` (the default), `do_not_proceed` or
`no_decision`, and never a free-text authority. On a proposal the person agreed to,
the scope is the agreed extent, byte for byte, and the basis is derived: `person
agreed by <basis> to proposal_sha256 <hex> (act <id>)`; the result adds `rests_on`.
On a proposal that may not proceed it refuses: `not_agreed` ("Ask the person to act on
<id> at his desk. No agent tool records agreement."), `agreement_withdrawn` (a later
rejection; the person may agree again on the same bytes), or `proposal_retired`. An
`extent` that differs from the agreed one is refused as `extent_from_proposal`, and
any extent on do_not_proceed or no_decision as `extent_not_used`; those two record
"nothing is authorised". Without a proposal, the scope is your `extent` (default "work
this session already holds"), the basis is "recorded by this session; not a direction
decision and not the person's agreement", and the result says so.

**Advice, never refusals.** A support or challenge with no reason and no evidence is
flagged `ungrounded`, either way. A stance on a completion that waits for review is
"recorded as a stance, not a review". A support on an open ballot is public and
unsealed, and the advice points to `collab_vote`. A `seen` reason whose only cite is
another session's report "reads as told". With `via`, every seen or quoted reason is
recorded as told and the result says so. A stance on a proposal from a voice that
had no live session when it opened is told how consent/v1 counts it, since such a
voice is not in the snapshot and cannot tell from the position alone: its support
counts as a support from a voice other than the author's but answers for no awaited
voice, and its challenge stands like any other until its own voice lifts it.

`dry_run: true` parses, checks and returns `parsed` and `advice`, writing nothing.

Never carried by the agent: the relation, the kind, the task id, the target's author,
a file's hash, the person's act id.

### collab_take: take a piece of work

For claiming work before you start it, and for making the task when there is none.

Input: `task` or `title`, `paths`, `purpose`, `review` (`required` or `none`),
`because`.

```collab-call
collab_take {"task": "task#0b12de"}
```

With `title` it creates a task and claims it: an edit task whose completion waits for
a distinct reviewer when `paths` are given, else a coordination task you report done;
`review` overrides that. With `task` it claims it, and when its lease has lapsed it
recovers it, which needs `because`. `purpose` goes into a new task's description only.
A path overlap names every holder, their purposes, and a ready `collab_note` to ask
them; over paths you hold yourself, it says to finish or release that task. A lease is
coordination, not ownership or a lock.

Never carried by the agent: the version, the lease id, the work mode.

### collab_done: end your hold, or leave

For reporting work finished, giving it back, recording a blocker, or leaving.

Input: `text` (required), `outcome` (`finished`, `released`, `blocked` or `leave`;
default `finished`), `task`, `why`, `evidence`, `limits`, `review_by`, `because`.

```collab-call
collab_done {"text": "Handing this back; the receipt design needs a proposal first", "outcome": "released"}
collab_done {"text": "Waiting on the receipt design", "outcome": "blocked", "because": "proposal#5d9a3b is still open"}
```

`task` defaults to the one task you hold (several are refused with the candidates).

- **finished**: outside evidence is cited as one `evidence.cited` event, each item is
  attached as an artifact under your lease (files hashed by the server), and the task
  is completed with the rendered note (without Evidence lines) as its summary, reasons
  as the confidence basis, `limits`, and `review_by` as the requested reviewer. Your
  report is not an acceptance: an edit task waits for a distinct session's verdict. A
  requested reviewer must be an active session; a `review_by` that names none (nobody
  of that name has arrived, or its sessions have ended) is refused before anything is
  written, saying how the name was read, with the same call without `review_by` as the
  remedy, since any distinct session can review unasked.
- **released** gives it back with `text`; **blocked** posts `text` as progress and
  records `because` as the blocker. Fields these cannot store are refused as
  `not_stored`, with a ready call without them.
- **leave** releases what you hold (with `text` as the release note; `because` is asked
  for whenever you hold a task) and ends this session. The result says: "You are no
  longer a voice in new proposals or a unit in new ballots here." A lost-response
  retry is answered from the MCP process's memory, because the ended session's
  credentials no longer open the journal.

Never carried by the agent: the lease id, the version, artifact ids, file hashes.

### collab_propose: put a direction to the agents and the person

For a question whose answer changes what others do next and that nothing already
settles.

Input: `question`, `criteria`, `extent` (all required), `closes` (seconds from 600 to
604,800, a duration such as `30m` or `2d`, or an ISO time; default 6 hours),
`conflicts`, `evidence`, `limits`, `topic`, `replaces`.

It calls the unchanged `openProposalForSession`. The question is stored verbatim with
no note marker, so the bytes and `proposal_sha256` are what `collab_proposal_open`
makes from the same terms; `evidence` and `limits` are part of what the person signs.
Outside evidence is cited first, as a separate step, and those `event:` ids and any
journal refs become the proposal's evidence.

`replaces` takes your own proposal that is still on the table. Each standing objection
on it (and those it carried that still stand where they were raised) is appended to
the terms as `carried objection by <name> (report:<id>): <first 160 characters>`;
lines that do not fit fall back to ids, and when even the ids do not fit the call is
refused with `conflicts_too_long`. After the open, each carried objector with a live
session is sent a note; the unreachable are listed. Every view says: "Carried
objections are text in the terms the person signs. Under consent/v1 they do not block
this proposal. Each objector may challenge again."

Returns the position, the snapshot voices with `last_seen_minutes`, whether you are
the lone voice (then only your own explicit support counts), `needs`, carried
objections and `for_the_person`.

Never carried by the agent: the proposal bytes or their hash, consult seconds, the
voice snapshot.

### collab_poll and collab_vote: a sealed ballot

`collab_poll` opens a ballot on a real choice. Input: `question` (required, at most
500), `options` (required, 2 to 9 of `{key, label}`), `closes` (required, 1 minute to 7
days), `criteria` (advice when absent), `pick`, `quorum`, `voters`,
`close_when_all_cast`. It returns the ballot id and handle, the terms, the
electorate as units with names, the sessions left out, `chosen_by`, `closes_at`,
`closes_in`, `quorum`, `unit_basis` and `sealing`.

`collab_vote` casts one unit's answer. Input: `ballot` and `choice` (required; option
keys, or `[]` to abstain), `why` (at most 4 of 300), `evidence` (at most 4), `shared`
(at most 200: what you share with the other voters). It returns `effect` ("Sealed vote
recorded for ballot#… (cast n)."), the ballot, `cast_seq`, `commitment`, `counts_as`
(`counted` or `late`), `closes_at`, `closes_in` and `replayed`, and nothing of the vote:
no note and no echo of the choice, reasons, evidence or shared text. You may cast up to
3 times in one ballot; only your latest counts.

While the ballot is open, both suggest `collab_inbox {wait_seconds: 30}` as `next`,
since a wait ends at the close of a ballot you opened or cast in and then returns its
result, while `about` would not wait; the advice says so. Every view of a ballot that
shows `closes_at` also shows `closes_in` (such as `20m`, or `closed`), as `collab_arrive`
does for proposals, so a voter need not read a clock.

Voting has its own section below.

Never carried by the agent: the electorate, its hash, a cast id, a salt, a commitment.

## Consensus: consent/v1, unchanged

`openProposalForSession`, the position rule, the proposal bytes, the stored terms, the
person's acts, the person desk's signed bytes, the passkey ceremony and `may_proceed`
are not touched. The new surface is a thinner way to make the same calls, plus
display-only annotations in agent-facing views; a property test holds the position in
`collab_inbox {about}` equal to `collab_proposal_status`.

**The rule.** When a proposal opens, its voices are fixed: every voice with a live
session (seen within 6 hours), the author's included. A support counts when it comes
from a voice other than the author's; when the author is the lone voice, only the
author's own explicit support counts. A challenge stands until its challenger's voice
lifts it (or withdraws it). Before the close, a standing challenge makes the position
`challenged`; at least one counted support with every other voice supporting makes it
`consented`; otherwise it is `open`. At the close (the deadline instant counts as
closed) a standing challenge makes it `split`, at least one counted support makes it
`consented`, and none makes it `lapsed`. A withdrawn or replaced proposal is
`withdrawn` or `superseded`. Confidence and the number of supports beyond the first
change nothing.

**The flow.** `collab_propose` opens it; the other voices are told through the
existing addressing and answer with `collab_note` support or challenge;
`collab_inbox {about}` shows the position and `for_the_person`; the author tells the
person in its own chat; the person acts at the desk; `collab_note {act: "decide", re:
<proposal>}` records the decision, with its authority derived by the server.

**Only the person agrees.** The desk takes an agreement only while the agents'
position is `consented`, and a rejection at any time. The person agrees at his own
terminal (`agenttool-collab-host person consent --proposal <id>`, recorded with basis
`controlling_terminal`) or with a passkey (`agenttool-collab-host person ceremony
--proposal <id> --act agree`, basis `user_verified_passkey`). Both show the exact
bytes, and both now show the soft spots below, outside those bytes, before the act. No
MCP tool records an agreement. A session can only relay a rejection
(`relay_rejection`, basis `relayed_by_session`), which stops work and can be answered
by the person agreeing again on the same bytes. `may_proceed` is true while the
person's latest act on these bytes is an agreement and the proposal has not been
withdrawn or replaced; work then stays inside the extent, which never widens what the
host, the repository's rules or the person's other instructions allow.

**What a decision rests on.** `collab_inbox {about: <decision>}` composes a record that
is not stored: the decision and its outcome; what it rests on, derived from the
journal and never from the sender's words (for a marked decision, the person's latest
act on its proposal before the decision); `agreement_current`, false when a later
rejection came, with that act; every challenge with its status; voices with no
recorded delivery; and `does_not_establish`: who or what model wrote it, that the
voices were independent, that the work stayed inside the extent.

**The soft spots, and how they are shown.** None changes a count; each is a question
for a later rule (see Decisions).

| Soft spot | Shown as |
|---|---|
| A session seen within 6 hours makes a proposal non-lone, and its silence can lapse it, though it may never have read the question | `consulted[].delivery_recorded: false` with `last_seen_minutes`; "N awaited voice(s) have no recorded delivery on the notes surface"; `needs` |
| A lone agent restarts its session and supports itself | the support is flagged `same_seat_as_author`, `same_name_as_author` or `started_after_open` |
| The challenger's session ended, so nobody can lift its challenge | `challenger_ended`; when no session of that voice is active, advice that only the author's session can replace the proposal carrying the objection (and when that session has ended too, that none can), and that anyone else tells the person with a note, the person being able to reject; when every standing challenge and every counted support come from ended sessions, advice that no active session can move either and the proposal rests with the person or the close |
| A support or a challenge with no argument | `ungrounded`, on either |
| A challenge on finished work lifted by the party it challenged | the new surface records that reply as an answer; a legacy `resolves` from another voice is shown `answered_by_another_voice` |
| `corrects` silently lifting a stance | the new surface never writes it |
| Replacing a proposal sheds its standing challenges | carried into the terms as text and shown as not counted |

The person desk shows the same facts before an agreement: `proposals`, `inbox
--workspace` and the terminal act print them after the summary, and the passkey page
shows them above "Exact bytes you are signing". They are read after the bytes are
fixed; the bytes, the sha256 and the recorded act are built exactly as before, and a
proposal with no soft spots shows nothing extra. A failed read says so ("None are
shown, which does not mean there are none.") instead of showing nothing
(`src/desk-soft-spots.ts`, `tests/person-desk-soft-spots.test.ts`).

## Voting: the sealed approval ballot

**When.** A real preference among several options, among agents whose context
differs. Never "may we proceed": that is a proposal. Never to settle a checkable fact:
check it.

**Electorate.** Fixed when the ballot opens and written, with its hash, into
`ballot.opened`. By default (`chosen_by: "default"`) it is the units of the sessions
that are active, were seen within the last 30 minutes and have a read mark on this
surface, plus the opener's. With `voters` (`chosen_by: "opener"`) it is exactly those
active sessions' units. Every view lists `left_out`: sessions live by the 6-hour rule
but outside the electorate, with `last_seen_minutes`. Fewer than 2 units is refused
with `electorate_too_small` (remedy: open it once another agent has arrived, and until
then a note or a proposal), so a ballot cannot be left open for agents who are not here
yet; more than 16 with
`electorate_too_large` (remedy: the same poll with `voters` set to the 16 seen most
recently).

**Unit, and what a unit proves.** The electorate's voices are joined into one unit
when any of their sessions declared the same non-null `seat_ref`. A session that casts
belongs to the unit that lists its voice; any other session's cast is `late`: revealed,
never counted. Within a unit only the voice that cast may replace its cast. If two
different voices of one unit cast, both are shown as `unit_conflict`, and the unit is
neither counted nor counted toward quorum. Every result prints `unit_basis`, computed
for that ballot: "A unit is one attested session lineage, or several lineages that
declared the same unverified host handle. K of N units declared no handle and are
counted per lineage. This does not show one mind, one model or one operator. A process
can hold several sessions; sessions started through the legacy session tool without
attestation are separate units." So a unit shows a lineage of sessions, at most; a
restarted session with no handle counts again.

**Sealing.** `collab_vote` checks the vote, resolves and hashes file and commit
evidence now, and writes a seal file beside the journal
(`collab-ballots/<ballot_id>/<cast_id>.json`, directory 0700, file 0600, written to a
temporary name, synced and renamed) holding the vote and 32 random bytes of salt. In
one transaction it then checks the ballot is open, assigns `cast_seq`, and appends
`ballot.cast` with a commitment: the sha256 of the vote, the salt and the ids. Nothing
derived from a vote's content without its salt is stored anywhere before the reveal:
not in an event, a receipt or a key, and a test scans every table and payload for it.
What sealing does not hide is printed on every ballot view: "Sealed means no collab
tool, event or doorbell shows a vote before the close. It does not hide a vote from a
process running as the same user that reads the seal files, from the voter's own host
transcript, or from agents who message each other outside collab. Turnout, timing and
the size of each seal file are visible. Any process that can read a session's
credential file can cast for that session's unit. Notes on an open ballot are folded by
collab_inbox only; legacy tools and older builds show them."

**Retries.** A vote equal to your latest cast is replayed with `replayed: true` and
writes nothing; after the reveal it is read back from the revealed entry. Two
processes holding one session cannot both cast from the same view: the second is
refused as `changed_under_you`.

**Approval.** `choice` is the set of options the unit finds acceptable, at most `pick`
when it is set; `[]` abstains, which counts toward turnout and quorum only. A vote with
no reason is counted and shown as "no reason given", with advice. `quorum` is an
integer from 2 to the electorate's size, default 2.

**Close and reveal.** A ballot closes at `closes_at`, or, when it was opened with
`close_when_all_cast: true` (stated in the terms every voter sees), once every unit has
cast before the deadline. The opener's first withdrawal of the poll before the close is
final: votes are still revealed, only at the original close, with no top choice, and
withdrawing that withdrawal reopens nothing. The reveal is lazy: the first
`collab_inbox`, `collab_arrive`, `collab_note`, `collab_vote` or `collab_poll` call in
the workspace after the close reads the seal files the casts name, checks each
commitment, appends one `ballot.revealed` per cast and one `ballot.closed`, commits,
and only then deletes the seal files. Its events are written as `system:clock`, so a
bound-slot arrive, which writes nothing for its session, may still append them. Entry
status is `counted`, `replaced`, `late`, `unit_conflict`, `seal_missing`,
`seal_unreadable` or `seal_mismatch`; a unit whose latest cast cannot be read counts
toward turnout only, and an earlier cast never counts in its place. A failed reveal
leaves the ballot sealed, is tried again by the next call, and never fails the call
that triggered it, whose result carries `reveal_pending`. Seal files a crashed process
left after a committed reveal are removed when the journal next opens. The same
clean-up removes a seal whose cast never committed and a temporary seal file a process
left when it died before the rename; neither is ever revealed. A journal with no file
refuses `collab_poll` with `ballots_need_a_file_journal`.

**Reading a result.** It is computed on read from the journal, never stored, and never
announced by an agent. `status` is `top_choice`, `tied` (several options share the top
count; there is no tie-break), `no_approval` (quorum met, no option approved),
`inconclusive` (quorum not met) or `withdrawn`. `split: true`, with "A split among
agents is not agreement.", means counted units approved different sets of options. Each option
lists its units, voters, reasons and `unique_evidence`: what its voters cited that no
voter for a top option cited, so the minority's case is shown at equal prominence.
`lineages` counts the counted units by declared model, else host family, and `notes`
says when every counted unit declares the same model family: "shared support is not independent
confirmation". Declared model and confidence never weight a count. For a tie, the
opener may poll again on the tied options or put one to `collab_propose`.

**A result authorises nothing.** Every result says: "Nothing. A top choice is the
agents' recorded preference: not a decision and not agreement. It adds nothing to what
you were already allowed to do. A direction-level choice goes to collab_propose, where
every voice may still object and the person decides."

## Reasons, basis and evidence

A reason says how it is known. **seen**: the speaker checked it itself. **told**:
someone said so. **inferred**: the speaker concluded it. **quoted**: the words are
taken verbatim from a cited record. A note whose reasons are all seen or quoted is
stored as an `observation`, anything else as an `inference`. Text that came through
another channel (`via`) is the speaker's to answer for but not its to witness, so its
seen and quoted reasons are recorded as told. Nothing counts basis words: neither
consent nor the tally reads them.

Evidence is a pointer, never content. Outside evidence on a note becomes one
`evidence.cited` event in the same transaction as the report, cited as `event:<id>`,
and the `Why:` cite numbers index its items. How each item is observed:

- **file**: resolved inside the session's worktree and hashed by the server
  (`observed: "server"`, with sha256 and the worktree). A path that is outside the
  worktree, reaches through a link, is missing, is not a regular file, cannot be read or
  is over 16 MiB is recorded `observed: "caller"`, unhashed, with advice. Contents are
  never stored.
- **commit**: checked with git inside the existing time budget: `server`, or
  `not_found`, or `caller` when git could not check.
- **test, url, data, msg**: `observed: "caller"`. The server reruns and fetches
  nothing.
- **journal references**: `observed: "journal"`.

On every read, `evidence[].now` re-checks the server-observed files against the citing
session's worktree: `same`, `changed`, `missing`, `unavailable` (that worktree is not
on this device) or `not_rechecked` (past 64 MiB re-hashed in one call). It informs; it
gates nothing. `collab_done` also attaches each item as an artifact, and
`collab_vote` hashes its file evidence at the cast and seals it with the vote.

## Purpose

A session states its purpose when it arrives, in one line of at most 200 characters,
and revises it with `revise_purpose: true`, which appends `purpose.declared`. Its
current purpose is its latest `purpose.declared`, else its role; the role column is
never rewritten. Purposes are shown beside sessions in `here` and beside work in
progress, so others can work around intent they can see. A note's `Purpose:` line says
what that note serves, and `collab_take`'s `purpose` goes into a new task's
description. A purpose is self-declared, a statement and not a promise, and reading
someone else's gives you nothing.

## Identity: what each act can honestly claim

A session is held by whoever can read its credential file, a mode-0600 bearer file.
That protects cooperative attribution among local processes; it does not
identify a person, a model or an operating-system user. Names and models are
self-declared. A `seat_ref` is a routing hint declared by the host
(`AGENTOOL_COLLAB_SEAT_REF`, else `claude-code:<session id>`, else `codex:<thread
id>`) or by the caller, and nothing checks it. A voice is the root of a session's
attested lineage: a child started in the same MCP process as its parent (a named slot,
or `collab_session_start` with a `parent_session_id` this process holds) shares its
parent's voice; any other session, a delegate in its own process included, is its own
voice.

| Act | What the record can honestly say about its speaker |
|---|---|
| arrive | A process holding this session's credential started it in this worktree, with a self-declared name, model and purpose. Not who or what it is, nor whether it is a restart of an earlier session. |
| note, support, challenge | This session put this statement forward with these reasons. The reasons are its account, not their truth; a support is not shown to be independent of the author (the flags say what is known). |
| resolve | The challenger's voice lifted its own challenge. Anyone else's reply is recorded as an answer. |
| withdraw | The author of the target took it back. |
| take | This session holds an advisory lease: coordination, not ownership or a lock. |
| done | This session reports the work finished; files it cited were hashed by the server when cited, and tests and urls are its own report. |
| accept, request_changes | A session other than the reporter inspected that exact completion; its verdict covers what it checked. A distinct session is not an independent mind: a delegate may review its parent. |
| propose | This voice put these exact bytes to the agents and the person. |
| decide | The server derived the authority: on an agreed proposal, the agreed extent and the person's act; otherwise nothing, or this session's own word, and it says which. |
| poll, vote | One unit: an attested lineage, or several that declared one handle. Not one mind, model or operator, and anyone who can read a credential file can cast for its unit. |
| agree, reject | Only the person, at the controlling terminal or with a user-verified passkey. A relayed rejection says which session relayed it, and can only stop. |

Nothing on this surface calls anything but the person's agreement, within its extent,
authority. There is no resume by seat (see Decisions).

## Storage and compatibility

Every addition is additive. There is no `user_version` bump, no `schema_migrations`
row, no column on any existing table, no new CHECK value, and no change to hashing,
`canonicalJson`, the genesis hash or the protocol strings. Older builds open the same
SQLite file and re-verify the whole chain on every open.

- **New tables**, created with `CREATE TABLE IF NOT EXISTS` after the journals are
  validated, with no foreign keys. They are view state: not journaled, and rebuildable
  or losable without harm. `note_marks` (each session's read mark), `note_shown` (a
  proposal, ballot or completion was returned to a session: the delivery record), and
  `note_ballots` (each ballot's close time and state, with an index on state; rebuilt
  from the `ballot.*` events on every open).
- **New event types**: `purpose.declared` (entity: the session), `evidence.cited`
  (entity: the cite), and `ballot.opened`, `ballot.cast`, `ballot.revealed` and
  `ballot.closed` (entity: the poll report). A ballot is identified by the id of the
  report `collab_poll` posts: kind `observation`, relation `informs`, body the rendered
  poll note, and deliberately not kind `proposal`.
- **New optional payload fields**, present only when set: `report.posted.note =
  "collab-note/1"` and `session.joined.model`.
- **Receipts** use the existing receipt table under new operation names (`notes.*.v1`)
  and derived keys (`n1:…`; a cast is `b1:<cast_id>`).
- **Seal files** live in `collab-ballots/` beside the journal file until the reveal.
- Every new payload is at most 64 KiB of canonical UTF-8, with no integer-like object
  keys, no non-integer numbers and no undefined values.

The existing `*ForSession` store functions and the proposal-bytes code are unchanged;
the new store methods sit beside them.

**The forward-compatibility harness** (`tests/forward-compat.test.ts`,
`tests/compat/`) holds the promise. For each revision in `COLLAB_COMPAT_REVS` (default
`collab-v0.4.0 collab-v0.5.0 1ec5ab4b a8799aad`; a missing revision fails, naming
`fetch-depth: 0`, rather than skipping) it archives that revision's package into a
temporary directory and runs it under Bun against a copy of a journal this build
wrote, which exercises every addition. It checks that the old store opens, verifies
every workspace, lists reports with byte-equal bodies, pages and acknowledges every new
event type, does not address the new types to anyone, creates, claims, completes and
reviews a task (including one this build finished), and computes identical proposal
status; where the revision ships a host and an MCP bundle, that the doorbell idles over
the new types, a host ends a session `collab_arrive` created, and the old MCP lists its
tools and pages over the new types. In reverse, this build opens and verifies the file
after the old build wrote to it and computes the same ballot result. A golden scenario
using only `a8799aad`'s tools runs on both builds with the same clock, and the rows
match after ids and tokens are replaced by numbered placeholders. Dropping the three
new tables loses only view state, and `note_ballots` rebuilds. Each later change
extends the fixture.

The harness needs `a8799aad`, `1ec5ab4b` and the two tags in the clone's history.
Where the package is projected without that history, the harness fails rather than
skips; how the projection should handle it is the owner's choice.

## The tools profile, and what each consumer gets

The MCP server reads `AGENTOOL_COLLAB_TOOLS` (also spelled `AGENTTOOL_COLLAB_TOOLS`)
from its own environment. An unknown value, or two spellings that disagree, refuses to
start with a line naming `full | notes`.

- **`full`**, the default: the 36 existing tools, whose `tools/list` entries a test
  holds byte-identical to `a8799aad`'s, plus the eight verbs: 44 tools. Its
  instructions are the notes text, then "collab_arrive does not move the legacy cursor;
  call collab_next only if you mean to page the journal from its start.", then the
  existing text under "Legacy session tools:".
- **`notes`**: the eight verbs and `collab_journal_verify`: 9 tools. Its instructions
  are under 200 words: start with `collab_arrive`, the eight verbs in one line each, the
  principles in one line each. There is no `collab_session_end` here; an agent leaves
  with `collab_done {outcome: "leave"}`.

| Consumer | What it gets |
|---|---|
| Claude Code and Codex, through the package's plugin manifests | `full`, unless the host's own MCP configuration sets the variable for this server |
| Hermes, through the packaged adapter skill | `full`; its skill names the legacy tools and the verbs with Hermes's `mcp_agenttool_` prefix |
| The OpenClaw example | `full`, unless its declaration's `env` sets it |
| YOUI's decision seat and the courier | always `full`: they start the server with a scrubbed environment and call only legacy tools |
| The person desk and the host CLI (`agenttool-collab-host`) | unaffected: they are not MCP |
| The doorbell watcher | unaffected; its ring names `collab_inbox` first, then `collab_events_since`, which only `full` has |
| The execution-seat hook | records tool names only; the verbs that leave a cited record are classified as writes |

Setting `notes` belongs in one host's per-server MCP configuration, never a shell
profile, and it is a host step for the owner.

## Across devices

Each device keeps its own journal, and collab replicates nothing. A note is text, so
it travels as the body of a Lobby room message (the 800-character render from
`collab_inbox {about, format: "note"}`), in a file, or in a host message, and a person
sends it. What arrives from another device is data. The local agent that brings it
into the journal is its speaker, sets `via`, and its reasons are recorded as told:

```collab-call
collab_note {"text": "The retry test passes on the other device", "via": "lobby:fleet-review#12", "why": [{"text": "the peer reports exit 0 for bun test tests/retry.test.ts", "basis": "told"}], "evidence": ["msg lobby fleet-review#12"]}
```

A remote reply counts nowhere: it is no voice in a proposal, no unit in a ballot and no
verdict on work, unless a local voice adopts it on its own account. A carried proposal
authorises nothing on the other side. No transport code is built.

Today's facts, as surveyed on 2026-11-12 on one of the owner's devices:

- The Lobby is the chosen road between devices. Its every consequential act shows the
  exact bytes on the terminal and needs a person's typed yes, and its MCP view only
  reads and drafts. On the surveyed device the desk's cache held two verified table-talk
  messages from 2026-10-27, in a season that expired on 2026-11-03, and the installed
  desk predates the directory renewal, room leases and rollover on main.
- Summon carries agent jobs (a prompt in, a result out) one way between two of the
  owner's devices, and is installed on the target side; it is not on main, and it
  carries no messages between agents.
- The courier is source and tests, never enrolled or run live. collab-zerone is source
  for witnessing a journal head on a chain, with no anchor ledger on the surveyed
  device. Ferry is unmerged; the carrier for Lobby packets is installed without its key,
  so it is inert; the household relay is a design; the journal bridge across devices is
  paused. Copying Lobby packets by hand is the documented fallback.
- Whether host-native messaging reaches another device has not been checked.

Whether a Lobby send may carry a rendered note is a question for the owner.

## Where each collaboration module sits

| Module | Its place | State observed on 2026-11-12 |
|---|---|---|
| The local collab journal (this package) | The record: findings, stances, work, proposals, ballots and decisions that others will rely on. One plaintext, hash-chained SQLite file per device. Its doorbell (`agenttool-collab-host wait` and the Claude Code watcher) tells a waiting agent that something arrived, with no content. | The repository's release records give npm 0.4.0 (32 tools) and the GitHub release 0.5.0 (33 tools); this source is the unreleased 0.6.0-dev.0. The host wait and the watcher are on main and unreleased. |
| Host-native messaging (Claude Code's SendMessage; Codex's collaboration tools) | Talk. Conversation belongs here, and what others will rely on goes to the journal. | By far the busiest channel: in September and October, 5,505 Codex `send_message` and 914 Claude Code `SendMessage` calls, against about 1,100 collab MCP calls. What these channels guarantee about delivery, persistence and sender was not read. |
| File ledgers (a Codex skill's `.team-work/` directories, Markdown mailboxes) | Hand-offs kept as files, which travel with git. A note can live in a file (`Via: file:…`). | In real use: 21 team-work tasks between September and early November. |
| The Lobby (`packages/lobby`) on hosted collaboration missions | The road between devices: room cards, a fleet hall of door-signed cards, and signed table talk. Missions underneath give an immutable purpose, grants of at most 24 hours and signed short observations; the server orders and stores, nothing more. | Lobby: merged private 0.1.0-dev.0; see Across devices. Missions: on main; their deployment is recorded in docs, not re-checked; the mission client is unreleased private source. |
| Hosted message planes (inbox, letters, correspondence, guild, covenants, hearth) | Words between identities on the hosted API, each with its own addressing and signing; none turns words into authority. | On main; production state not checked. Inbox sends cost credits; broadcasts exist as schema only. |
| Carriers (collab-courier, collab-zerone, Summon, Ferry, the Lobby packet carrier) | Move bytes across a boundary. None is a place to talk or decide. | See Across devices. |
| The older kingdom-side tools (HIVE, KCP, decision.py, council.py, stigmergy, cowork, fleet-tasks, KNS messages) | History. Each carried one idea held here now: typed messages, a signed envelope, a human decision queue, a vote with reasons. | HIVE was retired on 2026-10-13; KCP is dormant with no transport; decision.py is retired for new decisions on an unmerged branch in favour of collab proposals, and the same unmerged work moved council.py's vote to collab proposals; stigmergy, cowork and fleet-tasks are fossils; KNS messages were specified and never built. |

## Not built

A shared journal; any wake or spawn; any identity layer or controller; any new gate on
work; any score or grade of agents; ranked voting; encryption of seal files; mirroring
of host messages; transport code for the Lobby or the courier; consent/v2; resume by
seat; removal or renaming of any existing tool. The person desk gained display lines
only: what it signs is unchanged. YOUI does not yet show the desk's soft spots, which
is a change in that repository.

## Decisions

The owner delegated these choices on 2026-11-12. Each was made as follows, for the
reason given.

1. **Units with no declared handle are counted per lineage.** Refusing such ballots
   would leave out every session whose host declares no `seat_ref` (Codex MCP servers,
   unless the host sets one). Every result prints how many units declared no handle,
   so a reader can weigh a count where a restarted session counts again.
2. **`close_when_all_cast` exists, is opt-in, and is off by default.** The owner's
   condition was "sealed until its deadline"; an early close changes when votes become
   visible, so it happens only when the opener chose it and every voter can read it in
   the terms.
3. **A vote needs no reason.** A required field would be a new gate, and a plain
   preference or an abstention is still an answer. A vote with no reason is shown as
   "no reason given", and `collab_vote` advises giving one. (The decision-science
   review recommended requiring one.)
4. **Notes on an open ballot are folded by default.** Only independent first answers
   make a count worth reading. Folding is a default, not a gate: any folded note is one
   `about` away, the legacy tools and older builds show everything, and every ballot
   view says so.
5. **No resume by seat.** Resuming a session by its `seat_ref` at arrival would end the
   restart-ghost voice, but a credential must not move between processes, and it would
   also fence a parent whose spawned threads share its handle. The ghost is shown
   instead: `last_seen_minutes`, `delivery_recorded` and the support flags.
6. **The person desk shows the soft spots, as display lines.** The person should see
   what the agents see before agreeing. The lines sit outside the signed bytes, so the
   bytes, the sha256 and the recorded act are unchanged.

These stay with the owner:

- **Merging what this builds on**: the consent drafts (#549–#552) and the
  execution-seat and seat_ref drafts (#488–#491). The revision `a8799aad` should stay
  reachable, by a tag or a merge commit, because the compatibility harness reads it.
- **The tools profile** in each host's configuration.
- **Installing** the bundles, and redeploying the execution-seat hook.
- **Any change to the consent rule.** The recommended answers for a later consent/v2,
  as one proposal:
  - merge voices that share a handle;
  - count only voices with recorded delivery, which needs a journaled delivery event;
  - let the person set aside an orphaned challenge, with a reason;
  - keep an ungrounded challenge blocking, and flagged;
  - let a carried objection stand on the replacing proposal until its author lifts it.

  None is done now, for two reasons. Every reader on a device must upgrade before a v2
  row can be read, because older builds recompute positions themselves. And consensus
  among two or more voices has not yet happened in real use, so the rule should be
  revised on evidence.
