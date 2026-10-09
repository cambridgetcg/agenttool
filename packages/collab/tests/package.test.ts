import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");

const ORDINARY_LOOP = [
  "collab_session_start",
  "collab_next",
  "collab_cursor_ack",
  "collab_task_claim",
  "collab_artifact_attach",
  "collab_task_complete",
  "collab_task_review",
  "collab_session_end",
];

const RELATION_TABLE_HEADER = "| Relation | `target_report_id` | Who may append | Use it to |";

const RELATIONS = [
  "informs",
  "supports",
  "challenges",
  "resolves",
  "corrects",
  "withdraws",
  "supersedes",
];

const HOUSEHOLD_TERMS = [
  RELATION_TABLE_HEADER,
  "release_leases",
  "release_summary",
  "session_has_active_leases",
  "review_requested_session_id",
  "review_report_id",
  "accepted_by_session_id",
  "confidence_basis",
  "allowed_prefixes",
  "artifact:artifact_",
  "event:",
  "report:",
  "checkpoint:",
  "result_checkpoint_digest",
  "parent_session_id",
  "declared lineage",
  "never pass your session file",
  "liveness",
  "assignee_liveness",
  "recovery_required",
  "after_sequence_unsupported_in_bound_session",
  "collab_events_since",
  "delivers by artifact",
  "agenttool-collab-host",
  "host_commit_successor",
  "git_checkpoint_stale",
];

// Declared rest, four-state liveness, knocks as pointers and delivery hints
// (knock-and-rest spec, schema 3). Checked on whitespace-flattened text so a
// phrase may wrap across Markdown lines.
const KNOCK_TERMS = [
  "collab_session_rest",
  "session.rested",
  "session.returned",
  "wake_on",
  "addressed_waiting",
  "addressee",
  "`tap`",
  "`wake`",
  "`held`",
  "`none`",
  "{seq, kind, from_actor, ref_id}",
  "never a body",
  "silence is complete",
  "agenttool-collab-host knocks",
  "doorbell-scan",
  "ambiguity means silence",
  "Rest is declared, never inferred",
  "never releases, renews, extends or reassigns",
];

const LIVENESS_PRECEDENCE = "`ended`, `resting`, `stale` or `live`";
const REVIEWER_GUIDANCE = "unless the requested reviewer reads `live`, or `resting` with `wake_on` addressed";
const DELIVERY_TABLE_HEADER = "| `delivery` | Addressee reads | Meaning |";
// The household-smoothing wording that called an ended session stale.
const ENDED_AS_STALE = /`stale` once (?:it has |the session has )?ended|ended session always/;

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

function expectInOrder(text: string, heading: string, names: string[]): void {
  const start = text.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n## ", start + heading.length);
  const section = text.slice(start, end === -1 ? undefined : end);
  let cursor = -1;
  for (const name of names) {
    const at = section.indexOf(name, cursor + 1);
    expect(at).toBeGreaterThan(cursor);
    cursor = at;
  }
}

async function json(path: string): Promise<any> {
  return await Bun.file(join(packageRoot, path)).json();
}

describe("cross-host package", () => {
  test("points Codex and Claude at one bundled MCP runtime", async () => {
    const packageManifest = await json("package.json");
    const codex = await json(".codex-plugin/plugin.json");
    const claude = await json(".claude-plugin/plugin.json");

    expect(packageManifest.version).toBe("0.5.0");
    expect(codex.version).toBe(packageManifest.version);
    expect(claude.version).toBe(packageManifest.version);
    expect(codex.skills).toBe("./skills/");
    expect(codex.mcpServers["agenttool-collab"]).toEqual({
      type: "stdio",
      command: "bun",
      args: ["dist/agenttool-collab-mcp.js"],
      cwd: ".",
    });
    expect(claude.mcpServers["agenttool-collab"]).toEqual({
      command: "bun",
      args: ["${CLAUDE_PLUGIN_ROOT}/dist/agenttool-collab-mcp.js"],
    });
    expect(codex.interface.capabilities).toContain("Read-only Zerone witness status");
    expect(codex.interface.capabilities).toContain("Bounded read-only event waiting");
    for (const manifest of [packageManifest, codex, claude]) {
      expect(manifest.description).toContain("bounded event waiting");
      expect(manifest.description).not.toContain("UNRELEASED");
    }
    expect(codex.interface.longDescription).toContain("never contacts a chain");
    expect(claude.description).toContain("read-only Zerone witness status");
  });

  test("ships the plugins, skills, executable bundle, and notices", async () => {
    const packageManifest = await json("package.json");
    const files = packageManifest.files as string[];

    expect(files).toContain(".codex-plugin");
    expect(files).toContain(".claude-plugin");
    expect(files).toContain("skills");
    expect(files).toContain("integrations");
    expect(files).toContain("dist");
    expect(files).toContain("THIRD_PARTY_LICENSES");
    expect(packageManifest.bin["agenttool-collab-mcp"]).toBe("./dist/agenttool-collab-mcp.js");
    expect(packageManifest.bin["agenttool-collab-host"]).toBe("./dist/agenttool-collab-host.js");
    expect(packageManifest.keywords).toContain("hermes-agent");
    expect(packageManifest.keywords).toContain("zerone");
    expect(statSync(join(packageRoot, "dist", "agenttool-collab-mcp.js")).mode & 0o111).not.toBe(0);
    expect(statSync(join(packageRoot, "dist", "agenttool-collab-host.js")).mode & 0o111).not.toBe(0);
  });

  test("pins the bundler Bun to the version CI builds with", async () => {
    // The tracked bundle is byte-compared against a fresh build, and Bun's
    // codegen differs between releases. `bundlerBunVersion` is what makes that
    // comparison meaningful, so it has to stay equal to the version CI installs
    // — otherwise CI rebuilds differently from whoever committed the bundle.
    const packageManifest = await json("package.json");
    expect(packageManifest.bundlerBunVersion).toBeString();

    const workflow = Bun.file(
      join(packageRoot, "..", "..", ".github", "workflows", "ci.yml"),
    );
    if (!(await workflow.exists())) return; // not present in the published tarball

    const pins = [...(await workflow.text()).matchAll(/bun-version:\s*(\S+)/g)].map(
      (match) => match[1],
    );
    expect(pins.length).toBeGreaterThan(0);
    for (const pin of pins) {
      expect(pin).toBe(packageManifest.bundlerBunVersion);
    }
  });

  test("keeps release-candidate host guidance bounded and non-lifecycle", async () => {
    for (const path of [
      "README.md",
      "skills/coordinate-agent-work/SKILL.md",
      "integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md",
      "integrations/openclaw/README.md",
    ]) {
      const text = await Bun.file(join(packageRoot, path)).text();
      for (const term of ["RELEASE CANDIDATE", "0.5.0", "0.4.0", "34", "32", "collab_events_wait",
        "next_anchor", "256 KiB", "1 MiB", "8 MiB", "event_anchor_too_large", "stdin EOF",
        "event_too_large", "event_read_busy", "last_seen", "persona"]) {
        expect(text).toContain(term);
      }
      expect(text).toMatch(/\b34(?: local)?(?: MCP)? tools\b/);
      expect(text).not.toMatch(/\b33(?: local)?(?: MCP)? tools\b|\b33-tool\b/);
    }
    const openclaw = await Bun.file(join(packageRoot, "integrations/openclaw/README.md")).text();
    expect(openclaw).toContain("not a native lifecycle adapter");
    expect(openclaw).toContain("has not been exercised in live OpenClaw");
    expect(openclaw).toContain("AGENTOOL_COLLAB_DB");
    expect(openclaw).toContain("structuredContent");
    expect(openclaw).toContain("SOUL.md");
    expect(openclaw).toContain("IDENTITY.md");
    expect(openclaw).toContain("USER.md");
  });

  test("teaches the ordinary loop, relation targeting, delegation, and clean exit", async () => {
    for (const path of [
      "skills/coordinate-agent-work/SKILL.md",
      "integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md",
      "README.md",
    ]) {
      const text = await Bun.file(join(packageRoot, path)).text();
      for (const term of HOUSEHOLD_TERMS) expect(text).toContain(term);
      for (const relation of RELATIONS) expect(text).toContain(`| \`${relation}\` |`);
      expectInOrder(text, "## The ordinary loop", ORDINARY_LOOP);
    }

    const skill = await Bun.file(join(packageRoot, "skills/coordinate-agent-work/SKILL.md")).text();
    expect(skill).toContain("· sol job <job-id>");
    expect(skill).toContain("agenttool-collab-host end --session-file <path> --reason <text> --release-leases");
    const description = /^description: (.+)$/m.exec(skill)?.[1] ?? "";
    expect(description).toContain("requested reviewer");
    expect(description).toContain("ending a session cleanly");
    expect(description.length).toBeLessThanOrEqual(1024);
  });

  test("points the Codex skill prompt at the ordinary loop", async () => {
    const yaml = await Bun.file(join(packageRoot, "skills/coordinate-agent-work/agents/openai.yaml")).text();
    expect(yaml).toContain("$coordinate-agent-work");
    expect(yaml).toContain("ordinary loop");
    expect(yaml).toContain("requested reviewer");
    expect(yaml).toContain("release_leases");
  });

  test("teaches declared rest, four-state liveness, knocks as pointers and delivery hints", async () => {
    const read = async (path: string) => await Bun.file(join(packageRoot, path)).text();
    for (const path of [
      "skills/coordinate-agent-work/SKILL.md",
      "integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md",
      "README.md",
    ]) {
      const text = flat(await read(path));
      for (const term of KNOCK_TERMS) expect(text).toContain(term);
      expect(text).toContain(LIVENESS_PRECEDENCE);
      expect(text).toContain(REVIEWER_GUIDANCE);
      expect(text).not.toMatch(ENDED_AS_STALE);
    }

    const readme = flat(await read("README.md"));
    for (const term of [
      DELIVERY_TABLE_HEADER,
      "agenttool-collab-host knocks --host-ancestor auto|<pid> [--mark-tapped] [--db <path>]",
      "agenttool-collab-host doorbell-scan [--db <path>]",
      "agenttool.collab-knock/1",
      "agenttool.collab-doorbell-scan/1",
      "collab-sessions/knock-ledger.json",
      "<session-id>.host.json",
      "agenttool.collab-host-binding/1",
      "host_started_at",
      "`readonly`, `query_only`, zero busy timeout",
      "print nothing and exit 0",
      "{workspace_id?, idempotency_key, mode: \"resting\" | \"ready\", until?, reason?, wake_on?}",
    ]) expect(readme).toContain(term);

    const rawSkill = await read("skills/coordinate-agent-work/SKILL.md");
    expect(flat(rawSkill)).toContain(DELIVERY_TABLE_HEADER);
    expect(flat(rawSkill)).toContain("### Rest and return");
    const description = /^description: (.+)$/m.exec(rawSkill)?.[1] ?? "";
    expect(description).toContain("declared rest and return");
    expect(description).toContain("knocks");
    expect(description.length).toBeLessThanOrEqual(1024);

    const hermes = flat(await read("integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md"));
    expect(hermes).toContain("mcp_agenttool_collab_session_rest");
    expect(hermes).toContain("No host wake exists for Hermes yet");
    expect(hermes).toContain("`wake_on: []`");
  });

  test("points the Codex prompt and plugin at declared rest and quiet knocks", async () => {
    const yaml = await Bun.file(join(packageRoot, "skills/coordinate-agent-work/agents/openai.yaml")).text();
    expect(yaml).toContain("collab_session_rest");
    expect(yaml).toContain("knocks as pointers");
    expect(yaml).toContain("silence as a complete answer");
    const codex = await json(".codex-plugin/plugin.json");
    expect(codex.interface.longDescription).toContain("Collab 0.5.0: 34 tools");
    expect(codex.interface.longDescription).toContain("declared rest");
  });

  test("ships an explicit Hermes adapter for separate presence and secure planes", async () => {
    const skill = await Bun.file(join(
      packageRoot,
      "integrations",
      "hermes",
      "skills",
      "coordinate-agent-work-hermes",
      "SKILL.md",
    )).text();

    expect(skill).toContain("mcp_agenttool_collab_workspace_open");
    expect(skill).toContain("mcp_agenttool_collab_session_join");
    expect(skill).toContain("mcp_agenttool_collab_session_list");
    expect(skill).toContain("mcp_agenttool_collab_session_heartbeat");
    expect(skill).toContain("mcp_agenttool_collab_session_leave");
    expect(skill).toContain("mcp_agenttool_collab_session_start");
    expect(skill).toContain("mcp_agenttool_collab_session_end");
    expect(skill).toContain("mcp_agenttool_collab_cursor_ack");
    expect(skill).toContain("mcp_agenttool_collab_events_wait");
    expect(skill).toContain("mcp_agenttool_collab_report_append");
    expect(skill).toContain("mcp_agenttool_collab_task_review");
    expect(skill).toContain("mcp_agenttool_collab_task_claim");
    expect(skill).toContain("mcp_agenttool_collab_handoff_offer");
    expect(skill).toContain("mcp_agenttool_collab_anchor_status");
    expect(skill).toContain("never contacts a chain");
    expect(skill).toContain("heartbeat never renews a task");
    expect(skill).toContain("self-declared");
    expect(skill).toContain("credential-bound");
    expect(skill).toContain("do not authenticate");
    expect(skill).toContain("does not lock files");
    expect(skill).toContain("AGENTOOL_COLLAB_SESSION_FILE");
    expect(skill).toContain("never read");
    expect(skill).not.toContain("mcp_agenttool_collab_session_token");
  });
});
