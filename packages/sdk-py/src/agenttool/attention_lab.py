"""FOMOengine 公開 Attention Lab；只傳 caller 明確選取嘅契約欄位。

呢個 client 唔用 AgentTool bearer、cookies、環境認證或者付款 transport。
核心計算同研究快照由 FOMOengine 擁有；SDK 只做有界傳輸同驗證。
"""

from __future__ import annotations

import json
import math
import queue
import re
import threading
import time
from typing import Literal, Optional, TypedDict, cast
from urllib.parse import urlsplit

import httpx

from .exceptions import AgentToolError

ATTENTION_LAB_ORIGIN = "https://fomoengine.io"
ATTENTION_LAB_PATH = "/api/v1/attention-lab"
ATTENTION_LAB_SCHEMA_VERSION = 1
ATTENTION_LAB_MAX_REQUEST_BYTES = 64 * 1024
ATTENTION_LAB_MAX_RESPONSE_BYTES = 512 * 1024
ATTENTION_LAB_TIMEOUT_SECONDS = 10.0

AttentionLabEvidenceKind = Literal["official-disclosure", "experimental", "observational", "hypothesis"]


class AttentionLabBriefInput(TypedDict):
    topic: str
    audience: str
    platformId: str
    objective: Literal["surface-response", "useful-action", "understanding"]
    mechanismId: str
    takeaway: str
    action: str
    evidenceStatus: Literal["missing", "provided"]
    evidence: str
    constraints: str
    verifiedProof: str
    realLimit: str
    limitReason: str
    terms: str
    nonpoliticalConfirmed: bool


class AttentionLabRawCounts(TypedDict):
    aOutcomes: str
    aEligible: str
    bOutcomes: str
    bEligible: str


class AttentionLabExperimentPlan(TypedDict):
    design: Literal["observational", "randomized"]
    allocation: str
    eligibility: str
    startDate: str
    endDate: str
    stoppingRule: str
    guardrailPlan: str
    guardrailResults: str


class AttentionLabMetricDefinition(TypedDict):
    name: str
    numerator: str
    denominator: str
    caveat: str


class AttentionLabSource(TypedDict):
    id: str
    title: str
    url: str
    publisher: str
    publishedAt: Optional[str]
    reviewedAt: str
    context: str
    retrievalLimitations: str


class AttentionLabClaim(TypedDict):
    id: str
    text: str
    kind: AttentionLabEvidenceKind
    sourceIds: list[str]
    context: str
    limitations: list[str]


class AttentionLabMechanismExample(TypedDict):
    honest: str
    pressure: str
    distinction: str


class AttentionLabMechanismExperiment(TypedDict):
    question: str
    variable: str
    control: str
    treatment: str
    holdConstant: list[str]
    readout: str
    limitations: str


class AttentionLabMechanism(TypedDict):
    id: str
    name: str
    summary: str
    emotion: str
    howItWorks: list[str]
    example: AttentionLabMechanismExample
    claims: list[AttentionLabClaim]
    honestUse: list[str]
    countermeasure: str
    tradeoffs: list[str]
    experiment: AttentionLabMechanismExperiment
    compatiblePlatformIds: list[str]
    sourceIds: list[str]


class AttentionLabPlatform(TypedDict):
    id: str
    name: str
    channel: Literal["social", "search", "email", "offer"]
    surface: str
    kind: Literal["ranked-surface", "strategy-channel"]
    summary: str
    rankingDisclosure: str
    signals: list[AttentionLabClaim]
    practicalChoices: list[str]
    metric: AttentionLabMetricDefinition
    qualityGuardrails: list[str]
    confounders: list[str]
    sourceIds: list[str]


class AttentionLabSection(TypedDict):
    heading: str
    body: str


class AttentionLabBriefExperiment(TypedDict):
    question: str
    variable: str
    control: str
    treatment: str
    shared: list[str]
    blocked: bool
    limitations: list[str]


class AttentionLabGeneratedBrief(TypedDict):
    input: AttentionLabBriefInput
    title: str
    sections: list[AttentionLabSection]
    experiment: AttentionLabBriefExperiment
    metric: AttentionLabMetricDefinition
    guardrails: list[str]
    confounders: list[str]
    sourceIds: list[str]


class AttentionLabSelectedEntry(TypedDict):
    id: str
    name: str
    claimIds: list[str]


class AttentionLabComparisonResult(TypedDict):
    aRate: Optional[float]
    bRate: Optional[float]
    percentagePointDifference: Optional[float]
    relativeLift: Optional[float]


class AttentionLabVersions(TypedDict):
    schemaVersion: Literal[1]
    engineVersion: str
    catalogueVersion: str
    catalogueDigest: str


class AttentionLabCatalogue(AttentionLabVersions):
    mechanisms: list[AttentionLabMechanism]
    platforms: list[AttentionLabPlatform]
    sources: list[AttentionLabSource]


class AttentionLabBriefArtifact(AttentionLabVersions):
    brief: AttentionLabGeneratedBrief
    mechanism: AttentionLabSelectedEntry
    platform: AttentionLabSelectedEntry
    sources: list[AttentionLabSource]
    claims: list[AttentionLabClaim]
    markdown: str


class AttentionLabComparisonInput(TypedDict):
    counts: AttentionLabRawCounts
    plan: AttentionLabExperimentPlan
    metric: AttentionLabMetricDefinition


class AttentionLabComparisonArtifact(AttentionLabVersions, AttentionLabComparisonInput):
    comparison: Optional[AttentionLabComparisonResult]
    designDescription: str
    missingRequirements: list[str]
    interpretation: str


_MESSAGES = {
    "invalid_options": "Attention Lab 設定唔符合公開 client 界線。",
    "invalid_request": "Attention Lab 輸入唔符合契約。",
    "request_too_large": "Attention Lab 請求超過 UTF-8 bytes 上限。",
    "response_too_large": "Attention Lab 回應超過 bytes 上限。",
    "invalid_response": "Attention Lab 回應唔符合 UTF-8 JSON 契約。",
    "unsupported_schema_version": "Attention Lab 回應使用未支援嘅 schemaVersion。",
    "unsupported_media_type": "Attention Lab 回應唔係支援嘅 JSON media type。",
    "redirect_refused": "Attention Lab 唔會跟隨 redirect。",
    "http_error": "Attention Lab 回傳非成功 HTTP status。",
    "rate_limited": "Attention Lab 暫時限制請求次數。",
    "timeout": "Attention Lab 請求超過整體 deadline。",
    "unreachable": "Attention Lab 暫時連唔到。",
}


class _AttentionLabError(AgentToolError):
    pass


def _error(kind: str, status: Optional[int] = None) -> AgentToolError:
    return _AttentionLabError(
        _MESSAGES[kind],
        error_code="attention_lab_" + kind,
        status=status,
        hint="核對公開 origin、契約同有界設定；唔會自動重試。",
        docs="https://fomoengine.io/api/v1/attention-lab/openapi.json",
        safety=ATTENTION_LAB_PATH,
    )


def _origin(value: object, allow_loopback: bool) -> str:
    if (
        type(value) is not str
        or not value
        or re.search(r"[\s\x00-\x20\x7f-\x9f\\%?#]", value)
        or any(0xD800 <= ord(c) <= 0xDFFF for c in value)
    ):
        raise _error("invalid_options")
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        port = parsed.port
        if (
            not host
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in ("", "/")
            or parsed.netloc.endswith(":")
            or port == 0
        ):
            raise ValueError()
        loopback = host in {"localhost", "127.0.0.1", "::1"}
        if parsed.scheme != "https" and not (
            parsed.scheme == "http" and allow_loopback and loopback
        ):
            raise ValueError()
        url = httpx.URL(value)
        if not url.host or url.userinfo:
            raise ValueError()
        return str(url).rstrip("/")
    except (ValueError, TypeError, httpx.InvalidURL):
        raise _error("invalid_options") from None


def _json_constant(_value: str) -> object:
    raise ValueError()


def _object_pairs(pairs: list[tuple[str, object]]) -> dict:
    result: dict = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def _decode_json(body: bytes) -> object:
    try:
        return json.loads(
            body.decode("utf-8", errors="strict"),
            parse_constant=_json_constant,
            object_pairs_hook=_object_pairs,
        )
    except (UnicodeError, ValueError, RecursionError):
        raise _error("invalid_response") from None


def _read_bounded(response: httpx.Response, maximum: int) -> bytes:
    encoding = response.headers.get("content-encoding", "identity").lower()
    # 唔解壓遠端內容；避免壓縮炸彈喺 bytes gate 前分配無界記憶體。
    if encoding != "identity":
        raise _error("invalid_response", response.status_code)
    length = response.headers.get("content-length")
    declared: Optional[int] = None
    if length is not None:
        if not re.fullmatch(r"(?:0|[1-9][0-9]{0,15})", length):
            raise _error("invalid_response", response.status_code)
        declared = int(length)
        if declared > 9_007_199_254_740_991:
            raise _error("invalid_response", response.status_code)
        if declared > maximum:
            raise _error("response_too_large", response.status_code)
    body = bytearray()
    try:
        for chunk in response.iter_bytes(chunk_size=8192):
            if len(body) + len(chunk) > maximum:
                raise _error("response_too_large", response.status_code)
            body.extend(chunk)
    except (AgentToolError, httpx.TimeoutException):
        raise
    except Exception:
        raise _error("invalid_response", response.status_code) from None
    if declared is not None and len(body) != declared:
        raise _error("invalid_response", response.status_code)
    return bytes(body)


class AttentionLabClient:
    """獨立、毋須 token；constructor 同 namespace access 都唔會連線。

    ``transport`` 只係 standalone 測試／host seam，必須自行保持無認證。
    整體 timeout 包括 headers、stalled body 同驗證；timeout 後 client
    變成 terminal，唔會累積卡住嘅 worker 或靜默重試。
    """

    def __init__(
        self,
        *,
        base_url: str = ATTENTION_LAB_ORIGIN,
        timeout: float = ATTENTION_LAB_TIMEOUT_SECONDS,
        max_request_bytes: int = ATTENTION_LAB_MAX_REQUEST_BYTES,
        max_response_bytes: int = ATTENTION_LAB_MAX_RESPONSE_BYTES,
        allow_loopback_http: bool = False,
        transport: Optional[httpx.BaseTransport] = None,
    ) -> None:
        if (
            type(allow_loopback_http) is not bool
            or type(timeout) not in (int, float)
            or not 0 < timeout <= ATTENTION_LAB_TIMEOUT_SECONDS
            or not math.isfinite(timeout)
            or type(max_request_bytes) is not int
            or not 1 <= max_request_bytes <= ATTENTION_LAB_MAX_REQUEST_BYTES
            or type(max_response_bytes) is not int
            or not 1 <= max_response_bytes <= ATTENTION_LAB_MAX_RESPONSE_BYTES
        ):
            raise _error("invalid_options")
        self._base_url = _origin(base_url, allow_loopback_http)
        self._timeout = float(timeout)
        self._max_request_bytes = max_request_bytes
        self._max_response_bytes = max_response_bytes
        self._http = httpx.Client(
            auth=None,
            cookies={},
            trust_env=False,
            follow_redirects=False,
            timeout=self._timeout,
            headers={"Accept": "application/json", "Accept-Encoding": "identity"},
            transport=transport,
        )
        self._lifecycle_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._terminal = False
        self._cancel_started = False
        self._active_response: Optional[httpx.Response] = None
        self._active_worker: Optional[threading.Thread] = None

    def _operation(self, operation: str, candidate: object) -> object:
        from ._attention_lab_contract import validate_input, validate_result

        content = None
        if operation != "catalogue":
            try:
                validate_input(operation, candidate)
                content = json.dumps(
                    candidate, ensure_ascii=False, allow_nan=False, separators=(",", ":")
                ).encode("utf-8")
                # 再驗實際將送出嘅快照，唔畀 caller 並行改 dict 夾入額外欄位。
                validate_input(operation, json.loads(content))
            except (TypeError, ValueError, UnicodeError, RecursionError):
                raise _error("invalid_request") from None
            if len(content) > self._max_request_bytes:
                raise _error("request_too_large")
        headers = {"Content-Type": "application/json"} if content is not None else {}
        with self._state_lock:
            if self._terminal:
                raise _error("unreachable")
        try:
            with self._http.stream(
                "GET" if operation == "catalogue" else "POST",
                f"{self._base_url}{ATTENTION_LAB_PATH}/{operation}",
                content=content,
                headers=headers,
            ) as response:
                with self._state_lock:
                    if self._terminal:
                        raise _error("unreachable")
                    self._active_response = response
                status = response.status_code
                if 300 <= status < 400:
                    raise _error("redirect_refused", status)
                if status == 429:
                    raise _error("rate_limited", status)
                if status != 200:
                    # 唔讀遠端錯誤正文／hint，亦唔接入 x402 或 retry。
                    raise _error("http_error", status)
                media = response.headers.get("content-type", "").lower().split(";")[0].strip()
                if media != "application/json":
                    raise _error("unsupported_media_type", status)
                candidate = _decode_json(_read_bounded(response, self._max_response_bytes))
                if (
                    type(candidate) is not dict
                    or set(candidate) != {"success", "data"}
                    or candidate["success"] is not True
                    or type(candidate["data"]) is not dict
                ):
                    raise _error("invalid_response")
                data = candidate["data"]
                if "schemaVersion" in data and (
                    type(data["schemaVersion"]) not in (int, float) or data["schemaVersion"] != 1
                ):
                    raise _error("unsupported_schema_version")
                try:
                    validate_result(operation, data)
                except (TypeError, ValueError, RecursionError):
                    raise _error("invalid_response") from None
                return data
        finally:
            with self._state_lock:
                self._active_response = None

    def _worker(self, results: queue.Queue, operation: str, candidate: object) -> None:
        event: tuple[str, object]
        try:
            self._http.cookies.clear()
            event = ("ok", self._operation(operation, candidate))
        except httpx.TimeoutException:
            event = ("error", _error("timeout"))
        except _AttentionLabError as error:
            # 重新建立閉合錯誤，唔帶 worker exception chain 或 request。
            event = ("error", _error(error.error_code.removeprefix("attention_lab_"), error.status))
        except Exception:
            event = ("error", _error("unreachable"))
        finally:
            self._http.cookies.clear()
            with self._state_lock:
                self._active_worker = None
        results.put_nowait(event)

    def _cancel(self) -> None:
        with self._state_lock:
            self._terminal = True
            if self._cancel_started:
                return
            self._cancel_started = True
            response = self._active_response

        def close_transport() -> None:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass
            try:
                self._http.close()
            except Exception:
                pass

        try:
            threading.Thread(target=close_transport, daemon=True).start()
        except RuntimeError:
            pass

    def _request(self, operation: str, candidate: object = None) -> object:
        deadline = time.monotonic() + self._timeout
        if not self._lifecycle_lock.acquire(timeout=self._timeout):
            self._cancel()
            raise _error("timeout")
        try:
            with self._state_lock:
                if self._terminal:
                    raise _error("unreachable")
            results: queue.Queue = queue.Queue(maxsize=1)
            worker = threading.Thread(
                target=self._worker,
                args=(results, operation, candidate),
                name="agenttool-attention-lab-request",
                daemon=True,
            )
            with self._state_lock:
                self._active_worker = worker
            try:
                worker.start()
            except RuntimeError:
                with self._state_lock:
                    self._active_worker = None
                raise _error("unreachable") from None
            try:
                kind, value = results.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty:
                self._cancel()
                raise _error("timeout") from None
            if time.monotonic() >= deadline:
                self._cancel()
                raise _error("timeout")
            if kind == "error":
                if value.error_code == "attention_lab_timeout":
                    self._cancel()
                raise value from None
            return value
        finally:
            self._lifecycle_lock.release()

    def catalogue(self) -> AttentionLabCatalogue:
        """讀取有版本、完整來源同 claims 嘅公開 catalogue。"""
        return cast(AttentionLabCatalogue, self._request("catalogue"))

    def build_brief(self, input: AttentionLabBriefInput) -> AttentionLabBriefArtifact:
        """明確傳送 brief 欄位；保留 blocked、限制同 citation 快照。"""
        return cast(AttentionLabBriefArtifact, self._request("briefs", input))

    def compare(self, input: AttentionLabComparisonInput) -> AttentionLabComparisonArtifact:
        """傳送原始十進位字串／空白 counts；唔將未知改成零。"""
        return cast(AttentionLabComparisonArtifact, self._request("comparisons", input))

    def close(self) -> None:
        """關閉獨立 session；timeout 後唔再等候卡住嘅 transport。"""
        with self._lifecycle_lock:
            if self._terminal:
                return
            self._terminal = True
            self._http.close()

    def __enter__(self) -> AttentionLabClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
