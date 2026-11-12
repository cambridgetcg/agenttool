/**
 * The golden scenario of spec 8.5: one script that uses only tools a8799aad
 * already has, run through each build's own MCP tool handlers with the same
 * injected clock. Comparing the two journals row by row shows that the new
 * build writes the existing tools' records exactly as a8799aad does.
 *
 * It takes the build's modules as arguments and imports nothing from src, so
 * the same script drives an archived revision and this tree alike.
 */

export interface GoldenBuild {
  CollabStore: new (path: string, options?: { now?: () => Date }) => { close(): void };
  buildCollabMcpServer: (store: any, options?: { environment?: Record<string, string | undefined> }) => unknown;
}

export const GOLDEN_CLOCK_START = Date.parse("2026-11-12T09:00:00.000Z");

/** The report the bare-append check compares by payload key set. */
export const GOLDEN_BARE_REPORT_BODY = "A bare report: only the required fields.";

export interface GoldenProposal {
  report_id: string;
  proposal_bytes: string;
  proposal_sha256: string;
}

export interface GoldenOutcome {
  tool_calls: number;
  proposals: GoldenProposal[];
}

export async function runGoldenScenario(
  build: GoldenBuild,
  options: { databasePath: string; root: string },
): Promise<GoldenOutcome> {
  let time = GOLDEN_CLOCK_START;
  const now = () => new Date(time);
  // Two processes' worth of state: each MCP process has its own store and slots.
  const authorStore = new build.CollabStore(options.databasePath, { now });
  const peerStore = new build.CollabStore(options.databasePath, { now });
  const authorServer = build.buildCollabMcpServer(authorStore, { environment: {} });
  const peerServer = build.buildCollabMcpServer(peerStore, { environment: {} });
  let calls = 0;

  async function call(server: unknown, name: string, args: Record<string, unknown>): Promise<any> {
    // Every call gets its own second, however many times the build reads the clock.
    time += 1_000;
    calls += 1;
    const registration = (server as {
      _registeredTools: Record<string, { handler?: Function; callback?: Function }>;
    })._registeredTools[name];
    if (!registration) throw new Error(`golden scenario: tool not registered: ${name}`);
    const result = await (registration.handler ?? registration.callback)!(args, {}) as {
      isError?: boolean;
      structuredContent: any;
    };
    if (result.isError) {
      throw new Error(`golden scenario: ${name} failed: ${JSON.stringify(result.structuredContent)}`);
    }
    return result.structuredContent;
  }
  const author = (name: string, args: Record<string, unknown>) => call(authorServer, name, args);
  const child = (name: string, args: Record<string, unknown>) =>
    call(authorServer, name, { ...args, binding_key: "child" });
  const peer = (name: string, args: Record<string, unknown>) => call(peerServer, name, args);

  try {
    const started = await author("collab_session_start", {
      root_path: options.root,
      actor: "golden-author",
      role: "writes the golden scenario",
      seat_ref: "golden:author",
    });
    const workspace_id = started.workspace.id as string;
    const authorId = started.session.id as string;
    await child("collab_session_start", {
      root_path: options.root,
      actor: "golden-author/child",
      role: "a named child",
      parent_session_id: authorId,
    });
    const peerStarted = await peer("collab_session_start", {
      root_path: options.root,
      actor: "golden-peer",
      role: "answers the author",
    });
    const peerId = peerStarted.session.id as string;

    const bare = (await author("collab_report_append", {
      workspace_id,
      idempotency_key: "golden-bare",
      kind: "observation",
      body: GOLDEN_BARE_REPORT_BODY,
    })).report;
    const full = (await author("collab_report_append", {
      workspace_id,
      idempotency_key: "golden-full",
      kind: "inference",
      body: "A full report.\n\nWith a body, 協作, and every optional field.",
      evidence_refs: [`report:${bare.id}`],
      confidence: "medium",
      confidence_basis: "Inferred from the bare report.",
      limits: "Not checked outside the scenario.",
      to_session_id: peerId,
    })).report;
    await peer("collab_report_append", {
      workspace_id,
      idempotency_key: "golden-support",
      kind: "inference",
      body: "I stand behind it.",
      relation: "supports",
      target_report_id: bare.id,
    });
    const challenge = (await peer("collab_report_append", {
      workspace_id,
      idempotency_key: "golden-challenge",
      kind: "inference",
      body: "It should not stand as stated.",
      relation: "challenges",
      target_report_id: full.id,
    })).report;
    await peer("collab_report_append", {
      workspace_id,
      idempotency_key: "golden-resolve",
      kind: "observation",
      body: "My objection is answered.",
      relation: "resolves",
      target_report_id: challenge.id,
    });
    await author("collab_report_append", {
      workspace_id,
      idempotency_key: "golden-withdraw",
      kind: "inference",
      body: "Disregard the full report.",
      relation: "withdraws",
      target_report_id: full.id,
    });
    await author("collab_report_append", {
      workspace_id,
      idempotency_key: "golden-person",
      kind: "observation",
      body: "For the person's inbox.",
      to_person: true,
    });
    await author("collab_decision_record", {
      workspace_id,
      idempotency_key: "golden-decision",
      topic: "golden",
      decision: "Keep the scenario stable.",
      rationale: "Two builds must write it alike.",
      authority_scope: "the golden scenario only",
      authority_basis: "recorded by this session; not the person's agreement",
    });

    const proposal = (await author("collab_proposal_open", {
      workspace_id,
      idempotency_key: "golden-proposal",
      question: "Should both builds write this proposal alike?",
      criteria: "Row-by-row equality after normalisation.",
      extent: "The golden journal only.",
      known_conflicts: "None known.",
      evidence_refs: [`report:${bare.id}`],
      limits: "A scenario, not a decision.",
      topic: "compat:golden",
      consult_seconds: 3_600,
    })).proposal;
    await peer("collab_report_append", {
      workspace_id,
      idempotency_key: "golden-proposal-support",
      kind: "inference",
      body: "Yes.",
      relation: "supports",
      target_report_id: proposal.proposal.id,
    });
    await child("collab_report_append", {
      workspace_id,
      idempotency_key: "golden-child-support",
      kind: "inference",
      body: "The child agrees, as part of its parent's voice.",
      relation: "supports",
      target_report_id: proposal.proposal.id,
    });
    const second = (await author("collab_proposal_open", {
      workspace_id,
      idempotency_key: "golden-proposal-2",
      question: "Should a relayed rejection be written alike?",
      criteria: "Row-by-row equality.",
      extent: "The golden journal only.",
    })).proposal;
    const status = (await peer("collab_proposal_status", {
      workspace_id,
      proposal_report_id: second.proposal.id,
    })).proposal;
    await peer("collab_proposal_relay_rejection", {
      workspace_id,
      idempotency_key: "golden-relay",
      proposal_report_id: second.proposal.id,
      proposal_sha256: status.proposal_sha256,
      reason: "The person said no.",
    });

    const created = (await author("collab_task_create", {
      workspace_id,
      idempotency_key: "golden-edit-create",
      title: "Golden edit task",
      description: "Claim, progress, attach, complete, review.",
      work_mode: "edit",
      completion_policy: "accepted",
      path_scopes: ["golden/edit.txt"],
    })).task;
    const claimed = (await author("collab_task_claim", {
      workspace_id,
      idempotency_key: "golden-edit-claim",
      task_id: created.id,
      expected_version: created.version,
    })).task;
    const progressed = (await author("collab_task_progress", {
      workspace_id,
      idempotency_key: "golden-edit-progress",
      task_id: claimed.id,
      lease_id: claimed.lease_id,
      expected_version: claimed.version,
      message: "Half way.",
    })).task;
    const attached = await author("collab_artifact_attach", {
      workspace_id,
      idempotency_key: "golden-edit-attach",
      task_id: progressed.id,
      lease_id: claimed.lease_id,
      expected_version: progressed.version,
      kind: "url",
      uri: "https://example.invalid/golden",
      label: "golden link",
    });
    const reported = (await author("collab_task_complete", {
      workspace_id,
      idempotency_key: "golden-edit-complete",
      task_id: attached.task.id,
      lease_id: claimed.lease_id,
      expected_version: attached.task.version,
      summary: "The golden edit is done.",
      confidence: "high",
      confidence_basis: "The scenario wrote it.",
      limits: "Nothing outside the scenario.",
      evidence_refs: [`artifact:${attached.artifact.id}`],
      review_requested_session_id: peerId,
    })).task;
    await peer("collab_task_review", {
      workspace_id,
      idempotency_key: "golden-edit-review",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "Accepted.",
    });

    const handed = (await author("collab_task_create", {
      workspace_id,
      idempotency_key: "golden-handoff-create",
      title: "Golden handoff task",
      work_mode: "coordination",
    })).task;
    const held = (await author("collab_task_claim", {
      workspace_id,
      idempotency_key: "golden-handoff-claim",
      task_id: handed.id,
      expected_version: handed.version,
    })).task;
    const offer = await author("collab_handoff_offer", {
      workspace_id,
      idempotency_key: "golden-handoff-offer",
      task_id: held.id,
      lease_id: held.lease_id,
      expected_version: held.version,
      to_session_id: peerId,
      summary: "Yours if you want it.",
    });
    const accepted = (await peer("collab_handoff_respond", {
      workspace_id,
      idempotency_key: "golden-handoff-accept",
      handoff_id: offer.handoff.id,
      expected_version: offer.task.version,
      response: "accept",
    })).task;
    const blocked = (await peer("collab_task_block", {
      workspace_id,
      idempotency_key: "golden-handoff-block",
      task_id: accepted.id,
      lease_id: accepted.lease_id,
      expected_version: accepted.version,
      blocker: "Waiting on nothing in particular.",
    })).task;
    await peer("collab_task_unblock", {
      workspace_id,
      idempotency_key: "golden-handoff-unblock",
      task_id: blocked.id,
      expected_version: blocked.version,
      note: "Unblocked.",
    });

    const next = await peer("collab_next", { workspace_id, event_limit: 50 });
    await peer("collab_cursor_ack", {
      workspace_id,
      anchor: next.events.next_anchor,
      expected_cursor_version: next.session.cursor_version,
    });

    // The proposal hash covers random ids, so the comparison checks the bytes it hashes instead.
    const proposals: GoldenProposal[] = [];
    for (const id of [proposal.proposal.id, second.proposal.id] as string[]) {
      const read = (await author("collab_proposal_status", { workspace_id, proposal_report_id: id })).proposal;
      proposals.push({ report_id: id, proposal_bytes: read.proposal_bytes, proposal_sha256: read.proposal_sha256 });
    }

    await child("collab_session_end", { reason: "golden scenario finished" });
    await peer("collab_session_end", { reason: "golden scenario finished" });
    await author("collab_session_end", { reason: "golden scenario finished" });
    return { tool_calls: calls, proposals };
  } finally {
    peerStore.close();
    authorStore.close();
  }
}
