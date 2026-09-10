"""用已安裝嘅公開 package entrypoint 跑合成 photography 例子，唔讀 token。

本地驗收：python examples/attention_lab.py --base-url http://127.0.0.1:3000 --allow-loopback-http
只明確提交下面欄位；唔讀 project、repo、browser workspace 或 credential。
"""

from __future__ import annotations

import argparse
import json

from agenttool import AttentionLabClient, AttentionLabBriefInput, AttentionLabExperimentPlan


BRIEF_INPUT: AttentionLabBriefInput = {
    "topic": "Orange indoor portraits",
    "audience": "Beginner photographers practising indoor portraits with their own camera",
    "platformId": "youtube-shorts",
    "objective": "surface-response",
    "mechanismId": "curiosity-gap",
    "takeaway": "Set white balance for the actual light, then compare the same scene.",
    "action": "Try a white-balance comparison on your next portrait",
    "evidenceStatus": "missing",
    "evidence": "",
    "constraints": "Illustrative planning example only. Supply your own same-scene demonstration. Mixed light can need a different approach; do not promise perfect colour in every room.",
    "verifiedProof": "",
    "realLimit": "",
    "limitReason": "",
    "terms": "",
    "nonpoliticalConfirmed": True,
}
PLAN: AttentionLabExperimentPlan = {
    "design": "observational",
    "allocation": "兩組由 caller 手動記錄嘅合成資料，唔係隨機分流。",
    "eligibility": "每位合資格參與者只計一次，兩組沿用同一規則。",
    "startDate": "2026-09-01",
    "endDate": "2026-09-07",
    "stoppingRule": "預先固定觀察七日，唔因結果理想就提早停止。",
    "guardrailPlan": "用同一條理解問題檢查承諾有冇兌現；誤導或傷害即停。",
    "guardrailResults": "合成示範，未有真實觀察。",
}


def main() -> None:
    parser = argparse.ArgumentParser(description="明確調用 FOMOengine 公開 API；唔需要 AgentTool token。")
    parser.add_argument("--base-url", required=True, help="明確選獨立 origin；唔包含 API path。")
    parser.add_argument("--allow-loopback-http", action="store_true", help="只供 caller 明確啟動嘅 loopback HTTP 測試。")
    args = parser.parse_args()
    with AttentionLabClient(base_url=args.base_url, allow_loopback_http=args.allow_loopback_http) as lab:
        catalogue = lab.catalogue()
        brief = lab.build_brief(BRIEF_INPUT)
        comparison = lab.compare({
            "counts": {"aOutcomes": "10", "aEligible": "100", "bOutcomes": "18", "bEligible": "120"},
            "plan": PLAN,
            # 沿用生成結果嘅 metric 快照，唔用最新 catalogue 猜 denominator。
            "metric": brief["brief"]["metric"],
        })
    print(json.dumps({"catalogue": catalogue, "brief": brief, "comparison": comparison}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
