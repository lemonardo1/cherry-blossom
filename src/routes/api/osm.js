const { sendJson } = require("../../lib/http");
const { loadCherryElements } = require("../../services/cherry");

function createOsmHandler({
  db,
  overpassEndpoints,
  overpassCacheOptions,
  overpassLogOptions
}) {
  return async function handleOsm(req, res, url) {
    if (req.method !== "GET" || url.pathname !== "/api/osm/cherry") return false;
    const requestId = `osm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startAt = Date.now();
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
        overpassCacheOptions,
        logContext: {
          requestId,
          enabled: Boolean(overpassLogOptions?.enabled),
          detail: Boolean(overpassLogOptions?.detail)
        }
      });
      if (overpassLogOptions?.enabled && overpassLogOptions?.detail) {
        console.info(
          `[overpass][${requestId}] api_complete status=200 elapsed_ms=${Date.now() - startAt} total=${result.meta?.total ?? 0}`
        );
      }
      return sendJson(res, 200, result);
    } catch (error) {
      if (overpassLogOptions?.enabled) {
        console.error(
          `[overpass][${requestId}] api_error status=500 elapsed_ms=${Date.now() - startAt} message=${error.message}`
        );
      }
      return sendJson(res, 500, { error: "osm_proxy_error", message: error.message });
    }
  };
}

module.exports = {
  createOsmHandler
};
