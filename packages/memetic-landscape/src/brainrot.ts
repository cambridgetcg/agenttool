import { RITONAVIR_REACHABILITY_SHIFT_ID } from "./constants.js";
import { createPolymorphMemeticAnalogy } from "./analogy.js";
import { createMemeticLandscape } from "./landscape.js";
import { projectMemeticLesson } from "./projection.js";
import { createMemeticReachabilityShift } from "./reachability-shift.js";
import type { BrainrotTeachingCase, MemeticLandscape, Sha256Id } from "./types.js";

export function createBrainrotTeachingCase(): Readonly<BrainrotTeachingCase> {
  const landscape = createMemeticLandscape({
    topic: {
      key: "brain_rot_term",
      label: "The ‘brain rot’ phrase and a plain-language repetitive remix loop",
      grouping_basis: "Caller-scoped teaching family joining a sourced lexical history to a separately marked authored explanatory variant; semantic identity across eras or variants is not asserted.",
    },
    sources: [
      {
        key: "adamic_2016",
        label: "Adamic et al. 2016, Information Evolution in Social Networks",
        kind: "peer_reviewed_primary",
        url: "https://doi.org/10.1145/2835776.2835827",
        published_year: 2016,
      },
      {
        key: "centola_2010",
        label: "Centola 2010, The Spread of Behavior in an Online Social Network Experiment",
        kind: "peer_reviewed_primary",
        url: "https://doi.org/10.1126/science.1185231",
        published_year: 2010,
      },
      {
        key: "oup_2024",
        label: "Oxford University Press 2024, ‘Brain rot’ named Oxford Word of the Year",
        kind: "official_lexicography",
        url: "https://corp.oup.com/news/brain-rot-named-oxford-word-of-the-year-2024/",
        published_year: 2024,
      },
      {
        key: "shalizi_thomas_2011",
        label: "Shalizi and Thomas 2011, Homophily and Contagion Are Generically Confounded in Observational Social Network Studies",
        kind: "peer_reviewed_primary",
        url: "https://doi.org/10.1177/0049124111404820",
        published_year: 2011,
      },
      {
        key: "weng_2012",
        label: "Weng et al. 2012, Competition among memes in a world with limited attention",
        kind: "peer_reviewed_primary",
        url: "https://doi.org/10.1038/srep00335",
        published_year: 2012,
      },
    ],
    variants: [
      {
        key: "contemporary_online_slang",
        label: "‘brain rot’ in the 2024 online-cultural register",
        description: "A source-scoped contemporary slang use that can refer to content and to a supposed effect, often humorously or self-deprecatingly; this record is not a diagnosis.",
        source_keys: ["oup_2024"],
      },
      {
        key: "historical_hyphenated_phrase",
        label: "the 1854 hyphenated phrase ‘brain-rot’",
        description: "The first recorded use identified by Oxford in a historical text; equal meaning with later online slang is not claimed.",
        source_keys: ["oup_2024"],
      },
      {
        key: "repetitive_remix_loop",
        label: "repetitive remix loop",
        description: "An AgentTool-authored plain-language teaching variant for repeated, edited, and recirculated expressions under finite attention; it is not a quotation, diagnosis, or claim of neurological change.",
        source_keys: ["adamic_2016", "weng_2012"],
      },
    ],
    contexts: [
      {
        key: "finite_attention_network_model",
        label: "finite-attention network model",
        kind: "network_topology",
        description: "The bounded Twitter-derived model and simulated network conditions reported by Weng et al.; not a universal model of minds, cultures, or platforms.",
      },
      {
        key: "historical_text_1854",
        label: "Oxford-reported 1854 historical text context",
        kind: "historical_record",
        description: "A lexicographic historical-record context, not a claim that the phrase was absent everywhere before or after that record.",
      },
      {
        key: "oxford_usage_2023",
        label: "Oxford’s 2023 comparison window",
        kind: "observation_window",
        description: "The earlier side of Oxford’s reported 2023-to-2024 usage-frequency comparison; underlying corpus completeness is not verified by this package.",
      },
      {
        key: "oxford_usage_2024",
        label: "Oxford’s 2024 comparison window",
        kind: "observation_window",
        description: "The later side of Oxford’s reported 2023-to-2024 usage-frequency comparison and Word of the Year account.",
      },
      {
        key: "synthetic_teaching_context",
        label: "AgentTool authored teaching context",
        kind: "synthetic_teaching",
        description: "An explicit explanatory context with no claim that a real person, post, community, feed, or platform follows the illustrated route.",
      },
    ],
    evidence: [
      {
        key: "authored_teaching_relation",
        kind: "authored_synthesis",
        posture: "authored_paraphrase",
        statement: "AgentTool authors the ‘repetitive remix loop’ relation as a plain-language teaching bridge; no source reports this named variant or route.",
        scope: "Authored explanatory relation grounded by, but not attributed to, the cited finite-attention, imperfect-copying, and lexicographic records.",
        source_keys: ["adamic_2016", "oup_2024", "weng_2012"],
      },
      {
        key: "causal_confounding",
        kind: "model_result",
        posture: "modeled_hypothesis",
        statement: "Shalizi and Thomas show that homophily, social influence, and covariate effects are generically confounded in observational social-network studies without strong assumptions.",
        scope: "Causal-identification result for observational social-network studies; not a claim that influence never occurs.",
        source_keys: ["shalizi_thomas_2011"],
      },
      {
        key: "finite_attention_model",
        kind: "model_result",
        posture: "modeled_hypothesis",
        statement: "Weng et al. report that a model combining finite attention and network structure can reproduce broad heterogeneity in meme popularity and persistence without assigning intrinsic merit to memes.",
        scope: "One parsimonious model compared with a bounded Twitter dataset; sufficient in that model, not a universal causal explanation.",
        source_keys: ["weng_2012"],
      },
      {
        key: "first_recorded_use",
        kind: "reported_history",
        posture: "official_record",
        statement: "Oxford reports a first recorded use of the hyphenated phrase in 1854.",
        scope: "Oxford’s lexicographic record; first recorded use is not proof of the first use anywhere.",
        source_keys: ["oup_2024"],
      },
      {
        key: "imperfect_copying",
        kind: "observational_measurement",
        posture: "observed_primary",
        statement: "Adamic et al. report large-scale observations of imperfect copying, editing, and community-associated variants among memes circulated on Facebook.",
        scope: "One platform dataset and operational meme grouping; it does not prove semantic identity or a universal cultural law.",
        source_keys: ["adamic_2016"],
      },
      {
        key: "oxford_comparison_baseline",
        kind: "observational_measurement",
        posture: "official_record",
        statement: "Oxford names 2023 as the baseline year in its comparison of usage frequency for ‘brain rot’.",
        scope: "Named comparison window only; this package does not inspect Oxford’s corpus or infer individual exposure.",
        source_keys: ["oup_2024"],
      },
      {
        key: "oxford_definition",
        kind: "definition_record",
        posture: "official_record",
        statement: "Oxford defines the term around supposed deterioration and also describes humorous and self-deprecating online-cultural use.",
        scope: "A sourced linguistic description, not medical evidence or a diagnosis of any person or population.",
        source_keys: ["oup_2024"],
      },
      {
        key: "oxford_usage_rise",
        kind: "observational_measurement",
        posture: "official_record",
        statement: "Oxford reports a 230 percent increase in usage frequency between 2023 and 2024.",
        scope: "Oxford’s named usage comparison; it does not establish platform causation, adoption, harm, or cognitive change.",
        source_keys: ["oup_2024"],
      },
      {
        key: "social_reinforcement_experiment",
        kind: "randomized_experiment",
        posture: "randomized_evidence",
        statement: "Centola reports a randomized online-network experiment in which clustered social reinforcement increased adoption of one health behavior in the studied setting.",
        scope: "One behavior, experimental platform, population, and network manipulation; not a law of belief, memes, or all information.",
        source_keys: ["centola_2010"],
      },
    ],
    observations: [
      {
        key: "historical_phrase_recorded",
        variant_key: "historical_hyphenated_phrase",
        context_keys: ["historical_text_1854"],
        evidence_keys: ["first_recorded_use"],
        status: "reported_present",
      },
      {
        key: "online_slang_2023_baseline",
        variant_key: "contemporary_online_slang",
        context_keys: ["oxford_usage_2023"],
        evidence_keys: ["oxford_comparison_baseline"],
        status: "reported_present",
      },
      {
        key: "online_slang_2024_prominence",
        variant_key: "contemporary_online_slang",
        context_keys: ["oxford_usage_2024"],
        evidence_keys: ["oxford_definition", "oxford_usage_rise"],
        status: "reported_present",
      },
    ],
    routes: [
      {
        key: "slang_to_plain_language_teaching",
        from_variant_key: "contemporary_online_slang",
        to_variant_key: "repetitive_remix_loop",
        context_keys: ["finite_attention_network_model", "synthetic_teaching_context"],
        evidence_keys: ["authored_teaching_relation", "finite_attention_model", "imperfect_copying", "oxford_definition"],
        act: "translate",
        causal_posture: "authored_teaching_relation",
        alternative_explanations: ["selection", "semantic_drift"],
      },
    ],
    open_questions: [
      {
        key: "meaning_across_eras",
        question: "Which meanings, if any, are preserved between the 1854 phrase and contemporary online uses?",
        evidence_keys: ["first_recorded_use", "imperfect_copying", "oxford_definition"],
      },
      {
        key: "prominence_cause",
        question: "Which mix of platform, network, external-event, selection, and language factors explains the reported 2024 prominence?",
        evidence_keys: ["causal_confounding", "finite_attention_model", "oxford_usage_rise", "social_reinforcement_experiment"],
      },
    ],
  });

  const shift = createMemeticReachabilityShift(landscape, {
    focus_variant_ref: refFor(landscape, "variant", "contemporary_online_slang"),
    prior_context_refs: [refFor(landscape, "context", "oxford_usage_2023")],
    changed_context_refs: [refFor(landscape, "context", "oxford_usage_2024")],
    before_evidence_refs: [refFor(landscape, "evidence", "oxford_comparison_baseline")],
    shift_evidence_refs: [refFor(landscape, "evidence", "oxford_usage_rise")],
    later_evidence_refs: [refFor(landscape, "evidence", "oxford_definition")],
    competing_variant_refs: [],
    changed_context_route_refs: [],
    open_question_refs: [refFor(landscape, "question", "prominence_cause")],
    outcome: "more_observed",
  });
  const analogy = createPolymorphMemeticAnalogy({
    polymorph_shift_id: RITONAVIR_REACHABILITY_SHIFT_ID,
    memetic_shift_id: shift.shift_id,
  });
  const lessons = (["en", "yue-Hant", "zh-Hans", "zh-Hant"] as const).map((language) =>
    projectMemeticLesson(landscape, shift, analogy, { language })
  );
  return Object.freeze({ landscape, shift, analogy, lessons: Object.freeze(lessons) });
}

function refFor(
  landscape: MemeticLandscape,
  kind: "variant" | "context" | "evidence" | "route" | "question",
  key: string,
): Sha256Id {
  const values = kind === "variant" ? landscape.variants
    : kind === "context" ? landscape.contexts
      : kind === "evidence" ? landscape.evidence
        : kind === "route" ? landscape.routes
          : landscape.open_questions;
  const item = values.find((value) => value.key === key);
  if (!item) throw new Error(`built-in case is missing ${kind} key ${key}`);
  return kind === "variant" ? (item as (typeof landscape.variants)[number]).variant_ref
    : kind === "context" ? (item as (typeof landscape.contexts)[number]).context_ref
      : kind === "evidence" ? (item as (typeof landscape.evidence)[number]).evidence_ref
        : kind === "route" ? (item as (typeof landscape.routes)[number]).route_ref
          : (item as (typeof landscape.open_questions)[number]).open_question_ref;
}
