const { parseBody, sendJson } = require("../../lib/http");
const { makeId } = require("../../lib/auth");

function createSpotsHandler({ spotsFile, reportsFile, readJson, writeJson, authUser }) {
  return async function handleSpots(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/spots") {
      const user = await authUser(req);
      const mine = url.searchParams.get("mine") === "1";
      const spots = await readJson(spotsFile);
      const data = mine && user ? spots.filter((s) => s.userId === user.id) : spots;
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

      const spots = await readJson(spotsFile);
      const spot = {
        id: makeId(),
        userId: user.id,
        name,
        lat,
        lon,
        memo,
        createdAt: new Date().toISOString()
      };
      spots.push(spot);
      await writeJson(spotsFile, spots);

      const reports = await readJson(reportsFile);
      reports.push({
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
      await writeJson(reportsFile, reports);

      return sendJson(res, 201, { spot });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/spots/")) {
      const user = await authUser(req);
      if (!user) return sendJson(res, 401, { error: "auth_required" });
      const id = url.pathname.split("/").pop();
      const spots = await readJson(spotsFile);
      const idx = spots.findIndex((s) => s.id === id && s.userId === user.id);
      if (idx < 0) return sendJson(res, 404, { error: "not_found" });
      const removed = spots[idx];
      spots.splice(idx, 1);
      await writeJson(spotsFile, spots);

      const reports = await readJson(reportsFile);
      const nextReports = reports.filter((r) => !(r.userId === user.id && r.spotId === removed.id));
      await writeJson(reportsFile, nextReports);

      return sendJson(res, 200, { ok: true });
    }

    return false;
  };
}

module.exports = {
  createSpotsHandler
};
