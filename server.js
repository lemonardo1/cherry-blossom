const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SPOTS_FILE = path.join(DATA_DIR, "spots.json");
const CURATED_FILE = path.join(DATA_DIR, "cherry-curated.json");

const sessions = new Map();
const osmCache = new Map();

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await writeIfMissing(USERS_FILE, "[]");
  await writeIfMissing(SPOTS_FILE, "[]");
  await writeIfMissing(CURATED_FILE, "[]");
}

async function writeIfMissing(file, fallback) {
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, fallback, "utf8");
  }
}

async function readJson(file) {
  const text = await fs.readFile(file, "utf8");
  return JSON.parse(text);
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(
    raw
      .split(";")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => {
        const idx = v.indexOf("=");
        if (idx < 0) return [v, ""];
        return [v.slice(0, idx), decodeURIComponent(v.slice(idx + 1))];
      })
  );
}

function setSessionCookie(res, token) {
  const cookie = `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`;
  res.setHeader("Set-Cookie", cookie);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

async function parseBody(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function makeId() {
  return crypto.randomBytes(12).toString("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, oldHash] = (stored || "").split(":");
  if (!salt || !oldHash) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(oldHash, "hex"));
}

async function authUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.session;
  if (!token || !sessions.has(token)) return null;
  const userId = sessions.get(token);
  const users = await readJson(USERS_FILE);
  return users.find((u) => u.id === userId) || null;
}

function sanitizeUser(user) {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      runtime: "node",
      node: process.version,
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    let body;
    try {
      body = await parseBody(req);
    } catch {
      return sendJson(res, 400, { error: "invalid_json" });
    }

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "").trim() || "사용자";

    if (!email || !password || password.length < 6) {
      return sendJson(res, 400, { error: "invalid_input", message: "email/password(6+) 필요" });
    }

    const users = await readJson(USERS_FILE);
    if (users.some((u) => u.email === email)) {
      return sendJson(res, 409, { error: "email_exists" });
    }

    const user = {
      id: makeId(),
      email,
      name,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    };
    users.push(user);
    await writeJson(USERS_FILE, users);

    const token = makeId();
    sessions.set(token, user.id);
    setSessionCookie(res, token);
    return sendJson(res, 201, { user: sanitizeUser(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    let body;
    try {
      body = await parseBody(req);
    } catch {
      return sendJson(res, 400, { error: "invalid_json" });
    }

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const users = await readJson(USERS_FILE);
    const user = users.find((u) => u.email === email);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return sendJson(res, 401, { error: "invalid_credentials" });
    }

    const token = makeId();
    sessions.set(token, user.id);
    setSessionCookie(res, token);
    return sendJson(res, 200, { user: sanitizeUser(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const cookies = parseCookies(req);
    if (cookies.session) sessions.delete(cookies.session);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = await authUser(req);
    return sendJson(res, 200, { user: user ? sanitizeUser(user) : null });
  }

  if (req.method === "GET" && url.pathname === "/api/spots") {
    const user = await authUser(req);
    const mine = url.searchParams.get("mine") === "1";
    const spots = await readJson(SPOTS_FILE);
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

    const spots = await readJson(SPOTS_FILE);
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
    await writeJson(SPOTS_FILE, spots);
    return sendJson(res, 201, { spot });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/spots/")) {
    const user = await authUser(req);
    if (!user) return sendJson(res, 401, { error: "auth_required" });
    const id = url.pathname.split("/").pop();
    const spots = await readJson(SPOTS_FILE);
    const idx = spots.findIndex((s) => s.id === id && s.userId === user.id);
    if (idx < 0) return sendJson(res, 404, { error: "not_found" });
    spots.splice(idx, 1);
    await writeJson(SPOTS_FILE, spots);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/osm/cherry") {
    try {
      const bboxRaw = url.searchParams.get("bbox");
      const hasBbox = Boolean(bboxRaw);
      const bbox = hasBbox ? parseBbox(bboxRaw) : null;
      const query = hasBbox
        ? buildBboxQuery(bbox)
        : buildKoreaAreaQuery();
      const roundedKey = hasBbox ? bboxToRoundedKey(bbox) : "korea";
      const ttlMs = hasBbox ? 5 * 60 * 1000 : 30 * 60 * 1000;
      const overpassData = await fetchOverpassCached(query, roundedKey, ttlMs);

      const curated = await readJson(CURATED_FILE);
      const spots = await readJson(SPOTS_FILE);
      const curatedElements = curated
        .filter((p) => isInsideBbox(p, bbox))
        .map((p) => ({
          type: "node",
          id: `curated-${p.id}`,
          lat: p.lat,
          lon: p.lon,
          tags: {
            name: p.name,
            source: "curated",
            region: p.region,
            "cherry:type": "curated"
          }
        }));
      const communityElements = spots
        .filter((p) => isInsideBbox(p, bbox))
        .map((p) => ({
          type: "node",
          id: `community-${p.id}`,
          lat: p.lat,
          lon: p.lon,
          tags: {
            name: p.name,
            source: "community",
            memo: p.memo || "",
            "cherry:type": "community"
          }
        }));

      const merged = dedupeElements([
        ...(overpassData.elements || []),
        ...curatedElements,
        ...communityElements
      ]);

      return sendJson(res, 200, {
        elements: merged,
        meta: {
          overpass: (overpassData.elements || []).length,
          curated: curatedElements.length,
          community: communityElements.length,
          total: merged.length,
          cached: overpassData.cached
        }
      });
    } catch (error) {
      return sendJson(res, 500, { error: "osm_proxy_error", message: error.message });
    }
  }

  return false;
}

function buildKoreaAreaQuery() {
  return `
[out:json][timeout:120];
area["ISO3166-1"="KR"][admin_level=2]->.kr;
(
  node(area.kr)[natural=tree][genus~"prunus|cerasus",i];
  node(area.kr)[natural=tree][species~"prunus|serrulata|yedoensis|jamasakura|subhirtella",i];
  node(area.kr)[natural=tree]["species:ko"~"벚",i];
  node(area.kr)[natural=tree][name~"벚|cherry",i];
  node(area.kr)[tourism=attraction][name~"벚꽃|cherry",i];
  node(area.kr)[leisure=park][name~"벚|cherry",i];
  way(area.kr)[leisure=park][name~"벚|cherry",i];
  way(area.kr)[highway][name~"벚꽃|벚나무|cherry",i];
  way(area.kr)[landuse=orchard][trees~"cherry|벚",i];
  relation(area.kr)[leisure=park][name~"벚|cherry",i];
  relation(area.kr)[route][name~"벚꽃|cherry",i];
  relation(area.kr)[tourism=attraction][name~"벚꽃|cherry",i];
);
out center tags;
  `.trim();
}

function buildBboxQuery(bboxObj) {
  const bbox = `${bboxObj.minLat},${bboxObj.minLon},${bboxObj.maxLat},${bboxObj.maxLon}`;
  return `
[out:json][timeout:50];
(
  node[natural=tree][genus~"prunus|cerasus",i](${bbox});
  node[natural=tree][species~"prunus|serrulata|yedoensis|jamasakura|subhirtella",i](${bbox});
  node[natural=tree]["species:ko"~"벚",i](${bbox});
  node[natural=tree][name~"벚|cherry",i](${bbox});
  node[tourism=attraction][name~"벚꽃|cherry",i](${bbox});
  node[leisure=park][name~"벚|cherry",i](${bbox});
  way[leisure=park][name~"벚|cherry",i](${bbox});
  way[highway][name~"벚꽃|벚나무|cherry",i](${bbox});
  way[landuse=orchard][trees~"cherry|벚",i](${bbox});
  relation[leisure=park][name~"벚|cherry",i](${bbox});
  relation[route][name~"벚꽃|cherry",i](${bbox});
  relation[tourism=attraction][name~"벚꽃|cherry",i](${bbox});
);
out center tags;
  `.trim();
}

function parseBbox(raw) {
  const nums = raw.split(",").map(Number);
  if (nums.length !== 4 || nums.some(Number.isNaN)) throw new Error("invalid_bbox");
  const [minLon, minLat, maxLon, maxLat] = nums;
  if (minLon >= maxLon || minLat >= maxLat) throw new Error("invalid_bbox_range");
  return { minLon, minLat, maxLon, maxLat };
}

function bboxToRoundedKey(bbox) {
  return [
    bbox.minLon.toFixed(2),
    bbox.minLat.toFixed(2),
    bbox.maxLon.toFixed(2),
    bbox.maxLat.toFixed(2)
  ].join(",");
}

function isInsideBbox(point, bbox) {
  if (!bbox) return true;
  return (
    point.lon >= bbox.minLon &&
    point.lon <= bbox.maxLon &&
    point.lat >= bbox.minLat &&
    point.lat <= bbox.maxLat
  );
}

async function fetchOverpassCached(query, cacheKey, ttlMs) {
  const key = `osm:${cacheKey}`;
  const now = Date.now();
  const cached = osmCache.get(key);
  if (cached && cached.expiresAt > now) {
    return { elements: cached.elements, cached: true };
  }

  const body = new URLSearchParams({ data: query });
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body
  });
  if (!response.ok) {
    throw new Error(`overpass_failed_${response.status}`);
  }
  const data = await response.json();
  const elements = data.elements || [];
  osmCache.set(key, { elements, expiresAt: now + ttlMs });
  return { elements, cached: false };
}

function dedupeElements(elements) {
  const seen = new Set();
  const out = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const name = String(el.tags?.name || "").trim().toLowerCase().replace(/\s+/g, " ");
    const key = `${lat.toFixed(4)}:${lon.toFixed(4)}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(el);
  }
  return out;
}

async function serveStatic(req, res, url) {
  let filePath = path.join(PUBLIC_DIR, decodeURIComponent(url.pathname));
  if (url.pathname === "/") filePath = path.join(PUBLIC_DIR, "index.html");

  if (!filePath.startsWith(PUBLIC_DIR)) {
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

async function main() {
  await ensureDataFiles();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (handled !== false) return;
      return sendJson(res, 404, { error: "not_found" });
    }

    return serveStatic(req, res, url);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
