const { sendJson } = require("../../lib/http");
const { loadCherryElements } = require("../../services/cherry");

function createOsmHandler({
  db,
  overpassEndpoints,
  overpassCacheOptions
}) {
  return async function handleOsm(req, res, url) {
    if (req.method !== "GET" || url.pathname !== "/api/osm/cherry") return false;
    try {
      const result = await loadCherryElements({
        bboxRaw: url.searchParams.get("bbox"),
        listCuratedCherrySpots: db.listCuratedCherrySpots,
        listInternalCherrySpots: db.listInternalCherrySpots,
        listApprovedReports: db.listApprovedReports,
        getOverpassCacheEntry: db.getOverpassCacheEntry,
        upsertOverpassCacheEntry: db.upsertOverpassCacheEntry,
        getPlaceSnapshot: db.getPlaceSnapshot,
        upsertPlaceSnapshot: db.upsertPlaceSnapshot,
        overpassEndpoints,
        overpassCacheOptions
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
