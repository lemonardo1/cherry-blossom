const { parseBody, sendJson } = require("../../lib/http");
const { makeId } = require("../../lib/auth");

function createSpotsHandler({ spotsFile, reportsFile, readJson, writeJson, authUser }) {
  return async function handleSpots(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/spots") {
      const user = await authUser(req);
      const mine = url.searchParams.get("mine") === "1";
      const data = await readJson(spotsFile, { mine, userId: user?.id || null });
      return sendJson(res, 200, { spots: data });
    }

    if (req.method === "POST" && url.pathname === "/api/spots") {
      const user = await authUser(req);
      if (!user) return sendJson(res, 401, { error: "auth_required" });

      let body;
      try {
        body = await parseBody(req);
      } catch {
        return sendJson(res, 400, { error: "invalid_json" });
      }

      const name = String(body.name || "").trim();
      const lat = Number(body.lat);
      const lon = Number(body.lon);
      const memo = String(body.memo || "").trim().slice(0, 400);
      if (!name || Number.isNaN(lat) || Number.isNaN(lon)) {
        return sendJson(res, 400, { error: "invalid_input" });
      }

      const spot = {
        id: makeId(),
        userId: user.id,
        name,
        lat,
        lon,
        memo,
        createdAt: new Date().toISOString()
      };
      await writeJson(spotsFile, spot);

      await writeJson(reportsFile, {
        id: makeId(),
        userId: user.id,
        spotId: spot.id,
        name: spot.name,
        lat: spot.lat,
        lon: spot.lon,
        memo: spot.memo,
        status: "approved",
        createdAt: spot.createdAt,
        updatedAt: spot.createdAt
      });

      return sendJson(res, 201, { spot });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/spots/")) {
      const user = await authUser(req);
      if (!user) return sendJson(res, 401, { error: "auth_required" });
      const id = url.pathname.split("/").pop();
      const removed = await writeJson(spotsFile, {
        op: "deleteByUserAndId",
        spotId: id,
        userId: user.id
      });
      if (!removed) return sendJson(res, 404, { error: "not_found" });

      await writeJson(reportsFile, {
        op: "deleteBySpotAndUser",
        spotId: removed.id,
        userId: user.id
      });

      return sendJson(res, 200, { ok: true });
    }

    return false;
  };
}

module.exports = {
  createSpotsHandler
};
