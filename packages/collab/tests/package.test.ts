import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { COLLAB_PACKAGE_VERSION } from "../src/version.js";

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

const GUIDANCE_FILES = [
  "README.md",
  "skills/coordinate-agent-work/SKILL.md",
  "integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md",
  "integrations/openclaw/README.md",
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `version` as a whole version, never as the prefix of a longer one: 0.5.1
 * does not match inside 0.5.1-dev.0, and 0.5.1-dev.0 does not match inside
 * 0.5.1-dev.01. A sentence-ending period after the version is allowed.
 */
function exactVersion(version: string): string {
  return `(?<![\\w.-])${escapeRegExp(version)}(?![\\w-]|\\.\\d)`;
}

/**
 * Release-label problems in one guidance text for `version`. A development
 * build must carry its exact DEVELOPMENT BUILD label and no release-candidate
 * label. A release must carry no DEVELOPMENT BUILD label and no stale
 * `<version>-dev` label, so a dev-to-release bump cannot leave old text behind.
 */
function guidanceLabelProblems(text: string, version: string): string[] {
  const problems: string[] = [];
  if (!new RegExp(exactVersion(version)).test(text)) {
    problems.push(`does not name ${version} exactly`);
  }
  if (version.includes("-dev.")) {
    if (!new RegExp(`DEVELOPMENT BUILD:? ${exactVersion(version)}`).test(text)) {
      problems.push(`lacks the exact "DEVELOPMENT BUILD ${version}" label`);
    }
    if (text.includes("RELEASE CANDIDATE")) {
      problems.push("calls a development build a RELEASE CANDIDATE");
    }
  } else {
    if (text.includes("DEVELOPMENT BUILD")) {
      problems.push(`keeps a DEVELOPMENT BUILD label on release ${version}`);
    }
    if (new RegExp(`${escapeRegExp(version)}-dev`).test(text)) {
      problems.push(`still names a ${version}-dev build`);
    }
  }
  return problems;
}

/** The same exactness for the Codex plugin's longDescription. */
function codexDescriptionProblems(description: string, version: string): string[] {
  const problems: string[] = [];
  if (!new RegExp(`^Collab ${exactVersion(version)}`).test(description)) {
    problems.push(`does not start with "Collab ${version}"`);
  }
  const isDevelopment = version.includes("-dev.");
  if (isDevelopment !== /development build/i.test(description)) {
    problems.push(isDevelopment
      ? "does not call a -dev version a development build"
      : `calls release ${version} a development build`);
  }
  return problems;
}

/** Versions a stale label must fail against: the next dev build and the release. */
function neighbouringVersions(version: string): string[] {
  const dev = /^(\d+\.\d+\.\d+)-dev\.(\d+)$/.exec(version);
  if (dev) return [dev[1]!, `${dev[1]}-dev.${Number(dev[2]) + 1}`];
  const release = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!release) throw new Error(`unexpected collab version shape: ${version}`);
  return [`${release[1]}.${release[2]}.${Number(release[3]) + 1}-dev.0`];
}

async function json(path: string): Promise<any> {
  return await Bun.file(join(packageRoot, path)).json();
}

describe("cross-host package", () => {
  test("points Codex and Claude at one bundled MCP runtime", async () => {
    const packageManifest = await json("package.json");
    const codex = await json(".codex-plugin/plugin.json");
    const claude = await json(".claude-plugin/plugin.json");

    expect(COLLAB_PACKAGE_VERSION).toBe("0.5.1-dev.0");
    expect(packageManifest.version).toBe(COLLAB_PACKAGE_VERSION);
    expect(codex.version).toBe(packageManifest.version);
    expect(claude.version).toBe(packageManifest.version);
    expect(codexDescriptionProblems(codex.interface.longDescription, packageManifest.version)).toEqual([]);
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

  test("derives the MCP serverInfo version and instruction prefix from one constant", async () => {
    // events-wait.test.ts checks the committed bundle's live handshake, and
    // check:mcp-bundle keeps that bundle equal to a fresh build of this source.
    const mcpSource = await Bun.file(join(packageRoot, "src", "mcp.ts")).text();
    expect(mcpSource).toContain('{ name: "agenttool-collab", version: COLLAB_PACKAGE_VERSION }');
    expect(mcpSource).toContain("`Collab ${COLLAB_PACKAGE_VERSION}: ");
    expect(mcpSource).not.toMatch(/Collab \d+\.\d+\.\d+/);
    expect(mcpSource).not.toMatch(/version: "\d+\.\d+\.\d+/);
  });

  test("labels host guidance with the exact version and keeps it bounded and non-lifecycle", async () => {
    const version = (await json("package.json")).version as string;
    for (const path of GUIDANCE_FILES) {
      const text = await Bun.file(join(packageRoot, path)).text();
      for (const term of ["0.5.0", "0.4.0", "33", "32", "collab_events_wait",
        "next_anchor", "256 KiB", "1 MiB", "8 MiB", "event_anchor_too_large", "stdin EOF",
        "event_too_large", "event_read_busy", "last_seen", "persona"]) {
        expect(text).toContain(term);
      }
      expect({ path, problems: guidanceLabelProblems(text, version) }).toEqual({ path, problems: [] });
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

  test("the exact-label guard rejects today's labels at the next dev build and at the release", async () => {
    // Without boundaries, "0.5.1" matches inside "0.5.1-dev.0", and a
    // dev-to-release bump could keep every DEVELOPMENT BUILD label green.
    const version = (await json("package.json")).version as string;
    const description = (await json(".codex-plugin/plugin.json")).interface.longDescription as string;
    for (const other of neighbouringVersions(version)) {
      expect(codexDescriptionProblems(description, other).length).toBeGreaterThan(0);
      for (const path of GUIDANCE_FILES) {
        const text = await Bun.file(join(packageRoot, path)).text();
        expect({ path, other, stale: guidanceLabelProblems(text, other).length > 0 })
          .toEqual({ path, other, stale: true });
      }
    }
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
