/**
 * USDA FoodData Central Fetcher
 *
 * Downloads USDA food JSON data, extracts it,
 * and converts to CSV format matching data/raw/usda.csv structure.
 *
 * Usage: bun src/fetch-usda.ts
 */

import { get } from "node:https";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const RAW_DIR = join(PROJECT_ROOT, "data", "raw");
const TEMP_DIR = join(PROJECT_ROOT, "data", "temp");

const USDA_SOURCES = [
  {
    name: "foundation",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip",
    outputFile: "usda-foundation.csv",
  },
  {
    name: "survey",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip",
    outputFile: "usda-fndds.csv",
  },
];

const NUTRIENT_NUMBERS = {
  calories: "208",  // Energy in kcal
  protein: "203",   // Protein in g
  fat: "204",       // Total lipid (fat) in g
  carbo: "205",     // Carbohydrate, by difference in g
  fiber: "291",     // Fiber, total dietary in g
};

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
}

interface NutrientAmount {
  nutrient: {
    number: string;
    name: string;
  };
  amount?: number;
}

interface USDAFoodItem {
  fdcId: number;
  description: string;
  foodNutrients: NutrientAmount[];
}

interface USADSource {
  name: string;
  url: string;
  outputFile: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Download file from URL to destination
 */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Downloading: ${url}`);
    
    const file = createWriteStream(dest);
    
    get(url, (response) => {
      // Handle redirects
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        rmSync(dest, { force: true });
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      
      file.on("finish", () => {
        file.close();
        console.log(`Downloaded to: ${dest}`);
        resolve();
      });
      
      file.on("error", (err) => {
        rmSync(dest, { force: true });
        reject(err);
      });
    }).on("error", (err) => {
      file.close();
      rmSync(dest, { force: true });
      reject(err);
    });
  });
}

/**
 * Extract ZIP file to directory
 */
function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Extracting: ${zipPath}`);
    
    // Clean up existing extraction directory
    if (existsSync(destDir)) {
      rmSync(destDir, { recursive: true });
    }
    
    try {
      // Check if unzip is available
      execSync("which unzip", { stdio: "pipe" });
      execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: "pipe" });
      console.log(`Extracted to: ${destDir}`);
      resolve();
    } catch (error) {
      reject(new Error(`Failed to extract ZIP. Make sure 'unzip' is installed: ${error}`));
    }
  });
}

/**
 * Find JSON file in directory (recursive search)
 */
function findJsonFile(dir: string): string | null {
  const files = require("node:fs").readdirSync(dir, { withFileTypes: true });
  
  for (const file of files) {
    const fullPath = join(dir, file.name);
    if (file.isDirectory()) {
      const found = findJsonFile(fullPath);
      if (found) return found;
    } else if (file.name.endsWith(".json")) {
      return fullPath;
    }
  }
  
  return null;
}

/**
 * Parse USDA JSON file and extract food records
 */
function parseUSDAJson(jsonPath: string): FoodRecord[] {
  console.log(`Parsing JSON: ${jsonPath}`);
  
  const rawData = readFileSync(jsonPath, "utf-8");
  const data = JSON.parse(rawData);
  
  // Handle both array format and object with FoundationFoods or SurveyFoods key
  let rawItems: USDAFoodItem[] = [];
  if (Array.isArray(data)) {
    rawItems = data;
  } else if (data.FoundationFoods) {
    rawItems = data.FoundationFoods;
  } else if (data.SurveyFoods) {
    rawItems = data.SurveyFoods;
  }
  
  const foodItems = rawItems.filter((item): item is USDAFoodItem => item !== null && item !== undefined);
  
  console.log(`Found ${foodItems.length} food items (filtered from ${rawItems.length})`);
  
  const records: FoodRecord[] = [];
  
  for (const item of foodItems) {
    // Skip items without food nutrients
    if (!item.foodNutrients || !Array.isArray(item.foodNutrients)) {
      continue;
    }
    
    // Extract nutrient amounts by nutrient number
    const nutrientMap = new Map<string, number>();
    
    for (const nutrient of item.foodNutrients) {
      if (nutrient.amount !== undefined && nutrient.amount !== null) {
        nutrientMap.set(nutrient.nutrient.number, nutrient.amount);
      }
    }
    
    // Create food record
    const record: FoodRecord = {
      code: String(item.fdcId),
      name: item.description,
      calories: nutrientMap.get(NUTRIENT_NUMBERS.calories) ?? 0,
      protein: nutrientMap.get(NUTRIENT_NUMBERS.protein) ?? 0,
      fat: nutrientMap.get(NUTRIENT_NUMBERS.fat) ?? 0,
      carbo: nutrientMap.get(NUTRIENT_NUMBERS.carbo) ?? 0,
      fiber: nutrientMap.get(NUTRIENT_NUMBERS.fiber) ?? 0,
    };
    
    records.push(record);
  }
  
  console.log(`Parsed ${records.length} records`);
  return records;
}

/**
 * Format number with comma as decimal separator
 * Returns "-" for zero or null values
 */
function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) {
    return "-";
  }
  return value.toString().replace(".", ",");
}

/**
 * Convert food records to CSV format
 */
function toCSV(records: FoodRecord[]): string {
  const header = "code;name;calories;protein;fat;carbo;fiber";
  
  const rows = records.map((record) => {
    const values = [
      record.code,
      record.name,
      formatNumber(record.calories),
      formatNumber(record.protein),
      formatNumber(record.fat),
      formatNumber(record.carbo),
      formatNumber(record.fiber),
    ];
    return values.join(";");
  });
  
  return [header, ...rows].join("\n");
}

/**
 * Validate CSV output format
 */
function validateCSV(csv: string): boolean {
  const lines = csv.split("\n");
  
  // Check header
  const header = lines[0];
  if (header !== "code;name;calories;protein;fat;carbo;fiber") {
    console.error(`Invalid header: ${header}`);
    return false;
  }
  
  // Check that we have data rows
  if (lines.length < 2) {
    console.error("No data rows found");
    return false;
  }
  
  console.log(`CSV validation passed: ${lines.length - 1} data rows`);
  return true;
}

/**
 * Process a single USDA data source
 */
async function processSource(source: USADSource, seenCodes: Set<string>): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Processing: ${source.name}`);
  console.log(`URL: ${source.url}`);
  console.log(`Output: ${source.outputFile}`);
  console.log(`${"=".repeat(60)}\n`);
  
  const zipFile = join(TEMP_DIR, `${source.name}.zip`);
  const extractDir = join(TEMP_DIR, source.name);
  const outputFile = join(RAW_DIR, source.outputFile);
  
  try {
    // Download ZIP
    await downloadFile(source.url, zipFile);
    
    // Extract ZIP
    await extractZip(zipFile, extractDir);
    
    // Find JSON file in extracted directory
    const jsonFile = findJsonFile(extractDir);
    
    if (!jsonFile) {
      throw new Error(`JSON file not found in ${extractDir}`);
    }
    
    // Parse JSON and extract records
    const allRecords = parseUSDAJson(jsonFile);
    
    // Remove duplicates (keep first occurrence)
    const records: FoodRecord[] = [];
    let duplicatesRemoved = 0;
    
    for (const record of allRecords) {
      if (!seenCodes.has(record.code)) {
        seenCodes.add(record.code);
        records.push(record);
      } else {
        duplicatesRemoved++;
      }
    }
    
    if (duplicatesRemoved > 0) {
      console.log(`Removed ${duplicatesRemoved} duplicate codes`);
    }
    
    // Convert to CSV
    const csv = toCSV(records);
    
    // Validate CSV
    if (!validateCSV(csv)) {
      throw new Error("CSV validation failed");
    }
    
    // Write CSV file
    writeFileSync(outputFile, csv, "utf-8");
    console.log(`Written ${records.length} unique records to ${outputFile}`);
    
  } finally {
    // Cleanup temporary files for this source
    if (existsSync(zipFile)) {
      rmSync(zipFile, { force: true });
    }
    if (existsSync(extractDir)) {
      rmSync(extractDir, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("USDA FoodData Central Fetcher");
  console.log(`Processing ${USDA_SOURCES.length} data sources\n`);
  
  try {
    // Ensure temp directory exists
    if (!existsSync(TEMP_DIR)) {
      mkdirSync(TEMP_DIR, { recursive: true });
    }
    
    // Track seen codes across all sources for deduplication
    const seenCodes = new Set<string>();
    
    // Process each source
    for (const source of USDA_SOURCES) {
      await processSource(source, seenCodes);
    }
    
    console.log(`\n${"=".repeat(60)}`);
    console.log(`All done! Total unique records: ${seenCodes.size}`);
    console.log(`${"=".repeat(60)}`);
    
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
