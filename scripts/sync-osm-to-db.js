const db = require("../src/lib/db");
const { buildKoreaAreaQuery, dedupeElements, fetchOverpass } = require("../src/services/overpass");
const { OVERPASS_ENDPOINTS } = require("../src/config");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    args[key] = value;
  }
  return args;
}

function asBool(value, fallback) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeOsmElement(element) {
  const type = String(element?.type || "").trim();
  const id = String(element?.id || "").trim();
  const lat = Number(element?.lat ?? element?.center?.lat);
  const lon = Number(element?.lon ?? element?.center?.lon);
  if (!["node", "way", "relation"].includes(type)) return null;
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const tags = element?.tags && typeof element.tags === "object" ? element.tags : {};
  const name = String(tags.name || "").trim();

  return {
    osmKey: `${type}/${id}`,
    osmType: type,
    osmId: id,
    name,
    lat,
    lon,
    tags
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const deactivateMissing = asBool(args["deactivate-missing"], true);
  const dryRun = asBool(args["dry-run"], false);

  const query = buildKoreaAreaQuery();
  const logContext = { enabled: true, detail: true, requestId: `sync-${Date.now()}` };
  const fetched = await fetchOverpass({ query, endpoints: OVERPASS_ENDPOINTS, logContext });
  const deduped = dedupeElements(Array.isArray(fetched.elements) ? fetched.elements : []);
  const normalized = deduped
    .map(normalizeOsmElement)
    .filter(Boolean);

  await db.initSchema();

  if (dryRun) {
    const existing = await db.listOsmCherrySpots({ status: "all" });
    console.log(
      `[dry-run] fetched=${fetched.elements?.length || 0} deduped=${deduped.length} normalized=${normalized.length} existing=${existing.length}`
    );
    await db.closeDb();
    return;
  }

  const result = await db.upsertOsmCherrySpots(normalized, {
    syncedAt: new Date().toISOString(),
    deactivateMissing
  });
  await db.clearGeoCache();
  await db.closeDb();

  console.log(
    `[ok] fetched=${fetched.elements?.length || 0} deduped=${deduped.length} normalized=${normalized.length} upserted=${result.upserted} deactivated=${result.deactivated} deactivate_missing=${deactivateMissing}`
  );
}

main().catch(async (error) => {
  console.error(`[error] ${error.message}`);
  try {
    await db.closeDb();
  } catch {}
  process.exit(1);
});
