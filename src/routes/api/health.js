const { sendJson } = require("../../lib/http");

async function handleHealth(req, res, url) {
  if (req.method !== "GET" || url.pathname !== "/api/health") return false;
  return sendJson(res, 200, {
    ok: true,
    runtime: "node",
    node: process.version,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  handleHealth
};
