# Stages: builder → ingest (named), standalone (default)
#
# =============================================================================
# Stage 1: Builder — runs the CSV→JSON pipeline to produce data/db.json
# =============================================================================
FROM oven/bun:alpine AS builder

WORKDIR /app

COPY package.json ./
RUN bun install

COPY src/ ./src/
COPY data/raw/ ./data/raw/

RUN bun src/convert.ts && bun src/merge.ts

# =============================================================================
# Stage 2: Ingest — one-shot container that indexes db.json into Meilisearch
# =============================================================================
FROM oven/bun:alpine AS ingest

WORKDIR /app

COPY --from=builder /app/data/db.json ./data/db.json
COPY src/meilisearch-ingest.ts ./src/

CMD ["bun", "src/meilisearch-ingest.ts"]

# =============================================================================
# Stage 3: Standalone (default) — full Bun HTTP server, foods API + search
# =============================================================================
FROM oven/bun:alpine AS standalone

WORKDIR /app

COPY --from=builder /app/data/db.json ./data/db.json
COPY --from=builder /app/src/search-api.ts ./src/search-api.ts
COPY public/ ./public/

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "src/search-api.ts"]
