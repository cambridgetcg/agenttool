from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database (agent_trace) — overridden by DATABASE_URL env in production
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/agent_trace"

    # Auth DB (agent_tools — for API key validation) — overridden by AUTH_DATABASE_URL env
    auth_database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/agent_tools"

    # Redis — overridden by REDIS_URL env in production
    redis_url: str = "redis://localhost:6379/0"

    # Embeddings
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimensions: int = 384

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8005
    log_level: str = "info"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
