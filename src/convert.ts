/**
 * CSV to JSON Converter for Nutritional Data
 *
 * Reads every CSV file from data/raw/, parses it (semicolon-separated,
 * comma as decimal separator, "-" as null), and writes the result as
 * a JSON array to data/json/ with the same base name.
 *
 * Usage: npx tsx src/convert.ts
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const RAW_DIR = join(PROJECT_ROOT, "data", "raw");
const JSON_DIR = join(PROJECT_ROOT, "data", "json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Column names that are numeric nutritional values; "-" defaults to 0. */
const NUTRITION_COLUMNS = new Set([
  "calories",
  "protein",
  "fat",
  "carbo",
  "fiber",
]);

/** Remove BOM character if present. */
function stripBOM(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

/**
 * Parse a single CSV value:
 *  - Trim whitespace.
 *  - "-" or empty → null.
 *  - Otherwise try to parse as a number (replace comma with dot).
 *  - Fall back to the trimmed string.
 */
function parseValue(raw: string): string | number | null {
  const v = raw.trim();
  if (v === "" || v === "-") return null;

  const normalized = v.replace(",", ".");
  const num = Number(normalized);
  return !Number.isNaN(num) ? num : v;
}

/**
 * Parse one CSV text (already stripped of BOM) into an array of objects.
 */
function parseCSV(text: string): Record<string, string | number | null>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");

  if (lines.length < 2) {
    return []; // No data rows.
  }

  const headers = lines[0].split(";").map((h) => h.trim());
  const rows: Record<string, string | number | null>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(";");
    const row: Record<string, string | number | null> = {};

    headers.forEach((header, idx) => {
      const raw = idx < values.length ? values[idx] : "";

      if (header === "code") {
        // Always keep the "code" column as a string.
        row[header] = raw.trim();
      } else if (NUTRITION_COLUMNS.has(header)) {
        // Nutritional columns: "-" or empty defaults to 0.
        row[header] = parseValue(raw) ?? 0;
      } else {
        row[header] = parseValue(raw);
      }
    });

    rows.push(row);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  // Ensure output directory exists.
  if (!existsSync(JSON_DIR)) {
    mkdirSync(JSON_DIR, { recursive: true });
  }

  // Discover CSV files in the raw directory.
  const csvFiles = readdirSync(RAW_DIR).filter(
    (f: string) => f.toLowerCase().endsWith(".csv"),
  );

  if (csvFiles.length === 0) {
    console.log("No CSV files found in data/raw/");
    return;
  }

  for (const csvFile of csvFiles) {
    const rawPath = join(RAW_DIR, csvFile);
    const baseName = parse(csvFile).name; // e.g. "tkpi" from "tkpi.csv"
    const jsonPath = join(JSON_DIR, `${baseName}.json`);

    console.log(`Converting: ${csvFile} → ${baseName}.json`);

    const rawText = readFileSync(rawPath, "utf-8");
    const cleanText = stripBOM(rawText);
    const records = parseCSV(cleanText);

    writeFileSync(jsonPath, JSON.stringify(records, null, 2), "utf-8");
    console.log(`  ✔  ${records.length} records written to ${baseName}.json`);
  }

  console.log("\nDone.");
}

main();
