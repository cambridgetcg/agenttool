/** 只用 @agenttool/sdk 公開 package entrypoint；明確選 origin 先傳合成資料。 */
import {
  AttentionLabClient,
  type AttentionLabBriefInput,
  type AttentionLabExperimentPlan,
  type AttentionLabOptions,
} from "@agenttool/sdk";

export const photographyInput: AttentionLabBriefInput = {
  topic: "Orange indoor portraits",
  audience: "Beginner photographers practising indoor portraits with their own camera",
  platformId: "youtube-shorts",
  objective: "surface-response",
  mechanismId: "curiosity-gap",
  takeaway: "Set white balance for the actual light, then compare the same scene.",
  action: "Try a white-balance comparison on your next portrait",
  evidenceStatus: "missing",
  evidence: "",
  constraints: "Illustrative planning example only. Supply your own same-scene demonstration. Mixed light can need a different approach; do not promise perfect colour in every room.",
  verifiedProof: "",
  realLimit: "",
  limitReason: "",
  terms: "",
  nonpoliticalConfirmed: true,
};

export const observationPlan: AttentionLabExperimentPlan = {
  design: "observational",
  allocation: "兩組由 caller 手動記錄嘅合成資料，唔係隨機分流。",
  eligibility: "每位合資格參與者只計一次，兩組沿用同一規則。",
  startDate: "2026-09-01",
  endDate: "2026-09-07",
  stoppingRule: "預先固定觀察七日，唔因結果理想就提早停止。",
  guardrailPlan: "用同一條理解問題檢查承諾有冇兌現；誤導或傷害即停。",
  guardrailResults: "合成示範，未有真實觀察。",
};

export async function runAttentionLabExample(options: AttentionLabOptions & { baseUrl: string }) {
  const lab = new AttentionLabClient(options);
  const catalogue = await lab.catalogue();
  const mechanism = catalogue.mechanisms.find((entry) => entry.id === photographyInput.mechanismId);
  if (!mechanism?.compatiblePlatformIds.includes(photographyInput.platformId)) {
    throw new Error("呢個 catalogue 冇示範用嘅兼容組合；請明確選另一個 input。");
  }
  const brief = await lab.buildBrief(photographyInput);
  const comparison = await lab.compare({
    // 原始十進位字串；未知要傳 ""，唔可以偷換成 "0"。
    counts: { aOutcomes: "10", aEligible: "100", bOutcomes: "18", bEligible: "120" },
    plan: observationPlan,
    metric: brief.brief.metric,
  });
  return { catalogue, brief, comparison };
}

if (import.meta.main) {
  const [baseUrl, ...flags] = process.argv.slice(2);
  if (!baseUrl || flags.some((flag) => flag !== "--allow-loopback-http") || flags.length > 1) {
    throw new Error("用法：bun examples/attention-lab.ts <HTTPS-origin> [--allow-loopback-http]");
  }
  const result = await runAttentionLabExample({ baseUrl, allowLoopbackHttp: flags.includes("--allow-loopback-http") });
  // 回傳完整快照，方便 caller 自己保存；唔寫檔、唔發布、唔判 winner。
  console.log(JSON.stringify(result, null, 2));
}
