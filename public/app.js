const DEFAULT_VIEW = { lat: 37.52974, lng: 126.99886, zoom: 12 };
const FIRST_VISIT_VIEW = { lat: 36.63096, lng: 128.04565, zoom: 8 };
const FIRST_VISIT_STORAGE_KEY = "map:first-visit:done";
const VIEW_URL_KEYS = { lat: "lat", lng: "lng", zoom: "z" };
const MAX_MAP_ZOOM = 20;

function hasCompletedFirstVisit() {
  try {
    return window.localStorage.getItem(FIRST_VISIT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markFirstVisitDone() {
  try {
    window.localStorage.setItem(FIRST_VISIT_STORAGE_KEY, "1");
  } catch {
    // Ignore localStorage access errors (e.g. privacy mode)
  }
}

function parseViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const latRaw = Number(params.get(VIEW_URL_KEYS.lat));
  const lngRaw = Number(params.get(VIEW_URL_KEYS.lng));
  const zoomRaw = Number(params.get(VIEW_URL_KEYS.zoom));
  const hasLat = Number.isFinite(latRaw) && latRaw >= -90 && latRaw <= 90;
  const hasLng = Number.isFinite(lngRaw) && lngRaw >= -180 && lngRaw <= 180;
  const hasZoom = Number.isFinite(zoomRaw);

  if (hasLat && hasLng && hasZoom) {
    markFirstVisitDone();
    return {
      lat: latRaw,
      lng: lngRaw,
      zoom: Math.max(1, Math.min(MAX_MAP_ZOOM, zoomRaw))
    };
  }

  if (!hasCompletedFirstVisit()) {
    markFirstVisitDone();
    return FIRST_VISIT_VIEW;
  }

  return DEFAULT_VIEW;
}

function updateViewUrlParams() {
  const center = map.getCenter();
  const zoom = map.getZoom();
  const params = new URLSearchParams(window.location.search);
  const nextLat = center.lat.toFixed(5);
  const nextLng = center.lng.toFixed(5);
  const nextZoom = String(Math.round(zoom * 100) / 100);
  if (
    params.get(VIEW_URL_KEYS.lat) === nextLat &&
    params.get(VIEW_URL_KEYS.lng) === nextLng &&
    params.get(VIEW_URL_KEYS.zoom) === nextZoom
  ) {
    return;
  }
  params.set(VIEW_URL_KEYS.lat, nextLat);
  params.set(VIEW_URL_KEYS.lng, nextLng);
  params.set(VIEW_URL_KEYS.zoom, nextZoom);
  const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ""}`;
  window.history.replaceState(null, "", nextUrl);
}
const initialView = parseViewFromUrl();
const map = L.map("map", {
  zoomControl: false,
  preferCanvas: true
}).setView([initialView.lat, initialView.lng], initialView.zoom);

L.control.zoom({ position: "topright" }).addTo(map);

L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  subdomains: "abcd",
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
}).addTo(map);

const els = {
  leftPanel: document.getElementById("leftPanel"),
  rightPanel: document.getElementById("rightPanel"),
  rightPanelTitle: document.getElementById("rightPanelTitle"),
  toggleSearchPanelBtn: document.getElementById("toggleSearchPanelBtn"),
  closeAccountPanelBtn: document.getElementById("closeAccountPanelBtn"),
  accountFabBtn: document.getElementById("accountFabBtn"),
  saveSpotBox: document.getElementById("saveSpotBox"),
  saveSpotTitle: document.getElementById("saveSpotTitle"),
  mapPickToggleLine: document.getElementById("mapPickToggleLine"),
  prefsBox: document.getElementById("prefsBox"),
  accountFabBadge: document.getElementById("accountFabBadge"),
  fabAutoToggle: document.getElementById("fabAutoToggle"),
  fabCompactToggle: document.getElementById("fabCompactToggle"),
  searchInput: document.getElementById("searchInput"),
  kindSelect: document.getElementById("kindSelect"),
  statusText: document.getElementById("statusText"),
  resultList: document.getElementById("resultList"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  nameInput: document.getElementById("nameInput"),
  loginBtn: document.getElementById("loginBtn"),
  registerBtn: document.getElementById("registerBtn"),
  registerRow: document.getElementById("registerRow"),
  registerSubmitBtn: document.getElementById("registerSubmitBtn"),
  registerBackBtn: document.getElementById("registerBackBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  authGuest: document.getElementById("authGuest"),
  authUser: document.getElementById("authUser"),
  userLabel: document.getElementById("userLabel"),
  enableMapPickToggle: document.getElementById("enableMapPickToggle"),
  selectedSpotText: document.getElementById("selectedSpotText"),
  memoInput: document.getElementById("memoInput"),
  saveSpotBtn: document.getElementById("saveSpotBtn"),
  savedSpotList: document.getElementById("savedSpotList"),
  adminSpotBox: document.getElementById("adminSpotBox"),
  enableAdminPickToggle: document.getElementById("enableAdminPickToggle"),
  adminSelectedSpotText: document.getElementById("adminSelectedSpotText"),
  adminSpotNameInput: document.getElementById("adminSpotNameInput"),
  adminSpotRegionInput: document.getElementById("adminSpotRegionInput"),
  adminSpotMemoInput: document.getElementById("adminSpotMemoInput"),
  saveAdminSpotBtn: document.getElementById("saveAdminSpotBtn"),
  clearAdminSelectedBtn: document.getElementById("clearAdminSelectedBtn")
};

let user = null;
let features = [];
let filtered = [];
let selectedFeature = null;
let lastMeta = null;
let mySpotCount = 0;
let fabAutoMode = true;
const featureStore = new Map();
const fetchedTileCache = new Map();
const markerLayer = L.layerGroup().addTo(map);
const manualPickLayer = L.layerGroup().addTo(map);
const adminSelectedLayer = L.layerGroup().addTo(map);
const adminRegisteredLayer = L.layerGroup().addTo(map);
const markerMap = new Map();
let manualPickMarker = null;
let adminSelectedPoints = [];
let fetchCherryDebounceTimer = null;
let activeCherryFetchController = null;
let fetchCherrySeq = 0;
let lastRequestedFetchPlanKey = "";
const MIN_FETCH_ZOOM = 12;
const MAX_FETCH_BBOX_AREA = 0.08;
const FETCH_BBOX_PRECISION = 3;
const FETCH_TILE_KEY_PRECISION = 2;
const HIGH_ZOOM_PREFETCH_MIN_ZOOM = 16;
const PREFETCH_TILE_RADIUS = 1;
const KIND_SHORTCUT_MAP = {
  "1": "all",
  "2": "tree",
  "3": "place",
  "4": "curated",
  "5": "internal",
  "6": "community"
};

function isManualPickEnabled() {
  return Boolean(els.enableMapPickToggle && els.enableMapPickToggle.checked);
}

function isAdminPickEnabled() {
  return Boolean(els.enableAdminPickToggle && els.enableAdminPickToggle.checked);
}

function isAdminUser() {
  return user?.role === "admin";
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function setAuthGuestDepth(registerDepth) {
  if (!els.authGuest) return;
  els.nameInput.classList.toggle("hidden", !registerDepth);
  els.loginBtn.classList.toggle("hidden", registerDepth);
  els.registerBtn.classList.toggle("hidden", registerDepth);
  if (els.registerRow) els.registerRow.classList.toggle("hidden", !registerDepth);
  if (!registerDepth) els.nameInput.value = "";
}

function setAuthUI() {
  const admin = isAdminUser();
  document.body.classList.toggle("admin-mode", admin);
  document.body.classList.toggle("viewer-mode", !admin);

  if (user) {
    els.authGuest.classList.add("hidden");
    els.authUser.classList.remove("hidden");
    const roleLabel = user.role === "admin" ? "관리자" : "일반";
    els.userLabel.textContent = `${user.name} (${user.email}) · ${roleLabel}`;
  } else {
    els.authGuest.classList.remove("hidden");
    els.authUser.classList.add("hidden");
    els.userLabel.textContent = "사용자";
    setAuthGuestDepth(false);
  }
  if (els.adminSpotBox) {
    const showAdmin = admin;
    els.adminSpotBox.classList.toggle("hidden", !showAdmin);
    if (!showAdmin) {
      clearAdminSelectedPoints();
      adminRegisteredLayer.clearLayers();
      if (els.enableAdminPickToggle) els.enableAdminPickToggle.checked = false;
      setAdminSelectedSpotHint();
    }
  }
  if (els.prefsBox) els.prefsBox.classList.toggle("hidden", !admin);
  if (els.rightPanelTitle) {
    els.rightPanelTitle.textContent = admin ? "계정/저장" : "즐겨찾기";
  }
  if (els.saveSpotTitle) {
    els.saveSpotTitle.textContent = admin ? "선택 지점 저장" : "즐겨찾기 저장";
  }
  if (els.saveSpotBtn) {
    els.saveSpotBtn.textContent = admin ? "내 스팟 저장" : "즐겨찾기 추가";
  }
  if (els.accountFabBtn) {
    const icon = els.accountFabBtn.querySelector(".fab-icon");
    const label = els.accountFabBtn.querySelector(".fab-label");
    if (icon) icon.textContent = admin ? "ID" : "★";
    if (label) label.textContent = admin ? "계정/저장" : "메뉴";
    els.accountFabBtn.setAttribute("aria-label", admin ? "계정/저장 열기" : "즐겨찾기 메뉴 열기");
  }
  updateAccountFabBadge();
}

function updateAccountFabBadge() {
  if (!els.accountFabBadge) return;
  if (!user) {
    els.accountFabBadge.classList.remove("hidden");
    els.accountFabBadge.textContent = "!";
    return;
  }
  if (mySpotCount > 0) {
    els.accountFabBadge.classList.remove("hidden");
    els.accountFabBadge.textContent = mySpotCount > 99 ? "99+" : String(mySpotCount);
    return;
  }
  els.accountFabBadge.classList.add("hidden");
  els.accountFabBadge.textContent = "";
}

function normalize(elements) {
  return elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (typeof lat !== "number" || typeof lon !== "number") return null;
      const tags = el.tags || {};
      const name = (tags.name || "").trim() || "Unnamed spot";
      const source = String(tags.source || "").toLowerCase();
      if (source === "curated") {
        return {
          id: `${el.type}/${el.id}`,
          name,
          lat,
          lon,
          kind: "curated",
          source,
          memo: tags.memo || "",
          region: tags.region || ""
        };
      }
      if (source === "community") {
        return {
          id: `${el.type}/${el.id}`,
          name,
          lat,
          lon,
          kind: "community",
          source,
          memo: tags.memo || "",
          region: ""
        };
      }
      if (source === "internal") {
        return {
          id: `${el.type}/${el.id}`,
          name,
          lat,
          lon,
          kind: "internal",
          source,
          memo: tags.memo || "",
          region: tags.region || ""
        };
      }
      const isTree =
        tags.natural === "tree" &&
        /prunus|serrulata|cherry|벚/i.test(`${tags.genus || ""} ${tags.species || ""} ${name}`);
      return {
        id: `${el.type}/${el.id}`,
        name,
        lat,
        lon,
        kind: isTree ? "tree" : "place",
        source: "overpass",
        memo: "",
        region: ""
      };
    })
    .filter(Boolean);
}

function normalizeUnique(elements) {
  const normalized = normalize(elements);
  const seen = new Set();
  const out = [];
  normalized.forEach((feature) => {
    const key = feature.id || `${feature.lat.toFixed(5)}:${feature.lon.toFixed(5)}:${feature.name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(feature);
  });
  return out;
}

function upsertFeatures(elements) {
  const normalized = normalizeUnique(elements || []);
  normalized.forEach((feature) => {
    featureStore.set(feature.id, feature);
  });
  features = Array.from(featureStore.values());
}

function inCurrentBounds(feature, bounds) {
  const lat = Number(feature?.lat);
  const lon = Number(feature?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return bounds.contains([lat, lon]);
}

function filterFeatures() {
  const q = els.searchInput.value.trim().toLowerCase();
  const kind = els.kindSelect.value;
  const bounds = map.getBounds();
  filtered = features.filter((f) => {
    if (!inCurrentBounds(f, bounds)) return false;
    const byText = !q || f.name.toLowerCase().includes(q);
    const byKind = kind === "all" || f.kind === kind;
    return byText && byKind;
  });
  renderFeatures();
}

function clearManualPickMarker() {
  if (manualPickMarker) {
    manualPickLayer.removeLayer(manualPickMarker);
    manualPickMarker = null;
  }
}

function setSelectedSpotHint() {
  if (!els.selectedSpotText) return;
  els.selectedSpotText.textContent = isManualPickEnabled()
    ? "지도에서 마커를 선택하거나 지도를 클릭하세요."
    : "지도에서 마커를 선택하세요.";
}

function setAdminSelectedSpotHint() {
  if (!els.adminSelectedSpotText) return;
  if (!isAdminUser()) {
    els.adminSelectedSpotText.textContent = "관리자 계정으로 로그인하면 사용할 수 있습니다.";
    if (els.clearAdminSelectedBtn) els.clearAdminSelectedBtn.disabled = true;
    return;
  }
  if (!isAdminPickEnabled()) {
    els.adminSelectedSpotText.textContent = "체크박스를 켜고 지도를 클릭해 좌표를 추가하세요.";
    if (els.clearAdminSelectedBtn) els.clearAdminSelectedBtn.disabled = adminSelectedPoints.length === 0;
    return;
  }
  const count = adminSelectedPoints.length;
  els.adminSelectedSpotText.textContent = count
    ? `선택 ${count}개 (잘못 고른 좌표는 클릭해서 제거)`
    : "지도에서 여러 좌표를 클릭해 추가하세요.";
  if (els.clearAdminSelectedBtn) els.clearAdminSelectedBtn.disabled = count === 0;
}

function clearAdminSelectedPoints() {
  adminSelectedPoints = [];
  adminSelectedLayer.clearLayers();
  setAdminSelectedSpotHint();
}

function removeAdminSelectedPoint(pointId) {
  adminSelectedPoints = adminSelectedPoints.filter((point) => point.id !== pointId);
  adminSelectedLayer.eachLayer((layer) => {
    if (layer?.options?.pointId === pointId) {
      adminSelectedLayer.removeLayer(layer);
    }
  });
  setAdminSelectedSpotHint();
}

function addAdminSelectedPoint(latlng) {
  const point = {
    id: `admin:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
    lat: latlng.lat,
    lon: latlng.lng
  };
  adminSelectedPoints.push(point);
  const marker = L.circleMarker([point.lat, point.lon], {
    radius: 8,
    weight: 2,
    color: "#8a5200",
    fillColor: "#f59e0b",
    fillOpacity: 0.92,
    pointId: point.id
  });
  marker.bindPopup("등록 대기 좌표 (클릭 시 제거)");
  marker.on("click", () => removeAdminSelectedPoint(point.id));
  marker.addTo(adminSelectedLayer);
  setAdminSelectedSpotHint();
}

function markAdminRegisteredSpots(spots) {
  adminRegisteredLayer.clearLayers();
  if (!Array.isArray(spots)) return;
  spots.forEach((spot) => {
    const marker = L.circleMarker([spot.lat, spot.lon], {
      radius: 7,
      weight: 2,
      color: "#0f5f66",
      fillColor: "#22c1d6",
      fillOpacity: 0.86
    });
    marker.bindPopup(`등록 완료: ${spot.name}`);
    marker.addTo(adminRegisteredLayer);
  });
}

function selectFeature(feature, opts = {}) {
  selectedFeature = feature;
  const prefix = opts.manual ? "직접 선택" : feature.name;
  els.selectedSpotText.textContent = `${prefix} (${feature.lat.toFixed(5)}, ${feature.lon.toFixed(5)})`;
}

function renderFeatures() {
  markerLayer.clearLayers();
  markerMap.clear();

  filtered.forEach((f) => {
    const style = markerStyleByKind(f.kind);
    const marker = L.circleMarker([f.lat, f.lon], {
      radius: style.radius,
      weight: 1,
      color: style.stroke,
      fillColor: style.fill,
      fillOpacity: 0.78,
      bubblingMouseEvents: false
    });
    const sourceLabel = sourceLabelByKind(f.kind);
    const extra = f.region ? `<br/>${f.region}` : "";
    const memo = f.memo ? `<br/>${f.memo}` : "";
    marker.bindPopup(
      `<strong>${f.name}</strong><br/>${sourceLabel}${extra}${memo}<br/>${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}`
    );
    marker.on("click", () => {
      clearManualPickMarker();
      selectFeature(f);
    });
    marker.addTo(markerLayer);
    markerMap.set(f.id, marker);
  });

  renderList();
  const metaText = lastMeta
    ? ` | OSM ${lastMeta.overpass} + 추천 ${lastMeta.curated} + 내부DB ${lastMeta.internal || 0} + 커뮤니티 ${lastMeta.community}${lastMeta.cached ? " (cache)" : ""}${lastMeta.prefetchEnabled ? ` | 타일 ${lastMeta.prefetchLoaded}/${lastMeta.prefetchTotal}` : ""}${lastMeta.prefetchPartial ? " | 주변 타일 일부 실패" : ""}${lastMeta.overpassError === "bbox_too_large" ? " | 지도 확대 필요" : (lastMeta.overpassError ? " | OSM 장애(폴백)" : "")}`
    : "";
  setStatus(`조회 ${features.length.toLocaleString()}건 / 표시 ${filtered.length.toLocaleString()}건${metaText}`);
}

function renderList() {
  els.resultList.innerHTML = "";
  if (!filtered.length) {
    els.resultList.innerHTML = '<div class="item">결과 없음</div>';
    return;
  }

  filtered.slice(0, 400).forEach((f) => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `${f.name}<span class="tag">${shortLabelByKind(f.kind)}</span>`;
    el.onclick = () => {
      map.setView([f.lat, f.lon], Math.max(map.getZoom(), 14), { animate: true });
      const marker = markerMap.get(f.id);
      if (marker) marker.openPopup();
      clearManualPickMarker();
      selectFeature(f);
    };
    els.resultList.appendChild(el);
  });
}

function getRoundedBboxString() {
  const b = map.getBounds();
  return [
    b.getWest().toFixed(FETCH_BBOX_PRECISION),
    b.getSouth().toFixed(FETCH_BBOX_PRECISION),
    b.getEast().toFixed(FETCH_BBOX_PRECISION),
    b.getNorth().toFixed(FETCH_BBOX_PRECISION)
  ].join(",");
}

function parseBboxString(bbox) {
  const [minLon, minLat, maxLon, maxLat] = String(bbox).split(",").map(Number);
  if ([minLon, minLat, maxLon, maxLat].some((v) => !Number.isFinite(v))) return null;
  return { minLon, minLat, maxLon, maxLat };
}

function formatBbox({ minLon, minLat, maxLon, maxLat }) {
  return [
    minLon.toFixed(FETCH_BBOX_PRECISION),
    minLat.toFixed(FETCH_BBOX_PRECISION),
    maxLon.toFixed(FETCH_BBOX_PRECISION),
    maxLat.toFixed(FETCH_BBOX_PRECISION)
  ].join(",");
}

function formatBboxWithPrecision({ minLon, minLat, maxLon, maxLat }, precision) {
  return [
    minLon.toFixed(precision),
    minLat.toFixed(precision),
    maxLon.toFixed(precision),
    maxLat.toFixed(precision)
  ].join(",");
}

function clampLat(lat) {
  return Math.max(-85, Math.min(85, lat));
}

function clampLon(lon) {
  return Math.max(-180, Math.min(180, lon));
}

function buildFetchBboxes(baseBbox, zoom) {
  if (zoom < HIGH_ZOOM_PREFETCH_MIN_ZOOM) return [baseBbox];
  const parsed = parseBboxString(baseBbox);
  if (!parsed) return [baseBbox];
  const lonSpan = Math.max(0, parsed.maxLon - parsed.minLon);
  const latSpan = Math.max(0, parsed.maxLat - parsed.minLat);
  if (lonSpan <= 0 || latSpan <= 0) return [baseBbox];

  const bboxes = [baseBbox];
  const seen = new Set([baseBbox]);
  for (let dy = -PREFETCH_TILE_RADIUS; dy <= PREFETCH_TILE_RADIUS; dy += 1) {
    for (let dx = -PREFETCH_TILE_RADIUS; dx <= PREFETCH_TILE_RADIUS; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const candidate = formatBbox({
        minLon: clampLon(parsed.minLon + lonSpan * dx),
        minLat: clampLat(parsed.minLat + latSpan * dy),
        maxLon: clampLon(parsed.maxLon + lonSpan * dx),
        maxLat: clampLat(parsed.maxLat + latSpan * dy)
      });
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      bboxes.push(candidate);
    }
  }
  return bboxes;
}

function toTileKeyBbox(bbox, precision = FETCH_TILE_KEY_PRECISION) {
  const parsed = parseBboxString(bbox);
  if (!parsed) return bbox;
  return formatBboxWithPrecision(parsed, precision);
}

function buildFetchTileBboxes(baseBbox, zoom) {
  const rawBboxes = buildFetchBboxes(baseBbox, zoom);
  const seen = new Set();
  const out = [];
  rawBboxes.forEach((bbox) => {
    const key = toTileKeyBbox(bbox);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });
  return out;
}

async function fetchCherryByBbox(bbox, zoom, signal) {
  const res = await fetch(`/api/osm/cherry?bbox=${encodeURIComponent(bbox)}&zoom=${encodeURIComponent(String(zoom))}`, { signal });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "조회 실패");
  return json;
}

function mergeElementsUnique(elementGroups) {
  const merged = [];
  const seen = new Set();
  elementGroups.forEach((group) => {
    (group || []).forEach((el) => {
      const key = `${el.type || "node"}:${String(el.id ?? "")}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(el);
    });
  });
  return merged;
}

function buildMetaFromMergedElements(elements, prefetchTotal, prefetchLoaded, hasPartialFailures, tileMetas = []) {
  let overpass = 0;
  let curated = 0;
  let internal = 0;
  let community = 0;
  elements.forEach((el) => {
    const source = String(el?.tags?.source || "").toLowerCase();
    if (source === "curated") curated += 1;
    else if (source === "internal") internal += 1;
    else if (source === "community") community += 1;
    else overpass += 1;
  });
  return {
    overpass,
    curated,
    internal,
    community,
    total: elements.length,
    prefetchTotal,
    prefetchLoaded,
    prefetchEnabled: prefetchTotal > 1,
    prefetchPartial: hasPartialFailures,
    cached: tileMetas.length > 0 && tileMetas.every((meta) => Boolean(meta?.cached)),
    stale: tileMetas.some((meta) => Boolean(meta?.stale)),
    revalidating: tileMetas.some((meta) => Boolean(meta?.revalidating)),
    overpassError: tileMetas.find((meta) => meta?.overpassError)?.overpassError || null
  };
}

function logCherryLoadComplete({ reqSeq, fetchBboxes, loadedTiles, partialFailures, startedAt }) {
  const elapsed = Date.now() - startedAt;
  const completedAt = new Date().toISOString();
  console.info(
    `[cherry_ui] load_complete seq=${reqSeq} elapsed_ms=${elapsed} completed_at=${completedAt} tiles=${loadedTiles}/${fetchBboxes.length} partial=${partialFailures}`
  );
}

function getBboxAreaFromString(bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox.split(",").map(Number);
  if ([minLon, minLat, maxLon, maxLat].some((v) => !Number.isFinite(v))) return Infinity;
  return Math.max(0, maxLon - minLon) * Math.max(0, maxLat - minLat);
}

function shouldFetchCherryForView() {
  if (map.getZoom() < MIN_FETCH_ZOOM) {
    return { ok: false, reason: "zoom" };
  }
  const bbox = getRoundedBboxString();
  const area = getBboxAreaFromString(bbox);
  if (area > MAX_FETCH_BBOX_AREA) {
    return { ok: false, reason: "area", bbox, area };
  }
  return { ok: true, bbox, area };
}

async function fetchCherry(force = false) {
  const check = shouldFetchCherryForView();
  if (!check.ok && !force) {
    if (activeCherryFetchController) {
      activeCherryFetchController.abort();
      activeCherryFetchController = null;
    }
    if (check.reason === "zoom") {
      setStatus(`지도를 더 확대하세요 (줌 ${MIN_FETCH_ZOOM}+에서 데이터 조회)`);
    } else {
      setStatus("조회 범위가 너무 넓습니다. 지도를 더 확대하세요.");
    }
    return;
  }
  const bbox = check.bbox || getRoundedBboxString();
  const zoom = Math.round(map.getZoom() * 100) / 100;
  const fetchBboxes = buildFetchTileBboxes(bbox, map.getZoom());
  const fetchPlanKey = fetchBboxes.join("|");
  if (!force && fetchPlanKey === lastRequestedFetchPlanKey) return;
  lastRequestedFetchPlanKey = fetchPlanKey;
  const uncachedBboxes = force
    ? fetchBboxes
    : fetchBboxes.filter((tileBbox) => !fetchedTileCache.has(tileBbox));
  if (!uncachedBboxes.length) {
    setStatus(`조회 ${features.length.toLocaleString()}건 / 표시 ${filtered.length.toLocaleString()}건 | 캐시 사용`);
    return;
  }
  const reqSeq = ++fetchCherrySeq;
  if (activeCherryFetchController) {
    activeCherryFetchController.abort();
  }
  const controller = new AbortController();
  activeCherryFetchController = controller;
  const fetchStartedAt = Date.now();
  setStatus(
    fetchBboxes.length > 1
      ? `Overpass 데이터 조회 중... (신규 ${uncachedBboxes.length}/${fetchBboxes.length} 타일)`
      : "Overpass 데이터 조회 중..."
  );
  try {
    const [primaryBbox, ...neighborBboxes] = uncachedBboxes;
    const primary = await fetchCherryByBbox(primaryBbox, zoom, controller.signal);
    if (reqSeq !== fetchCherrySeq) return;
    fetchedTileCache.set(primaryBbox, primary);
    upsertFeatures(primary.elements || []);
    if (!neighborBboxes.length) {
      const primaryMeta = primary.meta || {};
      lastMeta = {
        ...primaryMeta,
        prefetchTotal: fetchBboxes.length,
        prefetchLoaded: 1,
        prefetchEnabled: fetchBboxes.length > 1,
        prefetchPartial: false
      };
      filterFeatures();
      logCherryLoadComplete({
        reqSeq,
        fetchBboxes,
        loadedTiles: 1,
        partialFailures: false,
        startedAt: fetchStartedAt
      });
      return;
    }

    let mergedElements = mergeElementsUnique([primary.elements || []]);
    let loadedTiles = 1;
    let partialFailures = false;
    let tileMetas = [primary.meta || null];
    lastMeta = buildMetaFromMergedElements(mergedElements, fetchBboxes.length, loadedTiles, partialFailures, tileMetas);
    filterFeatures();

    const settled = await Promise.allSettled(
      neighborBboxes.map((tileBbox) => fetchCherryByBbox(tileBbox, zoom, controller.signal))
    );
    if (reqSeq !== fetchCherrySeq) return;
    const groups = [primary.elements || []];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        loadedTiles += 1;
        const tileBbox = neighborBboxes[index];
        const tilePayload = result.value || {};
        groups.push(tilePayload.elements || []);
        tileMetas.push(tilePayload.meta || null);
        fetchedTileCache.set(tileBbox, tilePayload);
      } else {
        partialFailures = true;
      }
    });
    mergedElements = mergeElementsUnique(groups);
    upsertFeatures(mergedElements);
    lastMeta = buildMetaFromMergedElements(mergedElements, fetchBboxes.length, loadedTiles, partialFailures, tileMetas);
    filterFeatures();
    logCherryLoadComplete({
      reqSeq,
      fetchBboxes,
      loadedTiles,
      partialFailures,
      startedAt: fetchStartedAt
    });
  } catch (error) {
    if (error?.name === "AbortError") return;
    throw error;
  } finally {
    if (activeCherryFetchController === controller) {
      activeCherryFetchController = null;
    }
  }
}

function scheduleFetchCherry() {
  const zoom = map.getZoom();
  const debounceMs = zoom >= 16 ? 220 : (zoom >= 14 ? 500 : 900);
  if (fetchCherryDebounceTimer) clearTimeout(fetchCherryDebounceTimer);
  fetchCherryDebounceTimer = setTimeout(() => {
    fetchCherry().catch((err) => setStatus(`오류: ${err.message}`));
  }, debounceMs);
}

function markerStyleByKind(kind) {
  const zoom = map.getZoom();
  const radiusScale = zoom >= 13 ? 0.74 : 1;
  if (kind === "tree") return { radius: 5.5 * radiusScale, stroke: "#b03a76", fill: "#ff8fc4" };
  if (kind === "curated") return { radius: 7.5 * radiusScale, stroke: "#962d66", fill: "#ff6fb2" };
  if (kind === "internal") return { radius: 8 * radiusScale, stroke: "#962d66", fill: "#ff6fb2" };
  if (kind === "community") return { radius: 7 * radiusScale, stroke: "#962d66", fill: "#ff6fb2" };
  return { radius: 7 * radiusScale, stroke: "#ad3d75", fill: "#ff9bc9" };
}

function shortLabelByKind(kind) {
  if (kind === "tree") return "벚나무";
  if (kind === "curated") return "추천";
  if (kind === "internal") return "내부DB";
  if (kind === "community") return "커뮤니티";
  return "명소";
}

function sourceLabelByKind(kind) {
  if (kind === "tree") return "벚나무 포인트 (OSM)";
  if (kind === "curated") return "추천 명소(보강)";
  if (kind === "internal") return "내부 데이터베이스";
  if (kind === "community") return "커뮤니티 스팟";
  return "벚꽃 명소 (OSM)";
}

function isTypingTarget(target) {
  if (!target || typeof target !== "object") return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName || "").toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  const type = String(target.type || "text").toLowerCase();
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
}

function applyKindShortcut(key) {
  const nextKind = KIND_SHORTCUT_MAP[key];
  if (!nextKind || !els.kindSelect) return false;
  const hasOption = Array.from(els.kindSelect.options || []).some((opt) => opt.value === nextKind);
  if (!hasOption) return false;
  els.kindSelect.value = nextKind;
  filterFeatures();
  return true;
}

function applyLeftPanelState(collapsed) {
  els.leftPanel.classList.toggle("collapsed", collapsed);
  els.toggleSearchPanelBtn.textContent = collapsed ? "▶" : "◀";
  els.toggleSearchPanelBtn.setAttribute("aria-label", collapsed ? "검색 패널 열기" : "검색 패널 접기");
  localStorage.setItem("panel:left", collapsed ? "1" : "0");
}

function setAccountPanelOpen(open) {
  els.rightPanel.classList.toggle("open", open);
  if (els.accountFabBtn) {
    els.accountFabBtn.classList.toggle("hidden", open);
    els.accountFabBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  localStorage.setItem("panel:right:open", open ? "1" : "0");
}

function setFabCompactMode(compact) {
  if (els.accountFabBtn) els.accountFabBtn.classList.toggle("compact", compact);
}

function applyFabMode() {
  const compact = fabAutoMode
    ? window.matchMedia("(max-width: 900px)").matches
    : localStorage.getItem("fab:compact") === "1";
  setFabCompactMode(compact);
  if (els.fabCompactToggle) els.fabCompactToggle.checked = compact;
  const compactLabel = els.fabCompactToggle?.closest(".toggle-line");
  if (compactLabel) compactLabel.classList.toggle("compact-disabled", fabAutoMode);
}

function setFabAutoMode(auto) {
  fabAutoMode = auto;
  if (els.fabAutoToggle) els.fabAutoToggle.checked = auto;
  localStorage.setItem("fab:auto", auto ? "1" : "0");
  applyFabMode();
}

function initPanels() {
  const leftCollapsed = localStorage.getItem("panel:left") === "1";
  const rightOpen = localStorage.getItem("panel:right:open") === "1";
  const savedAuto = localStorage.getItem("fab:auto");
  fabAutoMode = savedAuto == null ? true : savedAuto === "1";
  applyLeftPanelState(leftCollapsed);
  setAccountPanelOpen(rightOpen);
  if (els.fabAutoToggle) els.fabAutoToggle.checked = fabAutoMode;
  applyFabMode();

  els.toggleSearchPanelBtn.onclick = () => {
    const next = !els.leftPanel.classList.contains("collapsed");
    applyLeftPanelState(next);
  };
  if (els.accountFabBtn) els.accountFabBtn.onclick = () => setAccountPanelOpen(true);
  if (els.closeAccountPanelBtn) els.closeAccountPanelBtn.onclick = () => setAccountPanelOpen(false);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setAccountPanelOpen(false);
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (isTypingTarget(event.target)) return;
    if (applyKindShortcut(event.key)) event.preventDefault();
  });
  if (els.fabCompactToggle) {
    els.fabCompactToggle.onchange = () => {
      if (fabAutoMode) return;
      localStorage.setItem("fab:compact", els.fabCompactToggle.checked ? "1" : "0");
      applyFabMode();
    };
  }
  if (els.fabAutoToggle) {
    els.fabAutoToggle.onchange = () => setFabAutoMode(Boolean(els.fabAutoToggle.checked));
  }
  window.addEventListener("resize", () => {
    if (fabAutoMode) applyFabMode();
  });
}

async function authMe() {
  const res = await fetch("/api/auth/me");
  const json = await res.json();
  user = json.user;
  setAuthUI();
}

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function handleApiErrorBody(json, fallbackMessage) {
  const errorCode = json?.error || "";
  if (errorCode === "auth_required") {
    user = null;
    mySpotCount = 0;
    setAuthUI();
    updateAccountFabBadge();
    throw new Error("세션이 만료되었습니다. 다시 로그인하세요.");
  }
  if (errorCode === "admin_required") {
    throw new Error("관리자 권한이 필요합니다.");
  }
  throw new Error(errorCode || fallbackMessage);
}

async function login() {
  const email = els.emailInput.value.trim();
  const password = els.passwordInput.value;
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "로그인 실패");
  user = json.user;
  setAuthUI();
  await loadMySpots();
}

async function register() {
  const name = els.nameInput.value.trim();
  const email = els.emailInput.value.trim();
  const password = els.passwordInput.value;
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "회원가입 실패");
  user = json.user;
  setAuthUI();
  await loadMySpots();
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  user = null;
  mySpotCount = 0;
  setAuthUI();
  els.savedSpotList.innerHTML = '<div class="item">로그인 후 조회</div>';
}

async function saveSpot() {
  if (!user) throw new Error("로그인이 필요합니다.");
  if (!selectedFeature) {
    throw new Error(
      isManualPickEnabled()
        ? "먼저 마커를 선택하거나 지도를 클릭하세요."
        : "먼저 지도 마커를 선택하세요."
    );
  }
  const memo = els.memoInput.value.trim();
  const res = await fetch("/api/spots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      name: selectedFeature.name,
      lat: selectedFeature.lat,
      lon: selectedFeature.lon,
      memo
    })
  });
  const json = await parseJsonSafe(res);
  if (!res.ok) handleApiErrorBody(json, "저장 실패");
  els.memoInput.value = "";
  await loadMySpots();
}

async function saveAdminSpot() {
  console.info("[admin_spot_ui] click_save", {
    isAdminUser: isAdminUser(),
    isAdminPickEnabled: isAdminPickEnabled(),
    selectedCount: adminSelectedPoints.length,
    spotName: String(els.adminSpotNameInput?.value || "").trim()
  });
  if (!isAdminUser()) throw new Error("관리자 권한이 필요합니다.");
  if (!adminSelectedPoints.length) throw new Error("먼저 관리자 등록 좌표를 지도에서 클릭해 추가하세요.");

  const name = els.adminSpotNameInput.value.trim();
  if (!name) throw new Error("스팟 이름을 입력하세요.");

  const res = await fetch("/api/admin/cherry-spots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      name,
      points: adminSelectedPoints.map((point) => ({ lat: point.lat, lon: point.lon })),
      region: els.adminSpotRegionInput.value.trim(),
      memo: els.adminSpotMemoInput.value.trim()
    })
  });
  const json = await parseJsonSafe(res);
  console.info("[admin_spot_ui] api_response", {
    status: res.status,
    ok: res.ok,
    error: json?.error || null,
    spotsCount: Array.isArray(json?.spots) ? json.spots.length : (json?.spot ? 1 : 0)
  });
  if (!res.ok) handleApiErrorBody(json, "관리자 등록 실패");
  const savedSpots = Array.isArray(json.spots) ? json.spots : (json.spot ? [json.spot] : []);

  els.adminSpotNameInput.value = "";
  els.adminSpotRegionInput.value = "";
  els.adminSpotMemoInput.value = "";
  clearAdminSelectedPoints();
  markAdminRegisteredSpots(savedSpots);
  setAdminSelectedSpotHint();
  await fetchCherry();
  if (savedSpots.length) {
    const firstSpot = savedSpots[0];
    els.kindSelect.value = "internal";
    filterFeatures();
    map.setView([firstSpot.lat, firstSpot.lon], Math.max(map.getZoom(), 15), { animate: true });
    setStatus(`관리자 등록 완료: ${savedSpots.length}개 좌표 (${firstSpot.name})`);
  }
}

async function removeSpot(id) {
  const res = await fetch(`/api/spots/${id}`, { method: "DELETE", credentials: "same-origin" });
  const json = await parseJsonSafe(res);
  if (!res.ok) handleApiErrorBody(json, "삭제 실패");
  await loadMySpots();
}

async function loadMySpots() {
  if (!user) return;
  const res = await fetch("/api/spots?mine=1", { credentials: "same-origin" });
  const json = await parseJsonSafe(res);
  if (!res.ok) handleApiErrorBody(json, "내 스팟 조회 실패");
  const list = json.spots || [];
  mySpotCount = list.length;
  updateAccountFabBadge();
  els.savedSpotList.innerHTML = "";
  if (!list.length) {
    els.savedSpotList.innerHTML = '<div class="item">저장된 스팟 없음</div>';
    return;
  }
  list.slice().reverse().forEach((s) => {
    const el = document.createElement("div");
    const memo = s.memo ? `<br/><span style="color:#4c6351;">${s.memo}</span>` : "";
    el.className = "item";
    el.innerHTML = `<strong>${s.name}</strong>${memo}`;
    el.onclick = () => map.setView([s.lat, s.lon], 15, { animate: true });
    const del = document.createElement("button");
    del.className = "secondary";
    del.style.marginTop = "6px";
    del.textContent = "삭제";
    del.onclick = async (e) => {
      e.stopPropagation();
      try {
        await removeSpot(s.id);
      } catch (err) {
        alert(err.message);
      }
    };
    el.appendChild(document.createElement("br"));
    el.appendChild(del);
    els.savedSpotList.appendChild(el);
  });
}

els.searchInput.oninput = filterFeatures;
els.kindSelect.onchange = filterFeatures;
if (els.enableMapPickToggle) {
  els.enableMapPickToggle.onchange = () => {
    if (!isManualPickEnabled()) {
      clearManualPickMarker();
      if (selectedFeature?.source === "manual") {
        selectedFeature = null;
        setSelectedSpotHint();
      }
    } else if (!selectedFeature) {
      setSelectedSpotHint();
    }
  };
}

if (els.enableAdminPickToggle) {
  els.enableAdminPickToggle.onchange = () => {
    if (!isAdminPickEnabled()) {
      clearAdminSelectedPoints();
    }
    setAdminSelectedSpotHint();
  };
}

if (els.clearAdminSelectedBtn) {
  els.clearAdminSelectedBtn.onclick = () => {
    clearAdminSelectedPoints();
  };
}

els.loginBtn.onclick = async () => {
  try {
    await login();
  } catch (error) {
    alert(error.message);
  }
};

els.registerBtn.onclick = () => {
  setAuthGuestDepth(true);
};

if (els.registerBackBtn) {
  els.registerBackBtn.onclick = () => {
    setAuthGuestDepth(false);
  };
}

if (els.registerSubmitBtn) {
  els.registerSubmitBtn.onclick = async () => {
    try {
      await register();
    } catch (error) {
      alert(error.message);
    }
  };
}

els.logoutBtn.onclick = async () => {
  try {
    await logout();
  } catch (error) {
    alert(error.message);
  }
};

els.saveSpotBtn.onclick = async () => {
  try {
    await saveSpot();
  } catch (error) {
    alert(error.message);
  }
};

if (els.saveAdminSpotBtn) {
  els.saveAdminSpotBtn.onclick = async () => {
    try {
      await saveAdminSpot();
    } catch (error) {
      console.error("[admin_spot_ui] save_failed", error);
      alert(error.message);
    }
  };
}

map.on("moveend", () => {
  updateViewUrlParams();
  filterFeatures();
  scheduleFetchCherry();
});

map.on("click", (event) => {
  const allowManual = isManualPickEnabled();
  const allowAdmin = isAdminUser() && isAdminPickEnabled();
  if (!allowManual && !allowAdmin) return;
  if (allowManual) {
    clearManualPickMarker();
    manualPickMarker = L.circleMarker(event.latlng, {
      radius: 8,
      weight: 2,
      color: "#175f3f",
      fillColor: "#74cf9c",
      fillOpacity: 0.92
    }).addTo(manualPickLayer);
    manualPickMarker.bindPopup("직접 선택한 위치").openPopup();
  }
  if (allowManual) {
    selectFeature(
      {
        id: `manual:${event.latlng.lat.toFixed(6)}:${event.latlng.lng.toFixed(6)}`,
        name: "직접 선택 위치",
        lat: event.latlng.lat,
        lon: event.latlng.lng,
        kind: "community",
        source: "manual",
        memo: "",
        region: ""
      },
      { manual: true }
    );
  }
  if (allowAdmin) {
    addAdminSelectedPoint(event.latlng);
  }
});

(async function boot() {
  try {
    updateViewUrlParams();
    initPanels();
    setSelectedSpotHint();
    setAdminSelectedSpotHint();
    updateAccountFabBadge();
    await authMe();
    if (user) await loadMySpots();
    else els.savedSpotList.innerHTML = '<div class="item">로그인 후 조회</div>';
    await fetchCherry();
  } catch (error) {
    setStatus(`초기화 오류: ${error.message}`);
  }
})();
