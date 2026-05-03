/**
 * Search API Server
 *
 * Thin proxy that exposes GET /search?q=<query> and forwards to Meilisearch.
 * Runs as a long-lived container service behind the meilisearch Docker profile.
 *
 * Environment variables:
 *   MEILI_URL – Meilisearch base URL (default: http://meilisearch:7700)
 *   PORT      – HTTP listen port (default: 3000)
 */

const MEILI_URL = process.env.MEILI_URL ?? "http://meilisearch:7700";
const INDEX = "foods";
const PORT = parseInt(process.env.PORT ?? "3000", 10);

interface FoodRecord {
  code: string;
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbo: number;
  fiber: number;
}

interface MeilisearchHit {
  code: string;
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbo: number;
  fiber: number;
}

interface SearchResponse {
  hits: FoodRecord[];
  estimatedTotalHits: number;
  query: string;
  processingTimeMs: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(req): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Health check
    if (url.pathname === "/health") {
      return jsonResponse({ status: "ok" });
    }

    // Search endpoint
    if (url.pathname === "/search") {
      const q = url.searchParams.get("q")?.trim();

      if (!q) {
        return jsonResponse(
          { error: "Missing 'q' query parameter. Example: /search?q=ayam" },
          400,
        );
      }

      try {
        const meiliResp = await fetch(
          `${MEILI_URL}/indexes/${INDEX}/search`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ q, sort: ["nameLength:asc"] }),
          },
        );

        if (!meiliResp.ok) {
          const errBody = await meiliResp.text();
          console.error(`Meilisearch error: ${meiliResp.status} ${errBody}`);
          return jsonResponse(
            { error: "Search service error" },
            502,
          );
        }

        const data = (await meiliResp.json()) as {
          hits: MeilisearchHit[];
          estimatedTotalHits: number;
          query: string;
          processingTimeMs: number;
        };

        const response: SearchResponse = {
          hits: data.hits.map((h) => ({
            code: h.code,
            name: h.name,
            calories: h.calories,
            protein: h.protein,
            fat: h.fat,
            carbo: h.carbo,
            fiber: h.fiber,
          })),
          estimatedTotalHits: data.estimatedTotalHits,
          query: data.query,
          processingTimeMs: data.processingTimeMs,
        };

        return jsonResponse(response);
      } catch (err) {
        console.error("Meilisearch unreachable:", err);
        return jsonResponse(
          { error: "Search service unavailable" },
          502,
        );
      }
    }

    // 404 for anything else
    return jsonResponse({ error: "Not found" }, 404);
  },
});

console.log(`Search API running on http://0.0.0.0:${PORT}`);
