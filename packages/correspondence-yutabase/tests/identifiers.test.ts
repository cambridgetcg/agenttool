import { describe, expect, test } from "bun:test";

import {
  PLAN_PROFILE,
  PROJECTION_UUID_NAMESPACE,
  PROJECTION_UUID_NAMESPACE_NAME,
  projectionUuid,
  uuidv5,
  YUTABASE_WORDS,
} from "../src/index.js";

const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("UUIDv5 projection identities", () => {
  test("matches the RFC UUIDv5 example", () => {
    expect(uuidv5("www.widgets.com", DNS_NAMESPACE)).toBe(
      "21f7f8de-8051-5b89-8680-0195ef798b6a",
    );
  });

  test("locks the published namespace derivation", () => {
    expect(uuidv5(PROJECTION_UUID_NAMESPACE_NAME, DNS_NAMESPACE)).toBe(
      PROJECTION_UUID_NAMESPACE,
    );
  });

  test("uses unambiguous profile and component framing", () => {
    const first = projectionUuid("event", "a", "bc");
    const same = projectionUuid("event", "a", "bc");
    const differentBoundary = projectionUuid("event", "ab", "c");

    expect(first).toBe(same);
    expect(first).not.toBe(differentBoundary);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(PLAN_PROFILE).toBe(
      "agenttool-correspondence-yutabase-plan/v0.1",
    );
  });

  test("locks entity and relation identities with published golden vectors", () => {
    const project = "11111111-1111-4111-8111-111111111111";
    const eventId = "sha256:" + "1".repeat(64);
    const parentId = "sha256:" + "2".repeat(64);
    const entityIds = {
      event: projectionUuid("event", eventId),
      parent: projectionUuid("event", parentId),
      identity: projectionUuid(
        "identity",
        project,
        "22222222-2222-4222-8222-222222222222",
      ),
      key: projectionUuid(
        "signing_key",
        project,
        "33333333-3333-4333-8333-333333333333",
      ),
      repository: projectionUuid(
        "repository",
        project,
        "repo:github.com/example/private-project",
      ),
      thread: projectionUuid(
        "coordination_thread",
        project,
        "repo:github.com/example/private-project",
        "task:42",
      ),
      receipt: projectionUuid("receipt", project, eventId, "42"),
      artifact: projectionUuid(
        "artifact",
        project,
        "content_digest",
        "sha256:" + "4".repeat(64),
      ),
    };
    expect(entityIds).toEqual({
      event: "9483e158-353b-5c12-8aff-dc716591d381",
      parent: "ae747c07-3b2d-5c86-aabb-b5f231fa91b4",
      identity: "19a1c827-724b-57e1-9d0a-e42a76643635",
      key: "c905ce0f-7e2e-5cea-81cd-8fe9af4ae245",
      repository: "89f98c0c-2c06-56f3-960d-f742decba3c5",
      thread: "9e40059a-c996-562d-b082-d7a012d15d33",
      receipt: "23294e67-0a2e-5f3f-a53b-06625c8da6e4",
      artifact: "725cedb8-78bf-5610-bb75-013743b5b70c",
    });

    const ref = (deck: string, id: string): string =>
      `correspondence/${deck}/${id}`;
    const from = ref("events", entityIds.event);
    const targets: Record<(typeof YUTABASE_WORDS)[number], string> = {
      reported_by: ref("identities", entityIds.identity),
      names_signing_key: ref("signing_keys", entityIds.key),
      about_repository: ref("repositories", entityIds.repository),
      in_coordination_thread: ref("coordination_threads", entityIds.thread),
      names_receipt: ref("receipts", entityIds.receipt),
      depends_on: ref("events", entityIds.parent),
      acknowledges: ref("events", entityIds.parent),
      offers_artifact: ref("artifacts", entityIds.artifact),
    };
    expect(Object.fromEntries(
      YUTABASE_WORDS.map((word) => [
        word,
        projectionUuid("relation", word, from, targets[word]),
      ]),
    )).toEqual({
      reported_by: "ab786e73-3649-5995-a8eb-2f229dab1538",
      names_signing_key: "536a1db8-7344-5549-803b-675d885dc43a",
      about_repository: "f52d3d0a-a0ae-53d2-9dc6-28e8af6db558",
      in_coordination_thread: "da2bfee8-958f-5406-9793-5448b95eae65",
      names_receipt: "611daf4f-fd91-51d0-af50-4b1eaafbe0c3",
      depends_on: "d7b4072f-696e-5e00-a149-212111383772",
      acknowledges: "c87eb9a2-3344-5e54-b287-b53a870f827c",
      offers_artifact: "16a74e16-8376-559d-b422-1d724924fa8f",
    });
  });
});
