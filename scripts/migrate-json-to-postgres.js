const fs = require("node:fs/promises");
const path = require("node:path");
const db = require("../src/lib/db");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

async function readJsonOrDefault(filePath, fallback) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    console.warn(`[warn] ${path.basename(filePath)} 읽기 실패, 기본값 사용: ${error.message}`);
    return fallback;
  }
}

async function importUsers(users) {
  for (const user of users) {
    await db.pool.query(
      `INSERT INTO users (id, email, name, role, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id)
       DO UPDATE SET
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         password_hash = EXCLUDED.password_hash,
         created_at = EXCLUDED.created_at`,
      [
        user.id,
        user.email,
        user.name,
        user.role || "user",
        user.passwordHash,
        user.createdAt || new Date().toISOString()
      ]
    );
  }
  console.log(`[ok] users ${users.length}건 upsert`);
}

async function importSpots(spots) {
  for (const spot of spots) {
    await db.pool.query(
      `INSERT INTO spots (id, user_id, name, lat, lon, memo, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         name = EXCLUDED.name,
         lat = EXCLUDED.lat,
         lon = EXCLUDED.lon,
         memo = EXCLUDED.memo,
         created_at = EXCLUDED.created_at`,
      [spot.id, spot.userId, spot.name, spot.lat, spot.lon, spot.memo || "", spot.createdAt || new Date().toISOString()]
    );
  }
  console.log(`[ok] spots ${spots.length}건 upsert`);
}

async function importReports(reports) {
  for (const report of reports) {
    await db.pool.query(
      `INSERT INTO reports (id, user_id, spot_id, name, lat, lon, memo, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         spot_id = EXCLUDED.spot_id,
         name = EXCLUDED.name,
         lat = EXCLUDED.lat,
         lon = EXCLUDED.lon,
         memo = EXCLUDED.memo,
         status = EXCLUDED.status,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at`,
      [
        report.id,
        report.userId,
        report.spotId || null,
        report.name,
        report.lat,
        report.lon,
        report.memo || "",
        report.status || "pending",
        report.createdAt || new Date().toISOString(),
        report.updatedAt || report.createdAt || new Date().toISOString()
      ]
    );
  }
  console.log(`[ok] reports ${reports.length}건 upsert`);
}

async function importOverpassEntries(store) {
  const entries = Array.isArray(store?.entries) ? store.entries : [];
  for (const entry of entries) {
    await db.pool.query(
      `INSERT INTO overpass_cache_entries (cache_key, updated_at, expires_at, stale_until, elements)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (cache_key)
       DO UPDATE SET
         updated_at = EXCLUDED.updated_at,
         expires_at = EXCLUDED.expires_at,
         stale_until = EXCLUDED.stale_until,
         elements = EXCLUDED.elements`,
      [
        entry.key,
        entry.updatedAt || new Date().toISOString(),
        Number(entry.expiresAt) || 0,
        Number(entry.staleUntil) || 0,
        JSON.stringify(entry.elements || [])
      ]
    );
  }
  console.log(`[ok] overpass cache ${entries.length}건 upsert`);
}

async function importPlaceSnapshots(store) {
  const snapshots = store?.snapshots && typeof store.snapshots === "object" ? store.snapshots : {};
  const keys = Object.keys(snapshots);
  for (const key of keys) {
    const snap = snapshots[key] || {};
    await db.pool.query(
      `INSERT INTO place_snapshots (cache_key, bbox, generated_at, elements, meta)
       VALUES ($1, $2::jsonb, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (cache_key)
       DO UPDATE SET
         bbox = EXCLUDED.bbox,
         generated_at = EXCLUDED.generated_at,
         elements = EXCLUDED.elements,
         meta = EXCLUDED.meta`,
      [
        key,
        JSON.stringify(snap.bbox || null),
        snap.generatedAt || new Date().toISOString(),
        JSON.stringify(snap.elements || []),
        JSON.stringify(snap.meta || {})
      ]
    );
  }
  console.log(`[ok] place snapshots ${keys.length}건 upsert`);
}

async function importInternalCherrySpots(spots) {
  for (const spot of spots) {
    const now = new Date().toISOString();
    await db.pool.query(
      `INSERT INTO internal_cherry_spots (
        id, name, lat, lon, region, memo, status, created_by, created_at, updated_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id)
       DO UPDATE SET
         name = EXCLUDED.name,
         lat = EXCLUDED.lat,
         lon = EXCLUDED.lon,
         region = EXCLUDED.region,
         memo = EXCLUDED.memo,
         status = EXCLUDED.status,
         created_by = EXCLUDED.created_by,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at`,
      [
        spot.id,
        spot.name,
        spot.lat,
        spot.lon,
        spot.region || "",
        spot.memo || "",
        spot.status || "active",
        spot.createdBy || null,
        spot.createdAt || now,
        spot.updatedAt || spot.createdAt || now
      ]
    );
  }
  console.log(`[ok] internal cherry spots ${spots.length}건 upsert`);
}

async function main() {
  await db.initSchema();

  const users = await readJsonOrDefault(path.join(DATA_DIR, "users.json"), []);
  const spots = await readJsonOrDefault(path.join(DATA_DIR, "spots.json"), []);
  const reports = await readJsonOrDefault(path.join(DATA_DIR, "reports.json"), []);
  const overpassCache = await readJsonOrDefault(path.join(DATA_DIR, "overpass-cache.json"), { entries: [] });
  const places = await readJsonOrDefault(path.join(DATA_DIR, "places.json"), { snapshots: {} });
  const internalSpots = await readJsonOrDefault(path.join(DATA_DIR, "internal-cherry-spots.json"), []);

  await importUsers(Array.isArray(users) ? users : []);
  await importSpots(Array.isArray(spots) ? spots : []);
  await importReports(Array.isArray(reports) ? reports : []);
  await importOverpassEntries(overpassCache);
  await importPlaceSnapshots(places);
  await importInternalCherrySpots(Array.isArray(internalSpots) ? internalSpots : []);
}

main()
  .then(async () => {
    console.log("[done] JSON -> PostgreSQL 마이그레이션 완료");
    await db.closeDb();
  })
  .catch(async (error) => {
    console.error("[error] 마이그레이션 실패:", error);
    await db.closeDb();
    process.exit(1);
  });
