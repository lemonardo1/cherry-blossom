const {
  buildKoreaAreaQuery,
  buildBboxQuery,
  parseBbox,
  getBboxArea,
  bboxToRoundedKey,
  isInsideBbox,
  dedupeElements,
  fetchOverpass
} = require("./overpass");

const refreshInFlight = new Map();

function logOverpass(logContext, message, extra = {}) {
  if (!logContext?.enabled) return;
  if (
    logContext.detail === false &&
    !["request_complete", "revalidate_error", "cache_miss", "cache_fresh_hit", "cache_stale_hit"].includes(message)
  ) {
    return;
  }
  const rid = logContext.requestId || "n/a";
  const entries = Object.entries(extra).filter(([, value]) => value !== undefined);
  const suffix = entries.length
    ? ` ${entries.map(([key, value]) => `${key}=${String(value)}`).join(" ")}`
    : "";
  console.info(`[overpass][${rid}] ${message}${suffix}`);
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

function getOverpassCachePolicy(overpassCacheOptions, hasBbox) {
  const fallback = getTtlPolicy(hasBbox);
  if (!overpassCacheOptions || typeof overpassCacheOptions !== "object") return fallback;
  if (hasBbox) {
    return {
      ttlMs: overpassCacheOptions.bboxTtlMs || fallback.ttlMs,
      staleTtlMs: overpassCacheOptions.bboxStaleTtlMs || fallback.staleTtlMs
    };
  }
  return {
    ttlMs: overpassCacheOptions.koreaTtlMs || fallback.ttlMs,
    staleTtlMs: overpassCacheOptions.koreaStaleTtlMs || fallback.staleTtlMs
  };
}

function getStaleUntil(entry, staleTtlMs) {
  if (!entry) return 0;
  if (typeof entry.staleUntil === "number") return entry.staleUntil;
  if (typeof entry.expiresAt === "number") return entry.expiresAt + staleTtlMs;
  return 0;
}

function getSnapshotTtlMs(overpassCacheOptions) {
  const value = Number(overpassCacheOptions?.snapshotTtlMs);
  if (!Number.isFinite(value) || value <= 0) return 60 * 1000;
  return value;
}

function getSnapshotGeneratedAt(snapshot) {
  if (!snapshot?.generatedAt) return 0;
  const value = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(value)) return 0;
  return value;
}

function getMaxBboxArea(overpassCacheOptions) {
  const value = Number(overpassCacheOptions?.maxBboxArea);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

async function revalidateCacheEntry({
  cacheKey,
  query,
  overpassEndpoints,
  upsertOverpassCacheEntry,
  ttlMs,
  staleTtlMs,
  logContext
}) {
  if (refreshInFlight.has(cacheKey)) {
    const joinStartedAt = Date.now();
    logOverpass(logContext, "revalidate_join", { cache_key: cacheKey });
    const joinedEntry = await refreshInFlight.get(cacheKey);
    logOverpass(logContext, "revalidate_join_complete", {
      cache_key: cacheKey,
      wait_ms: Date.now() - joinStartedAt,
      elements: (joinedEntry?.elements || []).length
    });
    return joinedEntry;
  }
  const task = (async () => {
    try {
      logOverpass(logContext, "revalidate_start", {
        cache_key: cacheKey,
        query_bytes: query.length,
        ttl_ms: ttlMs,
        stale_ttl_ms: staleTtlMs
      });
      const fetched = await fetchOverpass({ query, endpoints: overpassEndpoints, logContext });
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
      logOverpass(logContext, "revalidate_saved", {
        cache_key: cacheKey,
        elements: nextEntry.elements.length,
        expires_at: nextEntry.expiresAt,
        stale_until: nextEntry.staleUntil
      });
      return nextEntry;
    } catch (error) {
      logOverpass(logContext, "revalidate_error", {
        cache_key: cacheKey,
        message: error.message || "unknown"
      });
      throw error;
    } finally {
      refreshInFlight.delete(cacheKey);
    }
  })();
  refreshInFlight.set(cacheKey, task);
  return task;
}

async function loadCherryElements({
  bboxRaw,
  zoomRaw,
  listCuratedCherrySpots,
  listInternalCherrySpots,
  listOsmCherrySpots,
  listApprovedReports,
  getOverpassCacheEntry,
  upsertOverpassCacheEntry,
  getPlaceSnapshot,
  upsertPlaceSnapshot,
  overpassEndpoints,
  overpassCacheOptions,
  logContext
}) {
  const startedAt = Date.now();
  const hasBbox = Boolean(bboxRaw);
  const bbox = hasBbox ? parseBbox(bboxRaw) : null;
  const zoom = Number(zoomRaw);
  const hasZoom = Number.isFinite(zoom);
  const CORE_MODE_MIN_ZOOM = 12;

  if (hasZoom && zoom < CORE_MODE_MIN_ZOOM) {
    const completedAt = new Date().toISOString();
    logOverpass(logContext, "request_complete", {
      elapsed_ms: Date.now() - startedAt,
      completed_at: completedAt,
      mode: "zoom_gate",
      zoom
    });
    return {
      elements: [],
      meta: {
        mode: "zoom_gate",
        minZoom: CORE_MODE_MIN_ZOOM,
        zoom,
        overpass: 0,
        curated: 0,
        internal: 0,
        community: 0,
        rawTotal: 0,
        deduped: 0,
        total: 0,
        cached: true,
        stale: false,
        revalidating: false,
        overpassSource: "disabled_by_zoom",
        overpassError: null,
        snapshotCached: false
      }
    };
  }

  if (hasZoom && zoom >= CORE_MODE_MIN_ZOOM) {
    const coreSpots = asArray(await listInternalCherrySpots({ status: "active", coreOnly: true, zoom }));
    const coreElements = coreSpots
      .filter((p) => isInsideBbox(p, bbox))
      .map((p) => ({
        type: "node",
        id: `internal-${p.id}`,
        lat: p.lat,
        lon: p.lon,
        tags: {
          name: p.name,
          source: "internal",
          region: p.region || "",
          memo: p.memo || "",
          category: p.category || "hub",
          priority: String(p.priority || 100),
          "cherry:type": "internal"
        }
      }));
    return {
      elements: coreElements,
      meta: {
        mode: "core_hubs",
        minZoom: CORE_MODE_MIN_ZOOM,
        zoom,
        overpass: 0,
        curated: 0,
        internal: coreElements.length,
        community: 0,
        rawTotal: coreElements.length,
        deduped: 0,
        total: coreElements.length,
        cached: true,
        stale: false,
        revalidating: false,
        overpassSource: "disabled_core_hubs",
        overpassError: null,
        snapshotCached: false
      }
    };
  }

  const maxBboxArea = getMaxBboxArea(overpassCacheOptions);
  const bboxArea = hasBbox ? getBboxArea(bbox) : 0;
  const skipOverpassForLargeBbox = Boolean(hasBbox && maxBboxArea > 0 && bboxArea > maxBboxArea);
  const query = hasBbox ? buildBboxQuery(bbox) : buildKoreaAreaQuery();
  const bboxKeyPrecision = overpassCacheOptions?.bboxKeyPrecision;
  const roundedKey = hasBbox ? bboxToRoundedKey(bbox, bboxKeyPrecision) : "korea";
  const { ttlMs, staleTtlMs } = getOverpassCachePolicy(overpassCacheOptions, hasBbox);
  const snapshotTtlMs = getSnapshotTtlMs(overpassCacheOptions);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const existingSnapshot = await getPlaceSnapshot(roundedKey);
  const snapshotGeneratedAt = getSnapshotGeneratedAt(existingSnapshot);
  const snapshotFresh = Boolean(existingSnapshot && snapshotGeneratedAt + snapshotTtlMs > now);

  if (snapshotFresh) {
    logOverpass(logContext, "snapshot_fresh_hit", {
      cache_key: roundedKey,
      generated_at: existingSnapshot.generatedAt,
      snapshot_ttl_ms: snapshotTtlMs
    });
    const snapshotElements = Array.isArray(existingSnapshot.elements) ? existingSnapshot.elements : [];
    const snapshotMeta = existingSnapshot.meta && typeof existingSnapshot.meta === "object" ? existingSnapshot.meta : {};
    return {
      elements: snapshotElements,
      meta: {
        ...snapshotMeta,
        total: snapshotElements.length,
        snapshotCached: true
      }
    };
  }

  const osmDbSpots = asArray(await listOsmCherrySpots({ bbox, status: "active" }));
  const osmDbElements = osmDbSpots
    .map((spot) => ({
      type: "node",
      id: `osmdb-${spot.osmKey}`,
      lat: spot.lat,
      lon: spot.lon,
      tags: {
        ...(spot.tags || {}),
        name: spot.name || spot.tags?.name || "",
        source: "osm_db",
        "cherry:type": "osm_db"
      }
    }))
    .filter((el) => Number.isFinite(el.lat) && Number.isFinite(el.lon));

  const cachedEntry = skipOverpassForLargeBbox ? null : await getOverpassCacheEntry(roundedKey);
  let overpassData;
  let overpassSource = "network";
  const expiresAt = cachedEntry?.expiresAt || 0;
  const staleUntil = getStaleUntil(cachedEntry, staleTtlMs);
  const freshCache = cachedEntry && typeof expiresAt === "number" && expiresAt > now;
  const staleCache = cachedEntry && !freshCache && typeof staleUntil === "number" && staleUntil > now;

  logOverpass(logContext, "request_start", {
    mode: hasBbox ? "bbox" : "korea",
    cache_key: roundedKey,
    bbox: bboxRaw || "",
    query_bytes: query.length,
    cache_hit: Boolean(cachedEntry),
    fresh_cache: Boolean(freshCache),
    stale_cache: Boolean(staleCache),
    osm_db_count: osmDbElements.length
  });

  if (osmDbElements.length > 0) {
    overpassSource = "osm_db_short_circuit";
    overpassData = {
      elements: osmDbElements,
      cached: true,
      stale: false,
      revalidating: false,
      error: null
    };
  } else if (skipOverpassForLargeBbox) {
    overpassSource = "bbox_rejected";
    logOverpass(logContext, "bbox_rejected", {
      cache_key: roundedKey,
      bbox_area: bboxArea,
      max_bbox_area: maxBboxArea
    });
    overpassData = {
      elements: [],
      cached: true,
      stale: false,
      revalidating: false,
      error: "bbox_too_large"
    };
  } else if (freshCache) {
    overpassSource = "cache_fresh";
    logOverpass(logContext, "cache_fresh_hit", {
      cache_key: roundedKey,
      elements: (cachedEntry?.elements || []).length,
      expires_at: expiresAt
    });
    overpassData = { elements: cachedEntry.elements || [], cached: true, stale: false, revalidating: false, error: null };
  } else if (staleCache) {
    overpassSource = "cache_stale_revalidate";
    logOverpass(logContext, "cache_stale_hit", {
      cache_key: roundedKey,
      elements: (cachedEntry?.elements || []).length,
      stale_until: staleUntil
    });
    overpassData = { elements: cachedEntry.elements || [], cached: true, stale: true, revalidating: true, error: null };
    void revalidateCacheEntry({
      cacheKey: roundedKey,
      query,
      overpassEndpoints,
      upsertOverpassCacheEntry,
      ttlMs,
      staleTtlMs,
      logContext
    }).catch(() => {});
  } else {
    try {
      overpassSource = "network_revalidate";
      logOverpass(logContext, "cache_miss", { cache_key: roundedKey });
      const nextEntry = await revalidateCacheEntry({
        cacheKey: roundedKey,
        query,
        overpassEndpoints,
        upsertOverpassCacheEntry,
        ttlMs,
        staleTtlMs,
        logContext
      });
      overpassData = { elements: nextEntry.elements || [], cached: false, stale: false, revalidating: false, error: null };
    } catch (error) {
      overpassSource = "network_error";
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

  const curated = asArray(await listCuratedCherrySpots());
  const reports = asArray(await listApprovedReports());
  const internalSpots = asArray(await listInternalCherrySpots({ status: "active" }));
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
  const internalElements = internalSpots
    .filter((p) => isInsideBbox(p, bbox))
    .map((p) => ({
      type: "node",
      id: `internal-${p.id}`,
      lat: p.lat,
      lon: p.lon,
      tags: {
        name: p.name,
        source: "internal",
        region: p.region || "",
        memo: p.memo || "",
        "cherry:type": "internal"
      }
    }));

  const mergedInput = [
    ...(overpassData.elements || []),
    ...curatedElements,
    ...internalElements,
    ...communityElements
  ];
  const merged = dedupeElements(mergedInput);
  const dedupedCount = Math.max(0, mergedInput.length - merged.length);

  const result = {
    elements: merged,
    meta: {
      overpass: (overpassData.elements || []).length,
      curated: curatedElements.length,
      internal: internalElements.length,
      community: communityElements.length,
      rawTotal: mergedInput.length,
      deduped: dedupedCount,
      total: merged.length,
      cached: overpassData.cached,
      stale: overpassData.stale,
      revalidating: overpassData.revalidating,
      overpassSource,
      overpassError: overpassData.error || null,
      snapshotCached: false
    }
  };

  const shouldWriteSnapshot = !existingSnapshot || !overpassData.cached || overpassData.stale;
  const shouldSkipSnapshotOnOverpassFailure =
    Boolean(overpassData.error) && (overpassData.elements || []).length === 0;
  if (shouldWriteSnapshot && !shouldSkipSnapshotOnOverpassFailure) {
    logOverpass(logContext, "snapshot_upsert", {
      cache_key: roundedKey,
      reason: !existingSnapshot ? "first_write" : (overpassData.stale ? "stale_refresh" : "cache_miss_refresh"),
      raw_total: result.meta.rawTotal,
      deduped: result.meta.deduped,
      total: result.meta.total
    });
    await upsertPlaceSnapshot({
      key: roundedKey,
      bbox: bbox || null,
      generatedAt: nowIso,
      elements: merged,
      meta: result.meta
    });
  } else if (shouldWriteSnapshot && shouldSkipSnapshotOnOverpassFailure) {
    logOverpass(logContext, "snapshot_skip", {
      cache_key: roundedKey,
      reason: "overpass_failed_with_empty_result",
      overpass_error: overpassData.error || ""
    });
  }

  const completedAt = new Date().toISOString();
  logOverpass(logContext, "request_complete", {
    cache_key: roundedKey,
    elapsed_ms: Date.now() - startedAt,
    completed_at: completedAt,
    overpass: result.meta.overpass,
    curated: result.meta.curated,
    internal: result.meta.internal,
    community: result.meta.community,
    raw_total: result.meta.rawTotal,
    deduped: result.meta.deduped,
    total: result.meta.total,
    cached: result.meta.cached,
    stale: result.meta.stale,
    revalidating: result.meta.revalidating,
    overpass_source: result.meta.overpassSource,
    overpass_error: result.meta.overpassError || ""
  });

  return result;
}

module.exports = {
  loadCherryElements
};
