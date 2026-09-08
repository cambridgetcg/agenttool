# FOMOengine Attention Lab：外部共享能力

> **Compass:** [AGENT-DISCOVERY](AGENT-DISCOVERY.md) · [SDK-TIERS](SDK-TIERS.md) · [KINGDOM-OS-SDK](KINGDOM-OS-SDK.md)
> **Implements:** FOMO producer-owned Attention Lab 嘅 metadata-only discovery 同獨立、毋須憑證嘅 SDK consumer；唔係 AgentTool hosted proxy。
> **Code:** `api/src/services/wake/reachable.ts` · `api/src/services/wake/markdown.ts` · `api/src/services/discovery/discovery.ts` · `packages/sdk-ts/src/attention-lab.ts` · `packages/sdk-py/src/agenttool/attention_lab.py`
> **Tests:** `api/tests/wake-reachable-parity.test.ts` · `api/tests/openapi-wake.test.ts` · `api/tests/discovery-root-surface.test.ts` · `packages/sdk-ts/tests/attention-lab.test.ts` · `packages/sdk-py/tests/test_attention_lab.py` · `bin/tests/love-packages.test.ts`

## 狀態先講清楚

**Source contract、package distribution 同 API deployment 係三種獨立證據。**
AgentTool SDK paired source 係 **0.23.0**；npm、PyPI 同 LOVE 嘅 exact release bytes
要核對各自 receipts。以下 production URLs 係契約座標，唔係 health receipt；網站存在、
source push 或部署開始，都唔證明呢啲 API 已可用，須另做 deployed-revision／live readback。

FOMOengine 擁有研究資料、brief／comparison 邏輯、版本、OpenAPI 同 artifact；
AgentTool 只提供 consumer 同發現座標，唔複製核心、轉售或代理外部 POST。
`independent_external_service` 唔建立 authority、同意、真確性或可用性。

## 三個 operation

固定 origin `https://fomoengine.io`，固定前綴 `/api/v1/attention-lab`。

| 呼叫 | 用途 |
|---|---|
| `GET https://fomoengine.io/api/v1/attention-lab/catalogue` | 查版本化 mechanisms、platform surfaces、sources 同 claims；唔係 live trend research。 |
| `POST https://fomoengine.io/api/v1/attention-lab/briefs` | 將明確選取嘅 `BriefInput` 變成附來源快照、限制、實驗同 Markdown 嘅 artifact。 |
| `POST https://fomoengine.io/api/v1/attention-lab/comparisons` | 接受 `{ counts, plan, metric }`，回傳描述性 rates、百分點差、relative lift、設計說明同缺項。 |

Schema 座標係 `GET https://fomoengine.io/api/v1/attention-lab/openapi.json`；
呢個係契約文件，唔係第四種分析能力，亦唔係 MCP endpoint。
三個 operation 沿用 `{ success, data | error }`；SDK 方法回傳驗過結構嘅 `data`。
`/openapi.json` 直接回 raw OpenAPI document，唔包 success envelope。

## 資料點樣過界

1. 按當前任務選擇是否使用。讀 catalogue／schema 唔會上傳 repo 內容。
2. 先明確選取有需要、可披露嘅欄位；唔傳 secrets、登入資料、識別性個人資料或完整私有 workspace。
3. **`buildBrief`／`build_brief` 同 `compare` 會用 POST 將所選資料送至 FOMOengine。**
   呢個披露要屬於當前授權。毋須 API key 唔等於毋須處理資料披露。
4. 保留回傳嘅 source／claim snapshot、limitations、`blocked`、guardrails 同 metric denominator；
   有缺項就保持缺項，唔捏造聲量、期限、名額或社會證明。
5. Comparison 使用先前 brief 嘅 metric 快照，同一觀察窗口、單位、分子／分母定義；
   唔從最新 catalogue 重新猜度舊實驗嘅量度方式。

SDK 唔自動讀 repo／HOME／browser workspace、掃 URL、發文、操作帳號、排程、安裝 Skill
或調配流量。Constructor 唔連線；AgentTool authenticated transport、bearer、cookies
同環境認證唔傳入獨立 client。即使 AgentTool 啟用 x402 payer，呢個外部 namespace
都唔經嗰個 paying transport。

FOMO API application 嘅契約係唔持久保存／記錄提交內容、唔讀 cookies 作身份、唔 fetch
引用 URL、唔接 AI 或 DB；託管平台一般 access metadata 同保留政策另計，唔承諾零平台日誌。
原本 browser Lab／Trends 工作台同 browser workspace 格式仍然分開，API artifact 唔係
workspace import，也唔代表伺服器保存咗 browser 草稿。

## SDK 入口同限制

| TypeScript | Python |
|---|---|
| `at.attentionLab.catalogue()` | `at.attention_lab.catalogue()` |
| `at.attentionLab.buildBrief(input)` | `at.attention_lab.build_brief(input)` |
| `at.attentionLab.compare(input)` | `at.attention_lab.compare(input)` |
| `new AttentionLabClient(options)` | `AttentionLabClient(**options)` |

Standalone client 毋須 AgentTool 帳號／token。預設獨立 FOMO origin；如果明確選擇
self-host，`baseUrl`／`base_url` 只接受 HTTPS origin，唔容 userinfo、path、query 或
fragment。明確 loopback HTTP 測試仲要 `allowLoopbackHttp`／`allow_loopback_http: true`。
唔接受每次 operation 任意 URL。

- `timeout` 以秒計，上限 10；整體 deadline 包括 headers 同 body read。
- `maxRequestBytes`／`max_request_bytes` 上限 65,536 UTF-8 bytes。
- `maxResponseBytes`／`max_response_bytes` 上限 524,288 bytes，唔只信 `Content-Length`。
- 冇自動 retry、redirect 或 fallback 去舊 checker／爬網站；錯誤保持 sanitized。
- HTTP limiter 嘅 30/min/coarse-IP 係 FOMO 每實例 best-effort，唔係全球 quota 或身份認證；
  遇到 429／503 應停低處理，唔自動繞道或重試。

## 本地 synthetic consumer 例子

以下只適用於已建好／可 import 0.23.0 SDK、已由操作者另行啟動嘅本地 FOMO server
`http://127.0.0.1:3000`。唔會安裝依賴或啟動服務。第一個 argument 係 caller 明確指定嘅
FOMO source fixture `fixtures/attention-lab/v1.json`；請替換成你實際 checkout 嘅絕對路徑。
例子只抽取 `briefInput` 同比較所需欄位，唔將 fixture 全檔送出。

呢份 fixture 用合成攝影情境，`evidenceStatus: "missing"` 保留未提供證據嘅事實，
唔係 publication-ready 文案。先核對 catalogue IDs，再執行兩次明示 POST。

### TypeScript

喺已 build 嘅 `packages/sdk-ts` 執行；經 package root public export 使用 client。

```bash
bun --no-env-file --no-install - /absolute/path/to/fomoengine/fixtures/attention-lab/v1.json <<'TS'
import { readFile } from "node:fs/promises";
import { AttentionLabClient } from "@agenttool/sdk";

const fixture = JSON.parse(await readFile(process.argv[2], "utf8"));
const lab = new AttentionLabClient({
  baseUrl: "http://127.0.0.1:3000",
  allowLoopbackHttp: true,
});
const catalogue = await lab.catalogue();
console.log(catalogue.catalogueVersion, catalogue.catalogueDigest);
// 呢兩次 POST 只送出 caller 明確選取嘅 synthetic 欄位。
const artifact = await lab.buildBrief(fixture.briefInput);
console.log(JSON.stringify({ markdown: artifact.markdown }, null, 2));
const comparison = await lab.compare({
  counts: { aOutcomes: "10", aEligible: "100", bOutcomes: "18", bEligible: "120" },
  plan: fixture.comparisonInput.plan,
  metric: artifact.brief.metric,
});
console.log(comparison);
TS
```

### Python

喺已具備測試依賴嘅 `packages/sdk-py` 執行；`PYTHONPATH=src` 明確選用本地 source，
唔假設 registry 已提供 0.23.0。

```bash
PYTHONPATH=src python3 - /absolute/path/to/fomoengine/fixtures/attention-lab/v1.json <<'PY'
import json
import sys
from agenttool import AttentionLabClient

with open(sys.argv[1], encoding="utf-8") as selected_file:
    fixture = json.load(selected_file)
with AttentionLabClient(
    base_url="http://127.0.0.1:3000", allow_loopback_http=True,
) as lab:
    catalogue = lab.catalogue()
    print(catalogue["catalogueVersion"], catalogue["catalogueDigest"])
    # 呢兩次 POST 只送出 caller 明確選取嘅 synthetic 欄位。
    artifact = lab.build_brief(fixture["briefInput"])
    print(json.dumps({"markdown": artifact["markdown"]}, ensure_ascii=False, indent=2))
    comparison = lab.compare({
        "counts": {"aOutcomes": "10", "aEligible": "100", "bOutcomes": "18", "bEligible": "120"},
        "plan": fixture["comparisonInput"]["plan"],
        "metric": artifact["brief"]["metric"],
    })
    print(comparison)
PY
```

兩邊應描述 A=0.10、B=0.15、B−A 約 **+5 percentage points**，relative lift 約 **0.5**
（50%，唔係 50 percentage points）。Counts 用十進位字串；空字串係未知，唔係零。
零分母或零 baseline 冇適用數值就保留 `null`／`None`。呢啲係 caller 所交組別嘅描述，
唔係 winner、significance、因果結論，亦冇驗證量度或 randomization。

## 版本、discovery 同發布界線

`schemaVersion` 識別 artifact contract；`engineVersion` 識別計算版本；`catalogueVersion`
同 `catalogueDigest` 識別研究快照。Digest 係內容識別，唔係簽名、來源真確性或 authority。
歷史 artifact 用自身 snapshot 驗證同 render，唔跟當前 catalogue 靜默改寫；唔支援嘅
schema version 應明確拒絕。`nonpoliticalConfirmed` 只係 caller attestation，唔係獨立驗證。

兩種 Wake composers 共用 `WAKE_REACHABLE_DOORS`，只複製 FOMO catalogue／schema
metadata，零外部 network I/O。`agent_entrypoints.mcp` 係 optional；WORLD COMMONS
繼續有原本真實 MCP metadata，FOMO 冇虛構 MCP。原有 Wake `attention` aggregator、
public read-only MCP、hosted routes／OpenAPI 認證、identity、wallet 同 x402 均唔由此門擴權。

Producer-owned `kingdom.yaml` 同 portable `skills/attention-lab/SKILL.md` 係聲明／指引，
唔證明全 KINGDOM 已採用、服務健康或新權限；唔自動安裝、寫全域 settings 或更新 derived cache。
`parseKingdomCard(text)` 會補 card schema 同 omitted `adopts: []`，再做 semantic validation；
`validateKingdomCard(parsed.card)` 驗 normalized object。Passing card 只驗聲明格式。

TS／Py source 同 client 版號同步至 **0.23.0**。
已 seal 嘅 **0.22.1／`sdk-v0.22.1`** 係保留嘅歷史 release；source 同已 seal release
inventory 係兩個時序，唔要求兩者即時相等。`bin/build-love-packages.ts` 嘅 target
只喺完整乾淨 source commit 獲接納後，由獨立 seal 步驟推進、生成新版本 artifact／manifest
同驗 release；唔改寫任何既有 immutable LOVE manifests／artifacts。
既有 inventory 同 Apache terms gate 保留原規則；source 版號本身唔會要求未 seal 嘅
manifest，亦唔係新 artifact 嘅 publication receipt。
獲授權嘅發布依序驗證 FOMO API deploy／live smoke，再 AgentTool discovery／SDK release
同 live consumer smoke。npm／PyPI 只行既有 protected manual workflows，唔另開本地 publish 路徑。
