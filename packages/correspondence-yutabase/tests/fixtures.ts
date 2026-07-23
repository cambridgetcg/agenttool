import type {
  CorrespondenceEventRecord,
  CorrespondenceKind,
} from "../src/index.js";

export const EVENT_ID = "sha256:" + "1".repeat(64);
export const PARENT_EVENT_ID = "sha256:" + "2".repeat(64);
export const SECOND_PARENT_EVENT_ID = "sha256:" + "3".repeat(64);
export const ARTIFACT_DIGEST = "sha256:" + "4".repeat(64);

export const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
export const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
export const SIGNING_KEY_ID = "33333333-3333-4333-8333-333333333333";
export const DEVICE_ID = "44444444-4444-4444-8444-444444444444";
export const SESSION_ID = "55555555-5555-4555-8555-555555555555";
export const RAW_SIGNATURE = "S".repeat(85) + "A";

export interface FixtureOptions {
  readonly eventId?: string;
  readonly kind?: CorrespondenceKind;
  readonly parents?: readonly string[];
  readonly body?: unknown;
  readonly missingParents?: readonly string[];
  readonly lineageStatus?: CorrespondenceEventRecord["lineage_status"];
}

export function makeRecord(
  options: FixtureOptions = {},
): CorrespondenceEventRecord {
  return {
    event: {
      protocol: "agent-correspondence/v0.1",
      event_id: options.eventId ?? EVENT_ID,
      project_id: PROJECT_ID,
      repository_id: "repo:github.com/example/private-project",
      thread_id: "task:42",
      sender: {
        identity_id: IDENTITY_ID,
        signing_key_id: SIGNING_KEY_ID,
        device_id: DEVICE_ID,
        session_id: SESSION_ID,
      },
      kind: options.kind ?? "progress",
      parents: options.parents ?? [],
      session_seq: 7,
      issued_at: "2026-07-22T12:00:00.000Z",
      scope: {
        base_revision: "a".repeat(40),
        branch: "private/branch-name",
        paths: ["private/source", "secret/design"],
      },
      body: options.body ?? {
        summary: "private payload summary must not cross the mapping boundary",
        arbitrary_secret: "payload-secret-value",
      },
      authority: {
        automatic_action: "never",
        grants: [],
      },
      signature: {
        algorithm: "Ed25519",
        value_b64url: RAW_SIGNATURE,
      },
    },
    receipt: {
      received_seq: "42",
      received_at: "2026-07-22T12:00:03.217Z",
    },
    missing_parents: options.missingParents ?? [],
    lineage_status: options.lineageStatus ?? "not_applicable",
  };
}
