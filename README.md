# nutriapi

Indonesian Nutrition Data API. Provides nutritional information from two sources merged into a single REST API via [json-server](https://github.com/typicode/json-server).

Uses [Bun](https://bun.sh) as the runtime — TypeScript scripts run natively without `tsx`.


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
curl http://localhost:3000/foods
curl http://localhost:3000/foods?code=AP001
curl http://localhost:3000/foods?calories_gte=0&calories_lte=100
curl http://localhost:3000/foods?_page=1&_limit=20
curl http://localhost:3000/foods?name_like=nasi
```

## Development Scripts

All scripts are in `src/` and use TypeScript via [`tsx`](https://github.com/nicolo-ribaudo/tsx).

| Command | Description |
|---|---|
| `bun run convert` | Convert `data/raw/*.csv` → `data/json/*.json` |
| `bun run merge` | Merge all JSON files → `data/db.json` with duplicate check |
| `bun run build:all` | Run convert + merge in sequence |

### Data Pipeline

```
data/raw/*.csv   →   src/convert.ts   →   data/json/*.json
                                             ↓
                                     src/merge.ts  (dedup check)
                                             ↓
                                        data/db.json
```

### CSV Format

- Separator: `;` (semicolon)
- Decimal: `,` (comma) — auto-converted to `.`
- `-` → `0` for nutrition columns

## API (json-server)

The container runs json-server v0.17.4 with `--read-only` mode, providing these GET endpoints:

- `GET /foods` — list all
- `GET /foods/:id` — by auto-assigned id
- `GET /foods?field=value` — exact match (e.g. `?code=AP001`)
- `GET /foods?field_gte=value&field_lte=value` — range filter
- `GET /foods?name_like=<query>` — substring search (e.g. `?name_like=nasi`)
- `GET /foods?_page=1&_limit=20` — pagination
- `GET /` — serves static files from `./public/`

## Tech Stack

| Component | Choice |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Database | JSON file (minified) |
| API Server | [json-server](https://github.com/typicode/json-server) v0.17.4 |
| Build | Docker multi-stage
