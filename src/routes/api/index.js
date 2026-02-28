const { parseCookies } = require("../../lib/http");
const { createAuthHandler } = require("./auth");
const { createSpotsHandler } = require("./spots");
const { createReportsHandler } = require("./reports");
const { createAdminCherrySpotsHandler } = require("./admin-cherry-spots");
const { createOsmHandler } = require("./osm");
const { handleHealth } = require("./health");

function createApiHandler({
  usersFile,
  spotsFile,
  curatedFile,
  reportsFile,
  overpassEndpoints,
  db
}) {
  const sessions = new Map();

  async function authUser(req) {
    const cookies = parseCookies(req);
    const token = cookies.session;
    if (!token || !sessions.has(token)) return null;
    const userId = sessions.get(token);
    return db.getUserById(userId);
  }

  async function readJson(resource, opts = {}) {
    if (resource === usersFile) return db.getUserByEmail(opts.email || "");
    if (resource === spotsFile) return db.listSpots({ mine: Boolean(opts.mine), userId: opts.userId || null });
    if (resource === reportsFile) {
      return db.listReports({
        mine: Boolean(opts.mine),
        userId: opts.userId || null,
        status: opts.status || ""
      });
    }
    throw new Error(`unsupported_resource_read:${resource}`);
  }

  async function writeJson(resource, payload) {
    if (resource === usersFile) return db.createUser(payload);
    if (resource === spotsFile) {
      if (payload?.op === "deleteByUserAndId") {
        return db.deleteSpotByIdForUser({ spotId: payload.spotId, userId: payload.userId });
      }
      return db.createSpot(payload);
    }
    if (resource === reportsFile) {
      if (payload?.op === "deleteBySpotAndUser") {
        return db.deleteReportsBySpotForUser({ spotId: payload.spotId, userId: payload.userId });
      }
      if (payload?.op === "updateStatusByUser") {
        return db.updateReportStatusByUser({
          id: payload.id,
          userId: payload.userId,
          status: payload.status,
          updatedAt: payload.updatedAt
        });
      }
      return db.createReport(payload);
    }
    throw new Error(`unsupported_resource_write:${resource}`);
  }

  const handlers = [
    handleHealth,
    createAuthHandler({
      usersFile,
      readJson,
      writeJson,
      sessions,
      authUser,
      hasAdminUser: db.hasAdminUser
    }),
    createSpotsHandler({ spotsFile, reportsFile, readJson, writeJson, authUser }),
    createReportsHandler({ reportsFile, readJson, writeJson, authUser }),
    createAdminCherrySpotsHandler({ authUser, db }),
    createOsmHandler({
      curatedFile,
      db,
      overpassEndpoints
    })
  ];

  return async function handleApi(req, res, url) {
    for (const handler of handlers) {
      const handled = await handler(req, res, url);
      if (handled !== false) return handled;
    }
    return false;
  };
}

module.exports = {
  createApiHandler
};
