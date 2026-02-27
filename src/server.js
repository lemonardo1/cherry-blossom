const http = require("node:http");
const {
  PORT,
  HOST,
  PUBLIC_DIR,
  DATA_DIR,
  USERS_FILE,
  SPOTS_FILE,
  CURATED_FILE,
  REPORTS_FILE,
  OVERPASS_CACHE_FILE,
  PLACES_FILE,
  OVERPASS_ENDPOINTS
} = require("./config");
const { sendJson } = require("./lib/http");
const { ensureDataFiles, readJson, writeJson } = require("./lib/file-db");
const { createApiHandler } = require("./routes/api");
const { serveStatic } = require("./routes/static");

async function main() {
  await ensureDataFiles({
    dataDir: DATA_DIR,
    usersFile: USERS_FILE,
    spotsFile: SPOTS_FILE,
    curatedFile: CURATED_FILE,
    reportsFile: REPORTS_FILE,
    overpassCacheFile: OVERPASS_CACHE_FILE,
    placesFile: PLACES_FILE
  });
  await backfillReportsFromSpots();

  const handleApi = createApiHandler({
    usersFile: USERS_FILE,
    spotsFile: SPOTS_FILE,
    curatedFile: CURATED_FILE,
    reportsFile: REPORTS_FILE,
    overpassCacheFile: OVERPASS_CACHE_FILE,
    placesFile: PLACES_FILE,
    overpassEndpoints: OVERPASS_ENDPOINTS
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (handled !== false) return;
      return sendJson(res, 404, { error: "not_found" });
    }
    return serveStatic(res, url, PUBLIC_DIR);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}

async function backfillReportsFromSpots() {
  const spots = await readJson(SPOTS_FILE);
  const reports = await readJson(REPORTS_FILE);
  const reportSpotIds = new Set(reports.map((r) => r.spotId).filter(Boolean));
  const backfill = spots
    .filter((s) => !reportSpotIds.has(s.id))
    .map((s) => ({
      id: `bf-${s.id}`,
      userId: s.userId,
      spotId: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      memo: s.memo || "",
      status: "approved",
      createdAt: s.createdAt || new Date().toISOString(),
      updatedAt: s.createdAt || new Date().toISOString()
    }));
  if (!backfill.length) return;
  await writeJson(REPORTS_FILE, reports.concat(backfill));
}

module.exports = {
  main
};
