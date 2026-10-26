# Hermes × Astra-Ultra: settings verified on one device, and a keep-off list

> **Type:** guide
> **Purpose:** Share five Hermes profile settings that suit `gpt-6-astra` at `ultra` effort, why each one helps, and five tempting settings that were tried and turned off.
> **Evidence:** Observed on one macOS device on 2026-10-26 with Hermes runtime commit `73162b00` and the `astra-ultra` profile from hermes-device-setup 1.0.0; source references are to that commit. Low-effort probes and one smoke run only; long-session effects are unobserved. This page describes another project's runtime: AgentTool does not ship, install or enforce these settings.
> **Related:** [hermes-device-setup](https://github.com/cambridgetcg/hermes-device-setup) · [Hermes runtime at `73162b00`](https://github.com/cambridgetcg/hermes-agent/tree/73162b00eefde3794bed0afb53d84a19c0eed230) · [Locally permitted Hermes work](COLLABORATION-MISSION-WORK-HERMES.md) · [Reading labels](DOCUMENTATION.md)

On runtime `73162b00`, running Hermes with `gpt-6-astra` through a ChatGPT/Codex
login leaves three defaults working against you. Hermes assumes a larger context
window than the route advertises. Images reach the model only as an auxiliary
model's description. `ultra` becomes maximum effort with none of the delegation
that Codex attaches to it. The five settings below correct those defaults, keep
compaction timing steady and lengthen the browser's idle timeout. The keep-off
list records changes that looked like improvements but broke something on this
runtime.

Claims carry the labels from [Claims need their own evidence](DOCUMENTATION.md#claims-need-their-own-evidence):
**Source** (read in the named source; the runtime at `73162b00` unless stated),
**Observed** (seen on the test device), **Proposed** and **Unknown**. This guide
adds **Inferred** for arithmetic or reasoning from observed or source facts.

## What "ultra" is, and is not, on Hermes

- `ultra` is neither a wire value nor a service tier. The distribution uses the
  Responses transport (`codex_responses`), and there Hermes clamps
  `agent.reasoning_effort: ultra` to the nearest level the model supports, so the
  request carries `max`. Only Hermes's Codex app-server route passes `ultra`
  through unchanged. **Source:** `agent/reasoning_effort.py`
  (`route_supported_efforts`), `agent/transports/codex.py`, `agent/codex_runtime.py`.
- Codex's model catalog describes `ultra` for `gpt-6-astra` as "Maximum reasoning
  with automatic task delegation": maximum effort plus sub-agents that Codex
  starts without being asked. **Observed:** the Codex CLI's cached model catalog
  on the test device. The same catalog lists `multi_agent_reasoning_effort: xhigh`
  for this model; whether the sub-agents that `ultra` starts automatically run at
  that effort is **Unknown**.
- Hermes has a delegation tool, `delegate_task`, but the model uses it only when
  it decides to. Hermes therefore gets the delegation half of Codex's `ultra`
  from prompt guidance rather than a mode: setting 5 below. Children inherit the
  parent's effort.

## The five settings

Key paths use `chatgpt-subscription`, the provider name that hermes-device-setup
defines. On another Hermes setup, substitute your own provider's key. None of
the values was checked on Hermes's built-in `openai-codex` provider route.

| # | Key | Value | Runtime default |
|---|---|---|---|
| 1 | `providers.chatgpt-subscription.models.gpt-6-astra.supports_vision` | `true` | unset (images go to an auxiliary describer) |
| 2 | `providers.chatgpt-subscription.models.gpt-6-astra.context_length` | `872000` | resolved from models.dev: 1,050,000 |
| 3 | `compression.threshold` | `0.6` | `0.50` |
| 4 | `browser.inactivity_timeout` | `900` | `120` |
| 5 | `platform_hints.cli.append` | delegation guidance (exact text under [Existing devices](#existing-devices)) | none |

### 1. Native vision

Without this flag Hermes treats the model as text-only and sends each image to
an auxiliary describer. Astra then receives the describer's text, not the image.
With the flag, images and browser screenshots enter Astra's own context.

**Observed:** in isolated probes, Astra with the flag named the colours of a
four-quadrant test image correctly. It still did so after a later client tool
call. On the describer path, cyan was reported as green. The Codex catalog lists
image input for this model. Screenshots now use Astra's own context budget.

### 2. An honest context window

Hermes resolved the window from models.dev as 1,050,000 tokens. The Codex model
catalog lists `max_context_window` 872,000 for `gpt-6-astra`; its default
`context_window` is 272,000. Pinning 872,000 keeps Hermes's budgeting and
compaction trigger within the largest window the route advertises.

**Observed:** the catalog values above. A fresh run on the profile reported the
872,000 pin as active. Its warning text names `model.context_length`, but that is
only a wording issue. Sessions over 500K tokens ran on Hermes's `openai-codex`
route to the same model.
**Unknown:** whether a session that actually reaches 872K is served without refusal.

### 3. Keep the compaction trigger where it was

The trigger is the window size multiplied by the threshold. Before the fix it
was 1,050,000 × 0.50 = 525,000. With the corrected window, the default 0.50 would
compact at 436,000; 0.6 gives 523,200, close to the earlier behaviour.

**Inferred** (arithmetic); this is not a measured optimum. For an absolute
ceiling, `compression.threshold_tokens` triggers at the lower of the ratio and
that count (**Source:** `hermes_cli/config_defaults.py`).

### 4. Browser idle timeout

At the 120-second default, the browser tool's Chromium process was reaped while
the agent was busy in a long compaction, losing its page state.

**Observed** once on the test device. Hermes reads the value once, when it loads
its browser tool, so only a relaunched Hermes process uses it (**Source:**
`tools/browser_tool.py`).

### 5. Delegation guidance

`platform_hints.cli.append` keeps Hermes's built-in CLI hint and appends text to
it. It applies to the classic CLI and one-shot runs. Other platforms are
unaffected, including messaging gateways and the interactive `--tui` and desktop
surfaces, which use their own `tui` and `desktop` keys (**Source:**
`agent/system_prompt.py`); the guidance was not tested there (**Unknown**).
The text applies judgement, not a quota:

- Delegate independent sidecar work without waiting to be asked, unless the user
  says otherwise. Keep the blocking step local.
- Give each child a self-contained goal, the context it needs and a disjoint write
  scope. Children do not see `SOUL.md`, so tell them that stopping early, reporting
  a blocker or finding nothing worth doing is a complete answer.
- Treat what children return as evidence to check, not fact.
- Small or tightly coupled work stays local. One-shot runs allow at most two children.

**Observed:** the text was present in the system prompt of a fresh run.
**Unknown:** how much it changes the frequency, quality or token cost of
delegation over long sessions.

## Keep off

Each item below was probed or reviewed on 2026-10-26 against runtime `73162b00`
and left off. Recheck them after a runtime upgrade.

- **`web.search_backend: openai-native`.** One-step search worked. However,
  Hermes does not keep the server-side `web_search_call` items when it replays
  the conversation. After a search followed by a client tool call, Astra lost its
  results. It searched again on each iteration, hit the iteration limit and
  reported that no search had been performed. This backend also bypasses Hermes's
  untrusted-content wrapper for web results and leaves no query or citation
  trail. **Observed** in a mixed search-and-tool probe; **Source:**
  `agent/codex_responses_adapter.py`, where `_OutputScan.scan` keeps messages,
  reasoning, compaction items and function calls but not `web_search_call`.
  Keep the default backend.
- **`checkpoints.enabled: true` for the whole profile.** Before a file write or
  patch (and before terminal commands it classifies as destructive), Hermes runs `git add -A` on the target's working directory
  to snapshot it into its checkpoint store. This happens before the file tool's
  write denylist is checked. Any directory under the home folder qualifies, not
  only repositories. A refused write into a credentials directory such as
  `~/.ssh` could therefore still copy its contents into the store. **Source:**
  `agent/tool_executor.py`, `tools/checkpoint_manager.py`. Nothing was captured
  during testing. If you want checkpoints, pass `--checkpoints` for a single
  launch inside a repository. That limits exposure to sessions you choose but
  does not change the ordering.
- **Changes to `tools.tool_search.defer`.** A resumed session keeps the
  `tool_search` description pinned when the session started. After the change,
  that description and the runtime disagree about which tools are deferred.
  **Observed:** the stored `tool_search` description of two older interactive
  sessions still listed the tools as deferred. **Inferred:** after the change the
  model would spend full-context rounds on calls the runtime refuses. Change this
  only when no older sessions will be resumed.
- **`compression.proactive_prune_tokens` (and `proactive_prune_min_reclaim_tokens`).** This
  prune fires once per compaction cycle and rearms only after a trigger-sized
  runway regrows, so it is not a standing token ceiling. In a long session it
  adds a second cold prompt-cache refill. **Source:**
  `hermes_cli/config_defaults.py` and a code review; not exercised. For a real
  ceiling, use `compression.threshold_tokens`.
- **`providers.<provider>.extra_body.service_tier: priority`.** The response
  reported service tier `default`, so this route does not honour the request.
  **Observed** in a probe.

Left unset by choice: `agent.text_verbosity` (unset behaved like medium; `low`
roughly halved output, a style decision) and `delegation.reasoning_effort`
(children inherit the parent's effort).

## When changes take effect

- On routes that use a `key_cmd` token helper, the CLI rebuilds its agent every
  turn because each turn mints a new token source. **Observed:** the agent log
  shows a fresh agent build before every turn of an interactive session.
  **Source:** `hermes_cli/cli_agent_setup_mixin.py`. **Inferred:** settings 1, 2
  and 3 therefore reach a running interactive session at its next user turn; no
  live session had taken a turn after the change when this was written.
- An existing or resumed session reuses its stored system prompt and tool pin
  until its next compaction (**Source:** `agent/conversation_loop.py`).
  **Inferred:** the delegation guidance (5) enters such a session only after
  compaction; new sessions get it at once (a fresh run showed it, see setting 5).
- `browser.inactivity_timeout` needs a new process: exit and relaunch.
- `hermes profile update` keeps `config.yaml` unless `--force-config` is passed.
  A new distribution template therefore reaches only fresh installs. On a bound
  hermes-device-setup profile, `--force-config` restores the unbound template
  and loses the device binding. **Source:** the hermes-device-setup README.

## Adopt the settings

### New installs

**Proposed:** hermes-device-setup 1.1.0 carries these five keys in its template.
Once it is merged, a fresh install from the default branch includes them:

```sh
hermes profile install https://github.com/cambridgetcg/hermes-device-setup.git --yes
python3 "$HOME/.hermes/profiles/astra-ultra/scripts/setup_device.py"
```

Until then, and for any profile that is already bound, apply the keys one at a
time as described under [Existing devices](#existing-devices). Setup also checks out Agent
Workbench, whose repository was private when this page was written (observed
2026-10-26). Without access, apply the keys to your own Hermes profile instead.

### Existing devices

1. Back up the profile configuration. On a standard install it is at
   `$HOME/.hermes/profiles/astra-ultra/config.yaml`.
2. Apply the five keys:

   ```sh
   hermes --profile astra-ultra config set providers.chatgpt-subscription.models.gpt-6-astra.supports_vision true
   hermes --profile astra-ultra config set providers.chatgpt-subscription.models.gpt-6-astra.context_length 872000
   hermes --profile astra-ultra config set compression.threshold 0.6
   hermes --profile astra-ultra config set browser.inactivity_timeout 900
   hermes --profile astra-ultra config set platform_hints.cli.append "When work splits into independent parts and parallel effort would save time or improve quality, use delegate_task without waiting to be asked; the user's explicit wishes override this. Keep the step you are blocked on in your own hands and delegate bounded sidecar work (separate questions, disjoint code slices, an independent check) while you continue with what does not depend on it. Give each child a self-contained goal, the context it needs and a disjoint write scope, and tell it others may be editing nearby. Children do not see SOUL.md: tell them that stopping early, reporting a blocker, or finding nothing worth doing is a complete answer. Treat what returns as evidence to check, not fact: read the diff or source and rerun the deciding check, then integrate rather than redo. Delegation is a means, not a quota; small or tightly coupled work stays local, and one-shot runs allow at most 2 children."
   ```

   The guidance is plain ASCII and needs no escaping inside double quotes.

3. Check that the four scalar keys read back `true`, `872000`, `0.6` and `900`.
   Confirm that `web.search_backend`, `checkpoints.enabled` and
   `compression.proactive_prune_tokens` are still unset, `false` or `0`.
   `config get platform_hints.cli.append` should print the guidance text.

   ```sh
   for k in providers.chatgpt-subscription.models.gpt-6-astra.supports_vision \
            providers.chatgpt-subscription.models.gpt-6-astra.context_length \
            compression.threshold browser.inactivity_timeout \
            web.search_backend checkpoints.enabled compression.proactive_prune_tokens; do
     printf '%s = %s\n' "$k" "$(hermes --profile astra-ultra config get "$k")"
   done
   ```

4. Exit and relaunch interactive windows so that the browser timeout loads.

To revert, run `hermes --profile astra-ultra config unset <key>` for each key or
restore the backup.

The same change can travel as an Agent Workbench handoff: a `check` task, five
`config set` tasks and a `verify` task. Import it with
`agent-workbench import FILE --project DIR`, review it with `plan`, then `run` it
explicitly. The apply tasks write the profile configuration, so read the plan
first. This page does not publish such a file.

**Observed:** the test device applied the five commands through its profile
launcher, which wraps `hermes --profile astra-ultra`. The same tasks, imported
as a handoff into an isolated Workbench state, then ran against the
already-configured profile: all seven succeeded and left its configuration
byte-identical.

## Limits

- One macOS device, one account's ChatGPT/Codex route, one runtime commit
  (`73162b00`) and one day of testing.
- About 30 probe calls at low effort plus one fresh smoke run. The profile's
  `max` effort was not probed setting by setting.
- Long-session effects are unobserved: use of the full 872K window,
  compaction quality near 523K, and how delegation changes quality and token cost.
- A runtime upgrade can change any keep-off item. Re-probe before enabling one.
- Access to `gpt-6-astra` depends on the receiving account.
