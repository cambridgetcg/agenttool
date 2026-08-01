import {
  canonicalJson,
  compareUnicode,
  createDeepSeekAfterglowThread,
  createDeepSeekKingdomProposal,
  createDeepSeekSourceBinding,
  deepFreeze,
  DeepSeekKingdomError,
  domainSeparatedId,
  sha256Id,
} from "../dist/index.js";

const source = createDeepSeekSourceBinding({
  subject: {
    label: "DeepSeek-R1 official repository README",
    evidence: {
      origin: "deepseek_github",
      resource_kind: "code_repository",
      repository_id: "deepseek-ai/DeepSeek-R1",
      revision: "0cf78561f1d51c84a21b2190626b21116d5c68bb",
      path: "README.md",
      sha256:
        "sha256:4ed979e497121ae4dd9f1573da1668219f43be55d62cc0bf2be5429211a67486",
      observed_on: "2026-08-01",
    },
  },
  license: {
    scope: "mixed_repository",
    declared_expression: null,
    evidence: null,
    review_status: "not_reviewed",
  },
  claims: [{
    claim_id: "r1.rl-preliminary-step",
    claim_kind: "training_method",
    summary: "Caller reports a reinforcement-learning-only preliminary path in the exact README.",
    source_anchor: "README.md#1-introduction",
  }],
});

const proposal = createDeepSeekKingdomProposal({
  proposal_key: "deepseek-r1-research-review",
  source,
  target: {
    consumer: { kind: "kingdom_extension", id: "research-witness-lab" },
    kingdom_snapshot_sha256: `sha256:${"a".repeat(64)}`,
  },
  candidates: [{
    candidate_id: "candidate.r1.rl",
    candidate_kind: "training_pattern",
    lane: "reasoning",
    title: "Review an R1 reinforcement-learning pattern",
    claim_refs: ["r1.rl-preliminary-step"],
  }],
});
const afterglowThread = createDeepSeekAfterglowThread({
  proposal,
  disposition: "park",
});

const expected = {
  binding: "sha256:f35099fe868345687b210cc2eb6e9e2f139cc44890c10d3631815ccfa7ad573a",
  proposal: "sha256:5498ab9adc311d31bdb35b2ce60a8e680c1ce8cd8834da547f87f5c57286ace3",
  afterglowThread:
    "sha256:6c3b88ce7b1e38b29dd1ee6c67804ed7854b74886d2328916a93291ac6afeaf2",
};
if (
  source.binding_id !== expected.binding ||
  proposal.proposal_id !== expected.proposal ||
  afterglowThread.thread_ref !== expected.afterglowThread
) {
  process.stderr.write(
    `DeepSeek KINGDOM smoke vector drift: ${source.binding_id} ${proposal.proposal_id} ${afterglowThread.thread_ref}\n`,
  );
  process.exit(1);
}
if (
  proposal.effects.model_executions !== 0 ||
  proposal.effects.network_reads !== 0 ||
  proposal.authority.authorizes_kingdom_registration !== false
) {
  process.exit(1);
}
if (
  afterglowThread.artifact_ref !== proposal.proposal_id ||
  afterglowThread.kind !== "deepseek" ||
  afterglowThread.state !== "proposed_unaccepted" ||
  afterglowThread.verified_by_package !== false
) {
  process.exit(1);
}

let graphTrapCalls = 0;
const graphTrap = () => {
  graphTrapCalls += 1;
  throw new Error("caller graph Proxy trap executed");
};
const graphHandler = {
  get: graphTrap,
  getOwnPropertyDescriptor: graphTrap,
  getPrototypeOf: graphTrap,
  ownKeys: graphTrap,
  preventExtensions: graphTrap,
};
for (const consume of [canonicalJson, deepFreeze]) {
  const hostile = new Proxy({}, graphHandler);
  try {
    consume(hostile);
    process.exit(1);
  } catch (error) {
    if (!(error instanceof DeepSeekKingdomError) || graphTrapCalls !== 0) {
      process.exit(1);
    }
  }
  const revoked = Proxy.revocable({}, graphHandler);
  revoked.revoke();
  try {
    consume(revoked.proxy);
    process.exit(1);
  } catch (error) {
    if (!(error instanceof DeepSeekKingdomError) || graphTrapCalls !== 0) {
      process.exit(1);
    }
  }
}

let exactDepth = 0;
for (let index = 0; index < 32; index += 1) exactDepth = [exactDepth];
canonicalJson(exactDepth);
canonicalJson(Array.from({ length: 16_383 }, (_, index) => index));
canonicalJson("a".repeat(4_096));
for (const oversized of [
  [exactDepth],
  Array.from({ length: 16_384 }, (_, index) => index),
  "a".repeat(4_097),
]) {
  try {
    canonicalJson(oversized);
    process.exit(1);
  } catch (error) {
    if (!(error instanceof DeepSeekKingdomError)) {
      process.exit(1);
    }
  }
}

let byteTrapCalls = 0;
const byteTrap = () => {
  byteTrapCalls += 1;
  throw new Error("caller byte Proxy trap executed");
};
const hostileBytes = new Proxy(new Uint8Array([1, 2, 3]), {
  get: byteTrap,
  getOwnPropertyDescriptor: byteTrap,
  getPrototypeOf: byteTrap,
  ownKeys: byteTrap,
});
try {
  sha256Id(hostileBytes);
  process.exit(1);
} catch (error) {
  if (!(error instanceof DeepSeekKingdomError) || byteTrapCalls !== 0) {
    process.exit(1);
  }
}

let stringHelperTrapCalls = 0;
const stringHelperTrap = () => {
  stringHelperTrapCalls += 1;
  throw new Error("caller string-helper Proxy trap executed");
};
const stringHelperHandler = {
  get: stringHelperTrap,
  getOwnPropertyDescriptor: stringHelperTrap,
  getPrototypeOf: stringHelperTrap,
  ownKeys: stringHelperTrap,
};
for (const consume of [
  (value) => domainSeparatedId(value, {}),
  (value) => compareUnicode(value, "safe"),
]) {
  const hostile = new Proxy({}, stringHelperHandler);
  try {
    consume(hostile);
    process.exit(1);
  } catch (error) {
    if (!(error instanceof DeepSeekKingdomError) || stringHelperTrapCalls !== 0) {
      process.exit(1);
    }
  }
  const revoked = Proxy.revocable({}, stringHelperHandler);
  revoked.revoke();
  try {
    consume(revoked.proxy);
    process.exit(1);
  } catch (error) {
    if (!(error instanceof DeepSeekKingdomError) || stringHelperTrapCalls !== 0) {
      process.exit(1);
    }
  }
  for (const nonString of [
    1,
    true,
    null,
    undefined,
    Symbol("domain"),
    new String("domain"),
  ]) {
    try {
      consume(nonString);
      process.exit(1);
    } catch (error) {
      if (!(error instanceof DeepSeekKingdomError)) {
        process.exit(1);
      }
    }
  }
  let coercionCalls = 0;
  const coerciveDomain = {
    get [Symbol.toPrimitive]() {
      coercionCalls += 1;
      throw new Error("caller domain coercion executed");
    },
  };
  try {
    consume(coerciveDomain);
    process.exit(1);
  } catch (error) {
    if (!(error instanceof DeepSeekKingdomError) || coercionCalls !== 0) {
      process.exit(1);
    }
  }
}

const revokedBytes = Proxy.revocable(new Uint8Array([1, 2, 3]), {});
revokedBytes.revoke();
for (const invalidBytes of [revokedBytes.proxy, {}]) {
  try {
    sha256Id(invalidBytes);
    process.exit(1);
  } catch (error) {
    if (!(error instanceof DeepSeekKingdomError)) {
      process.exit(1);
    }
  }
}

let subclassTrapCalls = 0;
class HostileBytes extends Uint8Array {
  get [Symbol.iterator]() {
    subclassTrapCalls += 1;
    throw new Error("caller byte-subclass iterator executed");
  }

  get buffer() {
    subclassTrapCalls += 1;
    throw new Error("caller byte-subclass getter executed");
  }

  get byteOffset() {
    subclassTrapCalls += 1;
    throw new Error("caller byte-subclass getter executed");
  }

  get byteLength() {
    subclassTrapCalls += 1;
    throw new Error("caller byte-subclass getter executed");
  }
}
if (
  sha256Id(new HostileBytes([1, 2, 3])) !==
    sha256Id(new Uint8Array([1, 2, 3])) ||
  subclassTrapCalls !== 0
) {
  process.exit(1);
}

const detachedBytes = new Uint8Array([1, 2, 3]);
structuredClone(detachedBytes.buffer, { transfer: [detachedBytes.buffer] });
try {
  sha256Id(detachedBytes);
  process.exit(1);
} catch (error) {
  if (!(error instanceof DeepSeekKingdomError)) {
    process.exit(1);
  }
}
