const { parseBody, sendJson } = require("../../lib/http");
const { makeId } = require("../../lib/auth");

function createReportsHandler({ reportsFile, readJson, writeJson, authUser }) {
  return async function handleReports(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/reports") {
      const user = await authUser(req);
      const mine = url.searchParams.get("mine") === "1";
      const status = String(url.searchParams.get("status") || "").trim();
      const reports = await readJson(reportsFile);
      let data = reports;
      if (mine) {
        if (!user) return sendJson(res, 401, { error: "auth_required" });
        data = reports.filter((r) => r.userId === user.id);
      } else {
        data = reports.filter((r) => r.status === "approved");
      }
      if (status) data = data.filter((r) => r.status === status);
      return sendJson(res, 200, { reports: data });
    }

    if (req.method === "POST" && url.pathname === "/api/reports") {
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

      const now = new Date().toISOString();
      const report = {
        id: makeId(),
        userId: user.id,
        name,
        lat,
        lon,
        memo,
        status: "pending",
        createdAt: now,
        updatedAt: now
      };
      const reports = await readJson(reportsFile);
      reports.push(report);
      await writeJson(reportsFile, reports);
      return sendJson(res, 201, { report });
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/api/reports/")) {
      const user = await authUser(req);
      if (!user) return sendJson(res, 401, { error: "auth_required" });
      const id = url.pathname.split("/").pop();
      let body;
      try {
        body = await parseBody(req);
      } catch {
        return sendJson(res, 400, { error: "invalid_json" });
      }

      const nextStatus = String(body.status || "").trim();
      if (!["pending", "approved", "rejected"].includes(nextStatus)) {
        return sendJson(res, 400, { error: "invalid_status" });
      }

      const reports = await readJson(reportsFile);
      const idx = reports.findIndex((r) => r.id === id);
      if (idx < 0) return sendJson(res, 404, { error: "not_found" });
      if (reports[idx].userId !== user.id) return sendJson(res, 403, { error: "forbidden" });
      reports[idx] = { ...reports[idx], status: nextStatus, updatedAt: new Date().toISOString() };
      await writeJson(reportsFile, reports);
      return sendJson(res, 200, { report: reports[idx] });
    }

    return false;
  };
}

module.exports = {
  createReportsHandler
};
