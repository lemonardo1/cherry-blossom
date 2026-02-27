const { sendJson } = require("../../lib/http");
const { loadCherryElements } = require("../../services/cherry");

function createOsmHandler({
  curatedFile,
  reportsFile,
  overpassCacheFile,
  placesFile,
  readJson,
  writeJson,
  overpassEndpoints
}) {
  return async function handleOsm(req, res, url) {
    if (req.method !== "GET" || url.pathname !== "/api/osm/cherry") return false;
    try {
      const result = await loadCherryElements({
        bboxRaw: url.searchParams.get("bbox"),
        readJson,
        writeJson,
        curatedFile,
        reportsFile,
        overpassCacheFile,
        placesFile,
        overpassEndpoints
      });
      return sendJson(res, 200, result);
    } catch (error) {
      return sendJson(res, 500, { error: "osm_proxy_error", message: error.message });
    }
  };
}

module.exports = {
  createOsmHandler
};
