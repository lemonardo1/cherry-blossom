const fs = require("node:fs/promises");
const {
  buildKoreaAreaQuery,
  buildBboxQuery,
  parseBbox,
  bboxToRoundedKey,
  isInsideBbox,
  dedupeElements,
  fetchOverpass
} = require("./overpass");

const refreshInFlight = new Map();

function asCommunityElement(report) {
  return {
    type: "node",
    id: `report-${report.id}`,
    lat: report.lat,
    lon: report.lon,
    tags: {
      name: report.name,
      source: "community",
      memo: report.memo || "",
      "cherry:type": "community"
    }
  };
}

function asArray(raw) {
  return Array.isArray(raw) ? raw : [];
}

async function readJsonArray(file) {
  const text = await fs.readFile(file, "utf8");
  const parsed = JSON.parse(text);
  return asArray(parsed);
}

function getTtlPolicy(hasBbox) {
  return hasBbox
    ? { ttlMs: 5 * 60 * 1000, staleTtlMs: 24 * 60 * 60 * 1000 }
    : { ttlMs: 30 * 60 * 1000, staleTtlMs: 7 * 24 * 60 * 60 * 1000 };
}

function getStaleUntil(entry, staleTtlMs) {
  if (!entry) return 0;
  if (typeof entry.staleUntil === "number") return entry.staleUntil;
  if (typeof entry.expiresAt === "number") return entry.expiresAt + staleTtlMs;
  return 0;
}

async function revalidateCacheEntry({
  cacheKey,
  query,
  overpassEndpoints,
  upsertOverpassCacheEntry,
  ttlMs,
  staleTtlMs
}) {
  if (refreshInFlight.has(cacheKey)) return refreshInFlight.get(cacheKey);
  const task = (async () => {
    try {
      const fetched = await fetchOverpass({ query, endpoints: overpassEndpoints });
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const nextEntry = {
        key: cacheKey,
        updatedAt: nowIso,
        expiresAt: now + ttlMs,
        staleUntil: now + staleTtlMs,
        elements: fetched.elements || []
      };
      await upsertOverpassCacheEntry(nextEntry);
      return nextEntry;
    } finally {
      refreshInFlight.delete(cacheKey);
    }
  })();
  refreshInFlight.set(cacheKey, task);
  return task;
}

async function loadCherryElements({
  bboxRaw,
  curatedFile,
  listApprovedReports,
  getOverpassCacheEntry,
  upsertOverpassCacheEntry,
  getPlaceSnapshot,
  upsertPlaceSnapshot,
  overpassEndpoints
}) {
  const hasBbox = Boolean(bboxRaw);
  const bbox = hasBbox ? parseBbox(bboxRaw) : null;
  const query = hasBbox ? buildBboxQuery(bbox) : buildKoreaAreaQuery();
  const roundedKey = hasBbox ? bboxToRoundedKey(bbox) : "korea";
  const { ttlMs, staleTtlMs } = getTtlPolicy(hasBbox);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const cachedEntry = await getOverpassCacheEntry(roundedKey);
  let overpassData;
  const expiresAt = cachedEntry?.expiresAt || 0;
  const staleUntil = getStaleUntil(cachedEntry, staleTtlMs);
  const freshCache = cachedEntry && typeof expiresAt === "number" && expiresAt > now;
  const staleCache = cachedEntry && typeof staleUntil === "number" && staleUntil > now;

  if (freshCache) {
    overpassData = { elements: cachedEntry.elements || [], cached: true, stale: false, revalidating: false, error: null };
  } else if (staleCache) {
    overpassData = { elements: cachedEntry.elements || [], cached: true, stale: true, revalidating: true, error: null };
    void revalidateCacheEntry({
      cacheKey: roundedKey,
      query,
      overpassEndpoints,
      upsertOverpassCacheEntry,
      ttlMs,
      staleTtlMs
    }).catch(() => {});
  } else {
    try {
      const nextEntry = await revalidateCacheEntry({
        cacheKey: roundedKey,
        query,
        overpassEndpoints,
        upsertOverpassCacheEntry,
        ttlMs,
        staleTtlMs
      });
      overpassData = { elements: nextEntry.elements || [], cached: false, stale: false, revalidating: false, error: null };
    } catch (error) {
      if (cachedEntry) {
        overpassData = {
          elements: cachedEntry.elements || [],
          cached: true,
          stale: true,
          revalidating: false,
          error: error.message || "overpass_unavailable"
        };
      } else {
        overpassData = {
          elements: [],
          cached: false,
          stale: false,
          revalidating: false,
          error: error.message || "overpass_unavailable"
        };
      }
    }
  }

  const curated = await readJsonArray(curatedFile);
  const reports = asArray(await listApprovedReports());
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
  const communityElements = reports
    .filter((p) => isInsideBbox(p, bbox))
    .map(asCommunityElement);

  const merged = dedupeElements([
    ...(overpassData.elements || []),
    ...curatedElements,
    ...communityElements
  ]);

  const result = {
    elements: merged,
    meta: {
      overpass: (overpassData.elements || []).length,
      curated: curatedElements.length,
      community: communityElements.length,
      total: merged.length,
      cached: overpassData.cached,
      stale: overpassData.stale,
      revalidating: overpassData.revalidating,
      overpassError: overpassData.error || null
    }
  };

  const existingSnapshot = await getPlaceSnapshot(roundedKey);
  const shouldWriteSnapshot = !existingSnapshot || !overpassData.cached || overpassData.stale;
  if (shouldWriteSnapshot) {
    await upsertPlaceSnapshot({
      key: roundedKey,
      bbox: bbox || null,
      generatedAt: nowIso,
      elements: merged,
      meta: result.meta
    });
  }

  return result;
}

module.exports = {
  loadCherryElements
};
