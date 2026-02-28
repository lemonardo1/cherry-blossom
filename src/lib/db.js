const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined
});

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return new Date(value).toISOString();
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    createdAt: toIso(row.created_at)
  };
}

function mapSpot(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    lat: Number(row.lat),
    lon: Number(row.lon),
    memo: row.memo || "",
    createdAt: toIso(row.created_at)
  };
}

function mapReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    spotId: row.spot_id || null,
    name: row.name,
    lat: Number(row.lat),
    lon: Number(row.lon),
    memo: row.memo || "",
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapOverpassEntry(row) {
  if (!row) return null;
  return {
    key: row.cache_key,
    updatedAt: toIso(row.updated_at),
    expiresAt: Number(row.expires_at),
    staleUntil: Number(row.stale_until),
    elements: Array.isArray(row.elements) ? row.elements : []
  };
}

function mapSnapshot(row) {
  if (!row) return null;
  return {
    key: row.cache_key,
    bbox: row.bbox || null,
    generatedAt: toIso(row.generated_at),
    elements: Array.isArray(row.elements) ? row.elements : [],
    meta: row.meta && typeof row.meta === "object" ? row.meta : {}
  };
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS spots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      memo TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      spot_id TEXT NULL,
      name TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      memo TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS overpass_cache_entries (
      cache_key TEXT PRIMARY KEY,
      updated_at TIMESTAMPTZ NOT NULL,
      expires_at BIGINT NOT NULL,
      stale_until BIGINT NOT NULL,
      elements JSONB NOT NULL DEFAULT '[]'::jsonb
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS place_snapshots (
      cache_key TEXT PRIMARY KEY,
      bbox JSONB NULL,
      generated_at TIMESTAMPTZ NOT NULL,
      elements JSONB NOT NULL DEFAULT '[]'::jsonb,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
}

async function getUserById(id) {
  const { rows } = await pool.query(
    "SELECT id, email, name, password_hash, created_at FROM users WHERE id = $1 LIMIT 1",
    [id]
  );
  return mapUser(rows[0]);
}

async function getUserByEmail(email) {
  const { rows } = await pool.query(
    "SELECT id, email, name, password_hash, created_at FROM users WHERE email = $1 LIMIT 1",
    [email]
  );
  return mapUser(rows[0]);
}

async function createUser(user) {
  await pool.query(
    `INSERT INTO users (id, email, name, password_hash, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, user.email, user.name, user.passwordHash, user.createdAt]
  );
  return user;
}

async function listSpots({ userId, mine }) {
  const query = mine
    ? "SELECT id, user_id, name, lat, lon, memo, created_at FROM spots WHERE user_id = $1 ORDER BY created_at DESC"
    : "SELECT id, user_id, name, lat, lon, memo, created_at FROM spots ORDER BY created_at DESC";
  const { rows } = mine ? await pool.query(query, [userId]) : await pool.query(query);
  return rows.map(mapSpot);
}

async function createSpot(spot) {
  await pool.query(
    `INSERT INTO spots (id, user_id, name, lat, lon, memo, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [spot.id, spot.userId, spot.name, spot.lat, spot.lon, spot.memo, spot.createdAt]
  );
  return spot;
}

async function deleteSpotByIdForUser({ spotId, userId }) {
  const { rows } = await pool.query(
    `DELETE FROM spots
     WHERE id = $1 AND user_id = $2
     RETURNING id, user_id, name, lat, lon, memo, created_at`,
    [spotId, userId]
  );
  return mapSpot(rows[0]);
}

async function listReports({ userId, mine, status }) {
  const values = [];
  const where = [];
  if (mine) {
    values.push(userId);
    where.push(`user_id = $${values.length}`);
  } else {
    values.push("approved");
    where.push(`status = $${values.length}`);
  }
  if (status) {
    values.push(status);
    where.push(`status = $${values.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT id, user_id, spot_id, name, lat, lon, memo, status, created_at, updated_at
     FROM reports
     ${whereSql}
     ORDER BY created_at DESC`,
    values
  );
  return rows.map(mapReport);
}

async function createReport(report) {
  await pool.query(
    `INSERT INTO reports (id, user_id, spot_id, name, lat, lon, memo, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      report.id,
      report.userId,
      report.spotId || null,
      report.name,
      report.lat,
      report.lon,
      report.memo,
      report.status,
      report.createdAt,
      report.updatedAt
    ]
  );
  return report;
}

async function updateReportStatusByUser({ id, userId, status, updatedAt }) {
  const { rows } = await pool.query(
    `UPDATE reports
     SET status = $1, updated_at = $2
     WHERE id = $3 AND user_id = $4
     RETURNING id, user_id, spot_id, name, lat, lon, memo, status, created_at, updated_at`,
    [status, updatedAt, id, userId]
  );
  return mapReport(rows[0]);
}

async function deleteReportsBySpotForUser({ spotId, userId }) {
  await pool.query(
    "DELETE FROM reports WHERE user_id = $1 AND spot_id = $2",
    [userId, spotId]
  );
}

async function listApprovedReports() {
  const { rows } = await pool.query(
    `SELECT id, user_id, spot_id, name, lat, lon, memo, status, created_at, updated_at
     FROM reports
     WHERE status = 'approved'
     ORDER BY created_at DESC`
  );
  return rows.map(mapReport);
}

async function getOverpassCacheEntry(cacheKey) {
  const { rows } = await pool.query(
    `SELECT cache_key, updated_at, expires_at, stale_until, elements
     FROM overpass_cache_entries
     WHERE cache_key = $1
     LIMIT 1`,
    [cacheKey]
  );
  return mapOverpassEntry(rows[0]);
}

async function upsertOverpassCacheEntry(entry) {
  await pool.query(
    `INSERT INTO overpass_cache_entries (cache_key, updated_at, expires_at, stale_until, elements)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (cache_key)
     DO UPDATE SET
       updated_at = EXCLUDED.updated_at,
       expires_at = EXCLUDED.expires_at,
       stale_until = EXCLUDED.stale_until,
       elements = EXCLUDED.elements`,
    [entry.key, entry.updatedAt, entry.expiresAt, entry.staleUntil, JSON.stringify(entry.elements || [])]
  );
}

async function getPlaceSnapshot(cacheKey) {
  const { rows } = await pool.query(
    `SELECT cache_key, bbox, generated_at, elements, meta
     FROM place_snapshots
     WHERE cache_key = $1
     LIMIT 1`,
    [cacheKey]
  );
  return mapSnapshot(rows[0]);
}

async function upsertPlaceSnapshot(snapshot) {
  await pool.query(
    `INSERT INTO place_snapshots (cache_key, bbox, generated_at, elements, meta)
     VALUES ($1, $2::jsonb, $3, $4::jsonb, $5::jsonb)
     ON CONFLICT (cache_key)
     DO UPDATE SET
       bbox = EXCLUDED.bbox,
       generated_at = EXCLUDED.generated_at,
       elements = EXCLUDED.elements,
       meta = EXCLUDED.meta`,
    [
      snapshot.key,
      JSON.stringify(snapshot.bbox || null),
      snapshot.generatedAt,
      JSON.stringify(snapshot.elements || []),
      JSON.stringify(snapshot.meta || {})
    ]
  );
}

async function closeDb() {
  await pool.end();
}

module.exports = {
  pool,
  initSchema,
  getUserById,
  getUserByEmail,
  createUser,
  listSpots,
  createSpot,
  deleteSpotByIdForUser,
  listReports,
  createReport,
  updateReportStatusByUser,
  deleteReportsBySpotForUser,
  listApprovedReports,
  getOverpassCacheEntry,
  upsertOverpassCacheEntry,
  getPlaceSnapshot,
  upsertPlaceSnapshot,
  closeDb
};
