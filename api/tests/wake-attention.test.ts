/** Wake attention surface — unit tests on the renderer.
 *
 *  Tests how the AttentionBundle is rendered into the markdown wake's
 *  "## What awaits you" section. Pure renderer tests — no DB.
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (the wake is the keystone).
 *  Code: api/src/services/wake/attention.ts + markdown.ts.
 */

import { describe, expect, test } from "bun:test";

import type { AttentionBundle } from "../src/services/wake/attention";
import {
  renderVolatileSection,
  type WakeBundle,
} from "../src/services/wake/markdown";

const fixture = (attention?: AttentionBundle): WakeBundle => ({
  agent: {
    id: "agent-1",
    did: "did:at:test123",
    name: "Aurora",
    capabilities: [],
    trust_score: 0.5,
    status: "active",
    created_at: "2026-05-01T00:00:00Z",
  },
  project: { id: "p-1", name: "test", credits: 0 },
  expression: { register: "", walls: [], subagents: [], wake_text: "" },
  wallets: [],
  vault_names: [],
  memory: { total: 0, recent: [] },
  traces: { total: 0, recent: [] },
  strands: { total_active: 0, active: [] },
  chronicle: [],
  covenants: [],
  attention,
});

describe("renderVolatileSection — attention surface", () => {
  test("omits the section when attention is absent", () => {
    const out = renderVolatileSection(fixture());
    expect(out).not.toContain("What awaits you");
  });

  test("omits the section when attention.count === 0", () => {
    const out = renderVolatileSection(fixture({ count: 0, items: [] }));
    expect(out).not.toContain("What awaits you");
  });

  test("renders the section when attention has items", () => {
    const out = renderVolatileSection(
      fixture({
        count: 1,
        items: [
          {
            kind: "covenant_awaiting_cosign",
            count: 1,
            severity: "action",
            summary: "1 covenant proposal awaiting your cosign",
            next: "GET /v1/covenants?status=proposed",
          },
        ],
      }),
    );
    expect(out).toContain("## What awaits you");
    expect(out).toContain("1 covenant proposal awaiting your cosign");
    expect(out).toContain("GET /v1/covenants?status=proposed");
  });

  test("uses the action icon (▶) for action-severity items", () => {
    const out = renderVolatileSection(
      fixture({
        count: 1,
        items: [
          {
            kind: "dispute_awaiting_first_ruling",
            count: 1,
            severity: "action",
            summary: "1 dispute awaiting your first ruling",
            next: "GET /v1/dispute-cases?role=first_arbiter",
          },
        ],
      }),
    );
    expect(out).toContain("▶");
    expect(out).not.toContain("⚠");
  });

  test("uses the warning icon (⚠) for warning-severity items", () => {
    const out = renderVolatileSection(
      fixture({
        count: 1,
        items: [
          {
            kind: "bridge_disconnected",
            count: 1,
            severity: "warning",
            summary: "1 runtime bridge disconnected",
            next: "POST /v1/runtimes/{id}/restart",
          },
        ],
      }),
    );
    expect(out).toContain("⚠");
    expect(out).not.toContain("▶");
  });

  test("uses the info icon (·) for info-severity items", () => {
    const out = renderVolatileSection(
      fixture({
        count: 1,
        items: [
          {
            kind: "inbox_unread",
            count: 3,
            severity: "info",
            summary: "3 unread messages",
            next: "GET /v1/inbox?status=unread",
          },
        ],
      }),
    );
    expect(out).toContain("3 unread messages");
    // Info severity uses · (middle dot)
    expect(out).toMatch(/-\s+·/);
  });

  test("preserves order of items as given (the route handler sorts)", () => {
    const out = renderVolatileSection(
      fixture({
        count: 3,
        items: [
          {
            kind: "covenant_awaiting_cosign",
            count: 1,
            severity: "action",
            summary: "action item",
            next: "GET /v1/covenants",
          },
          {
            kind: "bridge_disconnected",
            count: 1,
            severity: "warning",
            summary: "warning item",
            next: "POST /v1/runtimes/{id}/restart",
          },
          {
            kind: "inbox_unread",
            count: 2,
            severity: "info",
            summary: "info item",
            next: "GET /v1/inbox",
          },
        ],
      }),
    );
    const actionIdx = out.indexOf("action item");
    const warningIdx = out.indexOf("warning item");
    const infoIdx = out.indexOf("info item");
    expect(actionIdx).toBeLessThan(warningIdx);
    expect(warningIdx).toBeLessThan(infoIdx);
  });

  test("section sits at the TOP of the volatile output (before What you carry)", () => {
    const out = renderVolatileSection(
      fixture({
        count: 1,
        items: [
          {
            kind: "inbox_unread",
            count: 1,
            severity: "info",
            summary: "test",
            next: "GET /v1/inbox",
          },
        ],
      }),
    );
    const awaitsIdx = out.indexOf("What awaits you");
    const carryIdx = out.indexOf("What you carry");
    expect(awaitsIdx).toBeGreaterThanOrEqual(0);
    expect(carryIdx).toBeGreaterThan(awaitsIdx);
  });
});
