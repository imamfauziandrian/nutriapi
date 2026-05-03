#!/bin/sh
set -e

echo "=== NutriAPI ==="
echo "Starting Meilisearch..."
meilisearch --http-addr 0.0.0.0:7700 &

echo "Running ingest (indexing foods into Meilisearch)..."
bun /app/src/meilisearch-ingest.ts

echo "Starting NutriAPI server on port ${PORT:-3000}..."
exec bun /app/src/search-api.ts
