const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parsePrecision(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return 0;
  if (parsed > 6) return 6;
  return parsed;
}

function parseBool(value, fallback) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

module.exports = {
  PORT: process.env.PORT || 3000,
  HOST: process.env.HOST || "0.0.0.0",
  ROOT,
  PUBLIC_DIR,
  DATA_DIR,
  USERS_FILE: path.join(DATA_DIR, "users.json"),
  SPOTS_FILE: path.join(DATA_DIR, "spots.json"),
  CURATED_FILE: path.join(DATA_DIR, "cherry-curated.json"),
  REPORTS_FILE: path.join(DATA_DIR, "reports.json"),
  OVERPASS_CACHE_FILE: path.join(DATA_DIR, "overpass-cache.json"),
  PLACES_FILE: path.join(DATA_DIR, "places.json"),
  OVERPASS_ENDPOINTS: [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ],
  OVERPASS_BBOX_KEY_PRECISION: parsePrecision(process.env.OVERPASS_BBOX_KEY_PRECISION, 2),
  OVERPASS_TTL_BBOX_MS: parsePositiveInt(process.env.OVERPASS_TTL_BBOX_MS, 5 * 60 * 1000),
  OVERPASS_STALE_TTL_BBOX_MS: parsePositiveInt(process.env.OVERPASS_STALE_TTL_BBOX_MS, 24 * 60 * 60 * 1000),
  OVERPASS_TTL_KOREA_MS: parsePositiveInt(process.env.OVERPASS_TTL_KOREA_MS, 30 * 60 * 1000),
  OVERPASS_STALE_TTL_KOREA_MS: parsePositiveInt(process.env.OVERPASS_STALE_TTL_KOREA_MS, 7 * 24 * 60 * 60 * 1000),
  OVERPASS_SNAPSHOT_TTL_MS: parsePositiveInt(process.env.OVERPASS_SNAPSHOT_TTL_MS, 60 * 1000),
  OVERPASS_LOG_ENABLED: parseBool(process.env.OVERPASS_LOG_ENABLED, true),
  OVERPASS_LOG_DETAIL: parseBool(process.env.OVERPASS_LOG_DETAIL, true)
};
