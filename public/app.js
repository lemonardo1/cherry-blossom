const map = L.map("map", {
  zoomControl: false,
  preferCanvas: true
}).setView([36.35, 127.8], 7);

L.control.zoom({ position: "topright" }).addTo(map);

L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  subdomains: "abcd",
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
}).addTo(map);

const els = {
  refreshBtn: document.getElementById("refreshBtn"),
  fitKoreaBtn: document.getElementById("fitKoreaBtn"),
  leftPanel: document.getElementById("leftPanel"),
  rightPanel: document.getElementById("rightPanel"),
  toggleSearchPanelBtn: document.getElementById("toggleSearchPanelBtn"),
  toggleAccountPanelBtn: document.getElementById("toggleAccountPanelBtn"),
  searchInput: document.getElementById("searchInput"),
  kindSelect: document.getElementById("kindSelect"),
  statusText: document.getElementById("statusText"),
  resultList: document.getElementById("resultList"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  nameInput: document.getElementById("nameInput"),
  loginBtn: document.getElementById("loginBtn"),
  registerBtn: document.getElementById("registerBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  authGuest: document.getElementById("authGuest"),
  authUser: document.getElementById("authUser"),
  userLabel: document.getElementById("userLabel"),
  enableMapPickToggle: document.getElementById("enableMapPickToggle"),
  selectedSpotText: document.getElementById("selectedSpotText"),
  memoInput: document.getElementById("memoInput"),
  saveSpotBtn: document.getElementById("saveSpotBtn"),
  savedSpotList: document.getElementById("savedSpotList")
};

let user = null;
let features = [];
let filtered = [];
let selectedFeature = null;
let lastMeta = null;
const markerLayer = L.layerGroup().addTo(map);
const manualPickLayer = L.layerGroup().addTo(map);
const markerMap = new Map();
let manualPickMarker = null;

function isManualPickEnabled() {
  return Boolean(els.enableMapPickToggle && els.enableMapPickToggle.checked);
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function setAuthUI() {
  if (user) {
    els.authGuest.classList.add("hidden");
    els.authUser.classList.remove("hidden");
    els.userLabel.textContent = `${user.name} (${user.email})`;
  } else {
    els.authGuest.classList.remove("hidden");
    els.authUser.classList.add("hidden");
    els.userLabel.textContent = "사용자";
  }
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

function filterFeatures() {
  const q = els.searchInput.value.trim().toLowerCase();
  const kind = els.kindSelect.value;
  filtered = features.filter((f) => {
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
    ? ` | OSM ${lastMeta.overpass} + 추천 ${lastMeta.curated} + 커뮤니티 ${lastMeta.community}${lastMeta.cached ? " (cache)" : ""}${lastMeta.overpassError ? " | OSM 장애(폴백)" : ""}`
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

async function fetchCherry() {
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(",");
  setStatus("Overpass 데이터 조회 중...");
  const res = await fetch(`/api/osm/cherry?bbox=${encodeURIComponent(bbox)}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "조회 실패");
  lastMeta = json.meta || null;
  features = normalize(json.elements || []);
  filterFeatures();
}

function markerStyleByKind(kind) {
  if (kind === "tree") return { radius: 5.5, stroke: "#397c32", fill: "#7fcf5f" };
  if (kind === "curated") return { radius: 7.5, stroke: "#2b6f28", fill: "#5ab046" };
  if (kind === "community") return { radius: 7, stroke: "#2e7b54", fill: "#6acb8f" };
  return { radius: 7, stroke: "#4f8338", fill: "#9ed36b" };
}

function shortLabelByKind(kind) {
  if (kind === "tree") return "벚나무";
  if (kind === "curated") return "추천";
  if (kind === "community") return "커뮤니티";
  return "명소";
}

function sourceLabelByKind(kind) {
  if (kind === "tree") return "벚나무 포인트 (OSM)";
  if (kind === "curated") return "추천 명소(보강)";
  if (kind === "community") return "커뮤니티 스팟";
  return "벚꽃 명소 (OSM)";
}

function applyPanelState(side, collapsed) {
  const isLeft = side === "left";
  const panel = isLeft ? els.leftPanel : els.rightPanel;
  const btn = isLeft ? els.toggleSearchPanelBtn : els.toggleAccountPanelBtn;
  panel.classList.toggle("collapsed", collapsed);
  btn.textContent = isLeft ? (collapsed ? "▶" : "◀") : (collapsed ? "◀" : "▶");
  btn.setAttribute("aria-label", isLeft ? (collapsed ? "검색 패널 열기" : "검색 패널 접기") : (collapsed ? "로그인 패널 열기" : "로그인 패널 접기"));
  localStorage.setItem(isLeft ? "panel:left" : "panel:right", collapsed ? "1" : "0");
}

function initPanels() {
  const leftCollapsed = localStorage.getItem("panel:left") === "1";
  const rightCollapsed = localStorage.getItem("panel:right") === "1";
  applyPanelState("left", leftCollapsed);
  applyPanelState("right", rightCollapsed);

  els.toggleSearchPanelBtn.onclick = () => {
    const next = !els.leftPanel.classList.contains("collapsed");
    applyPanelState("left", next);
  };
  els.toggleAccountPanelBtn.onclick = () => {
    const next = !els.rightPanel.classList.contains("collapsed");
    applyPanelState("right", next);
  };
}

async function authMe() {
  const res = await fetch("/api/auth/me");
  const json = await res.json();
  user = json.user;
  setAuthUI();
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
    body: JSON.stringify({
      name: selectedFeature.name,
      lat: selectedFeature.lat,
      lon: selectedFeature.lon,
      memo
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "저장 실패");
  els.memoInput.value = "";
  await loadMySpots();
}

async function removeSpot(id) {
  const res = await fetch(`/api/spots/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("삭제 실패");
  await loadMySpots();
}

async function loadMySpots() {
  if (!user) return;
  const res = await fetch("/api/spots?mine=1");
  const json = await res.json();
  const list = json.spots || [];
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

els.refreshBtn.onclick = async () => {
  try {
    await fetchCherry();
  } catch (error) {
    setStatus(`오류: ${error.message}`);
  }
};

els.fitKoreaBtn.onclick = () => {
  map.setView([36.35, 127.8], 7, { animate: true });
};

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

els.loginBtn.onclick = async () => {
  try {
    await login();
  } catch (error) {
    alert(error.message);
  }
};

els.registerBtn.onclick = async () => {
  try {
    await register();
  } catch (error) {
    alert(error.message);
  }
};

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

map.on("moveend", () => {
  if (map.getZoom() >= 8) {
    fetchCherry().catch((err) => setStatus(`오류: ${err.message}`));
  }
});

map.on("click", (event) => {
  if (!isManualPickEnabled()) return;
  clearManualPickMarker();
  manualPickMarker = L.circleMarker(event.latlng, {
    radius: 8,
    weight: 2,
    color: "#175f3f",
    fillColor: "#74cf9c",
    fillOpacity: 0.92
  }).addTo(manualPickLayer);
  manualPickMarker.bindPopup("직접 선택한 위치").openPopup();
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
});

(async function boot() {
  try {
    initPanels();
    setSelectedSpotHint();
    await authMe();
    if (user) await loadMySpots();
    else els.savedSpotList.innerHTML = '<div class="item">로그인 후 조회</div>';
    await fetchCherry();
  } catch (error) {
    setStatus(`초기화 오류: ${error.message}`);
  }
})();
