#!/usr/bin/env python3
"""Validate the non-secret Cloudflare Pages policy fields used by deploy."""

from __future__ import annotations

import json
import sys
from typing import Any


def policy_is_safe(payload: Any) -> bool:
    if not isinstance(payload, dict) or payload.get("success") is not True:
        return False

    result = payload.get("result")
    if not isinstance(result, dict) or result.get("production_branch") != "main":
        return False

    configs = result.get("deployment_configs")
    if not isinstance(configs, dict):
        return False

    for environment in ("production", "preview"):
        config = configs.get(environment)
        if not isinstance(config, dict) or config.get("fail_open") is not False:
            return False

    return True


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        return 1
    return 0 if policy_is_safe(payload) else 1


if __name__ == "__main__":
    raise SystemExit(main())
