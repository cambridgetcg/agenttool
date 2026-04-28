from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from agent_trace.config import settings

# trace schema: search_path via server_settings
engine = create_async_engine(
    settings.database_url,
    echo=False,
    connect_args={"server_settings": {"search_path": "trace,public"}},
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# auth engine: connects to tools schema for shared API key validation
auth_engine = create_async_engine(
    settings.auth_database_url,
    echo=False,
    connect_args={"server_settings": {"search_path": "tools,public"}},
)
auth_session = async_sessionmaker(auth_engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:  # type: ignore[misc]
    async with async_session() as session:
        yield session
