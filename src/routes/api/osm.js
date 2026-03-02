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
        zoomRaw: url.searchParams.get("zoom"),
        listCuratedCherrySpots: db.listCuratedCherrySpots,
        listInternalCherrySpots: db.listInternalCherrySpots,
        listOsmCherrySpots: db.listOsmCherrySpots,
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
        const elapsed = Date.now() - startAt;
        const completedAt = new Date().toISOString();
        console.info(
          `[overpass][${requestId}] api_complete status=200 elapsed_ms=${elapsed} completed_at=${completedAt} raw_total=${result.meta?.rawTotal ?? 0} deduped=${result.meta?.deduped ?? 0} total=${result.meta?.total ?? 0} source=${result.meta?.overpassSource || ""}`
        );
      }
      return sendJson(res, 200, result);
    } catch (error) {
      if (overpassLogOptions?.enabled) {
        const elapsed = Date.now() - startAt;
        const completedAt = new Date().toISOString();
        console.error(
          `[overpass][${requestId}] api_error status=500 elapsed_ms=${elapsed} completed_at=${completedAt} message=${error.message}`
        );
      }
      return sendJson(res, 500, { error: "osm_proxy_error", message: error.message });
    }
  };
}

module.exports = {
  createOsmHandler
};
