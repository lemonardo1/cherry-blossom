const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const db = require("../src/lib/db");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    args[key] = value;
  }
  return args;
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields.map((v) => String(v || "").trim());
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((v) => v.toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const fields = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j += 1) {
      row[header[j]] = fields[j] || "";
    }
    rows.push(row);
  }
  return rows;
}

function isValidCoord(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function stableId(prefix, name, lat, lon) {
  const source = `${name}|${lat.toFixed(6)}|${lon.toFixed(6)}`;
  const digest = crypto.createHash("sha1").update(source).digest("hex").slice(0, 16);
  return `${prefix}-${digest}`;
}

function dedupeRows(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    const name = String(row.name || "").trim();
    if (!name || !isValidCoord(lat, lon)) continue;
    const key = `${name.toLowerCase()}|${lat.toFixed(5)}|${lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: String(row.id || "").trim(),
      name,
      lat,
      lon,
      region: String(row.region || "").trim().slice(0, 100),
      memo: String(row.memo || "").trim().slice(0, 400),
      status: String(row.status || "active").trim().toLowerCase() === "inactive" ? "inactive" : "active"
    });
  }
  return result;
}

async function importCurated(rows, dryRun) {
  let inserted = 0;
  const now = new Date().toISOString();
  for (const row of rows) {
    const id = row.id || stableId("curated", row.name, row.lat, row.lon);
    if (dryRun) {
      inserted += 1;
      continue;
    }
    await db.upsertCuratedCherrySpot({
      id,
      name: row.name,
      lat: row.lat,
      lon: row.lon,
      region: row.region,
      memo: row.memo,
      createdAt: now,
      updatedAt: now
    });
    inserted += 1;
  }
  return inserted;
}

async function importInternal(rows, dryRun) {
  let inserted = 0;
  const now = new Date().toISOString();
  for (const row of rows) {
    const id = row.id || stableId("internal", row.name, row.lat, row.lon);
    if (dryRun) {
      inserted += 1;
      continue;
    }
    await db.pool.query(
      `INSERT INTO internal_cherry_spots (
        id, name, lat, lon, region, memo, status, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9)
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        lat = EXCLUDED.lat,
        lon = EXCLUDED.lon,
        region = EXCLUDED.region,
        memo = EXCLUDED.memo,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at`,
      [id, row.name, row.lat, row.lon, row.region, row.memo, row.status, now, now]
    );
    inserted += 1;
  }
  return inserted;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fileArg = String(args.file || "").trim();
  const mode = String(args.mode || "curated").trim().toLowerCase();
  const dryRun = String(args["dry-run"] || "false").trim().toLowerCase() === "true";
  if (!fileArg) {
    throw new Error("사용법: node scripts/import-cherry-csv.js --file <csv_path> [--mode curated|internal] [--dry-run true]");
  }
  if (!["curated", "internal"].includes(mode)) {
    throw new Error("--mode 는 curated 또는 internal 만 허용됩니다.");
  }

  const filePath = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
  const text = await fs.readFile(filePath, "utf8");
  const parsed = parseCsv(text);
  const rows = dedupeRows(parsed);

  await db.initSchema();
  let imported = 0;
  if (mode === "curated") imported = await importCurated(rows, dryRun);
  if (mode === "internal") imported = await importInternal(rows, dryRun);
  if (!dryRun) await db.clearGeoCache();
  await db.closeDb();

  console.log(`[ok] mode=${mode} parsed=${parsed.length} deduped=${rows.length} imported=${imported} dry_run=${dryRun}`);
}

main().catch(async (error) => {
  console.error(`[error] ${error.message}`);
  try {
    await db.closeDb();
  } catch {}
  process.exit(1);
});
