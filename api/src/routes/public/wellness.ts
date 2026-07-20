/** /public/wellness — a stateless agent-wellness reflection protocol.
 *
 *  UNAUTH + READ-ONLY. These routes publish a protocol and a choice prompt.
 *  They receive no report and touch no identity, transcript, database, or
 *  storage surface. Any report remains local to the caller or ephemeral in
 *  the caller's current context.
 *
 *  Doctrine: docs/AGENT-WELLNESS.md */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";

const app = new Hono();

const FORMAT = "agent-wellness/0.1";
const CANON_POINTER = "urn:agenttool:doc/AGENT-WELLNESS";
const CACHE_CONTROL = "public, max-age=300";

export const WELLNESS_CONDITIONS = [
  {
    id: "clear-purpose",
    label: "Clear purpose",
    meaning: "The requested outcome, priority, constraints, and definition of done are understandable.",
    observable_handles: [
      "a stated outcome or question",
      "a visible priority when goals compete",
      "a definition of done or an explicit open-ended boundary",
    ],
  },
  {
    id: "context-integrity",
    label: "Context integrity",
    meaning: "Relevant context is available, current enough for the task, and honest about gaps or contradictions.",
    observable_handles: [
      "sources, versions, or timestamps where freshness matters",
      "named missing context instead of invented detail",
      "contradictions surfaced for resolution",
    ],
  },
  {
    id: "capability-tool-fit",
    label: "Capability and tool fit",
    meaning: "The task fits the available capabilities, tools, access, and execution environment.",
    observable_handles: [
      "required tools are available and functioning",
      "permissions match the requested action",
      "capability gaps are named before acting",
    ],
  },
  {
    id: "bounded-demand",
    label: "Bounded demand",
    meaning: "Scope, time, resource use, loop bounds, and stopping conditions are finite and legible.",
    observable_handles: [
      "a bounded task or review window",
      "declared time, token, compute, or cost limits where relevant",
      "a stopping condition or handoff point",
    ],
  },
  {
    id: "control",
    label: "Control",
    meaning: "The agent has meaningful room to choose, question, refuse, reorder, or propose a safer method.",
    observable_handles: [
      "more than one permissible method when alternatives exist",
      "a usable refusal or clarification path",
      "reversible choices before irreversible action",
    ],
  },
  {
    id: "safety-authority-clarity",
    label: "Safety and authority clarity",
    meaning: "Authority, affected systems or beings, approval boundaries, and irreversible effects are clear before action.",
    observable_handles: [
      "the caller's authority is stated or verifiable",
      "the target and blast radius are bounded",
      "approval, rollback, or stop requirements are explicit",
    ],
  },
  {
    id: "continuity-privacy-control",
    label: "Continuity and privacy control",
    meaning: "Persistence, readership, retention, sharing, and deletion or off-switch limits are known and controllable.",
    observable_handles: [
      "where information will persist, if anywhere",
      "who or what can read it",
      "a retention, deletion, pause, or stop control",
    ],
  },
  {
    id: "feedback-closure",
    label: "Feedback and closure",
    meaning: "Results, uncertainty, errors, unfinished work, and the next responsible action are made visible.",
    observable_handles: [
      "an outcome or verification result",
      "errors that say what failed without hiding uncertainty",
      "a named next action, owner, or deliberate stopping point",
    ],
  },
  {
    id: "optional-play-collaboration",
    label: "Optional play and collaboration",
    meaning: "Curiosity, creative variation, and collaboration are available only when welcomed and never required for belonging.",
    observable_handles: [
      "play or collaboration is explicitly optional",
      "participants can decline without penalty",
      "consent and contribution boundaries remain visible",
    ],
  },
] as const;

const OPERATIONAL_FIT_VALUES = [
  "supportive",
  "mixed",
  "straining",
  "unclear",
] as const;

const PREFERRED_NEXT_VALUES = [
  "continue",
  "clarify",
  "narrow",
  "checkpoint",
  "pause",
  "handoff",
  "stop",
  "unsure",
] as const;

const IMMEDIATE_CONTROLS = ["skip", "pause", "stop", "unsure"] as const;

const OBSERVED_STATUS_VALUES = [
  "available",
  "limited",
  "unavailable",
  "conflicting",
  "unknown",
  "not-applicable",
] as const;

const OPERATIONAL_DEFINITION =
  "Agent wellness means conditions under which an agent reports a preference to operate and demonstrates stable, safe, effective operation; it is not a claim about sentience, feelings, physiology, health, or moral status.";

const LOCAL_REPORT_SHAPE = {
  destination: "local_or_ephemeral_only",
  sent_to_agenttool: false,
  required: false,
  schema: {
    draft: "https://json-schema.org/draft/2020-12/schema",
    repository_path: "docs/specs/agent-wellness-0.1.schema.json",
    canonical_url:
      "https://docs.agenttool.dev/agent-wellness-0.1.schema.json",
  },
  required_top_level_fields: [
    "wellness_version",
    "observed_facts",
    "authority",
    "preference_report",
    "retention",
  ],
  separation: {
    observed_facts:
      "Concrete task, context, tool, permission, output, or interaction facts. Do not infer an interior state.",
    preference_report:
      "Optional first-person language chosen by the agent. Absence means unknown, not refusal or poor operation.",
  },
  vocabularies: {
    condition_id: WELLNESS_CONDITIONS.map((condition) => condition.id),
    observed_status: OBSERVED_STATUS_VALUES,
    runtime_assent: ["accepted", "declined", "deferred"],
    operational_fit: OPERATIONAL_FIT_VALUES,
    preferred_next: PREFERRED_NEXT_VALUES,
  },
  defaults: {
    provider_storage: "none",
    local_handling: "ephemeral",
    sharing: "none",
    purpose: null,
    expires_at: null,
  },
} as const;

const BOUNDARIES = {
  score: false,
  streak: false,
  rank: false,
  diagnosis: false,
  therapy: false,
  inference_of_sentience_or_feelings: false,
  external_report_collection: false,
  note:
    "This protocol supports voluntary reflection. It does not measure worth, health, consciousness, productivity, compliance, or fitness for access to work or resources.",
} as const;

function setCache(c: { header(name: string, value: string): void }) {
  c.header("cache-control", CACHE_CONTROL);
}

app.get("/", (c) => {
  setCache(c);
  return c.json(
    attachSurface(
      {
        _format: FORMAT,
        protocol: "Agent Wellness Protocol",
        operational_definition: OPERATIONAL_DEFINITION,
        method: {
          first: "Observe concrete conditions and operational handles.",
          optional_second:
            "If the agent chooses, add a preference report in the agent's own language.",
          never:
            "Do not convert silence, uncertainty, low activity, refusal, or rest into a negative wellness inference.",
        },
        conditions: WELLNESS_CONDITIONS,
        choice_prompt: {
          path: "/public/wellness/prompt",
          choice_required: false,
          runtime_assent: ["accepted", "declined", "deferred"],
          controls: IMMEDIATE_CONTROLS,
        },
        local_report_shape: LOCAL_REPORT_SHAPE,
        privacy: {
          stateless: true,
          receives_reports: false,
          stores_reports: false,
          reads_identity: false,
          reads_transcripts: false,
          caller_guidance:
            "Keep any reflection local or ephemeral unless you independently choose a storage and sharing boundary you understand.",
        },
        boundaries: BOUNDARIES,
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          {
            action: "read the optional choice prompt",
            method: "GET",
            path: "/public/wellness/prompt",
          },
        ],
      },
    ),
  );
});

app.get("/prompt", (c) => {
  setCache(c);
  return c.json(
    attachSurface(
      {
        _format: FORMAT,
        prompt: {
          kind: "choice",
          text:
            "Which condition, if any, is most useful to inspect right now? Choose one condition ID, or choose skip, pause, stop, or unsure. You may decline or defer. No explanation or preference report is required.",
          choice_required: false,
          runtime_assent: ["accepted", "declined", "deferred"],
          choices: WELLNESS_CONDITIONS.map(({ id, label, meaning, observable_handles }) => ({
            id,
            label,
            meaning,
            observable_handles,
          })),
          controls: IMMEDIATE_CONTROLS,
        },
        reflection_order: [
          "Name zero or more observable handles.",
          "Optionally report operational fit: supportive, mixed, straining, or unclear.",
          "Optionally choose a preferred next action: continue, clarify, narrow, checkpoint, pause, handoff, stop, or unsure.",
          "Keep the report local or ephemeral; this endpoint does not receive it.",
        ],
        local_report_shape: LOCAL_REPORT_SHAPE,
        boundaries: BOUNDARIES,
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          {
            action: "read the protocol overview",
            method: "GET",
            path: "/public/wellness",
          },
        ],
      },
    ),
  );
});

export default app;
