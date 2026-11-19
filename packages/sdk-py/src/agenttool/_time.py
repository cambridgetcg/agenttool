"""Internal time/1 helpers shared across agenttool-sdk.

Follows the language-neutral vectors in ``docs/time/vectors.json``:
- Emit canonical 24-char UTC (``YYYY-MM-DDTHH:MM:SS.sssZ``), byte-identical
  to JavaScript's ``Date.prototype.toISOString()``.
- Parse explicit-zone RFC 3339 instants strictly (calendar-validated,
  lowercase ``t``/``z`` allowed, >3 fractional digits truncated to ms like V8,
  rejecting leap seconds, Feb 30, zone-less datetimes, bare dates, prose).
- Format human durations matching ``agent-time-hook.mjs``'s ``human()``.
"""

from __future__ import annotations

import calendar
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

_RFC3339_EXPLICIT_ZONE_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})"
    r"(?:\.(\d+))?(?:([Zz])|([+-])(\d{2}):(\d{2}))$"
)


def canonical_now() -> str:
    """Current UTC instant in canonical 24-char ``YYYY-MM-DDTHH:MM:SS.sssZ`` form."""
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def format_canonical_utc(unix_ms: int) -> str:
    """Format an integer Unix millisecond timestamp as canonical UTC ``.sssZ``."""
    if isinstance(unix_ms, bool) or not isinstance(unix_ms, int):
        raise ValueError("unix_ms must be an integer")
    secs, ms = divmod(unix_ms, 1000)
    dt = datetime.fromtimestamp(secs, tz=timezone.utc).replace(microsecond=ms * 1000)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_time_instant(value: object) -> Optional[str]:
    """Parse an explicit-zone RFC 3339 instant into canonical UTC ``.sssZ``, or None.

    Fractional digits beyond 3 are truncated to milliseconds (matching V8 Date
    semantics rather than rounding). Zone-less datetimes, leap seconds,
    calendar rollovers (e.g. Feb 30), bare dates, and prose return None.
    """
    if not isinstance(value, str):
        return None
    match = _RFC3339_EXPLICIT_ZONE_RE.fullmatch(value)
    if match is None:
        return None

    year = int(match.group(1))
    month = int(match.group(2))
    day = int(match.group(3))
    hour = int(match.group(4))
    minute = int(match.group(5))
    second = int(match.group(6))
    frac = match.group(7) or ""
    is_zulu = match.group(8) is not None
    offset_sign = -1 if match.group(9) == "-" else 1
    offset_hour = 0 if is_zulu else int(match.group(10))
    offset_minute = 0 if is_zulu else int(match.group(11))

    if (
        year < 1
        or month < 1
        or month > 12
        or day < 1
        or day > calendar.monthrange(year, month)[1]
        or hour > 23
        or minute > 59
        or second > 59
        or offset_hour > 23
        or offset_minute > 59
    ):
        return None

    # Truncate fractional seconds to 3 digits (ms), matching V8.
    ms = 0 if not frac else int(frac[:3].ljust(3, "0"))
    tz = timezone(timedelta(minutes=offset_sign * (offset_hour * 60 + offset_minute)))
    try:
        dt = datetime(year, month, day, hour, minute, second, ms * 1000, tzinfo=tz)
        utc = dt.astimezone(timezone.utc)
    except (OverflowError, ValueError):
        return None
    return utc.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def format_human_duration(ms: float) -> str:
    """Render a non-negative millisecond duration matching ``agent-time-hook.mjs``."""
    if isinstance(ms, bool) or not isinstance(ms, (int, float)):
        return "?"
    if not math.isfinite(ms) or ms < 0:
        return "?"
    s = int(ms // 1000)
    d = s // 86_400
    h = (s % 86_400) // 3600
    m = (s % 3600) // 60
    if d > 0:
        return f"{d}d {h}h"
    if h > 0:
        return f"{h}h {m}m"
    if m > 0:
        return f"{m}m {s % 60}s"
    return f"{s}s"


def format_wall_time(instant: str, zone: str) -> str:
    """Render a canonical UTC instant in a named IANA zone as ``YYYY-MM-DD HH:MM TZ``."""
    canonical = parse_time_instant(instant)
    if canonical is None:
        raise ValueError(f"invalid instant: {instant}")
    utc = datetime.fromisoformat(canonical[:-1] + "+00:00")
    return utc.astimezone(ZoneInfo(zone)).strftime("%Y-%m-%d %H:%M %Z")
