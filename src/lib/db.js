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
    role: row.role || "user",
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

function mapOsmCherrySpot(row) {
  if (!row) return null;
  return {
    osmKey: row.osm_key,
    osmType: row.osm_type,
    osmId: row.osm_id,
    name: row.name || "",
    lat: Number(row.lat),
    lon: Number(row.lon),
    tags: row.tags && typeof row.tags === "object" ? row.tags : {},
    status: row.status || "active",
    firstSeenAt: toIso(row.first_seen_at),
    lastSeenAt: toIso(row.last_seen_at),
    updatedAt: toIso(row.updated_at)
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

function mapInternalCherrySpot(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    lat: Number(row.lat),
    lon: Number(row.lon),
    region: row.region || "",
    memo: row.memo || "",
    status: row.status || "active",
    isCore: row.is_core !== false,
    minZoom: Number.isFinite(Number(row.min_zoom)) ? Number(row.min_zoom) : 12,
    priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 100,
    category: row.category || "hub",
    createdBy: row.created_by || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapSession(row) {
  if (!row) return null;
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at)
  };
}

function mapCuratedCherrySpot(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    lat: Number(row.lat),
    lon: Number(row.lon),
    region: row.region || "",
    memo: row.memo || "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
  `);
  await pool.query(`
    ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check
  `);
  await pool.query(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))
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
    CREATE TABLE IF NOT EXISTS osm_cherry_spots (
      osm_key TEXT PRIMARY KEY,
      osm_type TEXT NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
      osm_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      tags JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      first_seen_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS osm_cherry_spots_status_idx ON osm_cherry_spots(status)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS osm_cherry_spots_lat_lon_idx ON osm_cherry_spots(lat, lon)
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS internal_cherry_spots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      region TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      is_core BOOLEAN NOT NULL DEFAULT TRUE,
      min_zoom INTEGER NOT NULL DEFAULT 12,
      priority INTEGER NOT NULL DEFAULT 100,
      category TEXT NOT NULL DEFAULT 'hub',
      created_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`
    ALTER TABLE internal_cherry_spots
    ADD COLUMN IF NOT EXISTS is_core BOOLEAN NOT NULL DEFAULT TRUE
  `);
  await pool.query(`
    ALTER TABLE internal_cherry_spots
    ADD COLUMN IF NOT EXISTS min_zoom INTEGER NOT NULL DEFAULT 12
  `);
  await pool.query(`
    ALTER TABLE internal_cherry_spots
    ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100
  `);
  await pool.query(`
    ALTER TABLE internal_cherry_spots
    ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'hub'
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS internal_cherry_spots_core_zoom_idx
    ON internal_cherry_spots(status, is_core, min_zoom, priority)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS curated_cherry_spots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      region TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at)
  `);
}

async function getUserById(id) {
  const { rows } = await pool.query(
    "SELECT id, email, name, role, password_hash, created_at FROM users WHERE id = $1 LIMIT 1",
    [id]
  );
  return mapUser(rows[0]);
}

async function getUserByEmail(email) {
  const { rows } = await pool.query(
    "SELECT id, email, name, role, password_hash, created_at FROM users WHERE email = $1 LIMIT 1",
    [email]
  );
  return mapUser(rows[0]);
}

async function createUser(user) {
  await pool.query(
    `INSERT INTO users (id, email, name, role, password_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.id, user.email, user.name, user.role || "user", user.passwordHash, user.createdAt]
  );
  return user;
}

async function hasAdminUser() {
  const { rows } = await pool.query(
    "SELECT 1 FROM users WHERE role = 'admin' LIMIT 1"
  );
  return rows.length > 0;
}

async function createSession(session) {
  await pool.query(
    `INSERT INTO sessions (token, user_id, created_at, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (token)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       created_at = EXCLUDED.created_at,
       expires_at = EXCLUDED.expires_at`,
    [session.token, session.userId, session.createdAt, session.expiresAt]
  );
  return session;
}

async function getSessionByToken(token) {
  const { rows } = await pool.query(
    `SELECT token, user_id, created_at, expires_at
     FROM sessions
     WHERE token = $1
     LIMIT 1`,
    [token]
  );
  return mapSession(rows[0]);
}

async function deleteSessionByToken(token) {
  await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
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

async function listOsmCherrySpots({ bbox, status = "active" } = {}) {
  const values = [];
  const where = [];
  if (status && status !== "all") {
    values.push(status);
    where.push(`status = $${values.length}`);
  }
  if (bbox && typeof bbox === "object") {
    values.push(Number(bbox.minLat));
    where.push(`lat >= $${values.length}`);
    values.push(Number(bbox.maxLat));
    where.push(`lat <= $${values.length}`);
    values.push(Number(bbox.minLon));
    where.push(`lon >= $${values.length}`);
    values.push(Number(bbox.maxLon));
    where.push(`lon <= $${values.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT osm_key, osm_type, osm_id, name, lat, lon, tags, status, first_seen_at, last_seen_at, updated_at
     FROM osm_cherry_spots
     ${whereSql}
     ORDER BY updated_at DESC`,
    values
  );
  return rows.map(mapOsmCherrySpot);
}

async function upsertOsmCherrySpots(spots, { syncedAt, deactivateMissing = true } = {}) {
  if (!Array.isArray(spots) || spots.length === 0) return { upserted: 0, deactivated: 0 };
  const runAt = syncedAt || new Date().toISOString();
  const seenKeys = new Set();
  const client = await pool.connect();
  let deactivated = 0;
  try {
    await client.query("BEGIN");
    for (const spot of spots) {
      const osmType = String(spot.osmType || "").trim();
      const osmId = String(spot.osmId || "").trim();
      const osmKey = String(spot.osmKey || `${osmType}/${osmId}`).trim();
      if (!osmKey || !osmType || !osmId) continue;
      seenKeys.add(osmKey);
      await client.query(
        `INSERT INTO osm_cherry_spots (
          osm_key, osm_type, osm_id, name, lat, lon, tags, status, first_seen_at, last_seen_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'active', $8, $8, $8)
        ON CONFLICT (osm_key)
        DO UPDATE SET
          osm_type = EXCLUDED.osm_type,
          osm_id = EXCLUDED.osm_id,
          name = EXCLUDED.name,
          lat = EXCLUDED.lat,
          lon = EXCLUDED.lon,
          tags = EXCLUDED.tags,
          status = 'active',
          last_seen_at = EXCLUDED.last_seen_at,
          updated_at = EXCLUDED.updated_at`,
        [
          osmKey,
          osmType,
          osmId,
          String(spot.name || "").trim(),
          Number(spot.lat),
          Number(spot.lon),
          JSON.stringify(spot.tags || {}),
          runAt
        ]
      );
    }
    if (deactivateMissing) {
      const keys = Array.from(seenKeys);
      const values = [runAt];
      let query = `
        UPDATE osm_cherry_spots
        SET status = 'inactive', updated_at = $1
        WHERE status = 'active'
      `;
      if (keys.length) {
        values.push(keys);
        query += ` AND NOT (osm_key = ANY($2::text[]))`;
      }
      const result = await client.query(query, values);
      deactivated = Number(result.rowCount || 0);
    }
    await client.query("COMMIT");
    return { upserted: seenKeys.size, deactivated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

async function listInternalCherrySpots({ status = "active", coreOnly = false, zoom = null } = {}) {
  const values = [];
  const whereParts = [];
  if (status && status !== "all") {
    values.push(status);
    whereParts.push(`status = $${values.length}`);
  }
  if (coreOnly) {
    whereParts.push("is_core = TRUE");
  }
  if (Number.isFinite(Number(zoom))) {
    values.push(Number(zoom));
    whereParts.push(`min_zoom <= $${values.length}`);
  }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT id, name, lat, lon, region, memo, status, is_core, min_zoom, priority, category, created_by, created_at, updated_at
     FROM internal_cherry_spots
     ${whereSql}
     ORDER BY priority ASC, updated_at DESC`,
    values
  );
  return rows.map(mapInternalCherrySpot);
}

async function createInternalCherrySpot(spot) {
  await pool.query(
    `INSERT INTO internal_cherry_spots (
      id, name, lat, lon, region, memo, status, created_by, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      spot.id,
      spot.name,
      spot.lat,
      spot.lon,
      spot.region || "",
      spot.memo || "",
      spot.status || "active",
      spot.createdBy || null,
      spot.createdAt,
      spot.updatedAt
    ]
  );
  return spot;
}

async function createInternalCherrySpots(spots) {
  if (!Array.isArray(spots) || !spots.length) return [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const spot of spots) {
      await client.query(
        `INSERT INTO internal_cherry_spots (
          id, name, lat, lon, region, memo, status, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          spot.id,
          spot.name,
          spot.lat,
          spot.lon,
          spot.region || "",
          spot.memo || "",
          spot.status || "active",
          spot.createdBy || null,
          spot.createdAt,
          spot.updatedAt
        ]
      );
    }
    await client.query("COMMIT");
    return spots;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateInternalCherrySpotById(spot) {
  const { rows } = await pool.query(
    `UPDATE internal_cherry_spots
     SET name = $1,
         lat = $2,
         lon = $3,
         region = $4,
         memo = $5,
         status = $6,
         updated_at = $7
     WHERE id = $8
     RETURNING id, name, lat, lon, region, memo, status, created_by, created_at, updated_at`,
    [
      spot.name,
      spot.lat,
      spot.lon,
      spot.region || "",
      spot.memo || "",
      spot.status || "active",
      spot.updatedAt,
      spot.id
    ]
  );
  return mapInternalCherrySpot(rows[0]);
}

async function setInternalCherrySpotStatusById({ id, status, updatedAt }) {
  const { rows } = await pool.query(
    `UPDATE internal_cherry_spots
     SET status = $1, updated_at = $2
     WHERE id = $3
     RETURNING id, name, lat, lon, region, memo, status, created_by, created_at, updated_at`,
    [status, updatedAt, id]
  );
  return mapInternalCherrySpot(rows[0]);
}

async function clearGeoCache() {
  await pool.query("DELETE FROM overpass_cache_entries");
  await pool.query("DELETE FROM place_snapshots");
}

async function listCuratedCherrySpots() {
  const { rows } = await pool.query(
    `SELECT id, name, lat, lon, region, memo, created_at, updated_at
     FROM curated_cherry_spots
     ORDER BY updated_at DESC`
  );
  return rows.map(mapCuratedCherrySpot);
}

async function upsertCuratedCherrySpot(spot) {
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO curated_cherry_spots (
      id, name, lat, lon, region, memo, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id)
     DO UPDATE SET
       name = EXCLUDED.name,
       lat = EXCLUDED.lat,
       lon = EXCLUDED.lon,
       region = EXCLUDED.region,
       memo = EXCLUDED.memo,
       created_at = EXCLUDED.created_at,
       updated_at = EXCLUDED.updated_at`,
    [
      spot.id,
      spot.name,
      spot.lat,
      spot.lon,
      spot.region || "",
      spot.memo || "",
      spot.createdAt || now,
      spot.updatedAt || spot.createdAt || now
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
  hasAdminUser,
  createSession,
  getSessionByToken,
  deleteSessionByToken,
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
  listOsmCherrySpots,
  upsertOsmCherrySpots,
  getPlaceSnapshot,
  upsertPlaceSnapshot,
  listInternalCherrySpots,
  createInternalCherrySpot,
  createInternalCherrySpots,
  updateInternalCherrySpotById,
  setInternalCherrySpotStatusById,
  listCuratedCherrySpots,
  upsertCuratedCherrySpot,
  clearGeoCache,
  closeDb
};
