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
  leftPanel: document.getElementById("leftPanel"),
  rightPanel: document.getElementById("rightPanel"),
  toggleSearchPanelBtn: document.getElementById("toggleSearchPanelBtn"),
  closeAccountPanelBtn: document.getElementById("closeAccountPanelBtn"),
  accountFabBtn: document.getElementById("accountFabBtn"),
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
  saveAdminSpotBtn: document.getElementById("saveAdminSpotBtn")
};

let user = null;
let features = [];
let filtered = [];
let selectedFeature = null;
let lastMeta = null;
let mySpotCount = 0;
let fabAutoMode = true;
const markerLayer = L.layerGroup().addTo(map);
const manualPickLayer = L.layerGroup().addTo(map);
const markerMap = new Map();
let manualPickMarker = null;
let adminSelectedPoint = null;

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
    const showAdmin = isAdminUser();
    els.adminSpotBox.classList.toggle("hidden", !showAdmin);
    if (!showAdmin) {
      adminSelectedPoint = null;
      if (els.enableAdminPickToggle) els.enableAdminPickToggle.checked = false;
      setAdminSelectedSpotHint();
    }
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

function setAdminSelectedSpotHint() {
  if (!els.adminSelectedSpotText) return;
  if (!isAdminUser()) {
    els.adminSelectedSpotText.textContent = "관리자 계정으로 로그인하면 사용할 수 있습니다.";
    return;
  }
  els.adminSelectedSpotText.textContent = isAdminPickEnabled()
    ? "지도에서 등록할 좌표를 클릭하세요."
    : "체크박스를 켜고 지도를 클릭해 좌표를 선택하세요.";
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
    ? ` | OSM ${lastMeta.overpass} + 추천 ${lastMeta.curated} + 내부DB ${lastMeta.internal || 0} + 커뮤니티 ${lastMeta.community}${lastMeta.cached ? " (cache)" : ""}${lastMeta.overpassError ? " | OSM 장애(폴백)" : ""}`
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
  if (kind === "tree") return { radius: 5.5, stroke: "#b03a76", fill: "#ff8fc4" };
  if (kind === "curated") return { radius: 7.5, stroke: "#962d66", fill: "#ff6fb2" };
  if (kind === "internal") return { radius: 8, stroke: "#2f6a47", fill: "#6dcf98" };
  if (kind === "community") return { radius: 7, stroke: "#a83871", fill: "#ff7fbb" };
  return { radius: 7, stroke: "#ad3d75", fill: "#ff9bc9" };
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
  if (!isAdminUser()) throw new Error("관리자 권한이 필요합니다.");
  if (!adminSelectedPoint) throw new Error("먼저 관리자 등록 좌표를 지도에서 클릭하세요.");

  const name = els.adminSpotNameInput.value.trim();
  if (!name) throw new Error("스팟 이름을 입력하세요.");

  const res = await fetch("/api/admin/cherry-spots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      name,
      lat: adminSelectedPoint.lat,
      lon: adminSelectedPoint.lon,
      region: els.adminSpotRegionInput.value.trim(),
      memo: els.adminSpotMemoInput.value.trim()
    })
  });
  const json = await parseJsonSafe(res);
  if (!res.ok) handleApiErrorBody(json, "관리자 등록 실패");

  els.adminSpotNameInput.value = "";
  els.adminSpotRegionInput.value = "";
  els.adminSpotMemoInput.value = "";
  adminSelectedPoint = null;
  clearManualPickMarker();
  setAdminSelectedSpotHint();
  await fetchCherry();
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
      adminSelectedPoint = null;
      clearManualPickMarker();
    }
    setAdminSelectedSpotHint();
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
      alert(error.message);
    }
  };
}

map.on("moveend", () => {
  if (map.getZoom() >= 8) {
    fetchCherry().catch((err) => setStatus(`오류: ${err.message}`));
  }
});

map.on("click", (event) => {
  const allowManual = isManualPickEnabled();
  const allowAdmin = isAdminUser() && isAdminPickEnabled();
  if (!allowManual && !allowAdmin) return;
  clearManualPickMarker();
  manualPickMarker = L.circleMarker(event.latlng, {
    radius: 8,
    weight: 2,
    color: "#175f3f",
    fillColor: "#74cf9c",
    fillOpacity: 0.92
  }).addTo(manualPickLayer);
  manualPickMarker.bindPopup(allowAdmin ? "관리자 등록 좌표" : "직접 선택한 위치").openPopup();
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
    adminSelectedPoint = {
      lat: event.latlng.lat,
      lon: event.latlng.lng
    };
    els.adminSelectedSpotText.textContent = `선택됨 (${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)})`;
  }
});

(async function boot() {
  try {
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
