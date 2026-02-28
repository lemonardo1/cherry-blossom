const http = require("node:http");
const {
  PORT,
  HOST,
  PUBLIC_DIR,
  USERS_FILE,
  SPOTS_FILE,
  CURATED_FILE,
  REPORTS_FILE,
  OVERPASS_ENDPOINTS
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
    curatedFile: CURATED_FILE,
    reportsFile: REPORTS_FILE,
    overpassEndpoints: OVERPASS_ENDPOINTS,
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
