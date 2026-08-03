"""Small canonical-JSON subset shared with AgentTool content IDs."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from typing import Any

from .errors import DecisionInvalid

_DOMAIN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
_MAX_SAFE_INTEGER = 9_007_199_254_740_991
_MAX_BYTES = 128 * 1024


def _snapshot(value: Any, path: str = "$") -> Any:
    if value is None or isinstance(value, (str, bool)):
        if isinstance(value, str) and "\x00" in value:
            raise DecisionInvalid(f"{path} contains forbidden U+0000")
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > _MAX_SAFE_INTEGER:
            raise DecisionInvalid(f"{path} is outside the JSON safe-integer range")
        return value
    if isinstance(value, float):
        raise DecisionInvalid(f"{path} must not contain floating-point values")
    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        for key, nested in value.items():
            if not isinstance(key, str):
                raise DecisionInvalid(f"{path} has a non-string key")
            result[key] = _snapshot(nested, f"{path}.{key}")
        return result
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_snapshot(nested, f"{path}[{index}]") for index, nested in enumerate(value)]
    raise DecisionInvalid(f"{path} contains unsupported {type(value).__name__}")


def canonical_json(value: Any) -> str:
    """Serialize the closed JSON subset like AgentTool's canonicalJson()."""

    encoded = json.dumps(
        _snapshot(value),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    if len(encoded.encode("utf-8")) > _MAX_BYTES:
        raise DecisionInvalid("canonical JSON exceeds 128 KiB")
    return encoded


def domain_separated_id(domain: str, value: Any) -> str:
    if not isinstance(domain, str) or _DOMAIN.fullmatch(domain) is None:
        raise DecisionInvalid("domain must be a 1-128 character ASCII protocol token")
    digest = hashlib.sha256(f"{domain}\x00{canonical_json(value)}".encode()).hexdigest()
    return f"sha256:{digest}"
