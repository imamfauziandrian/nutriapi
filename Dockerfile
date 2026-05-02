# ---- Stage 1: Build ----
FROM oven/bun:alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json ./
RUN bun install

# Copy source scripts and raw data
COPY src/ ./src/
COPY data/raw/ ./data/raw/

# Run the converter & merger (Bun runs TypeScript natively)
RUN bun src/convert.ts && bun src/merge.ts

# ---- Stage 2: Production ----
FROM oven/bun:alpine

WORKDIR /app

# Install json-server globally so it's available as a CLI command
RUN bun install -g json-server

# Copy only the generated database from the builder stage
COPY --from=builder /app/data/db.json ./data/db.json

# Expose the default port
EXPOSE 3000

# Start the server
CMD ["json-server", "--watch", "data/db.json", "--host", "0.0.0.0"]
