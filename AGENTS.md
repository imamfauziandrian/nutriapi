# AGENTS.md

Project context for AI coding agents working on this repository.

## Project Overview

Indonesian Nutrition Data API (`nutriapi`). Converts CSV nutritional datasets (TKPI and USDA) into a JSON-based REST API served via json-server on a Bun runtime.

## Directory Structure

```
.
├── AGENTS.md              # This file
├── Dockerfile             # Multi-stage build (Bun runtime)
├── .dockerignore
├── package.json           # Scripts for local dev
├── tsconfig.json
├── src/
│   ├── convert.ts         # CSV → JSON converter
│   └── merge.ts           # Merge + dedup → db.json
├── data/
│   ├── raw/               # Source CSV files (input)
│   │   ├── tkpi.csv
│   │   └── usda.csv
│   ├── json/              # Per-file JSON output (gitignored)
│   └── db.json            # Merged result (gitignored)
└── README.md
```

## Key Facts

- **Runtime**: Bun (TypeScript runs natively, no tsx needed)
- **API port**: 3000 (json-server)
- **Data endpoint**: `GET /foods` — flat array of 9,938 records
- **CSV separator**: `;` (semicolon)
- **CSV decimal**: `,` (comma) → converted to `.`
- **Missing values**: `-` in CSV becomes `0` for nutrition columns
- **Code field**: Always kept as a string

## Scripts

| Command | Description |
|---|---|
| `bun src/convert.ts` | Convert CSVs → per-file JSON in `data/json/` |
| `bun src/merge.ts` | Merge all JSON files → `data/db.json` + duplicate code check |
| `docker build -t nutriapi .` | Build the production image |
| `docker run -p 3000:3000 nutriapi` | Run the API |

## Coding Conventions

- All comments in English
- TypeScript with strict mode
- ES module imports (`import { ... } from "..."`)
- No external dependencies for CSV parsing (manual parser)
- Use `node:fs`, `node:path`, `node:url` for file operations

## Important Notes

- `data/json/` and `data/db.json` are gitignored — they are build artifacts
- Raw CSV files in `data/raw/` are the source of truth
- json-server v0.17.4 is used
- Static files from `./public/` are served automatically at `GET /`
- The output `db.json` is minified (single line) and wrapped as `{ "foods": [...] }`
