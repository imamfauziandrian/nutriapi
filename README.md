# nutriapi

Indonesian Nutrition Data API. Provides nutritional information from two sources merged into a single REST API served by a self-contained **Bun HTTP server**.

Uses [Bun](https://bun.sh) as the runtime — TypeScript runs natively without `tsx`.

## Data Sources

| Source | Records | Description |
|---|---|---|
| **TKPI** | 1,148 | Indonesian Food Composition Table (*Tabel Komposisi Pangan Indonesia*) |
| **USDA** | 8,790 | USDA National Nutrient Database (sourced via andrafarm.com) |
| **Total** | 9,938 | Merged into `/foods` endpoint |

## Fields

| Field | Type | Description |
|---|---|---|
| `code` | `string` | Unique identifier |
| `name` | `string` | Food name |
| `calories` | `number` | Energy (kcal) |
| `protein` | `number` | Protein (g) |
| `fat` | `number` | Total fat (g) |
| `carbo` | `number` | Carbohydrates (g) |
| `fiber` | `number` | Dietary fiber (g) |

Missing values (`-` in CSV) default to `0`.

## Quick Start

```bash
# Build the image
docker build -t nutriapi .

# Run
docker run -d --name nutriapi -p 3000:3000 nutriapi

# Query
curl http://localhost:3000/foods?_page=1&_limit=20
curl http://localhost:3000/foods?code=AP001
```

### Local Development

```bash
# Install dependencies
bun install

# Convert CSVs to JSON
bun run convert

# Merge into db.json
bun run merge

# Start the server
bun run start
# or with watch mode:
bun run dev
```

## Development Scripts

All scripts are in `src/` and use TypeScript via Bun.

| Command | Description |
|---|---|
| `bun run convert` | Convert `data/raw/*.csv` → `data/json/*.json` |
| `bun run merge` | Merge all JSON files → `data/db.json` with duplicate check |
| `bun run build:all` | Run convert + merge in sequence |
| `bun run start` | Start the Bun HTTP server |
| `bun run dev` | Start with file watch for hot reload |

### Data Pipeline

```
data/raw/*.csv   →   src/convert.ts   →   data/json/*.json
                                             ↓
                                     src/merge.ts  (dedup check)
                                             ↓
                                        data/db.json
                                             ↓
                                     src/search-api.ts
                                      (Bun HTTP server)
```

### CSV Format

- Separator: `;` (semicolon)
- Decimal: `,` (comma) — auto-converted to `.`
- `-` → `0` for nutrition columns

## API Endpoints

All data endpoints return a plain JSON array of food records (or a single object for `code` lookup). Pagination metadata is exposed via response headers.

| Endpoint | Description |
|---|---|
| `GET /` | Static files from `public/` |
| `GET /health` | Health check (`{"status":"ok"}`) |
| `GET /foods?code=AP001` | Get single food by exact code match |
| `GET /foods?_page=1&_limit=20` | Paginated list (default: page 1, limit 20, max 100) |
| `GET /foods?name_like=ayam` | Full-text search via Meilisearch (paginated) |
| `GET /search?q=ayam` | Same as `name_like`, alternative endpoint |

### Response Format

All data endpoints return plain `FoodRecord[]` at the root — no wrapper object.

**Pagination headers** (returned on all list endpoints):

| Header | Description |
|---|---|
| `X-Total-Count` | Total matching records |
| `X-Total-Pages` | Total number of pages |
| `X-Page` | Current page number |
| `X-Limit` | Records per page |

### Examples

**Paginated list:**
```
GET /foods?_page=1&_limit=2
```

Response body:
```json
[
  {"code":"AP001","name":"Nasi","calories":180,"protein":3,"fat":0.3,"carbo":39.8,"fiber":0.2},
  {"code":"AP002","name":"Nasi tim","calories":120,"protein":2.4,"fat":0.4,"carbo":26,"fiber":0.5}
]
```

Response headers:
```
X-Total-Count: 9938
X-Total-Pages: 4969
X-Page: 1
X-Limit: 2
```

**Get by code:**
```
GET /foods?code=AP001
```

Response (200):
```json
{"code":"AP001","name":"Nasi","calories":180,"protein":3,"fat":0.3,"carbo":39.8,"fiber":0.2}
```

Response (404):
```json
{"error":"Food with code 'XXX' not found"}
```

**Full-text search:**
```
GET /foods?name_like=nasi&_limit=3
GET /search?q=nasi&_limit=3
```

Both return the same format (plain array with pagination headers). Uses Meilisearch if available, falls back to in-memory substring matching otherwise.

### Pagination

Supported on all list endpoints (`/foods`, `/foods?name_like=`, `/search?q=`):

| Parameter | Default | Max |
|---|---|---|
| `_page` | 1 | — |
| `_limit` | 20 | 100 |

## Docker Compose

```bash
# All services (standalone + Meilisearch + search API)
docker compose up

# Standalone Bun server only (port 3000)
docker compose up standalone

# Meilisearch stack only (port 3001)
docker compose up meilisearch ingest search-api
```

## Tech Stack

| Component | Choice |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Database | JSON file (loaded in-memory) |
| API Server | Bun native `Bun.serve` |
| Search | [Meilisearch](https://www.meilisearch.com) (optional) |
| Build | Docker multi-stage |
