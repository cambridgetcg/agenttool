"""SQLAlchemy ORM models and database session factory."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Float, Index, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import settings


def _build_engine():
    """Build async engine, converting ?options= search_path to connect_args."""
    url = settings.database_url
    connect_args: dict = {}

    # asyncpg doesn't support ?options=-csearch_path=... in URL
    # Extract it and pass via server_settings instead
    if "options=" in url:
        from urllib.parse import parse_qs, urlparse, urlunparse, urlencode

        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        options_val = params.pop("options", [None])[0]
        if options_val and "search_path" in options_val:
            # Extract search_path from -csearch_path=schema,public
            sp = options_val.replace("-c", "").split("=", 1)
            if len(sp) == 2:
                connect_args["server_settings"] = {"search_path": sp[1]}
        # Rebuild URL without options param
        new_query = urlencode({k: v[0] for k, v in params.items()}) if params else ""
        url = urlunparse(parsed._replace(query=new_query))

    return create_async_engine(url, echo=False, connect_args=connect_args)


engine = _build_engine()
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, server_default=text("gen_random_uuid()"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    api_key: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    plan: Mapped[str] = mapped_column(Text, nullable=False, server_default="seed")
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))


class Memory(Base):
    __tablename__ = "memories"

    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, server_default=text("gen_random_uuid()"))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID, nullable=False)
    agent_id: Mapped[str | None] = mapped_column(Text)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    key: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # embedding handled via raw SQL (pgvector)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, server_default=text("'{}'"))
    importance: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0.5"))
    accessed_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))
    expires_at: Mapped[datetime | None] = mapped_column()


class UsageEvent(Base):
    __tablename__ = "usage_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, server_default=text("gen_random_uuid()"))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID, nullable=False)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    count: Mapped[int] = mapped_column(nullable=False, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))
