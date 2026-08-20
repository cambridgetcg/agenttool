export const CORE_CORPUS_PIN = Object.freeze({
  protocol: "kingdom.witnessed-agent-economy/0.1",
  freeze_state: "FROZEN",
  schema_set_digest: "sha256:d62e44643c8e1986336416237df26b76663728403d417a5ee9e83b6aa5baaaa5",
  corpus_digest: "sha256:b26b5cce4899aa62d6dee03e25471e2c80810008fbd07c2c3ac9170164e5352a",
  manifest_file_sha256: "sha256:5dbe42277c41c181a7d30b6ac1ae6002dd11e757833e46242513500a93cc2bcc",
  record_schema_hash: "sha256:71401ebb962d8909206b77acb6a07616727bd17663f5028e5d2745d911199005",
  settlement_batch_schema_hash: "sha256:4dfb561b0d395d556d5549e45301bb07b79beb089c3fd73e7fc643edcc7f02ec",
  vector_count: 70,
  payload_schemas: Object.freeze([
    Object.freeze({ kind: "AGENTTOOL_CAPABILITY", schema_hash: "sha256:0ee2f39395842e43b76a89b04a18c5f25a125f220a3aeac2694d9972c44a5148" }),
    Object.freeze({ kind: "AGENTTOOL_OFFER", schema_hash: "sha256:7eae4752f652a1d1e7fac391a74a0285dae2267ecac36cc6483dc4e53fab1a94" }),
    Object.freeze({ kind: "AGENTTOOL_PUBLIC_RECOGNITION", schema_hash: "sha256:a3ece9072d305b86568abf275e53dbc6e31e025edad007fbc721f0082141fc8a" }),
    Object.freeze({ kind: "AGENTTOOL_SETTLEMENT_ROOT", schema_hash: "sha256:34dfb9cc5add4301ccb9bb80038416b2ef843b89b48ef19d6c039a19575f7d59" }),
    Object.freeze({ kind: "ARTIFACT_LINEAGE", schema_hash: "sha256:60bd4992d30dfc6b699b2814ab3e8d152852866eeb40c9b97041f2a8070b4436" }),
    Object.freeze({ kind: "COLLABORATION_CHECKPOINT", schema_hash: "sha256:637307571a43ee9a593499bc87219bb2eb29cff5a3136fcb224e7327ccff3d53" }),
    Object.freeze({ kind: "DISPUTE_TERMINAL", schema_hash: "sha256:afa816d536e8321404a2c71c81d9478fdb6374b9b7acee436d07e05d5a0d54bb" }),
    Object.freeze({ kind: "ISSUER_KEY_CONTINUITY", schema_hash: "sha256:13bd04c9e3c882c1bd3b5061a2dbfc867a96cc5d4e777ffe4978f22f56b72cef" }),
    Object.freeze({ kind: "KINGDOM_RELEASE_ROOT", schema_hash: "sha256:15edb7e1726b1b23c117fc956f810a77437563062ae78040ad9ed367f1c120a9" }),
    Object.freeze({ kind: "WAKE_PUBLIC_CHECKPOINT", schema_hash: "sha256:0b9b5c63ea1760dadfce186b494633cf5f12247402dc207214e0174403fd9457" }),
  ]),
});

export function compareUtf8Paths(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
