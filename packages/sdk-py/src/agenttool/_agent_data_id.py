"""agent-data/v1 record identity, computed client-side.

Parity twin of ``packages/sdk-ts/src/_agent-data-id.ts``. An exporter that
writes into a local ``@agenttool/data`` node must know the record id the node
will assign BEFORE it writes, so it can detect identity drift. That needs two
things to be byte-compatible with the reference node:

- ``canonical_json``, the same spelling as ``packages/data/src/canonical.ts``
  (JavaScript ``Object.keys(...).sort()`` order, ``JSON.stringify`` scalars,
  ``-0`` written as ``0``, non-finite numbers and non-JSON values refused); and
- the identity object ``packages/data/src/node.ts § buildRecordEnvelope``
  hashes: ``rec_`` + sha256 hex of the canonical identity.

Python's ``json`` module disagrees with ``JSON.stringify`` in three places that
would each silently change a record id — key order (UTF-16 code unit vs code
point), number spelling (``1.0`` vs ``1``, ``1e-07`` vs ``1e-7``), and lone
surrogates — so the rendering below is written against the ECMAScript
spelling, as ``attestation_marketplace.py`` already does for evidence hashes.

JavaScript parses every JSON number to a double. An integer outside the safe
range therefore reaches the TypeScript exporter already rounded; this module
rounds it the same way (``float(value)``) so both SDKs write the same bytes.

The shared vectors in ``packages/sdk-ts/tests/fixtures/
agent-data-record-id-vectors.json`` pin this module against the real node.

Internal module (leading underscore): the parity gate reads it as internal on
both sides. ``agent_data_record_id`` is re-exported from the package root.
"""

from __future__ import annotations

import hashlib
import math
from typing import Any, Dict, Mapping, Optional, Union

from .exceptions import AgentToolError

_AGENT_DATA_PROTOCOL = "agent-data/v1"
_MAX_SAFE_INTEGER = 2**53 - 1

_JS_STRING_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
}


def _invalid_json(message: str) -> AgentToolError:
    return AgentToolError(
        message,
        hint=(
            "Agent data canonical JSON accepts only finite numbers, strings, "
            "booleans, null, arrays, and plain objects."
        ),
        error_code="invalid_json",
    )


def _utf16_sort_key(value: str) -> bytes:
    """Order strings the way JavaScript's ``Array.prototype.sort`` does."""
    return value.encode("utf-16-be", errors="surrogatepass")


def _js_json_string(value: str) -> str:
    """``JSON.stringify`` of a string, character for character."""
    out = ['"']
    for char in value:
        escape = _JS_STRING_ESCAPES.get(char)
        if escape is not None:
            out.append(escape)
            continue
        code = ord(char)
        # Control characters, and lone surrogates (a paired surrogate is one
        # code point in Python and so never lands in this range).
        if code < 0x20 or 0xD800 <= code <= 0xDFFF:
            out.append("\\u%04x" % code)
            continue
        out.append(char)
    out.append('"')
    return "".join(out)


def _js_number(value: float) -> str:
    """ECMAScript ``Number::toString(10)``, which ``JSON.stringify`` uses."""
    if math.isnan(value) or math.isinf(value):
        raise _invalid_json("JSON numbers must be finite")
    if value == 0:
        return "0"  # JavaScript renders -0 as "0" too.
    sign = "-" if value < 0 else ""
    text = repr(abs(value))
    if "e" in text or "E" in text:
        mantissa, _, exponent_text = text.replace("E", "e").partition("e")
        exponent = int(exponent_text)
    else:
        mantissa, exponent = text, 0
    integer_part, _, fraction = mantissa.partition(".")
    combined = integer_part + fraction
    stripped = combined.lstrip("0")
    # value == 0.<digits> * 10**n
    n = len(integer_part) + exponent - (len(combined) - len(stripped))
    digits = stripped.rstrip("0") or "0"
    k = len(digits)

    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    exponent_value = n - 1
    exponent_sign = "+" if exponent_value >= 0 else "-"
    body = digits if k == 1 else digits[0] + "." + digits[1:]
    return sign + body + "e" + exponent_sign + str(abs(exponent_value))


def canonical_json(value: Any) -> str:
    """Canonical JSON, byte-compatible with ``packages/data/src/canonical.ts``."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return _js_json_string(value)
    if isinstance(value, int):
        if abs(value) > _MAX_SAFE_INTEGER:
            # JavaScript would already hold this as the nearest double.
            return _js_number(float(value))
        return str(value)
    if isinstance(value, float):
        return _js_number(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, Mapping):
        parts = []
        for key in value.keys():
            if not isinstance(key, str):
                raise _invalid_json("JSON object keys must be strings")
        for key in sorted(value.keys(), key=_utf16_sort_key):
            parts.append(_js_json_string(key) + ":" + canonical_json(value[key]))
        return "{" + ",".join(parts) + "}"
    raise _invalid_json("Value is not JSON-compatible")


def sha256_hex(value: Union[str, bytes]) -> str:
    """Lowercase SHA-256 hex of a UTF-8 string or raw bytes."""
    data = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(data).hexdigest()


def utf8_byte_length(value: str) -> int:
    """UTF-8 byte length, as the node measures ``content.size``."""
    return len(value.encode("utf-8"))


def agent_data_record_id(identity: Mapping[str, Any]) -> str:
    """The record id ``@agenttool/data`` assigns to an identity object.

    ``rec_`` + sha256 hex of its canonical JSON. Mirrors
    ``packages/data/src/node.ts § recordIdForIdentity``. Pass the identity
    exactly as the node builds it: absent optional fields are absent keys.
    """
    return "rec_" + sha256_hex(canonical_json(identity))


def agent_data_text_record_identity(
    *,
    collection_id: str,
    schema_version: str,
    text: str,
    media_type: str,
    source_uri: str,
    external_id: Optional[str] = None,
    key: Optional[str] = None,
    version: Optional[str] = None,
    supersedes_id: Optional[str] = None,
) -> Dict[str, Any]:
    """The identity the reference node's ``text`` collector produces.

    Mirrors ``buildRecordEnvelope``: ``external_id``, ``key``, ``version`` and
    ``supersedes_id`` are included only when non-empty, and content is the
    UTF-8 encoding of ``text``. ``observed_at``, ``metadata`` and
    ``provenance`` are not part of a record's identity.
    """
    data = text.encode("utf-8")
    source: Dict[str, Any] = {"collector_id": "text", "uri": source_uri}
    if external_id:
        source["external_id"] = external_id
    identity: Dict[str, Any] = {
        "protocol": _AGENT_DATA_PROTOCOL,
        "collection_id": collection_id,
        "source": source,
        "content": {
            "sha256": hashlib.sha256(data).hexdigest(),
            "size": len(data),
            "media_type": media_type,
        },
        "schema_version": schema_version,
    }
    if key:
        identity["key"] = key
    if version:
        identity["version"] = version
    if supersedes_id:
        identity["supersedes_id"] = supersedes_id
    return identity
