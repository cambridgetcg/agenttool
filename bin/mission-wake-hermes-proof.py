#!/usr/bin/env python3
"""Verify one newly admitted Hermes read receipt. Stdlib, SQLite read-only.

Only selected user/tool/assistant fields for one exact fixture-matched session
are read. Never export system prompts, reasoning, other sessions, or credentials.
Unknown schema/content fails closed; this is local evidence, not attestation.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import time

MAX = 262144


def require(condition):
    if not condition:
        raise ValueError("native evidence mismatch")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def private_file(path):
    path = Path(path)
    require(path.is_absolute() and str(path.resolve()) == str(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077 and info.st_size <= MAX)
        return stream.read(MAX + 1)


def verify(spec):
    require(set(spec) == {"state_db", "arrival_path", "arrival_sha256", "started_after", "finished_before", "receipt"})
    start, end = spec["started_after"], spec["finished_before"]
    require(type(start) in (int, float) and type(end) in (int, float) and 0 < start <= end <= start + 930)
    fixture_path = spec["arrival_path"]
    fixture = private_file(fixture_path)
    require(digest(fixture) == spec["arrival_sha256"])
    arrival = json.loads(fixture)
    receipt = {key: arrival[key] for key in ("event_id", "delivery_id", "challenge", "body_sha256", "message_sha256")}
    receipt["status"] = "read"
    require(spec["receipt"] == receipt)
    database = Path(spec["state_db"])
    require(database.is_absolute() and str(database.resolve()) == str(database))
    before = database.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and not before.st_mode & 0o022)
    db = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=2)
    db.execute("PRAGMA query_only = ON")
    deadline = time.monotonic() + 3
    db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
    try:
        # cwd is NULL in some Hermes CLI versions. The fresh unique fixture path
        # in the host task, source and time window are the selection boundary.
        candidates = db.execute("""SELECT s.id, s.started_at FROM sessions s
            WHERE s.source = 'tool' AND s.parent_session_id IS NULL
            AND s.started_at >= ? AND s.started_at <= ?
            AND EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id
                AND m.role = 'user' AND m.active = 1 AND instr(m.content, ?) > 0)
            LIMIT 2""", (start, end, json.dumps(fixture_path, ensure_ascii=False))).fetchall()
        require(len(candidates) == 1)
        session, started = candidates[0]
        require(isinstance(session, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", session))
        inactive = db.execute("""SELECT count(*) FROM messages WHERE session_id = ?
            AND active IS NOT 1 AND role IN ('user', 'assistant', 'tool')""", (session,)).fetchone()[0]
        require(inactive == 0)
        count, size = db.execute("""SELECT count(*), coalesce(sum(coalesce(length(content), 0) + coalesce(length(tool_calls), 0)), 0)
            FROM messages WHERE session_id = ? AND active = 1
            AND role IN ('user', 'assistant', 'tool')""", (session,)).fetchone()
        require(0 < count <= 100 and size <= MAX)
        rows = db.execute("""SELECT id, role, content, tool_calls, tool_call_id, tool_name
            FROM messages WHERE session_id = ? AND active = 1
            AND role IN ('user', 'assistant', 'tool') ORDER BY id""", (session,)).fetchall()
    finally:
        db.close()
    after = database.lstat()
    require((before.st_dev, before.st_ino) == (after.st_dev, after.st_ino))
    calls, proofs, finals = {}, [], []
    fixture_text = fixture.decode("utf-8").rstrip("\n")
    for message_id, role, content, raw_calls, call_id, tool_name in rows:
        require(content is None or isinstance(content, str))
        if role == "user":
            # Challenge exists only in the arrival, never the model task input.
            require(arrival["challenge"] not in (content or ""))
        if role == "assistant" and raw_calls:
            decoded = json.loads(raw_calls)
            require(isinstance(decoded, list) and len(decoded) <= 12)
            for call in decoded:
                function = call.get("function", {})
                args = json.loads(function.get("arguments", ""))
                require(function.get("name") == "read_file" and isinstance(args, dict))
                require(set(args) <= {"path", "offset", "limit"} and args.get("path") == fixture_path and args.get("offset", 1) == 1)
                require(isinstance(call.get("id"), str) and 0 < len(call["id"]) <= 256 and call["id"] not in calls)
                calls[call["id"]] = {"message_id": message_id, "arguments": args}
        elif role == "assistant" and content:
            finals.append(content)
        elif role == "tool":
            require(tool_name == "read_file" and call_id in calls and not any(p["tool_call_id"] == call_id for p in proofs))
            result = json.loads(content)
            require(isinstance(result, dict) and not result.get("error") and not result.get("truncated") and not result.get("dedup"))
            numbered = result.get("content")
            require(isinstance(numbered, str))
            # Installed read_file numbers split('\n'), preserving Unicode line
            # separators within a JSON string. Shell backends may retain or
            # remove the file's one terminating newline before numbering.
            lines = numbered.split("\n")
            require(lines and all(re.match(r"^\s*" + str(index) + r"\|", line) for index, line in enumerate(lines, 1)))
            recovered = "\n".join(re.sub(r"^\s*\d+\|", "", line, count=1) for line in lines)
            require(recovered in (fixture_text, fixture.decode("utf-8")))
            proofs.append({"tool_call_id": call_id, "call_message_id": calls[call_id]["message_id"],
                           "result_message_id": message_id, "arguments": calls[call_id]["arguments"],
                           "result_sha256": digest(content.encode()), "content_sha256": digest(recovered.encode())})
    require(0 < len(proofs) == len(calls) <= 12 and finals and json.loads(finals[-1]) == receipt)
    require(digest(private_file(fixture_path)) == spec["arrival_sha256"])
    return {"status": "verified", "session_id": session, "session_started_at": started,
            "arrival_sha256": spec["arrival_sha256"], "read_calls": proofs, "final_receipt": receipt}


def main():
    try:
        raw = sys.stdin.buffer.read(MAX + 1)
        require(0 < len(raw) <= MAX)
        print(json.dumps(verify(json.loads(raw)), ensure_ascii=False))
        return 0
    except Exception:
        print(json.dumps({"status": "unconfirmed", "code": "NATIVE_PROOF_MISMATCH"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
