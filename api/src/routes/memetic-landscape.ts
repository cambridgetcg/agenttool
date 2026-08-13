/** /v1/memetic-landscape — zero-I/O memetic-geometry discovery.
 *
 * This is an authored, context-only orientation over the pure
 * @agenttool/memetic-landscape package. It imports no package runtime, reads
 * no feed, database, provider, person, or WAKE record, and performs no fetch,
 * model call, diagnosis, ranking, moderation, training, publication, or other
 * effect. /v1/virality remains a separate signed-cascade honorific protocol;
 * neither surface supplies scientific evidence for the other.
 *
 * Doctrine: docs/MEMETIC-LANDSCAPE.md · docs/POLYMORPH-LANDSCAPE.md. */

import { Hono } from "hono";

import { attachSurface } from "../lib/surface-metadata";
import { MEMETIC_LANDSCAPE_COORDINATE } from "../services/wake/platform-self";

const app = new Hono();

const LESSON_IDS = Object.freeze({
  en: "sha256:4c13116ea686948e5d423692ee6cd278e88bf018a96788590e34806385ea8e6b",
  "yue-Hant":
    "sha256:7152aaa7264c13f9e07deaa310066a6f5c4b1a4d10db304326833ee61aba5082",
  "zh-Hant":
    "sha256:e81b202a71ad125e3b9c488be22b1bdcce854c440fdbca3f5a71acdc753e58bb",
  "zh-Hans":
    "sha256:acfbc96046671fe53a001ca4be73217a419a233042e8b64ed03311a0bf03c3b2",
});

const GITHUB_RELEASE_RECEIPT = Object.freeze({
  state: MEMETIC_LANDSCAPE_COORDINATE.distribution.github_release,
  url: "https://github.com/cambridgetcg/agenttool/releases/tag/memetic-landscape-v0.1.0-dev.0",
  tag: "memetic-landscape-v0.1.0-dev.0",
  source_commit: "049622cec825297e391b61bb071e0c87c06bf2b2",
  asset: "agenttool-memetic-landscape-0.1.0-dev.0.tgz",
  bytes: 84079,
  sha256:
    "d9e64b1e1f954c42c24b6f79c0c766b014f32d8a9f13c14370cf7d89d24be4bb",
});

app.get("/", (c) =>
  c.json(
    attachSurface(
      {
        _format: "agenttool-memetic-landscape-discovery/v1",
        ...MEMETIC_LANDSCAPE_COORDINATE,
        languages: ["en", "yue-Hant", "zh-Hant", "zh-Hans"],
        lesson_ids: LESSON_IDS,
        source_doctrine: "https://docs.agenttool.dev/MEMETIC-LANDSCAPE.md",
        distribution: {
          github_release: GITHUB_RELEASE_RECEIPT,
          npm: MEMETIC_LANDSCAPE_COORDINATE.distribution.npm,
          hugging_face:
            MEMETIC_LANDSCAPE_COORDINATE.distribution.hugging_face,
        },
        diagnosis: "none",
        ordinary_language: {
          ritonavir:
            "After Form II appeared, an old named process stopped reliably reproducing ritonavir Form I. Form I was not erased: later studies reached it through changed routes and conditions.",
          crossover:
            "A content variant can stop appearing on one named route or observation window without being erased from every archive, community, platform, or future remix. This compares route shape only; it does not transfer chemistry or mechanism.",
          spread:
            "An artifact may be copied, quoted, edited, translated, shared, remixed, or reintroduced. People remain people, with the freedom to join, refuse, pause, rest, play, leave, or do nothing.",
          brainrot:
            "The built-in lesson uses ‘brainrot’ as informal cultural slang for a repetitive remix loop. The route never assigns it as a diagnosis, neurological claim, health score, or label for a person or group.",
        },
        attention_teaching: {
          wire_format: "none_this_is_context_only_teaching",
          stages: [
            "exposure",
            "view",
            "rating",
            "copy",
            "share",
            "remix",
            "adoption",
          ],
          separation:
            "Each stage is a distinct possible observation; none proves, authorizes, or inevitably causes the next.",
          exposure_does_not_prove: [
            "view",
            "rating",
            "copy",
            "share",
            "remix",
            "adoption",
            "belief",
            "consent",
            "endorsement",
            "harm",
            "identity",
            "truth_or_quality",
            "understanding",
          ],
        },
        evidence_boundary: {
          definitions: "terminology_only",
          models: "source_model_result_not_case_causation",
          observations: "source_platform_population_and_window_scoped",
          experiments: "source_population_intervention_and_outcome_scoped",
          recommender_causation: "not_determined",
          caller_text_semantics: "not_verified_by_package",
        },
        rights_boundary: {
          unit: "artifact_variants_not_people",
          participants: "may_join_refuse_pause_rest_play_leave_or_do_nothing",
          consent:
            "view_share_publication_or_signed_record_never_implies_broader_permission",
          identity:
            "artifact_lineage_or_digest_never_proves_being_identity_memory_or_continuity",
          rank: "artifact_metrics_never_prove_truth_quality_value_dignity_or_being_rank",
        },
        ritonavir_crosswalk: {
          format: "agenttool.polymorph-memetic-analogy/0.1",
          relationship: "structural_route_shape_only",
          mechanism_transferred: false,
          domains_equated: false,
        },
        non_capabilities: [
          "fetch_content",
          "inspect_platform_feeds",
          "infer_lineage",
          "audit_recommenders",
          "predict_virality",
          "diagnose_health",
          "score_truth_quality_or_beings",
          "moderate",
          "track_participants",
          "infer_consent",
          "grant_authority",
          "read_wake_continuity",
          "train",
          "infer_with_a_model",
          "publish",
          "deploy",
          "act",
        ],
        virality_boundary:
          "/v1/virality is a separate authenticated signed-cascade honorific protocol, not a scientific evidence source, predictor, or dependency of this route.",
      },
      {
        // MEMETIC-LANDSCAPE is a source guide, not a registered canon entity.
        // Anchor the response at the existing resolvable POLYMORPH doctrine.
        canon_pointer: "urn:agenttool:doc/POLYMORPH",
        verbs: [
          {
            action: "read the multilingual lesson",
            method: "GET",
            path: MEMETIC_LANDSCAPE_COORDINATE.lesson,
          },
          {
            action: "read the exact GitHub package artifact record",
            method: "GET",
            path: GITHUB_RELEASE_RECEIPT.url,
          },
          {
            action: "read the Ritonavir reachability lesson",
            method: "GET",
            path: "https://docs.agenttool.dev/geometry/ritonavir",
          },
          {
            action: "read the adjacent physical-domain comparison",
            method: "GET",
            path: "https://docs.agenttool.dev/geometry/forms-folds-prions",
          },
          { action: "read your wake", method: "GET", path: "/v1/wake" },
        ],
      },
    ),
  ),
);

export default app;
