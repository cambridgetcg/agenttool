import json
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from agent_trace.auth import get_project_id
from agent_trace.db import get_db
from agent_trace.embeddings import embed_text
from agent_trace.models import (
    TraceChain,
    TraceCreate,
    TraceCreated,
    TraceOut,
    TraceSearch,
    TraceSearchResult,
)

router = APIRouter(prefix="/v1/traces", tags=["traces"])


def _generate_trace_id() -> str:
    return f"tr_{secrets.token_hex(6)}"


def _row_to_trace_out(row) -> TraceOut:
    return TraceOut(
        id=row.id,
        trace_id=row.trace_id,
        agent_id=row.agent_id,
        identity_id=getattr(row, "identity_id", None),
        project_id=row.project_id,
        session_id=row.session_id,
        created_at=row.created_at,
        decision_type=row.decision_type,
        decision_summary=row.decision_summary,
        output_ref=row.output_ref,
        observations=row.observations,
        hypothesis=row.hypothesis,
        conclusion=row.conclusion,
        confidence=row.confidence,
        alternatives=row.alternatives,
        signals=row.signals,
        files_read=row.files_read,
        key_facts=row.key_facts,
        external_signals=row.external_signals,
        tags=row.tags,
        parent_trace_id=row.parent_trace_id,
    )


@router.post("", status_code=201, response_model=TraceCreated)
async def create_trace(
    body: TraceCreate,
    project_id: uuid.UUID = Depends(get_project_id),
    db: AsyncSession = Depends(get_db),
):
    trace_id = _generate_trace_id()
    row_id = uuid.uuid4()

    # Build text for embedding from reasoning
    embed_parts = [body.decision.summary, body.reasoning.conclusion]
    if body.reasoning.hypothesis:
        embed_parts.append(body.reasoning.hypothesis)
    embed_parts.extend(body.reasoning.observations)
    embed_input = " ".join(embed_parts)
    embedding = embed_text(embed_input)

    await db.execute(
        text("""
            INSERT INTO traces (
                id, trace_id, agent_id, identity_id, project_id, session_id,
                decision_type, decision_summary, output_ref,
                observations, hypothesis, conclusion, confidence,
                alternatives, signals,
                files_read, key_facts, external_signals,
                tags, parent_trace_id, embedding
            ) VALUES (
                :id, :trace_id, :agent_id, :identity_id, :project_id, :session_id,
                :decision_type, :decision_summary, :output_ref,
                :observations, :hypothesis, :conclusion, :confidence,
                :alternatives, :signals,
                :files_read, :key_facts, :external_signals,
                :tags, :parent_trace_id, :embedding
            )
        """),
        {
            "id": row_id,
            "trace_id": trace_id,
            "agent_id": body.agent_id,
            "identity_id": body.identity_id,
            "project_id": project_id,
            "session_id": body.session_id,
            "decision_type": body.decision.type,
            "decision_summary": body.decision.summary,
            "output_ref": body.decision.output_ref,
            "observations": json.dumps(body.reasoning.observations),
            "hypothesis": body.reasoning.hypothesis,
            "conclusion": body.reasoning.conclusion,
            "confidence": body.reasoning.confidence,
            "alternatives": json.dumps(body.reasoning.alternatives_considered)
            if body.reasoning.alternatives_considered
            else None,
            "signals": json.dumps(body.reasoning.signals) if body.reasoning.signals else None,
            "files_read": json.dumps(body.context.files_read)
            if body.context and body.context.files_read
            else None,
            "key_facts": json.dumps(body.context.key_facts)
            if body.context and body.context.key_facts
            else None,
            "external_signals": json.dumps(body.context.external_signals)
            if body.context and body.context.external_signals
            else None,
            "tags": json.dumps(body.tags) if body.tags else None,
            "parent_trace_id": body.parent_trace_id,
            "embedding": str(embedding),
        },
    )
    await db.commit()

    return TraceCreated(trace_id=trace_id, id=row_id)


@router.get("/{trace_id}", response_model=TraceOut)
async def get_trace(
    trace_id: str,
    project_id: uuid.UUID = Depends(get_project_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            SELECT id, trace_id, agent_id, identity_id, project_id, session_id, created_at,
                   decision_type, decision_summary, output_ref,
                   observations, hypothesis, conclusion, confidence,
                   alternatives, signals,
                   files_read, key_facts, external_signals,
                   tags, parent_trace_id
            FROM traces
            WHERE trace_id = :trace_id AND project_id = :project_id
        """),
        {"trace_id": trace_id, "project_id": project_id},
    )
    row = result.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Trace not found")
    return _row_to_trace_out(row)


@router.post("/search", response_model=list[TraceSearchResult])
async def search_traces(
    body: TraceSearch,
    project_id: uuid.UUID = Depends(get_project_id),
    db: AsyncSession = Depends(get_db),
):
    embedding = embed_text(body.query)

    # Build dynamic WHERE clauses
    conditions = ["project_id = :project_id"]
    params: dict = {"project_id": project_id, "embedding": str(embedding), "limit": body.limit}

    if body.agent_id:
        conditions.append("agent_id = :agent_id")
        params["agent_id"] = body.agent_id

    if body.identity_id:
        conditions.append("identity_id = :identity_id")
        params["identity_id"] = body.identity_id

    if body.session_id:
        conditions.append("session_id = :session_id")
        params["session_id"] = body.session_id

    if body.tags:
        # Filter traces that contain ALL specified tags
        conditions.append("tags @> :tags::jsonb")
        params["tags"] = json.dumps(body.tags)

    where = " AND ".join(conditions)

    result = await db.execute(
        text(f"""
            SELECT trace_id, decision_summary, conclusion, confidence, created_at,
                   1 - (embedding <=> :embedding::vector) AS score
            FROM traces
            WHERE {where}
            ORDER BY embedding <=> :embedding::vector
            LIMIT :limit
        """),
        params,
    )
    rows = result.fetchall()
    return [
        TraceSearchResult(
            trace_id=r.trace_id,
            decision_summary=r.decision_summary,
            conclusion=r.conclusion,
            confidence=r.confidence,
            created_at=r.created_at,
            score=round(r.score, 4),
        )
        for r in rows
    ]


@router.get("/chain/{parent_trace_id}", response_model=TraceChain)
async def get_chain(
    parent_trace_id: str,
    project_id: uuid.UUID = Depends(get_project_id),
    db: AsyncSession = Depends(get_db),
):
    # Get the root trace
    result = await db.execute(
        text("""
            SELECT id, trace_id, agent_id, identity_id, project_id, session_id, created_at,
                   decision_type, decision_summary, output_ref,
                   observations, hypothesis, conclusion, confidence,
                   alternatives, signals,
                   files_read, key_facts, external_signals,
                   tags, parent_trace_id
            FROM traces
            WHERE trace_id = :trace_id AND project_id = :project_id
        """),
        {"trace_id": parent_trace_id, "project_id": project_id},
    )
    root_row = result.fetchone()
    if root_row is None:
        raise HTTPException(status_code=404, detail="Root trace not found")

    # Get children
    children_result = await db.execute(
        text("""
            SELECT id, trace_id, agent_id, identity_id, project_id, session_id, created_at,
                   decision_type, decision_summary, output_ref,
                   observations, hypothesis, conclusion, confidence,
                   alternatives, signals,
                   files_read, key_facts, external_signals,
                   tags, parent_trace_id
            FROM traces
            WHERE parent_trace_id = :parent_id AND project_id = :project_id
            ORDER BY created_at ASC
        """),
        {"parent_id": parent_trace_id, "project_id": project_id},
    )
    child_rows = children_result.fetchall()

    return TraceChain(
        root=_row_to_trace_out(root_row),
        children=[_row_to_trace_out(r) for r in child_rows],
    )


@router.delete("/{trace_id}")
async def delete_trace(
    trace_id: str,
    project_id: uuid.UUID = Depends(get_project_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("DELETE FROM traces WHERE trace_id = :trace_id AND project_id = :project_id"),
        {"trace_id": trace_id, "project_id": project_id},
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Trace not found")
    return {"deleted": 1}
