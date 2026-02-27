const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");

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
  ]
};
