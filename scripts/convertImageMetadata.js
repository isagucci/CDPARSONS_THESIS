/**
 * Converts the image-level CSV in data/ into data/image_metadata.json.
 * Tries: image_level_id.csv, then image_level_tags.csv.
 * Run from project root: node scripts/convertImageMetadata.js
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const CSV_NAMES = ["image_level_id.csv", "image_level_tags.csv"];
const JSON_PATH = path.join(DATA_DIR, "image_metadata.json");

function findCsvPath() {
  for (const name of CSV_NAMES) {
    const p = path.join(DATA_DIR, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const NUMERIC_FIELDS = new Set([
  "avg_sat_pct",
  "avg_val_pct",
  "avg_lightness_pct",
  "neutral_ratio_pct",
  "warm_ratio_pct",
  "cool_ratio_pct",
  "neutral_temp_ratio_pct"
]);

function parseRow(line, headers) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === "," && !inQuotes) || c === "\n" || c === "\r") {
      values.push(current.trim());
      current = "";
      if (c !== ",") break;
    } else {
      current += c;
    }
  }
  if (current.length) values.push(current.trim());
  const obj = {};
  headers.forEach((h, i) => {
    let val = values[i] !== undefined ? values[i] : "";
    if (NUMERIC_FIELDS.has(h)) {
      const n = parseFloat(val);
      val = Number.isFinite(n) ? n : 0;
    }
    obj[h] = val;
  });
  return obj;
}

function main() {
  const CSV_PATH = findCsvPath();
  if (!CSV_PATH) {
    console.error("No image-level CSV found in data/. Tried:", CSV_NAMES.join(", "));
    process.exit(1);
  }
  const csv = fs.readFileSync(CSV_PATH, "utf8");
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    console.error("CSV has no data rows");
    process.exit(1);
  }
  const headers = lines[0].split(",").map((h) => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseRow(lines[i], headers);
    if (row.image_file) {
      out.push(row);
    }
  }
  fs.writeFileSync(JSON_PATH, JSON.stringify(out, null, 2), "utf8");
  console.log("Read", path.basename(CSV_PATH), "→ wrote", out.length, "image metadata objects to data/image_metadata.json");
}

main();
