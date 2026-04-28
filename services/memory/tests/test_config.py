"""Tests for application config and plan limits."""

import pytest
from src.config import settings, PLAN_RATE_LIMITS


class TestSettings:
    def test_default_port(self):
        assert settings.api_port == 8000

    def test_default_embedding_model(self):
        assert settings.embedding_model == "text-embedding-ada-002"

    def test_embedding_dimensions(self):
        assert settings.embedding_dimensions == 1536

    def test_working_memory_ttl_default(self):
        assert settings.working_memory_ttl == 3600  # 1 hour

    def test_database_url_is_postgres(self):
        assert "postgresql" in settings.database_url

    def test_redis_url_present(self):
        assert settings.redis_url.startswith("redis://")

    def test_seed_limits(self):
        assert settings.seed_memory_limit == 10_000
        assert settings.seed_agent_limit == 5

    def test_grow_limits(self):
        assert settings.grow_memory_limit == 100_000
        assert settings.grow_agent_limit == 25

    def test_grow_exceeds_seed(self):
        assert settings.grow_memory_limit > settings.seed_memory_limit
        assert settings.grow_agent_limit > settings.seed_agent_limit

    def test_rate_limits_ascending(self):
        assert settings.grow_rate_limit > settings.seed_rate_limit
        assert settings.scale_rate_limit > settings.grow_rate_limit

    def test_seed_rate_limit(self):
        assert settings.seed_rate_limit == 30

    def test_grow_rate_limit(self):
        assert settings.grow_rate_limit == 120

    def test_scale_rate_limit(self):
        assert settings.scale_rate_limit == 600


class TestPlanRateLimits:
    def test_all_plans_present(self):
        assert "seed" in PLAN_RATE_LIMITS
        assert "grow" in PLAN_RATE_LIMITS
        assert "scale" in PLAN_RATE_LIMITS

    def test_limits_match_settings(self):
        assert PLAN_RATE_LIMITS["seed"] == settings.seed_rate_limit
        assert PLAN_RATE_LIMITS["grow"] == settings.grow_rate_limit
        assert PLAN_RATE_LIMITS["scale"] == settings.scale_rate_limit

    def test_limits_are_positive(self):
        for plan, limit in PLAN_RATE_LIMITS.items():
            assert limit > 0, f"Rate limit for {plan} should be positive"

    def test_scale_is_highest(self):
        assert PLAN_RATE_LIMITS["scale"] == max(PLAN_RATE_LIMITS.values())
