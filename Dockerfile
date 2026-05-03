# =============================================================================
# NutriAPI — Single Dockerfile (Meilisearch + Bun API server)
#
# Build:
#   docker build -t nutriapi .
#
# Run:
#   docker run -p 3000:3000 -p 7700:7700 nutriapi
#
# Endpoints:
#   http://localhost:3000/          API + landing page
#   http://localhost:7700/health    Meilisearch health check (internal)
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Builder — runs the CSV→JSON pipeline to produce data/db.json
# ---------------------------------------------------------------------------
FROM oven/bun:alpine AS builder

WORKDIR /app

COPY package.json ./
RUN bun install

COPY src/ ./src/
COPY data/raw/ ./data/raw/
COPY public/ ./public/

RUN bun src/convert.ts && bun src/merge.ts

# ---------------------------------------------------------------------------
# Stage 2: Runtime — Meilisearch base + Bun (copied from builder) + API server
# ---------------------------------------------------------------------------
FROM getmeili/meilisearch:v1.14

# Install runtime dependencies for Bun (libstdc++)
RUN apk add --no-cache libstdc++

# Copy Bun binary from builder stage (both are Alpine/musl, fully compatible)
COPY --from=builder /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Copy build artifacts from builder stage
COPY --from=builder /app/data/db.json ./data/db.json
COPY --from=builder /app/src/search-api.ts ./src/search-api.ts
COPY --from=builder /app/src/meilisearch-ingest.ts ./src/meilisearch-ingest.ts
COPY --from=builder /app/public/ ./public/

# Startup script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Configure environment
ENV PORT=3000
ENV MEILI_URL=http://localhost:7700
ENV MEILI_NO_ANALYTICS=true
ENV MEILI_DB_PATH=/tmp/meili_data

EXPOSE 3000

# Override Meilisearch's default CMD with our unified startup
CMD ["/app/start.sh"]
