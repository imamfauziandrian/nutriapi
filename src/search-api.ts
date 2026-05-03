/**
 * NutriAPI Server
 *
 * Self-contained Bun HTTP server that serves nutritional data from data/db.json.
 * Supports get-by-code lookup, paginated listing, Meilisearch full-text search,
 * and static file serving for the public/ directory.
 *
 * Environment variables:
 *   MEILI_URL – Meilisearch base URL (default: http://meilisearch:7700)
 *   PORT      – HTTP listen port (default: 3000)
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MEILI_URL = process.env.MEILI_URL ?? "http://meilisearch:7700";
const MEILI_INDEX = "foods";
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const DB_PATH = join(resolve("."), "data", "db.json");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FoodRecord {
  code: string;
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbo: number;
  fiber: number;
  id?: string;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

let foods: FoodRecord[] = [];
let codeIndex: Map<string, FoodRecord> = new Map();

function loadData(): void {
  if (!existsSync(DB_PATH)) {
    console.warn(`Warning: ${DB_PATH} not found — API will return empty results.`);
    console.warn("Run 'bun src/convert.ts && bun src/merge.ts' first.");
    return;
  }

  const raw = readFileSync(DB_PATH, "utf-8");
  const db = JSON.parse(raw) as { foods?: FoodRecord[] };
  foods = db.foods ?? [];
  codeIndex = new Map(foods.map((f) => [f.code, f]));

  console.log(`Loaded ${foods.length} food records from data/db.json`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function respond(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Total-Count, X-Total-Pages, X-Page, X-Limit",
  };
  if (extraHeaders) {
    Object.assign(headers, extraHeaders);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// ---------------------------------------------------------------------------
// Static file serving (public/)
// ---------------------------------------------------------------------------

const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(pathname: string): Response | null {
  // Only serve the root and top-level public files to avoid directory traversal
  const publicDir = join(resolve("."), "public");
  let filePath: string;

  if (pathname === "/" || pathname === "/index.html") {
    filePath = join(publicDir, "index.html");
  } else {
    // Strip leading slash and prevent traversal
    const sanitized = pathname.replace(/^\/+/, "").replace(/\.\./g, "");
    if (!sanitized) return null;
    filePath = join(publicDir, sanitized);
  }

  if (!existsSync(filePath) || !filePath.startsWith(publicDir)) {
    return null;
  }

  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const mime = STATIC_MIME[ext] ?? "application/octet-stream";

  try {
    const content = readFileSync(filePath);
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Foods endpoint handlers
// ---------------------------------------------------------------------------

function getFoodByCode(code: string): Response {
  const food = codeIndex.get(code);
  if (food) {
    return respond(food, 200);
  }
  return respond({ error: `Food with code '${code}' not found` }, 404);
}

function getPaginatedFoods(
  page: number,
  limit: number,
  filteredFoods?: FoodRecord[],
): Response {
  const source = filteredFoods ?? foods;
  const clampedPage = Math.max(1, page);
  const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const total = source.length;
  const totalPages = Math.ceil(total / clampedLimit) || 1;
  const startIndex = (clampedPage - 1) * clampedLimit;
  const endIndex = Math.min(startIndex + clampedLimit, total);
  const data = source.slice(startIndex, endIndex);

  return respond(data, 200, {
    "X-Total-Count": String(total),
    "X-Total-Pages": String(totalPages),
    "X-Page": String(clampedPage),
    "X-Limit": String(clampedLimit),
  });
}

async function handleFoods(url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  const nameLike = url.searchParams.get("name_like");
  const pageStr = url.searchParams.get("_page");
  const limitStr = url.searchParams.get("_limit");

  // Get by code takes precedence
  if (code !== null && code.trim() !== "") {
    return getFoodByCode(code.trim());
  }

  const page = pageStr ? parseInt(pageStr, 10) : DEFAULT_PAGE;
  const limit = limitStr ? parseInt(limitStr, 10) : DEFAULT_LIMIT;
  const resolvedPage = Number.isNaN(page) ? DEFAULT_PAGE : page;
  const resolvedLimit = Number.isNaN(limit) ? DEFAULT_LIMIT : limit;

  // Full-text search via Meilisearch when name_like is provided
  if (nameLike !== null && nameLike.trim() !== "") {
    return handleNameLikeSearch(nameLike.trim(), resolvedPage, resolvedLimit);
  }

  return getPaginatedFoods(resolvedPage, resolvedLimit);
}

// ---------------------------------------------------------------------------
// Meilisearch shared helpers
// ---------------------------------------------------------------------------

interface MeilisearchHit {
  code: string;
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbo: number;
  fiber: number;
}

interface MeiliSearchResult {
  hits: FoodRecord[];
  total: number;
}

/**
 * Call Meilisearch and return hits + total count.
 * Falls back to in-memory substring filtering if Meilisearch is unreachable.
 */
async function searchMeili(q: string, page: number, limit: number): Promise<MeiliSearchResult> {
  const clampedPage = Math.max(1, page);
  const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const offset = (clampedPage - 1) * clampedLimit;

  try {
    const meiliResp = await fetch(`${MEILI_URL}/indexes/${MEILI_INDEX}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q,
        offset,
        limit: clampedLimit,
        sort: ["nameLength:asc"],
      }),
    });

    if (!meiliResp.ok) {
      const errBody = await meiliResp.text();
      throw new Error(`Meilisearch ${meiliResp.status}: ${errBody}`);
    }

    const data = (await meiliResp.json()) as {
      hits: MeilisearchHit[];
      estimatedTotalHits: number;
    };

    return {
      hits: data.hits.map((h) => ({
        code: h.code,
        name: h.name,
        calories: h.calories,
        protein: h.protein,
        fat: h.fat,
        carbo: h.carbo,
        fiber: h.fiber,
      })),
      total: data.estimatedTotalHits,
    };
  } catch (err) {
    // Fallback: in-memory substring search
    console.warn(`Meilisearch unreachable, falling back to in-memory search: ${err}`);
    const lower = q.toLowerCase();
    const filtered = foods.filter((f) => f.name.toLowerCase().includes(lower));
    const start = offset;
    const end = Math.min(start + clampedLimit, filtered.length);
    return {
      hits: filtered.slice(start, end),
      total: filtered.length,
    };
  }
}

async function handleNameLikeSearch(q: string, page: number, limit: number): Promise<Response> {
  const clampedPage = Math.max(1, page);
  const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  const { hits, total } = await searchMeili(q, clampedPage, clampedLimit);
  const totalPages = Math.ceil(total / clampedLimit) || 1;

  return respond(hits, 200, {
    "X-Total-Count": String(total),
    "X-Total-Pages": String(totalPages),
    "X-Page": String(clampedPage),
    "X-Limit": String(clampedLimit),
  });
}

// ---------------------------------------------------------------------------
// Search endpoint (Meilisearch, same paginated format as /foods)
// ---------------------------------------------------------------------------

async function handleSearch(url: URL): Promise<Response> {
  const q = url.searchParams.get("q")?.trim();
  const pageStr = url.searchParams.get("_page");
  const limitStr = url.searchParams.get("_limit");

  if (!q) {
    return respond({ error: "Missing 'q' query parameter. Example: /search?q=ayam" }, 400);
  }

  const page = pageStr ? parseInt(pageStr, 10) : DEFAULT_PAGE;
  const limit = limitStr ? parseInt(limitStr, 10) : DEFAULT_LIMIT;
  const resolvedPage = Number.isNaN(page) ? DEFAULT_PAGE : page;
  const resolvedLimit = Number.isNaN(limit) ? DEFAULT_LIMIT : limit;

  const { hits, total } = await searchMeili(q, resolvedPage, resolvedLimit);
  const totalPages = Math.ceil(total / resolvedLimit) || 1;

  return respond(hits, 200, {
    "X-Total-Count": String(total),
    "X-Total-Pages": String(totalPages),
    "X-Page": String(resolvedPage),
    "X-Limit": String(resolvedLimit),
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

loadData();

const server = Bun.serve({
  port: PORT,
  async fetch(req): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return corsPreflight();
    }

    const pathname = url.pathname;

    // Health check
    if (pathname === "/health") {
      return respond({ status: "ok" });
    }

    // Foods endpoint
    if (pathname === "/foods") {
      return handleFoods(url);
    }

    // Search endpoint (Meilisearch)
    if (pathname === "/search") {
      return handleSearch(url);
    }

    // Static files (including /)
    const staticResp = serveStatic(pathname);
    if (staticResp) return staticResp;

    // 404 for everything else
    return respond({ error: "Not found" }, 404);
  },
});

console.log(`NutriAPI running on http://0.0.0.0:${PORT}`);
console.log(`Endpoints:`);
console.log(`  GET /                              Static files (public/)`);
console.log(`  GET /health                         Health check`);
console.log(`  GET /foods?code=...                 Get single food by code`);
console.log(`  GET /foods?_page=1&_limit=20        Paginated list`);
console.log(`  GET /foods?name_like=nasi           Full-text search via Meilisearch (paginated)`);
console.log(`  GET /search?q=...                   Full-text search (Meilisearch)`);
