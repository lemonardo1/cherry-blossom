const http = require("node:http");
const {
  PORT,
  HOST,
  PUBLIC_DIR,
  USERS_FILE,
  SPOTS_FILE,
  REPORTS_FILE,
  OVERPASS_ENDPOINTS,
  OVERPASS_BBOX_KEY_PRECISION,
  OVERPASS_TTL_BBOX_MS,
  OVERPASS_STALE_TTL_BBOX_MS,
  OVERPASS_TTL_KOREA_MS,
  OVERPASS_STALE_TTL_KOREA_MS
} = require("./config");
const { sendJson } = require("./lib/http");
const db = require("./lib/db");
const { createApiHandler } = require("./routes/api");
const { serveStatic } = require("./routes/static");

async function main() {
  await db.initSchema();

  const handleApi = createApiHandler({
    usersFile: USERS_FILE,
    spotsFile: SPOTS_FILE,
    reportsFile: REPORTS_FILE,
    overpassEndpoints: OVERPASS_ENDPOINTS,
    overpassCacheOptions: {
      bboxKeyPrecision: OVERPASS_BBOX_KEY_PRECISION,
      bboxTtlMs: OVERPASS_TTL_BBOX_MS,
      bboxStaleTtlMs: OVERPASS_STALE_TTL_BBOX_MS,
      koreaTtlMs: OVERPASS_TTL_KOREA_MS,
      koreaStaleTtlMs: OVERPASS_STALE_TTL_KOREA_MS
    },
    db
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (handled !== false) return;
      return sendJson(res, 404, { error: "not_found" });
    }
    return serveStatic(req, res, url, PUBLIC_DIR);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}

module.exports = {
  main
};
