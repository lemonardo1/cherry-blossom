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

function bboxToRoundedKey(bbox, precision = 2) {
  const digits = Number.isInteger(precision) ? Math.max(0, Math.min(precision, 6)) : 2;
  return [
    bbox.minLon.toFixed(digits),
    bbox.minLat.toFixed(digits),
    bbox.maxLon.toFixed(digits),
    bbox.maxLat.toFixed(digits)
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

async function fetchOverpass({ query, endpoints }) {
  const body = new URLSearchParams({ data: query });
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body,
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error(`overpass_failed_${response.status}`);
      const data = await response.json();
      const elements = data.elements || [];
      return { elements };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("overpass_unavailable");
}

module.exports = {
  buildKoreaAreaQuery,
  buildBboxQuery,
  parseBbox,
  bboxToRoundedKey,
  isInsideBbox,
  dedupeElements,
  fetchOverpass
};
