/**
 * Merge all JSON files from data/json/ into data/db.json
 *
 * Output: { "foods": [ ... ] } — the array is wrapped under the "foods" key
 * so json-server can expose it as the /foods endpoint.
 *
 * Usage: npx tsx src/merge.ts
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const JSON_DIR = join(PROJECT_ROOT, "data", "json");
const DB_PATH = join(PROJECT_ROOT, "data", "db.json");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  if (!existsSync(JSON_DIR)) {
    console.error("Directory data/json/ does not exist. Run the converter first.");
    process.exit(1);
  }

  const jsonFiles = readdirSync(JSON_DIR).filter((f: string) =>
    f.toLowerCase().endsWith(".json"),
  );

  if (jsonFiles.length === 0) {
    console.log("No JSON files found in data/json/");
    return;
  }

  const records: unknown[] = [];

  for (const file of jsonFiles) {
    const filePath = join(JSON_DIR, file);
    const content = readFileSync(filePath, "utf-8");

    try {
      const data = JSON.parse(content);

      if (Array.isArray(data)) {
        records.push(...data);
        console.log(`  ✔  ${file} → ${(data as unknown[]).length} records`);
      } else {
        console.error(`  ✖  ${file} is not an array, skipping`);
      }
    } catch (err) {
      console.error(`  ✖  Failed to parse ${file}: ${err}`);
    }
  }

  // Check for duplicate codes across all sources.
  const codeMap = new Map<string, number[]>();

  for (let i = 0; i < records.length; i++) {
    const rec = records[i] as Record<string, unknown>;
    const code = String(rec.code ?? "");

    if (!codeMap.has(code)) {
      codeMap.set(code, []);
    }
    codeMap.get(code)!.push(i);
  }

  const duplicates: { code: string; indices: number[] }[] = [];
  for (const [code, indices] of codeMap) {
    if (indices.length > 1) {
      duplicates.push({ code, indices });
    }
  }

  if (duplicates.length > 0) {
    console.warn(`\n⚠  Found ${duplicates.length} duplicate code(s):`);
    for (const { code, indices } of duplicates) {
      console.warn(`    "${code}" appears ${indices.length} times (indices: ${indices.join(", ")})`);
    }
  } else {
    console.log(`\n✔  No duplicate codes found.`);
  }

  // Wrap under "foods" key so json-server serves it as the /foods endpoint.
  const output = { foods: records };

  writeFileSync(DB_PATH, JSON.stringify(output), "utf-8");
  console.log(`\nDone → ${DB_PATH} (${records.length} total records → /foods)`);
}

main();
