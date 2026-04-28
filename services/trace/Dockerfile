# Slim build — uses hash-based embedding fallback (no PyTorch/sentence-transformers).
# Image size: ~200MB vs 12.4GB for the full embeddings variant.
# For neural embeddings, install with: pip install "agent-trace[embeddings]"
FROM python:3.11-slim AS builder
WORKDIR /app
RUN pip install --no-cache-dir hatchling
COPY pyproject.toml .
COPY src/ src/
# Install core deps only (no [embeddings] extra = no torch)
RUN pip install --no-cache-dir --prefix=/install .

FROM python:3.11-slim
RUN useradd --create-home --shell /bin/bash app
WORKDIR /app
COPY --from=builder /install /usr/local
COPY src/ src/
COPY migrations/ migrations/
USER app
EXPOSE 8005
CMD ["uvicorn", "agent_trace.main:app", "--host", "0.0.0.0", "--port", "8005"]
