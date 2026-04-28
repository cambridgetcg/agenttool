"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/agent_memory"

    # Auth DB — tools schema (shared API key validation across all services)
    auth_database_url: str = ""

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # OpenAI
    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"  # 5× cheaper than ada-002, same dims
    embedding_dimensions: int = 1536

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    log_level: str = "info"

    # Working memory
    working_memory_ttl: int = 3600  # seconds

    # agent-economy (billing authority — internal)
    economy_url: str = "http://localhost:8004"

    # Stripe
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""

    # Plan limits
    seed_memory_limit: int = 10_000
    seed_agent_limit: int = 5
    grow_memory_limit: int = 100_000
    grow_agent_limit: int = 25

    # Rate limits (requests per minute per project)
    seed_rate_limit: int = 30
    grow_rate_limit: int = 120
    scale_rate_limit: int = 600

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()

PLAN_RATE_LIMITS: dict[str, int] = {
    "seed": settings.seed_rate_limit,
    "grow": settings.grow_rate_limit,
    "scale": settings.scale_rate_limit,
}
