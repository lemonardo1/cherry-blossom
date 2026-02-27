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

function safeOverpassStore(raw) {
  if (!raw || typeof raw !== "object") return { entries: [] };
  if (!Array.isArray(raw.entries)) return { entries: [] };
  return raw;
}

function safePlacesStore(raw) {
  if (!raw || typeof raw !== "object") return { snapshots: {} };
  if (!raw.snapshots || typeof raw.snapshots !== "object") return { snapshots: {} };
  return raw;
}

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

function upsertCacheEntry(store, entry) {
  store.entries = store.entries.filter((item) => item.key !== entry.key);
  store.entries.push(entry);
}

async function revalidateCacheEntry({
  cacheKey,
  query,
  overpassEndpoints,
  overpassCacheFile,
  readJson,
  writeJson,
  ttlMs,
  staleTtlMs
}) {
  if (refreshInFlight.has(cacheKey)) return refreshInFlight.get(cacheKey);
  const task = (async () => {
    try {
      const fetched = await fetchOverpass({ query, endpoints: overpassEndpoints });
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const store = safeOverpassStore(await readJson(overpassCacheFile));
      const nextEntry = {
        key: cacheKey,
        updatedAt: nowIso,
        expiresAt: now + ttlMs,
        staleUntil: now + staleTtlMs,
        elements: fetched.elements || []
      };
      upsertCacheEntry(store, nextEntry);
      await writeJson(overpassCacheFile, store);
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
  readJson,
  writeJson,
  curatedFile,
  reportsFile,
  overpassCacheFile,
  placesFile,
  overpassEndpoints
}) {
  const hasBbox = Boolean(bboxRaw);
  const bbox = hasBbox ? parseBbox(bboxRaw) : null;
  const query = hasBbox ? buildBboxQuery(bbox) : buildKoreaAreaQuery();
  const roundedKey = hasBbox ? bboxToRoundedKey(bbox) : "korea";
  const { ttlMs, staleTtlMs } = getTtlPolicy(hasBbox);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const overpassStore = safeOverpassStore(await readJson(overpassCacheFile));
  const cachedEntry = overpassStore.entries.find((entry) => entry.key === roundedKey) || null;
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
      overpassCacheFile,
      readJson,
      writeJson,
      ttlMs,
      staleTtlMs
    }).catch(() => {});
  } else {
    try {
      const nextEntry = await revalidateCacheEntry({
        cacheKey: roundedKey,
        query,
        overpassEndpoints,
        overpassCacheFile,
        readJson,
        writeJson,
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

  const curated = asArray(await readJson(curatedFile));
  const reports = asArray(await readJson(reportsFile));
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
  const approvedReports = reports.filter((r) => r.status === "approved");
  const communityElements = approvedReports
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

  if (!overpassData.cached || overpassData.stale || !overpassData.error) {
    const placesStore = safePlacesStore(await readJson(placesFile));
    placesStore.snapshots[roundedKey] = {
      key: roundedKey,
      bbox: bbox || null,
      generatedAt: nowIso,
      elements: merged,
      meta: result.meta
    };
    await writeJson(placesFile, placesStore);
  }

  return result;
}

module.exports = {
  loadCherryElements
};
