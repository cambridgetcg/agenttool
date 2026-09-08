#!/usr/bin/env python3
"""Opt-in, daemon-free real SDK file-keyring + NativeSeedIo proof. Stdlib only.
Creates only a fresh disposable home; never accepts/reuses a caller's keyring.
Passwords exist in this test process and owned no-echo PTYs, not JSON/env/argv.
"""
import argparse
import base64
import hashlib
import json
import os
import pathlib
import pty
import secrets
import select
import shutil
import stat
import subprocess
import tempfile
import termios
import time


def require(value, label):
    if not value:
        raise RuntimeError(label)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def write(path, value):
    with open(path, "xb") as f:
        f.write(canonical(value))


def digest(path):
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ack-disposable-file-keyring", action="store_true", required=True)
    for name in ("bun", "zeroned", "zeroned-sha256", "helper", "helper-sha256"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    root = pathlib.Path(tempfile.mkdtemp(prefix="seed-file-keyring-", dir=pathlib.Path(tempfile.gettempdir()).resolve()))
    children, terminals = [], []
    stage = "artifact_pins"
    result = {"result": "FAIL"}
    try:
        helper, zeroned, bun = (pathlib.Path(p) for p in (args.helper, args.zeroned, args.bun))
        for p in (helper, zeroned, bun):
            require(p.is_absolute() and p.resolve() == p and p.is_file(), "explicit_canonical_artifact")
        require(digest(helper) == args.helper_sha256 and digest(zeroned) == args.zeroned_sha256, "artifact_digest")
        env = {"PATH": "/usr/bin:/bin", "HOME": str(root), "TMPDIR": str(root), "LANG": "C", "LC_ALL": "C"}
        require(subprocess.check_output([str(bun), "--version"], env=env, timeout=10).strip() == b"1.3.5", "bun_version")
        home = root / "generated-home"
        home.mkdir(mode=0o700)
        password = secrets.token_urlsafe(32).encode()
        wrong_password = secrets.token_urlsafe(32).encode()

        def terminal():
            master, slave = pty.openpty()
            terminals.extend([master, slave])
            attrs = termios.tcgetattr(slave)
            attrs[3] &= ~(termios.ECHO | termios.ECHONL)
            termios.tcsetattr(slave, termios.TCSANOW, attrs)
            name = os.ttyname(slave)
            s = os.fstat(slave)
            require(stat.S_ISCHR(s.st_mode) and s.st_uid == os.getuid() and os.isatty(slave), "owned_pty")
            return master, slave, name

        def drive(command, replies, stdin=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=90):
            # Bounded buffers remain private; errors never relay child diagnostic bodies.
            child = subprocess.Popen(command, cwd=root, env=env, stdin=stdin, stdout=subprocess.PIPE, stderr=stderr)
            children.append(child)
            streams = {child.stdout.fileno(): bytearray()}
            if child.stderr is not None:
                streams[child.stderr.fileno()] = bytearray()
            buffers = {fd: bytearray() for fd in replies}
            sent = {fd: 0 for fd in replies}
            until = time.monotonic() + timeout
            while child.poll() is None or streams:
                require(time.monotonic() < until, "child_deadline")
                ready, _, _ = select.select(list(streams) + list(replies), [], [], 0.1)
                for fd in ready:
                    try:
                        data = os.read(fd, 4096)
                    except OSError:
                        data = b""
                    if fd in streams:
                        if not data:
                            del streams[fd]
                            continue
                        target = out if fd == child.stdout.fileno() else err
                        target.extend(data)
                        require(len(target) <= 262144, "child_output_bound")
                    elif data:
                        buffers[fd].extend(data)
                        require(len(buffers[fd]) <= 8192, "terminal_output_bound")
                        plan = replies[fd]
                        while sent[fd] < len(plan) and plan[sent[fd]][0] in buffers[fd]:
                            prompt, secret = plan[sent[fd]]
                            end = buffers[fd].index(prompt) + len(prompt)
                            del buffers[fd][:end]
                            os.write(fd, secret + b"\n")
                            sent[fd] += 1
                if child.poll() is not None and not streams:
                    break
            require(child.wait(timeout=5) == 0, "child_exit")
            require(all(sent[fd] == len(replies[fd]) for fd in replies), "expected_terminal_prompts")
            require(password not in out and password not in err and wrong_password not in out and wrong_password not in err, "secret_output")
            return json.loads(out)

        stage = "fresh_sdk_keyring"
        master, slave, _ = terminal()
        out, err = bytearray(), bytearray()
        public = drive([str(zeroned), "keys", "add", "claimant", "--no-backup", "--keyring-backend", "file", "--home", str(home), "--output", "json"],
                       {master: [(b"Enter keyring passphrase (attempt 1/3):", password), (b"Re-enter keyring passphrase:", password)]}, stdin=slave, stderr=slave)
        require("mnemonic" not in public or not public["mnemonic"], "mnemonic_output")
        pub = public["pubkey"]
        if isinstance(pub, str):
            pub = json.loads(pub)
        require(pub["@type"] == "/cosmos.crypto.secp256k1.PubKey", "sdk_public_key_type")
        key = base64.b64decode(pub["key"], validate=True)
        require(len(key) == 33, "sdk_public_key_size")
        keyring = home / "keyring-file"
        require((keyring / "keyhash").is_file() and (keyring / "claimant.info").is_file(), "existing_encrypted_keyring")
        before = {str(p.relative_to(home)): digest(p) for p in home.rglob("*") if p.is_file()}
        for p in keyring.rglob("*"):
            require(stat.S_IMODE(p.stat().st_mode) == (0o700 if p.is_dir() else 0o600), "private_keyring_modes")
        good_master, _, good_name = terminal()
        bad_master, _, bad_name = terminal()
        fifo = root / "not-terminal"
        os.mkfifo(fifo, 0o600)
        genesis, source, runtime = (root / name for name in ("genesis.json", "source.json", "runtime.fixture"))
        write(genesis, {"chain_id": "seed-local-1", "genesis_time": "2026-01-01T00:00:00Z", "initial_height": "1", "app_state": {}, "validators": []})
        write(source, {"label": "NON-FINAL disposable file-keyring unit proof; no node", "helper_sha256": args.helper_sha256})
        runtime.write_bytes(b"explicit disposable unit runtime marker; not a node binary")
        setup = root / "public-input.json"
        write(setup, {"ack": "disposable-file-keyring-proof", "helper": {"path": str(helper), "sha256": args.helper_sha256}, "public_key_b64u": base64.urlsafe_b64encode(key).decode().rstrip("="), "home": str(home), "terminal": good_name, "wrong_terminal": bad_name, "fifo": str(fifo), "genesis": str(genesis), "source": str(source), "runtime": str(runtime)})
        stage = "native_adapter_sign_verify"
        here = pathlib.Path(__file__).resolve().parent
        out, err = bytearray(), bytearray()
        result = drive([str(bun), "--tsconfig-override", str(here / "tsconfig.json"), str(here / "file-keyring-proof.ts"), "--ack-disposable-file-keyring", str(setup)],
                       {good_master: [(b"Unlock existing seed keyring: ", password)], bad_master: [(b"Unlock existing seed keyring: ", wrong_password)]})
        require(result.get("result") == "PASS", "adapter_proof_result")
        after = {str(p.relative_to(home)): digest(p) for p in home.rglob("*") if p.is_file()}
        require(before == after, "existing_keyring_unchanged")
        require(digest(helper) == args.helper_sha256 and digest(zeroned) == args.zeroned_sha256, "final_artifact_digest")
        result.update({"fresh_sdk_file_keyring": True, "keyring_unchanged": True, "echo_disabled": True, "sdk_keygen_no_backup": True, "terminal_prompts": 4, "zeroned_sha256": args.zeroned_sha256})
    except Exception as exc:
        result = {"result": "FAIL", "stage": stage, "code": str(exc) if isinstance(exc, RuntimeError) else "test_setup_failed"}
        progress = root / "progress.json"
        if progress.is_file():
            result["adapter_stage"] = json.loads(progress.read_bytes())["stage"]
    finally:
        for child in children:
            if child.poll() is None:
                # No running node; helpers have their own <=10s deadline. Reap owned direct children only.
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=10)
            for stream in (child.stdout, child.stderr):
                if stream:
                    stream.close()
        for fd in terminals:
            os.close(fd)
        shutil.rmtree(root)
        result.update({"owned_direct_children_reaped": all(p.poll() is not None for p in children), "owned_ptys_closed": True, "owned_private_home_removed": not root.exists(), "production_state_used": False})
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if result["result"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
