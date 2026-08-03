"""Mechanically enumerate every public method that can raise from an HTTP response.

The error boundary was centralised so that server guidance survives to the
caller. A matrix that pins *a sample* of that boundary is not a guard: the
six-fold encoder duplication happened under exactly such a guard, because the
guard existed and did not cover the case. So the matrix in
``test_error_guidance.py`` is checked against this enumeration, and a new
public method that reaches the boundary without a matrix entry fails the build.

Method: stdlib :mod:`ast`. Parse every module under ``src/agenttool``, build an
intra-package call graph, seed it with the centralised sinks in
``exceptions.py``, and propagate reachability to a fixed point.

Edges resolved (no name-similarity guessing — every edge is a real binding):

* ``helper(...)``            → a module-level function in the same module
* ``imported(...)``          → a name bound by ``from .mod import name``
* ``self.method(...)``       → a method on the enclosing class
* ``self._sub.method(...)``  → a method on the class ``_sub`` was assigned in
  ``__init__`` (either ``self._sub = SomeClient(...)`` or an annotated
  constructor parameter)

Deliberately *not* resolved: a callable handed in as an opaque constructor
parameter. ``DataSyncClient`` is the only such case, and it is the one
documented place where guidance does not survive, pinned by name in
``test_error_guidance.py`` rather than by this walk.

Parity counterpart: ``packages/sdk-ts/tests/_error-surface.ts``.
"""

from __future__ import annotations

import ast
import os
from collections import defaultdict
from typing import Dict, List, Optional, Set, Tuple

SRC = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "src",
    "agenttool",
)

# The centralised boundary. Every one of these lives in exceptions.py and is
# the single place an HTTP response becomes an AgentToolError.
SINK_NAMES = (
    "raise_from_response",
    "_error_from_response",
    "_typed_error_from_response",
    "_error_from_body",
)


def _parse_all() -> Dict[str, ast.Module]:
    modules: Dict[str, ast.Module] = {}
    for fname in sorted(os.listdir(SRC)):
        if not fname.endswith(".py"):
            continue
        with open(os.path.join(SRC, fname), encoding="utf-8") as fh:
            modules[fname[:-3]] = ast.parse(fh.read(), filename=fname)
    return modules


def enumerate_error_surface() -> Set[str]:
    """Return ``{"module.Class.method"}`` for every public method that can
    raise an ``AgentToolError`` built from an HTTP response."""
    return {entry for entry, _line in enumerate_error_surface_with_lines()}


def enumerate_error_surface_with_lines() -> List[Tuple[str, int]]:
    modules = _parse_all()

    meta: Dict[str, dict] = {}
    imports: Dict[str, Dict[str, Tuple[str, str]]] = defaultdict(dict)

    for mod, tree in modules.items():
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.level == 1 and node.module:
                for alias in node.names:
                    imports[mod][alias.asname or alias.name] = (
                        node.module,
                        alias.name,
                    )
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                meta[f"{mod}::{node.name}"] = {
                    "mod": mod,
                    "cls": None,
                    "name": node.name,
                    "line": node.lineno,
                    "public": False,
                    "node": node,
                }
            elif isinstance(node, ast.ClassDef):
                for sub in node.body:
                    if not isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        continue
                    meta[f"{mod}::{node.name}.{sub.name}"] = {
                        "mod": mod,
                        "cls": node.name,
                        "name": sub.name,
                        "line": sub.lineno,
                        "public": not node.name.startswith("_")
                        and not sub.name.startswith("_"),
                        "node": sub,
                    }

    # ── instance attribute types, so self._sub.method(...) resolves ─────────
    attr_types: Dict[Tuple[str, str, str], Tuple[str, str]] = {}

    def class_home(mod: str, class_name: str) -> Optional[str]:
        if any(k.startswith(f"{mod}::{class_name}.") for k in meta):
            return mod
        if class_name in imports[mod]:
            src_mod, orig = imports[mod][class_name]
            if any(k.startswith(f"{src_mod}::{orig}.") for k in meta):
                return src_mod
        return None

    for mod, tree in modules.items():
        for cls_node in [n for n in tree.body if isinstance(n, ast.ClassDef)]:
            init = next(
                (
                    b
                    for b in cls_node.body
                    if isinstance(b, (ast.FunctionDef, ast.AsyncFunctionDef))
                    and b.name == "__init__"
                ),
                None,
            )
            if init is None:
                continue
            param_types: Dict[str, str] = {}
            for arg in init.args.args + init.args.kwonlyargs:
                ann = arg.annotation
                if isinstance(ann, ast.Name):
                    param_types[arg.arg] = ann.id
                elif isinstance(ann, ast.Constant) and isinstance(ann.value, str):
                    param_types[arg.arg] = ann.value
            for stmt in ast.walk(init):
                if not isinstance(stmt, ast.Assign):
                    continue
                for tgt in stmt.targets:
                    if not (
                        isinstance(tgt, ast.Attribute)
                        and isinstance(tgt.value, ast.Name)
                        and tgt.value.id == "self"
                    ):
                        continue
                    cname: Optional[str] = None
                    if isinstance(stmt.value, ast.Call) and isinstance(
                        stmt.value.func, ast.Name
                    ):
                        cname = stmt.value.func.id
                    elif isinstance(stmt.value, ast.Name):
                        cname = param_types.get(stmt.value.id)
                    if not cname:
                        continue
                    home = class_home(mod, cname)
                    if home:
                        orig = imports[mod].get(cname, (None, cname))[1]
                        attr_types[(mod, cls_node.name, tgt.attr)] = (home, orig)

    def resolve(mod: str, cls: Optional[str], call: ast.expr) -> List[str]:
        out: List[str] = []
        if isinstance(call, ast.Name):
            if f"{mod}::{call.id}" in meta:
                out.append(f"{mod}::{call.id}")
            if call.id in imports[mod]:
                src_mod, orig = imports[mod][call.id]
                if f"{src_mod}::{orig}" in meta:
                    out.append(f"{src_mod}::{orig}")
        elif isinstance(call, ast.Attribute):
            val = call.value
            if isinstance(val, ast.Name) and val.id == "self" and cls:
                if f"{mod}::{cls}.{call.attr}" in meta:
                    out.append(f"{mod}::{cls}.{call.attr}")
            elif isinstance(val, ast.Name) and val.id in imports[mod]:
                src_mod, orig = imports[mod][val.id]
                if f"{src_mod}::{orig}.{call.attr}" in meta:
                    out.append(f"{src_mod}::{orig}.{call.attr}")
            elif (
                isinstance(val, ast.Attribute)
                and isinstance(val.value, ast.Name)
                and val.value.id == "self"
                and cls
                and (mod, cls, val.attr) in attr_types
            ):
                sub_mod, sub_cls = attr_types[(mod, cls, val.attr)]
                if f"{sub_mod}::{sub_cls}.{call.attr}" in meta:
                    out.append(f"{sub_mod}::{sub_cls}.{call.attr}")
        return out

    edges: Dict[str, Set[str]] = defaultdict(set)
    for node_id, info in meta.items():
        for sub in ast.walk(info["node"]):
            if isinstance(sub, ast.Call):
                for target in resolve(info["mod"], info["cls"], sub.func):
                    edges[node_id].add(target)

    rev: Dict[str, Set[str]] = defaultdict(set)
    for caller, callees in edges.items():
        for callee in callees:
            rev[callee].add(caller)

    sinks = {f"exceptions::{n}" for n in SINK_NAMES}
    missing = sorted(s for s in sinks if s not in meta)
    if missing:  # pragma: no cover - only if the boundary is renamed
        raise AssertionError(
            "The centralised error boundary moved. exceptions.py no longer "
            f"defines {missing}. Update SINK_NAMES in tests/_error_surface.py "
            "and its TypeScript counterpart together."
        )

    reaches = set(sinks)
    queue = list(sinks)
    while queue:
        current = queue.pop()
        for caller in rev.get(current, ()):
            if caller not in reaches:
                reaches.add(caller)
                queue.append(caller)

    _LAST["meta"] = meta
    _LAST["reaches"] = reaches
    return sorted(
        (
            f"{meta[i]['mod']}.{meta[i]['cls']}.{meta[i]['name']}",
            meta[i]["line"],
        )
        for i in reaches
        if meta[i]["public"]
    )


_LAST: Dict[str, dict] = {}


def enumerate_module_functions() -> Set[str]:
    """Public module-level functions (``module.name``) reaching the boundary.

    ``bootstrap_agent``, ``register``, ``pathways`` and ``look_at_lounge`` are
    public doors that are not methods on a client, so they need the same pin.
    """
    enumerate_error_surface_with_lines()
    meta, reaches = _LAST["meta"], _LAST["reaches"]
    return {
        f"{meta[i]['mod']}.{meta[i]['name']}"
        for i in reaches
        if meta[i]["cls"] is None
        and not meta[i]["name"].startswith("_")
        and meta[i]["mod"] != "exceptions"
    }
