/**
 * Meilisearch Ingest Script
 *
 * One-shot container entrypoint. Waits for Meilisearch to become healthy,
 * creates the "foods" index with settings, bulk-indexes data/db.json,
 * polls until indexing is complete, then exits.
 *
 * Environment variables:
 *   MEILI_URL  – Meilisearch base URL (default: http://meilisearch:7700)
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MEILI_URL = process.env.MEILI_URL ?? "http://meilisearch:7700";
const INDEX = "foods";
const DB_PATH = resolve(process.cwd(), "data", "db.json");

/** Small delay helper (ms). */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry fetching Meilisearch health endpoint until it responds 200. */
async function waitForMeilisearch(): Promise<void> {
  const maxRetries = 30;
  const delayMs = 2000;

  for (let i = 1; i <= maxRetries; i++) {
    try {
      const resp = await fetch(`${MEILI_URL}/health`);
      if (resp.ok) {
        console.log(`Meilisearch is healthy (attempt ${i})`);
        return;
      }
    } catch {
      // Connection refused — expected during startup
    }
    console.log(`Waiting for Meilisearch… (${i}/${maxRetries})`);
    await sleep(delayMs);
  }

  throw new Error(`Meilisearch not reachable after ${maxRetries} attempts`);
}

/** Create the "foods" index if it doesn't already exist. */
async function createIndex(): Promise<void> {
  // Check if index exists already
  const listResp = await fetch(`${MEILI_URL}/indexes`);
  const listData = (await listResp.json()) as { results?: { uid: string }[] };
  const exists = listData.results?.some((idx: { uid: string }) => idx.uid === INDEX);

  if (exists) {
    console.log(`Index "${INDEX}" already exists, deleting and recreating…`);
    await fetch(`${MEILI_URL}/indexes/${INDEX}`, { method: "DELETE" });
    // Wait for deletion task to complete (brief pause is enough for empty index)
    await sleep(500);
  }

  const resp = await fetch(`${MEILI_URL}/indexes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid: INDEX, primaryKey: "code" }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to create index: ${resp.status} ${body}`);
  }

  console.log(`Index "${INDEX}" created with primaryKey "code"`);
}

/** Apply searchable, filterable, sortable, and ranking settings. */
async function configureSettings(): Promise<void> {
  const resp = await fetch(`${MEILI_URL}/indexes/${INDEX}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      searchableAttributes: ["name", "code"],
      filterableAttributes: ["calories", "protein", "fat", "carbo", "fiber"],
      sortableAttributes: ["nameLength"],
      rankingRules: [
        "words",
        "typo",
        "proximity",
        "attribute",
        "exactness",
        "sort",
      ],
      typoTolerance: {
        minWordSizeForTypos: { oneTypo: 3, twoTypos: 7 },
      },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to configure settings: ${resp.status} ${body}`);
  }

  console.log("Search settings applied (ranking: words > typo > proximity > exactness > shortest name)");
}

/** Bulk-index all foods and wait for the task to finish. */
async function bulkIndex(): Promise<void> {
  const raw = readFileSync(DB_PATH, "utf-8");
  const db = JSON.parse(raw) as { foods?: Record<string, unknown>[] };
  const foods = db.foods ?? [];

  if (foods.length === 0) {
    console.log("No records found in db.json, skipping index");
    return;
  }

  // Inject nameLength into every document so we can rank by shortest name
  for (const food of foods) {
    const name = String(food.name ?? "");
    food.nameLength = name.length;
  }

  const resp = await fetch(`${MEILI_URL}/indexes/${INDEX}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(foods),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to index documents: ${resp.status} ${body}`);
  }

  const { taskUid } = (await resp.json()) as { taskUid: number };

  // Poll until the task completes
  for (let i = 0; i < 60; i++) {
    const taskResp = await fetch(`${MEILI_URL}/tasks/${taskUid}`);
    const task = (await taskResp.json()) as { status: string; error?: unknown };

    if (task.status === "succeeded") {
      console.log(`Successfully indexed ${foods.length} documents`);
      return;
    }
    if (task.status === "failed") {
      throw new Error(`Indexing task failed: ${JSON.stringify(task.error)}`);
    }

    await sleep(1000);
  }

  throw new Error("Indexing task timed out");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Meilisearch Ingest starting…");
  await waitForMeilisearch();
  await createIndex();
  await configureSettings();
  await bulkIndex();
  console.log("Ingest complete.");
}

main().catch((err) => {
  console.error("Ingest failed:", err);
  process.exit(1);
});
