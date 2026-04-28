FROM python:3.11-slim AS builder

WORKDIR /app

RUN pip install --no-cache-dir hatchling

COPY pyproject.toml .
RUN pip install --no-cache-dir --prefix=/install .

FROM python:3.11-slim

RUN useradd --create-home --shell /bin/bash app
WORKDIR /app

COPY --from=builder /install /usr/local
COPY --chown=app:app src/ src/
COPY --chown=app:app migrations/ migrations/

USER app

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
