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
  const region = String(body.region || "").trim().slice(0, 100);
  const memo = String(body.memo || "").trim().slice(0, 400);
  const statusRaw = String(body.status || "active").trim().toLowerCase();
  const status = statusRaw === "inactive" ? "inactive" : "active";
  const rawPoints = Array.isArray(body.points) ? body.points : [{ lat: body.lat, lon: body.lon }];
  const points = rawPoints
    .map((point) => ({
      lat: Number(point?.lat),
      lon: Number(point?.lon)
    }))
    .filter((point) => isValidCoord(point.lat, point.lon));
  if (!name || !points.length) return null;
  return { name, region, memo, status, points };
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
    console.info(`[admin_spot] method=${req.method} path=${url.pathname} user_id=${user.id}`);

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
      const spotsToCreate = parsed.points.map((point) => ({
        id: makeId(),
        name: parsed.name,
        lat: point.lat,
        lon: point.lon,
        region: parsed.region,
        memo: parsed.memo,
        status: parsed.status,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now
      }));
      const spots = spotsToCreate.length === 1
        ? [await db.createInternalCherrySpot(spotsToCreate[0])]
        : await db.createInternalCherrySpots(spotsToCreate);
      await db.clearGeoCache();
      console.info(
        `[admin_spot] created count=${spots.length} name=${parsed.name} created_by=${user.id}`
      );
      return sendJson(res, 201, { spot: spots[0], spots });
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
