const { parseBody, sendJson } = require("../../lib/http");
const { makeId } = require("../../lib/auth");

function isValidCoord(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function parseSpotInput(body) {
  const name = String(body.name || "").trim();
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const region = String(body.region || "").trim().slice(0, 100);
  const memo = String(body.memo || "").trim().slice(0, 400);
  const statusRaw = String(body.status || "active").trim().toLowerCase();
  const status = statusRaw === "inactive" ? "inactive" : "active";
  if (!name || !isValidCoord(lat, lon)) return null;
  return { name, lat, lon, region, memo, status };
}

function createAdminCherrySpotsHandler({
  authUser,
  db
}) {
  return async function handleAdminCherrySpots(req, res, url) {
    if (!url.pathname.startsWith("/api/admin/cherry-spots")) return false;

    const user = await authUser(req);
    if (!user) return sendJson(res, 401, { error: "auth_required" });
    if (user.role !== "admin") return sendJson(res, 403, { error: "admin_required" });

    if (req.method === "GET" && url.pathname === "/api/admin/cherry-spots") {
      const status = String(url.searchParams.get("status") || "all").trim();
      const spots = await db.listInternalCherrySpots({ status });
      return sendJson(res, 200, { spots });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/cherry-spots") {
      let body;
      try {
        body = await parseBody(req);
      } catch {
        return sendJson(res, 400, { error: "invalid_json" });
      }
      const parsed = parseSpotInput(body);
      if (!parsed) return sendJson(res, 400, { error: "invalid_input" });
      const now = new Date().toISOString();
      const spot = await db.createInternalCherrySpot({
        id: makeId(),
        ...parsed,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now
      });
      await db.clearGeoCache();
      return sendJson(res, 201, { spot });
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/api/admin/cherry-spots/")) {
      const id = url.pathname.split("/").pop();
      let body;
      try {
        body = await parseBody(req);
      } catch {
        return sendJson(res, 400, { error: "invalid_json" });
      }
      const parsed = parseSpotInput(body);
      if (!parsed) return sendJson(res, 400, { error: "invalid_input" });
      const spot = await db.updateInternalCherrySpotById({
        id,
        ...parsed,
        updatedAt: new Date().toISOString()
      });
      if (!spot) return sendJson(res, 404, { error: "not_found" });
      await db.clearGeoCache();
      return sendJson(res, 200, { spot });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/cherry-spots/")) {
      const id = url.pathname.split("/").pop();
      const spot = await db.setInternalCherrySpotStatusById({
        id,
        status: "inactive",
        updatedAt: new Date().toISOString()
      });
      if (!spot) return sendJson(res, 404, { error: "not_found" });
      await db.clearGeoCache();
      return sendJson(res, 200, { spot });
    }

    return false;
  };
}

module.exports = {
  createAdminCherrySpotsHandler
};
