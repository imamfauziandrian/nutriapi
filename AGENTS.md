# AGENTS.md

Project context for AI coding agents working on this repository.

## Project Overview

Indonesian Nutrition Data API (`nutriapi`). Converts CSV nutritional datasets (TKPI and USDA) into a JSON-based REST API served via a self-contained Bun HTTP server.

## Directory Structure

```
.
├── AGENTS.md              # This file
├── Dockerfile             # Multi-stage build (standalone, ingest, search-api)
├── .dockerignore
├── docker-compose.yml     # Profiles: standalone, meilisearch, all
├── package.json           # Scripts for local dev
├── tsconfig.json
├── src/
│   ├── convert.ts         # CSV → JSON converter
│   ├── merge.ts           # Merge + dedup → db.json
│   ├── search-api.ts      # Bun HTTP server (main API)
│   └── meilisearch-ingest.ts  # One-shot Meilisearch indexer
├── data/
│   ├── raw/               # Source CSV files (input)
│   │   ├── tkpi.csv
│   │   └── usda.csv
│   ├── json/              # Per-file JSON output (gitignored)
│   └── db.json            # Merged result (gitignored)
├── public/
│   └── index.html         # Static landing page
└── README.md
```

## Key Facts

- **Runtime**: Bun (TypeScript runs natively, no tsx needed)
- **API port**: 3000 (standalone Bun server)
- **Data endpoint**: `GET /foods` — returns plain `FoodRecord[]` array (or single object for `code` lookup)
- **Pagination**: Via `_page` & `_limit` query params; metadata in response headers (`X-Total-Count`, `X-Total-Pages`, `X-Page`, `X-Limit`)
- **Search**: `name_like` on `/foods` or `q` on `/search` — uses Meilisearch with automatic fallback to in-memory substring match
- **CSV separator**: `;` (semicolon)
- **CSV decimal**: `,` (comma) → converted to `.`
- **Missing values**: `-` in CSV becomes `0` for nutrition columns
- **Code field**: Always kept as a string

## Scripts

| Command | Description |
|---|---|
| `bun src/convert.ts` | Convert CSVs → per-file JSON in `data/json/` |
| `bun src/merge.ts` | Merge all JSON files → `data/db.json` + duplicate code check |
| `bun run start` | Start the Bun HTTP server (port 3000) |
| `bun run dev` | Start with watch mode |
| `docker build -t nutriapi .` | Build the production image |
| `docker run -p 3000:3000 nutriapi` | Run the API |

## API Endpoints (search-api.ts)

All data endpoints return plain `FoodRecord[]` (or single object for `code`). Pagination via response headers.

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Static files from `public/` |
| `GET` | `/health` | Health check |
| `GET` | `/foods?code=AP001` | Get single food by code (200: object, 404: error) |
| `GET` | `/foods?_page=1&_limit=20` | Paginated food list (array, pagination headers) |
| `GET` | `/foods?name_like=ayam` | Full-text search via Meilisearch (paginated, falls back to in-memory) |
| `GET` | `/search?q=ayam` | Same as `name_like`, returns identical format |

## Coding Conventions

- All comments in English
- TypeScript with strict mode
- ES module imports (`import { ... } from "..."`)
- No external dependencies for CSV parsing (manual parser)
- Use `node:fs`, `node:path`, `node:url` for file operations
- Bun native APIs (`Bun.serve`) for HTTP server

## Important Notes

- `data/json/` and `data/db.json` are gitignored — they are build artifacts
- Raw CSV files in `data/raw/` are the source of truth
- The Bun server loads `data/db.json` into memory on startup
- Meilisearch integration is optional — the server falls back to in-memory substring search when Meilisearch is unreachable
- Search via `name_like` (on `/foods`) and `q` (on `/search`) produce identical results
- All list endpoints return plain `FoodRecord[]`; pagination metadata is in `X-Total-Count`, `X-Total-Pages`, `X-Page`, `X-Limit` headers
- The output `db.json` is minified (single line) and wrapped as `{ "foods": [...] }`
