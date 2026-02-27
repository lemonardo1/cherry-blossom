const { parseCookies } = require("../../lib/http");
const { readJson, writeJson } = require("../../lib/file-db");
const { createAuthHandler } = require("./auth");
const { createSpotsHandler } = require("./spots");
const { createReportsHandler } = require("./reports");
const { createOsmHandler } = require("./osm");
const { handleHealth } = require("./health");

function createApiHandler({
  usersFile,
  spotsFile,
  curatedFile,
  reportsFile,
  overpassCacheFile,
  placesFile,
  overpassEndpoints
}) {
  const sessions = new Map();

  async function authUser(req) {
    const cookies = parseCookies(req);
    const token = cookies.session;
    if (!token || !sessions.has(token)) return null;
    const userId = sessions.get(token);
    const users = await readJson(usersFile);
    return users.find((u) => u.id === userId) || null;
  }

  const handlers = [
    handleHealth,
    createAuthHandler({ usersFile, readJson, writeJson, sessions, authUser }),
    createSpotsHandler({ spotsFile, reportsFile, readJson, writeJson, authUser }),
    createReportsHandler({ reportsFile, readJson, writeJson, authUser }),
    createOsmHandler({
      curatedFile,
      reportsFile,
      overpassCacheFile,
      placesFile,
      readJson,
      writeJson,
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
