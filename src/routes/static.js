const fs = require("node:fs/promises");
const path = require("node:path");
const { sendText } = require("../lib/http");

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function getBaseUrl(req) {
  const envBase = trimTrailingSlash(process.env.PUBLIC_BASE_URL);
  if (envBase) return envBase;

  const forwardedProtoRaw = String(req.headers["x-forwarded-proto"] || "");
  const forwardedHostRaw = String(req.headers["x-forwarded-host"] || "");
  const proto = forwardedProtoRaw.split(",")[0].trim() || "http";
  const host = forwardedHostRaw.split(",")[0].trim() || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

function serveDynamicDiscovery(req, res, url) {
  const baseUrl = getBaseUrl(req);
  if (url.pathname === "/robots.txt") {
    sendText(
      res,
      200,
      `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`
    );
    return true;
  }

  if (url.pathname === "/sitemap.xml") {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/robots.txt</loc>
    <changefreq>monthly</changefreq>
    <priority>0.2</priority>
  </url>
  <url>
    <loc>${baseUrl}/llms.txt</loc>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${baseUrl}/api-discovery.json</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
</urlset>
`;
    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
    res.end(xml);
    return true;
  }

  if (url.pathname === "/api-discovery.json") {
    const payload = {
      name: "Cherry Atlas KR API",
      version: "1.0.0",
      description: "Korea cherry blossom map API discovery document",
      baseUrl,
      publicEndpoints: [
        { method: "GET", path: "/api/health", description: "Service health check" },
        {
          method: "GET",
          path: "/api/osm/cherry?bbox=minLon,minLat,maxLon,maxLat",
          description: "Cherry points in map bounds"
        },
        { method: "GET", path: "/api/reports", description: "Approved community reports" }
      ],
      authEndpoints: [
        "POST /api/auth/register",
        "POST /api/auth/login",
        "POST /api/auth/logout",
        "GET /api/auth/me",
        "GET /api/spots?mine=1",
        "POST /api/spots",
        "DELETE /api/spots/:id",
        "GET /api/reports?mine=1",
        "POST /api/reports",
        "PATCH /api/reports/:id"
      ]
    };
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload, null, 2));
    return true;
  }

  return false;
}

async function serveStatic(req, res, url, publicDir) {
  if (serveDynamicDiscovery(req, res, url)) return;
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
        ".txt": "text/plain; charset=utf-8",
        ".xml": "application/xml; charset=utf-8",
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
