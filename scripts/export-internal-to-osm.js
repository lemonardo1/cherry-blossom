const fs = require("node:fs/promises");
const path = require("node:path");
const db = require("../src/lib/db");

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

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toGeoJson(spots) {
  return {
    type: "FeatureCollection",
    features: spots.map((spot) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [spot.lon, spot.lat]
      },
      properties: {
        internal_id: spot.id,
        name: spot.name,
        region: spot.region || "",
        note: spot.memo || "",
        source: "local_survey",
        natural: "tree",
        genus: "Prunus"
      }
    }))
  };
}

function toOsmXml(spots) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<osm version="0.6" generator="cherry-blossom-export">');

  let tempId = -1;
  for (const spot of spots) {
    lines.push(
      `  <node id="${tempId}" lat="${spot.lat}" lon="${spot.lon}">`
    );
    lines.push(`    <tag k="name" v="${escapeXml(spot.name)}"/>`);
    lines.push('    <tag k="natural" v="tree"/>');
    lines.push('    <tag k="genus" v="Prunus"/>');
    lines.push('    <tag k="source" v="local_survey"/>');
    if (spot.region) {
      lines.push(`    <tag k="addr:district" v="${escapeXml(spot.region)}"/>`);
    }
    if (spot.memo) {
      lines.push(`    <tag k="note" v="${escapeXml(spot.memo)}"/>`);
    }
    lines.push(`    <tag k="ref:internal" v="${escapeXml(spot.id)}"/>`);
    lines.push("  </node>");
    tempId -= 1;
  }

  lines.push("</osm>");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const format = String(args.format || "both").trim().toLowerCase();
  const outDirArg = String(args.out || "exports").trim();
  const status = String(args.status || "active").trim().toLowerCase();

  if (!["geojson", "osm", "both"].includes(format)) {
    throw new Error("--format 은 geojson|osm|both 만 허용됩니다.");
  }
  if (!["active", "inactive", "all"].includes(status)) {
    throw new Error("--status 는 active|inactive|all 만 허용됩니다.");
  }

  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(process.cwd(), outDirArg);
  await fs.mkdir(outDir, { recursive: true });

  await db.initSchema();
  const spots = await db.listInternalCherrySpots({ status });

  const written = [];
  if (format === "geojson" || format === "both") {
    const geojsonPath = path.join(outDir, "internal-cherry-spots.geojson");
    const geojson = toGeoJson(spots);
    await fs.writeFile(geojsonPath, `${JSON.stringify(geojson, null, 2)}\n`, "utf8");
    written.push(geojsonPath);
  }

  if (format === "osm" || format === "both") {
    const osmPath = path.join(outDir, "internal-cherry-spots.osm");
    const osmXml = toOsmXml(spots);
    await fs.writeFile(osmPath, `${osmXml}\n`, "utf8");
    written.push(osmPath);
  }

  await db.closeDb();

  console.log(`[ok] exported=${spots.length} status=${status} format=${format}`);
  for (const filePath of written) {
    console.log(`[file] ${filePath}`);
  }
  console.log("[note] .osm 파일은 JOSM/iD에서 검수 후 업로드하세요.");
}

main().catch(async (error) => {
  console.error(`[error] ${error.message}`);
  try {
    await db.closeDb();
  } catch {}
  process.exit(1);
});
