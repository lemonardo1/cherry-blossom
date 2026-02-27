const fs = require("node:fs/promises");
const path = require("node:path");
const { sendText } = require("../lib/http");

async function serveStatic(res, url, publicDir) {
  let filePath = path.join(publicDir, decodeURIComponent(url.pathname));
  if (url.pathname === "/") filePath = path.join(publicDir, "index.html");

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    const ext = path.extname(filePath).toLowerCase();
    const type =
      {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg"
      }[ext] || "application/octet-stream";

    const content = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  } catch {
    sendText(res, 404, "Not Found");
  }
}

module.exports = {
  serveStatic
};
