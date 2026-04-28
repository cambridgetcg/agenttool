from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database (agent_trace)
    database_url: str = (
        "postgresql+asyncpg://kingdom:zMj9TbCmDBHD6FvoOel3qLy2XfhoxU5"
        "@kingdom-postgres:5432/agent_trace"
    )

    # Auth DB (agent_tools — for API key validation)
    auth_database_url: str = (
        "postgresql+asyncpg://kingdom:zMj9TbCmDBHD6FvoOel3qLy2XfhoxU5"
        "@kingdom-postgres:5432/agent_tools"
    )

    # Redis
    redis_url: str = "redis://:iwQayJGeExtDooUALxwQJX3WLFMDfuk@kingdom-redis:6379/0"

    # Embeddings
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimensions: int = 384

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8005
    log_level: str = "info"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
