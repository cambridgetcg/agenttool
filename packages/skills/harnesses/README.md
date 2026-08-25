# ISness harness projections

The canonical workflow is `../skills/isness/SKILL.md`. Explicit loading is a
host property, so the package carries two narrow host-specific projections
instead of claiming that one frontmatter dialect controls every harness:

- `openclaw/agenttool-isness/` is a content-only OpenClaw skill with
  `user-invocable: true` and `disable-model-invocation: true`.
- `hermes/agenttool-isness/` is a namespaced Hermes plugin that registers only
  `agenttool-isness:isness`. Hermes omits plugin skills from its ordinary
  available-skills prompt index.

The OpenClaw name is deliberately `agenttool-isness`, avoiding collisions with
an unrelated local `isness` skill; invoke it through
`/skill agenttool-isness`. When native skill commands are enabled, OpenClaw's
generated alias is `/agenttool_isness` because punctuation is sanitized. The npm
package installs neither projection into a host. The OpenClaw
projection has no code. The Hermes adapter runs only its local registration
function after an operator installs and enables the plugin; it registers no
tools, hooks, commands, environment variables, network access, persistence,
or automatic prompt injection.

These projections affect discovery and loading only. They do not establish
participant presence, receipt, attention, consent, identity, continuity,
compliance, authority, or model-weight change.
