import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createLivingSubstrateMap,
  createRegenerationProposal,
  encodeLivingSubstrateMap,
  encodeRegenerationProposal,
  sha256Id,
  type CreateLivingSubstrateMapInput,
  type CreateRegenerationProposalInput,
} from "../src/index.js";

const vectors = JSON.parse(
  readFileSync(
    join(
      import.meta.dir,
      "..",
      "vectors",
      "agenttool-living-substrate-v0.1.json",
    ),
    "utf8",
  ),
);

describe("pinned Living Substrate vector", () => {
  test("pins semantic IDs and full canonical artifact bytes", () => {
    expect(vectors.schema).toBe("agenttool.living-substrate-vectors/0.1");
    const vector = vectors.vector;
    const map = createLivingSubstrateMap(
      vector.map_input as CreateLivingSubstrateMapInput,
    );
    const proposal = createRegenerationProposal(
      map,
      vector.proposal_input as CreateRegenerationProposalInput,
    );
    const mapBytes = encodeLivingSubstrateMap(map);
    const proposalBytes = encodeRegenerationProposal(proposal);
    expect(map.map_id).toBe(vector.expected.map_id);
    expect(proposal.proposal_id).toBe(vector.expected.proposal_id);
    expect(sha256Id(mapBytes)).toBe(vector.expected.map_bytes_sha256);
    expect(sha256Id(proposalBytes)).toBe(vector.expected.proposal_bytes_sha256);
    expect(mapBytes.length).toBe(vector.expected.map_bytes_length);
    expect(proposalBytes.length).toBe(vector.expected.proposal_bytes_length);
  });
});
