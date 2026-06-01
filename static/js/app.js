/* =========================================
   Media Player Pro v7.0 — Frontend JS
   YANGILIKLAR v7.0:
   1. Picture-in-Picture rejimi
   2. Screenshot olish
   3. Loop/segment takrorlash rejimi
   4. Papka kuzatish (Watch Folder)
   5. Fayl nomini o'zgartirish (Rename)
   6. Butun papkani import qilish
   7. Ko'rish statistikasi grafigi (Chart.js)
   8. Top media reytingi sahifasi
   9. Ko'rish vaqti hisobi
   10. Izoh (comment) qoldirish
   ========================================= */

// ── STATE ──────────────────────────────────
const State = {
  currentPage: "home",
  viewMode: "grid",
  libPage: 1,
  libLimit: 24,
  player: {
    mediaId: null,
    mediaType: null,
    seeking: false,
    isMuted: false,
    savedVol: 80,
    playlistId: null,
    playlistItems: [],
    playlistIndex: -1,
    loopEnabled: false,
    loopStart: 0,
    loopEnd: 0,
    loopTimer: null,
    watchStartTime: null,
  },
  searchTimer: null,
  categories: [],
  uploadFiles: [],
  adminTab: "media",
  theme: localStorage.getItem("theme") || "dark",
  currentPlaylistId: null,
  charts: {},
};

// ── DOM HELPERS ────────────────────────────
const $ = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

// ── THEME ──────────────────────────────────
function applyTheme(t) {
  State.theme = t;
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("theme", t);
  const btn = $("themeToggle");
  if (btn) btn.textContent = t === "dark" ? "☀ Yorug'" : "🌙 Qorong'i";
}
function toggleTheme() { applyTheme(State.theme === "dark" ? "light" : "dark"); }

// ── API ────────────────────────────────────
async function api(path, opts = {}) {
  try {
    const res = await fetch(path, {
      headers: opts.body && typeof opts.body === "string"
        ? { "Content-Type": "application/json" } : {},
      ...opts,
    });
    return await res.json();
  } catch (e) { console.error("API error:", path, e); return null; }
}
async function apiPost(path, data) { return api(path, { method: "POST", body: JSON.stringify(data) }); }
async function apiDel(path) { return api(path, { method: "DELETE" }); }
async function apiPut(path, data) { return api(path, { method: "PUT", body: JSON.stringify(data) }); }

// ── TOAST ──────────────────────────────────
let toastTimer;
function toast(msg, kind = "info", dur = 3000) {
  const t = $("toast");
  t.className = `toast ${kind}`;
  const icons = { info: "ℹ", success: "✅", error: "❌", warn: "⚠" };
  t.textContent = `${icons[kind] || "ℹ"}  ${msg}`;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), dur);
}

// ── NAVIGATION ─────────────────────────────
function navigate(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const pg = $(`page-${page}`);
  if (pg) pg.classList.add("active");
  const btn = document.querySelector(`[data-page="${page}"]`);
  if (btn) btn.classList.add("active");
  State.currentPage = page;
  if (page === "home")       loadHome();
  else if (page === "library")   { loadCategories(); loadLibrary(); loadGenres(); }
  else if (page === "upload")    loadUploadCategories();
  else if (page === "playlists") loadPlaylists();
  else if (page === "history")   loadHistory();
  else if (page === "admin")     loadAdminTab("media");
  else if (page === "stats")     loadStatsPage();
  else if (page === "top")       loadTopPage();
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => navigate(btn.dataset.page));
});

// ── FORMAT HELPERS ─────────────────────────
function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes > 1073741824) return (bytes / 1073741824).toFixed(1) + " GB";
  if (bytes > 1048576)    return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1024).toFixed(0) + " KB";
}
function fmtTime(ms) {
  if (!ms) return "0:00";
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  const sec = s % 60, min = m % 60;
  return h ? `${h}:${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")}`
           : `${min}:${String(sec).padStart(2,"0")}`;
}
function fmtSeconds(sec) {
  if (!sec) return "0 daqiqa";
  if (sec < 60) return `${sec} soniya`;
  if (sec < 3600) return `${Math.floor(sec/60)} daqiqa`;
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60);
  return `${h} soat ${m > 0 ? m + " daqiqa" : ""}`.trim();
}
function fmtDate(str) {
  if (!str) return "—";
  return str.substring(0, 16).replace("T", " ");
}
function stars(rating) {
  const n = Math.round(rating || 0);
  return "⭐".repeat(n) || "☆☆☆☆☆";
}
function escHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}


// ── HOME ───────────────────────────────────
async function loadHome() {
  const data = await api("/api/home");
  if (!data) return;
  const sg = $("statsGrid"), s = data.stats;
  const items = [
    ["🎬","Videolar",    s.videos,          "var(--accent)"],
    ["🎵","Audio",       s.audio,           "var(--accent-warn)"],
    ["🖼","Rasmlar",     s.images,          "var(--accent-purple)"],
    ["📚","Kitoblar",    s.books,           "var(--accent-orange)"],
    ["❤","Sevimlilar",  s.favorites,       "var(--accent-danger)"],
    ["🎵","Pleylistlar", s.playlists,       "var(--accent)"],
    ["⏱","Ko'rish vaqti", `${s.total_watch_h}h`, "var(--accent-success)"],
    ["📁","Jami",        s.total,           "var(--text-secondary)"],
  ];
  sg.innerHTML = items.map(([icon, label, val, color]) => `
    <div class="stat-card">
      <div class="stat-val" style="color:${color}">${val}</div>
      <div class="stat-label">${icon} ${label}</div>
    </div>`).join("");

  const cs = $("continueSection");
  if (data.continue_watching?.length > 0) {
    cs.innerHTML = `<h2 class="section-hdr">⏯ Ko'rishni davom ettiring</h2>
      <div class="continue-scroll">${data.continue_watching.map(m => `
        <div class="continue-card" onclick="openPlayer(${m.id})">
          <div class="continue-title">${escHtml(m.title)}</div>
          <div class="mini-progress"><div class="mini-progress-fill" style="width:${m.pct}%"></div></div>
          <div class="continue-pct">${m.pct.toFixed(0)}% ko'rildi</div>
          <button class="btn btn-primary btn-sm">▶ Davom</button>
        </div>`).join("")}</div>`;
  } else cs.innerHTML = "";

  const rs = $("recentSection");
  if (data.recent?.length > 0) {
    rs.innerHTML = `<h2 class="section-hdr">🕐 Oxirgi qo'shilganlar</h2>
      <div class="media-grid">${data.recent.map(m => mediaCard(m)).join("")}</div>`;
  } else {
    rs.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div>
      <p>Hozircha media yo'q.</p><br>
      <button class="btn btn-primary" onclick="navigate('upload')">📤 Media yuklash</button></div>`;
  }
}

// ── LIBRARY ────────────────────────────────
let libCurrentPage = 1, searchDebounce;
function debounceSearch() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => { libCurrentPage = 1; loadLibrary(); }, 350);
}

async function loadLibrary(page) {
  if (page) libCurrentPage = page;
  const grid = $("mediaGrid");
  grid.innerHTML = `<div class="loading"><div class="spinner"></div> Yuklanmoqda...</div>`;
  const params = new URLSearchParams({
    search:      $("libSearch").value,
    type:        $("libType").value,
    category_id: $("libCategory").value,
    genre:       $("libGenre").value,
    favorites:   $("libFav").checked,
    sort:        $("libSort").value,
    page:        libCurrentPage,
    limit:       State.libLimit,
  });
  const data = await api(`/api/media?${params}`);
  if (!data) { grid.innerHTML = `<div class="empty-state"><p>Xato yuz berdi</p></div>`; return; }
  const { media } = data;
  if (!media.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>Hech narsa topilmadi</p></div>`;
    $("libPagination").innerHTML = "";
    return;
  }
  if (State.viewMode === "grid") {
    grid.className = "media-grid";
    grid.innerHTML = media.map(m => mediaCard(m)).join("");
  } else {
    grid.className = "media-grid list-view";
    grid.innerHTML = media.map(m => listItem(m)).join("");
  }
  const pag = $("libPagination");
  const hasPrev = libCurrentPage > 1, hasNext = media.length === State.libLimit;
  if (hasPrev || hasNext) {
    pag.innerHTML = `
      ${hasPrev ? `<button class="page-btn" onclick="loadLibrary(${libCurrentPage-1})">← Oldingi</button>` : ""}
      <span class="page-btn active">${libCurrentPage}</span>
      ${hasNext ? `<button class="page-btn" onclick="loadLibrary(${libCurrentPage+1})">Keyingi →</button>` : ""}`;
  } else pag.innerHTML = "";
}

async function loadCategories() {
  const cats = await api("/api/categories");
  if (!cats) return;
  State.categories = cats;
  const sel = $("libCategory"), current = sel.value;
  sel.innerHTML = `<option value="">Barcha kategoriyalar</option>` +
    cats.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  sel.value = current;
}

async function loadGenres() {
  const genres = await api("/api/genres");
  if (!genres) return;
  const sel = $("libGenre"), current = sel.value;
  sel.innerHTML = `<option value="">Barcha janrlar</option>` +
    genres.map(g => `<option value="${g}">${g}</option>`).join("");
  sel.value = current;
}

function setView(mode) {
  State.viewMode = mode;
  $("gridViewBtn").classList.toggle("active", mode === "grid");
  $("listViewBtn").classList.toggle("active", mode === "list");
  loadLibrary();
}

// ── MEDIA CARD HTML ────────────────────────
function mediaTypeIcon(type) {
  return { video:"🎬", audio:"🎵", image:"🖼", book:"📚" }[type] || "📄";
}

function mediaCard(m) {
  const emoji = mediaTypeIcon(m.media_type);
  const pos = parseInt(m.saved_position) || 0;
  const dur = parseInt(m.saved_duration) || 0;
  const pct = dur > 0 ? Math.round(pos * 100 / dur) : 0;
  const fav = m.is_favorite ? 1 : 0;
  let playBtn = `<button class="card-btn play" onclick="openPlayer(${m.id})">▶ Play</button>`;
  if (m.media_type === "image") playBtn = `<button class="card-btn play" onclick="openImageViewer(${m.id})">🔍 Ko'r</button>`;
  else if (m.media_type === "book") playBtn = `<button class="card-btn play" onclick="openBookViewer(${m.id})">📖 O'qi</button>`;

  return `<div class="media-card">
    <div class="card-thumb">
      <span>${emoji}</span>
      <div class="card-play-overlay" onclick="${m.media_type==='image'?`openImageViewer(${m.id})`:m.media_type==='book'?`openBookViewer(${m.id})`:`openPlayer(${m.id})`}">▶</div>
    </div>
    <div class="card-body">
      <div class="card-title" title="${escHtml(m.title)}">${escHtml(m.title)}</div>
      <div class="card-meta">
        <span>${m.category_name?`<span class="cat-dot" style="background:${m.category_color||"#58a6ff"}"></span>${escHtml(m.category_name)}`:"—"}</span>
        <span>${m.year>0?m.year:""}</span>
      </div>
      <div class="card-meta">
        <span class="stars">${stars(m.rating)} ${(m.rating||0).toFixed(1)}</span>
        <span style="color:var(--text-muted)">${fmtSize(m.file_size)}</span>
      </div>
      ${pct>0?`<div class="card-progress"><div class="card-progress-fill" style="width:${pct}%"></div></div>`:""}
    </div>
    <div class="card-actions">
      <button class="card-btn fav ${fav?"active":""}" onclick="toggleFav(${m.id},this)">${fav?"❤":"♡"}</button>
      ${playBtn}
      <button class="card-btn" onclick="showAddToPlaylist(${m.id})" title="Pleylistga qo'sh">➕</button>
      <button class="card-btn" onclick="openEdit(${m.id})">✏</button>
      <button class="card-btn" onclick="openRenameModal(${m.id})" title="Nomini o'zgartir">🏷</button>
      <button class="card-btn danger" onclick="deleteMedia(${m.id})">🗑</button>
    </div>
  </div>`;
}

function listItem(m) {
  const emoji = mediaTypeIcon(m.media_type);
  const action = m.media_type==="image"?`openImageViewer(${m.id})`:m.media_type==="book"?`openBookViewer(${m.id})`:`openPlayer(${m.id})`;
  return `<div class="list-item">
    <span class="list-item-icon">${emoji}</span>
    <div class="list-item-info">
      <div class="list-item-title">${escHtml(m.title)}</div>
      <div class="list-item-meta">
        ${m.category_name?escHtml(m.category_name)+" · ":""}
        ${m.year>0?m.year+" · ":""}${stars(m.rating)} ${(m.rating||0).toFixed(1)} · ${fmtSize(m.file_size)}
        ${m.views?` · 👁 ${m.views}`:""}
      </div>
    </div>
    <div class="list-item-actions">
      <button class="btn btn-primary btn-sm" onclick="${action}">▶</button>
      <button class="btn btn-sm" onclick="openRenameModal(${m.id})">🏷</button>
      <button class="btn btn-sm" onclick="showAddToPlaylist(${m.id})">➕</button>
      <button class="btn btn-sm" onclick="openEdit(${m.id})">✏</button>
      <button class="btn btn-sm" onclick="deleteMedia(${m.id})" style="color:var(--accent-danger)">🗑</button>
    </div>
  </div>`;
}


// ── MEDIA ACTIONS ──────────────────────────
async function toggleFav(id, btn) {
  const res = await apiPost(`/api/media/${id}/favorite`, {});
  if (res) {
    btn.textContent = res.is_favorite ? "❤" : "♡";
    btn.classList.toggle("active", res.is_favorite);
    toast(res.is_favorite ? "Sevimlilar qo'shildi ❤" : "Sevimlilardan olib tashlandi", "info");
  }
}

async function deleteMedia(id) {
  if (!confirm("Bu mediani o'chirishni tasdiqlaysizmi?")) return;
  const res = await api(`/api/media/${id}`, { method: "DELETE" });
  if (res?.ok) {
    toast("Media o'chirildi", "success");
    if (State.currentPage === "library") loadLibrary();
    else if (State.currentPage === "home") loadHome();
    else if (State.currentPage === "playlists" && State.currentPlaylistId) openPlaylist(State.currentPlaylistId);
  }
}

// ── RENAME MODAL ───────────────────────────
async function openRenameModal(id) {
  const m = await api(`/api/media/${id}`);
  if (!m) return;
  $("renameId").value   = id;
  $("renameTitle").value = m.title || "";
  const filename = m.file_path ? m.file_path.split(/[\\/]/).pop() : "";
  $("renameFilename").value  = filename;
  $("renameFilenameRow").style.display = m.file_mode === "copy" ? "flex" : "none";
  $("renameModal").style.display = "flex";
  setTimeout(() => $("renameTitle").focus(), 60);
}

function closeRenameModal() { $("renameModal").style.display = "none"; }

async function doRename() {
  const id       = $("renameId").value;
  const title    = $("renameTitle").value.trim();
  const filename = $("renameFilename").value.trim();
  if (!title) { toast("Sarlavha kiritilmagan!", "error"); return; }
  const res = await apiPost(`/api/media/${id}/rename`, { title, filename });
  if (res?.ok) {
    toast("Nom o'zgartirildi ✓", "success");
    closeRenameModal();
    if (State.currentPage === "library") loadLibrary();
    else if (State.currentPage === "home") loadHome();
    else if (State.currentPage === "admin") reloadAdminMedia();
  } else {
    toast(res?.error || "Xato yuz berdi", "error");
  }
}

// ── EDIT MODAL ─────────────────────────────
async function openEdit(id) {
  const m = await api(`/api/media/${id}`);
  if (!m) return;
  $("editId").value    = id;
  $("editTitle").value = m.title || "";
  $("editDesc").value  = m.description || "";
  $("editGenre").value = m.genre || "";
  $("editYear").value  = m.year || new Date().getFullYear();
  $("editRating").value = m.rating || 0;
  await loadEditCategories();
  $("editCategory").value = m.category_id || "";
  $("editModal").style.display = "flex";
}

async function loadEditCategories() {
  if (!State.categories.length) State.categories = await api("/api/categories") || [];
  const sel = $("editCategory");
  sel.innerHTML = `<option value="">— Kategoriyasiz —</option>` +
    State.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
}

function closeEdit() { $("editModal").style.display = "none"; }

async function saveEdit() {
  const id = $("editId").value;
  const data = {
    title:       $("editTitle").value.trim(),
    description: $("editDesc").value.trim(),
    genre:       $("editGenre").value.trim(),
    year:        parseInt($("editYear").value) || 0,
    rating:      parseFloat($("editRating").value) || 0,
    category_id: parseInt($("editCategory").value) || null,
  };
  if (!data.title) { toast("Sarlavha kiritilmagan!", "error"); return; }
  const res = await apiPut(`/api/media/${id}`, data);
  if (res?.ok) {
    toast("Saqlandi ✓", "success"); closeEdit();
    if (State.currentPage === "library") loadLibrary();
    else if (State.currentPage === "home") loadHome();
    else if (State.currentPage === "playlists" && State.currentPlaylistId) openPlaylist(State.currentPlaylistId);
  }
}

// ── VIDEO/AUDIO PLAYER ─────────────────────
async function openPlayer(id, playlistId, playlistItems, plIndex) {
  // Agar modal allaqachon ochiq va xuddi shu media bo'lsa — qayta yuklamaslik
  if (State.player.mediaId === id && $("playerModal").style.display !== "none") return;

  const m = await api(`/api/media/${id}`);
  if (!m) { toast("Media topilmadi", "error"); return; }
  if (m.media_type === "image") { openImageViewer(id); return; }
  if (m.media_type === "book")  { openBookViewer(id); return; }

  State.player.mediaId       = id;
  State.player.mediaType     = m.media_type;
  State.player.playlistId    = playlistId || null;
  State.player.playlistItems = playlistItems || [];
  State.player.playlistIndex = plIndex !== undefined ? plIndex : -1;
  State.player.loopEnabled   = false;
  State.player.watchStartTime = Date.now();

  $("playerTitle").textContent = m.title;
  $("playerModal").style.display = "flex";

  const vid = $("videoEl"), aud = $("audioEl");
  const streamUrl = `/api/stream/${id}`;

  const plNav = $("playerPlaylistNav");
  if (plNav) {
    if (State.player.playlistItems.length > 1) {
      plNav.style.display = "flex";
      $("plPrevBtn").disabled = State.player.playlistIndex <= 0;
      $("plNextBtn").disabled = State.player.playlistIndex >= State.player.playlistItems.length - 1;
    } else plNav.style.display = "none";
  }

  if (m.media_type === "audio") {
    vid.style.display = "none"; aud.style.display = "block"; aud.src = streamUrl;
  } else {
    vid.style.display = "block"; aud.style.display = "none"; vid.src = streamUrl;
  }

  // setupPlayerEvents AVVAL chaqirilsin, keyin progress — shunda eventlar ishlaydi
  const mediaEl = m.media_type === "audio" ? aud : vid;
  setupPlayerEvents(mediaEl, id);

  // Keyingi eventlar uchun yangilangan elementni olish (cloneNode sabab)
  const activeEl = getMediaEl();

  // Progress resume
  const progress = await api(`/api/media/${id}/progress`);
  if (progress?.position > 1000) {
    if (activeEl.readyState >= 1) {
      activeEl.currentTime = progress.position / 1000;
    } else {
      activeEl.addEventListener("loadedmetadata", function onLoad() {
        activeEl.currentTime = progress.position / 1000;
        activeEl.removeEventListener("loadedmetadata", onLoad);
      });
    }
  }

  $("playerInfo").innerHTML = [
    m.media_type === "video" ? "🎬 Video" : "🎵 Audio",
    m.category_name ? `🏷 ${escHtml(m.category_name)}` : "",
    m.year > 0 ? `📆 ${m.year}` : "",
    (m.rating||0) > 0 ? `⭐ ${m.rating.toFixed(1)}` : "",
    m.genre ? `🎭 ${escHtml(m.genre)}` : "",
    m.file_size ? `💾 ${fmtSize(m.file_size)}` : "",
    m.views ? `👁 ${m.views} marta` : "",
  ].filter(Boolean).map(t => `<span>${t}</span>`).join("");

  const vol = parseInt(localStorage.getItem("vol") || "80");
  $("volBar").value = vol;
  $("volLabel").textContent = vol + "%";
  activeEl.volume = vol / 100;

  // Reset loop state
  State.player.loopStart = 0;
  State.player.loopEnd   = 0;
  updateLoopUI();

  activeEl.play().catch(() => { $("playerStatus").textContent = "▶ Play tugmasini bosing"; });
}

function setupPlayerEvents(el, mediaId) {
  const newEl = el.cloneNode(true);
  el.parentNode.replaceChild(newEl, el);
  const mediaEl = newEl;
  if (mediaEl.id === "videoEl") window._videoEl = mediaEl;
  else window._audioEl = mediaEl;

  // Progress throttle: faqat har 10 soniyada bir marta saqlash
  let lastSavedSec = -1;

  mediaEl.onloadedmetadata = () => {
    $("playerStatus").textContent = "✅ Tayyor";
    $("timeDur").textContent = fmtTime(mediaEl.duration * 1000);
    $("seekBar").max = 1000;
    if (!State.player.loopEnd) State.player.loopEnd = mediaEl.duration;
  };

  mediaEl.ontimeupdate = () => {
    if (State.player.seeking) return;
    const pct = mediaEl.duration ? (mediaEl.currentTime / mediaEl.duration) * 1000 : 0;
    $("seekBar").value = pct;
    $("timeCur").textContent = fmtTime(mediaEl.currentTime * 1000);

    // Loop segment
    if (State.player.loopEnabled && State.player.loopEnd > State.player.loopStart) {
      if (mediaEl.currentTime >= State.player.loopEnd) {
        mediaEl.currentTime = State.player.loopStart;
      }
    }

    // Progress: har 10 soniyada faqat bir marta saqlash
    const curSec = Math.floor(mediaEl.currentTime / 10);
    if (curSec !== lastSavedSec && mediaEl.duration > 0) {
      lastSavedSec = curSec;
      apiPost(`/api/media/${mediaId}/progress`, {
        position: Math.floor(mediaEl.currentTime * 1000),
        duration: Math.floor(mediaEl.duration * 1000),
      });
    }
  };

  mediaEl.onplay  = () => { $("playBtn").textContent = "⏸"; $("overlayIcon").style.display = "none"; };
  mediaEl.onpause = () => { $("playBtn").textContent = "▶"; $("overlayIcon").style.display = "flex"; };
  mediaEl.onended = () => {
    $("playBtn").textContent = "▶";
    $("playerStatus").textContent = "⏹ Tugadi";
    if (mediaEl.duration > 0) {
      apiPost(`/api/media/${mediaId}/progress`, {
        position: Math.floor(mediaEl.duration * 1000),
        duration: Math.floor(mediaEl.duration * 1000),
      });
    }
    saveWatchTime();
    playlistNext();
  };
  mediaEl.onerror   = () => { $("playerStatus").textContent = "❌ Fayl yuklanmadi"; };
  mediaEl.onwaiting = () => { $("playerStatus").textContent = "⏳ Bufferlanmoqda..."; };
  mediaEl.oncanplay = () => { $("playerStatus").textContent = "✅ Tayyor"; };
}

function getMediaEl() {
  return State.player.mediaType === "audio"
    ? (window._audioEl || $("audioEl"))
    : (window._videoEl || $("videoEl"));
}

function togglePlay() { const el = getMediaEl(); if (!el) return; el.paused ? el.play() : el.pause(); }
function seekRelative(sec) {
  const el = getMediaEl();
  if (!el) return;
  el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + sec));
}
function onSeekMove(val) {
  State.player.seeking = true;
  const el = getMediaEl();
  if (!el || !el.duration) return;
  $("timeCur").textContent = fmtTime((val / 1000) * el.duration * 1000);
}
function onSeekRelease(val) {
  const el = getMediaEl();
  if (el?.duration) el.currentTime = (val / 1000) * el.duration;
  setTimeout(() => { State.player.seeking = false; }, 100);
}
function setVolume(val) {
  const el = getMediaEl();
  if (el) el.volume = val / 100;
  $("volLabel").textContent = val + "%";
  localStorage.setItem("vol", val);
  State.player.savedVol = parseInt(val);
  $("muteBtn").textContent = val == 0 ? "🔇" : val < 50 ? "🔉" : "🔊";
}
function toggleMute() {
  const el = getMediaEl();
  if (!el) return;
  State.player.isMuted = !State.player.isMuted;
  el.muted = State.player.isMuted;
  $("muteBtn").textContent = State.player.isMuted ? "🔇" : "🔊";
}
function setSpeed(val) { const el = getMediaEl(); if (el) el.playbackRate = parseFloat(val); }

function toggleFullscreen() {
  const wrap = (window._videoEl || $("videoEl")).parentElement;
  if (!document.fullscreenElement) {
    (wrap.requestFullscreen || wrap.webkitRequestFullscreen || wrap.mozRequestFullScreen).call(wrap);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
}

function saveWatchTime() {
  if (!State.player.watchStartTime || !State.player.mediaId) return;
  const seconds = Math.round((Date.now() - State.player.watchStartTime) / 1000);
  if (seconds > 5) {
    apiPost(`/api/media/${State.player.mediaId}/watch-time`, { seconds });
  }
  State.player.watchStartTime = null;
}

function closePlayer() {
  const mediaId = State.player.mediaId;
  const el = getMediaEl();
  if (el && !el.paused && el.duration > 0) {
    apiPost(`/api/media/${mediaId}/progress`, {
      position: Math.floor(el.currentTime * 1000),
      duration: Math.floor(el.duration * 1000),
    });
  }
  saveWatchTime();
  if (window._videoEl) { window._videoEl.pause(); window._videoEl.src = ""; }
  if (window._audioEl) { window._audioEl.pause(); window._audioEl.src = ""; }
  $("playerModal").style.display = "none";
  State.player.mediaId       = null;
  State.player.playlistItems = [];
  State.player.playlistIndex = -1;
  State.player.loopEnabled   = false;
  clearTimeout(State.player.loopTimer);
}

function playlistPrev() {
  const { playlistItems, playlistIndex } = State.player;
  if (playlistIndex > 0) openPlayer(playlistItems[playlistIndex-1].id, State.player.playlistId, playlistItems, playlistIndex-1);
}
function playlistNext() {
  const { playlistItems, playlistIndex } = State.player;
  if (playlistIndex >= 0 && playlistIndex < playlistItems.length - 1)
    openPlayer(playlistItems[playlistIndex+1].id, State.player.playlistId, playlistItems, playlistIndex+1);
}


// ══════════════════════════════════════════
// 1. PICTURE-IN-PICTURE (PiP)
// ══════════════════════════════════════════
async function togglePiP() {
  const vid = window._videoEl || $("videoEl");
  if (!vid || State.player.mediaType !== "video") {
    toast("PiP faqat video uchun ishlaydi", "warn"); return;
  }
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      $("pipBtn").textContent = "📺 PiP";
      toast("PiP yopildi", "info");
    } else {
      await vid.requestPictureInPicture();
      $("pipBtn").textContent = "📺 PiP ✓";
      toast("Picture-in-Picture rejimi yoqildi!", "success");
    }
  } catch (e) {
    toast("Brauzer PiP-ni qo'llab-quvvatlamaydi", "error");
  }
}

// ══════════════════════════════════════════
// 2. SCREENSHOT OLISH
// ══════════════════════════════════════════
function takeScreenshot() {
  const vid = window._videoEl || $("videoEl");
  if (!vid || vid.readyState < 2) { toast("Video hali yuklanmadi", "warn"); return; }
  try {
    const canvas = document.createElement("canvas");
    canvas.width  = vid.videoWidth  || 1280;
    canvas.height = vid.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    const link = document.createElement("a");
    const time = Math.floor(vid.currentTime);
    link.download = `screenshot_${State.player.mediaId}_${time}s.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast("Screenshot saqlandi 📸", "success");
  } catch (e) {
    toast("Screenshot olishda xato: " + e.message, "error");
  }
}

// ══════════════════════════════════════════
// 3. LOOP (TAKRORLASH) REJIMI
// ══════════════════════════════════════════
function toggleLoop() {
  State.player.loopEnabled = !State.player.loopEnabled;
  const el = getMediaEl();
  if (el && !State.player.loopStart && !State.player.loopEnd) {
    // Butun mediani loop
    el.loop = State.player.loopEnabled && State.player.loopStart === 0;
  }
  updateLoopUI();
  toast(State.player.loopEnabled ? "Loop yoqildi 🔁" : "Loop o'chirildi", "info");
}

function setLoopStart() {
  const el = getMediaEl();
  if (!el) return;
  State.player.loopStart = el.currentTime;
  updateLoopUI();
  toast(`Loop boshi: ${fmtTime(el.currentTime * 1000)}`, "info");
}

function setLoopEnd() {
  const el = getMediaEl();
  if (!el) return;
  State.player.loopEnd = el.currentTime;
  updateLoopUI();
  toast(`Loop oxiri: ${fmtTime(el.currentTime * 1000)}`, "info");
}

function resetLoop() {
  const el = getMediaEl();
  State.player.loopStart   = 0;
  State.player.loopEnd     = el ? el.duration : 0;
  State.player.loopEnabled = false;
  if (el) el.loop = false;
  updateLoopUI();
  toast("Loop tozalandi", "info");
}

function updateLoopUI() {
  const btn = $("loopBtn");
  if (btn) {
    btn.classList.toggle("active", State.player.loopEnabled);
    btn.textContent = State.player.loopEnabled ? "🔁 Loop ✓" : "🔁 Loop";
  }
  const info = $("loopInfo");
  if (info) {
    if (State.player.loopStart > 0 || (State.player.loopEnd > 0 && State.player.loopEnd < (getMediaEl()?.duration || 999))) {
      info.textContent = `[${fmtTime(State.player.loopStart*1000)} — ${fmtTime(State.player.loopEnd*1000)}]`;
      info.style.display = "inline";
    } else {
      info.textContent = "";
      info.style.display = "none";
    }
  }
}

// ── IMAGE VIEWER ───────────────────────────
async function openImageViewer(id) {
  const m = await api(`/api/media/${id}`);
  if (!m) return;
  $("imageViewerTitle").textContent = m.title;
  $("imageViewerImg").src = `/api/stream/${id}`;
  $("imageViewerInfo").innerHTML = [
    m.category_name ? `🏷 ${escHtml(m.category_name)}` : "",
    m.description ? escHtml(m.description) : "",
  ].filter(Boolean).join(" · ");
  $("imageViewerModal").style.display = "flex";
}
function closeImageViewer() { $("imageViewerModal").style.display = "none"; }

// ── BOOK VIEWER ────────────────────────────
async function openBookViewer(id) {
  const m = await api(`/api/media/${id}`);
  if (!m) return;
  $("bookViewerTitle").textContent = m.title;
  const ext = m.file_path ? m.file_path.split(".").pop().toLowerCase() : "";
  if (ext === "pdf") {
    $("bookViewerFrame").src = `/api/stream/${id}`;
    $("bookViewerFrame").style.display = "block";
    $("bookViewerText").style.display  = "none";
  } else if (ext === "txt") {
    $("bookViewerFrame").style.display = "none";
    $("bookViewerText").style.display  = "block";
    $("bookViewerText").innerHTML = `<div style="padding:20px;text-align:center"><div class="spinner" style="margin:0 auto 12px"></div></div>`;
    try {
      const txt = await (await fetch(`/api/stream/${id}`)).text();
      $("bookViewerText").innerHTML = `<pre style="white-space:pre-wrap;word-break:break-word;font-size:14px;padding:20px;max-height:65vh;overflow:auto;text-align:left">${escHtml(txt)}</pre>`;
    } catch { $("bookViewerText").innerHTML = `<p style="padding:20px;color:var(--accent-danger)">❌ O'qib bo'lmadi</p>`; }
  } else {
    $("bookViewerFrame").style.display = "none";
    $("bookViewerText").style.display  = "block";
    $("bookViewerText").innerHTML = `<div style="padding:32px;text-align:center">
      <p style="font-size:56px">📚</p>
      <p style="font-size:18px;font-weight:600;margin:12px 0">${escHtml(m.title)}</p>
      <a href="/api/stream/${id}" target="_blank" class="btn btn-primary" style="display:inline-block;margin:4px">🔗 Ochish</a>
      <a href="/api/stream/${id}" download class="btn" style="display:inline-block;margin:4px">⬇ Yuklash</a>
    </div>`;
  }
  $("bookViewerModal").style.display = "flex";
}
function closeBookViewer() { $("bookViewerModal").style.display = "none"; }

// ══════════════════════════════════════════
// 10. IZOHLAR (COMMENTS)
// ══════════════════════════════════════════
async function openCommentsModal(mediaId) {
  $("commentsMediaId").value = mediaId;
  $("commentsModal").style.display = "flex";
  $("newCommentText").value = "";
  await loadComments(mediaId);
}

function closeCommentsModal() { $("commentsModal").style.display = "none"; }

async function loadComments(mediaId) {
  const list = $("commentsList");
  list.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const comments = await api(`/api/media/${mediaId}/comments`);
  if (!comments || !comments.length) {
    list.innerHTML = `<div class="empty-state" style="padding:20px"><div class="empty-icon" style="font-size:32px">💬</div><p>Hozircha izoh yo'q</p></div>`;
    return;
  }
  list.innerHTML = comments.map(c => `
    <div class="comment-item" id="comment-${c.id}">
      <div class="comment-content">${escHtml(c.content)}</div>
      <div class="comment-meta">
        <span>🕐 ${fmtDate(c.created_at)}</span>
        <button class="btn btn-sm" style="color:var(--accent-danger);padding:2px 6px;font-size:11px"
          onclick="deleteComment(${c.id}, ${mediaId})">🗑</button>
      </div>
    </div>`).join("");
}

async function addComment() {
  const mediaId = parseInt($("commentsMediaId").value);
  const content = $("newCommentText").value.trim();
  if (!content) { toast("Izoh bo'sh bo'lishi mumkin emas", "warn"); return; }
  const res = await apiPost(`/api/media/${mediaId}/comments`, { content });
  if (res?.ok) {
    $("newCommentText").value = "";
    await loadComments(mediaId);
    toast("Izoh qo'shildi ✓", "success");
  }
}

async function deleteComment(commentId, mediaId) {
  if (!confirm("Izohni o'chirishni tasdiqlaysizmi?")) return;
  await api(`/api/comments/${commentId}`, { method: "DELETE" });
  await loadComments(mediaId);
  toast("Izoh o'chirildi", "info");
}


// ══════════════════════════════════════════
// 7. KO'RISH STATISTIKASI GRAFIGI (Chart.js)
// ══════════════════════════════════════════
async function loadStatsPage() {
  const period = ($("statsPeriodSel") || {}).value || "daily";
  const days   = period === "weekly" ? 90 : 30;
  const wrap   = $("statsChartWrap");
  if (!wrap) return;
  wrap.innerHTML = `<div class="loading"><div class="spinner"></div> Yuklanmoqda...</div>`;

  const res = await api(`/api/watch-stats?period=${period}&days=${days}`);
  if (!res) { wrap.innerHTML = `<div class="empty-state"><p>Ma'lumot yo'q</p></div>`; return; }

  const { data, total_seconds } = res;
  $("totalWatchTime").textContent = fmtSeconds(total_seconds);

  if (!data.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><p>Ko'rish tarixi yo'q</p></div>`;
    return;
  }

  wrap.innerHTML = `<canvas id="watchChart" style="max-height:350px"></canvas>`;

  const labels = data.map(d => period === "weekly" ? d.week_label : d.watched_at);
  const values = data.map(d => Math.round(d.total_seconds / 60));

  if (State.charts.watchChart) { State.charts.watchChart.destroy(); delete State.charts.watchChart; }

  const ctx = $("watchChart").getContext("2d");
  const isDark = State.theme === "dark";
  State.charts.watchChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Ko'rish vaqti (daqiqa)",
        data: values,
        backgroundColor: "rgba(88,166,255,0.7)",
        borderColor:     "#58a6ff",
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: isDark ? "#e6edf3" : "#1f2328" } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.y} daqiqa (${fmtSeconds(ctx.parsed.y * 60)})`
          }
        }
      },
      scales: {
        x: { ticks: { color: isDark ? "#8b949e" : "#57606a" }, grid: { color: isDark ? "#21262d" : "#d1d9e0" } },
        y: {
          ticks: { color: isDark ? "#8b949e" : "#57606a", callback: v => v + " daq" },
          grid: { color: isDark ? "#21262d" : "#d1d9e0" }
        }
      }
    }
  });

  // Media bo'yicha top watch time
  await loadWatchTimePerMedia();
}

async function loadWatchTimePerMedia() {
  const wrap = $("watchTimePerMedia");
  if (!wrap) return;
  const top = await api("/api/top-media?sort=views&limit=10");
  if (!top?.length) return;
  wrap.innerHTML = `<h3 class="section-hdr" style="margin-top:24px">⏱ Media bo'yicha ko'rish vaqti</h3>
    <div class="watch-time-list">
      ${top.filter(m => m.total_watch_seconds > 0).map(m => `
        <div class="watch-time-item">
          <span class="wt-icon">${mediaTypeIcon(m.media_type)}</span>
          <div class="wt-info">
            <div class="wt-title">${escHtml(m.title)}</div>
            <div class="wt-bar-wrap">
              <div class="wt-bar" style="width:${Math.min(100, m.total_watch_seconds/3600*20)}%"></div>
            </div>
          </div>
          <span class="wt-time">${fmtSeconds(m.total_watch_seconds)}</span>
        </div>`).join("") || "<p style='color:var(--text-muted);padding:12px'>Ma'lumot yo'q</p>"}
    </div>`;
}

// ══════════════════════════════════════════
// 8. TOP MEDIA REYTINGI
// ══════════════════════════════════════════
async function loadTopPage() {
  const sortBy = ($("topSortSel") || {}).value || "views";
  const wrap   = $("topMediaList");
  if (!wrap) return;
  wrap.innerHTML = `<div class="loading"><div class="spinner"></div> Yuklanmoqda...</div>`;
  const media = await api(`/api/top-media?sort=${sortBy}&limit=30`);
  if (!media?.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🏆</div><p>Hali media yo'q</p></div>`;
    return;
  }
  wrap.innerHTML = media.map((m, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `<span style="color:var(--text-muted)">#${i+1}</span>`;
    return `<div class="top-media-item">
      <div class="top-rank">${medal}</div>
      <div class="top-icon">${mediaTypeIcon(m.media_type)}</div>
      <div class="top-info">
        <div class="top-title">${escHtml(m.title)}</div>
        <div class="top-meta">
          ${m.category_name ? `<span class="cat-dot" style="background:${m.category_color}"></span>${escHtml(m.category_name)} · ` : ""}
          ${m.year > 0 ? m.year + " · " : ""}
          <span class="stars">${stars(m.rating)}</span> ${(m.rating||0).toFixed(1)}
        </div>
      </div>
      <div class="top-stats">
        <div class="top-stat"><span>👁</span> ${m.views || 0}</div>
        ${m.total_watch_seconds > 0 ? `<div class="top-stat"><span>⏱</span> ${fmtSeconds(m.total_watch_seconds)}</div>` : ""}
      </div>
      <button class="btn btn-primary btn-sm" onclick="openPlayer(${m.id})">▶ Play</button>
    </div>`;
  }).join("");
}


// ══════════════════════════════════════════
// 4. PAPKA KUZATISH (WATCH FOLDER)
// 5. 6. BULK IMPORT
// ══════════════════════════════════════════
async function loadWatchFolders() {
  const list = $("watchFolderList");
  if (!list) return;
  const folders = await api("/api/watch-folders");
  if (!folders?.length) {
    list.innerHTML = `<div class="empty-state" style="padding:20px"><div class="empty-icon" style="font-size:32px">📂</div><p>Kuzatilayotgan papka yo'q</p></div>`;
    return;
  }
  list.innerHTML = folders.map(f => `
    <div class="watch-folder-item ${f.active ? "" : "inactive"}">
      <div class="wf-icon">${f.active ? "👁" : "⏸"}</div>
      <div class="wf-info">
        <div class="wf-path">${escHtml(f.path)}</div>
        <div class="wf-meta">Qo'shilgan: ${fmtDate(f.created_at)}</div>
      </div>
      <div class="wf-actions">
        <button class="btn btn-sm" onclick="scanWatchFolder(${f.id})" title="Skan qilish">🔍 Skan</button>
        <button class="btn btn-sm" onclick="toggleWatchFolder(${f.id})" title="Yoqish/o'chirish">
          ${f.active ? "⏸ To'xtat" : "▶ Yoqish"}
        </button>
        <button class="btn btn-sm btn-danger" onclick="removeWatchFolder(${f.id})">🗑</button>
      </div>
    </div>`).join("");
}

async function addWatchFolder() {
  const pathVal = ($("watchFolderPath") || {}).value?.trim();
  if (!pathVal) { toast("Papka yo'li kiritilmagan!", "error"); return; }
  const res = await apiPost("/api/watch-folders", { path: pathVal });
  if (res?.ok) {
    toast("Papka qo'shildi ✓", "success");
    $("watchFolderPath").value = "";
    await loadWatchFolders();
  } else {
    toast(res?.error || "Xato yuz berdi", "error");
  }
}

async function removeWatchFolder(id) {
  if (!confirm("Bu papkani kuzatuvdan olib tashlashni tasdiqlaysizmi?")) return;
  await api(`/api/watch-folders/${id}`, { method: "DELETE" });
  toast("Olib tashlandi", "info");
  loadWatchFolders();
}

async function toggleWatchFolder(id) {
  const res = await apiPost(`/api/watch-folders/${id}/toggle`, {});
  toast(res?.active ? "Kuzatuv yoqildi" : "Kuzatuv to'xtatildi", "info");
  loadWatchFolders();
}

async function scanWatchFolder(id) {
  toast("Skan boshlanmoqda...", "info");
  const res = await apiPost(`/api/watch-folders/${id}/scan`, {});
  if (res?.ok) {
    toast(`Skan tugadi: ${res.added} ta yangi fayl qo'shildi`, "success");
    loadWatchFolders();
  } else {
    toast(res?.error || "Skan xatosi", "error");
  }
}

async function scanAllFolders() {
  const folders = await api("/api/watch-folders");
  if (!folders?.length) { toast("Kuzatilayotgan papka yo'q", "warn"); return; }
  let totalAdded = 0;
  for (const f of folders.filter(f => f.active)) {
    const res = await apiPost(`/api/watch-folders/${f.id}/scan`, {});
    if (res?.ok) totalAdded += res.added;
  }
  toast(`Jami ${totalAdded} ta yangi fayl qo'shildi ✓`, "success");
  if (State.currentPage === "library") loadLibrary();
}

// Bulk import
async function doBulkImport() {
  const pathVal   = ($("bulkImportPath") || {}).value?.trim();
  const catId     = ($("bulkImportCat") || {}).value || null;
  const recursive = ($("bulkImportRecursive") || {}).checked || false;
  if (!pathVal) { toast("Papka yo'li kiritilmagan!", "error"); return; }
  const btn = $("bulkImportBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Yuklanmoqda..."; }
  const res = await apiPost("/api/bulk-import-folder", {
    path: pathVal, category_id: catId ? parseInt(catId) : null, recursive
  });
  if (btn) { btn.disabled = false; btn.textContent = "📂 Import qilish"; }
  if (res?.ok) {
    toast(`✅ ${res.added} ta fayl qo'shildi (${res.skipped} ta mavjud edi)`, "success");
    $("bulkImportStatus").textContent = `✅ Qo'shildi: ${res.added} ta · Mavjud: ${res.skipped} ta`;
    if (State.currentPage === "library") loadLibrary();
  } else {
    toast(res?.error || "Xato yuz berdi", "error");
    $("bulkImportStatus").textContent = `❌ ${res?.error || "Xato"}`;
  }
}

// ── UPLOAD PAGE ────────────────────────────
async function loadUploadCategories() {
  const cats = await api("/api/categories");
  if (!cats) return;
  State.categories = cats;
  ["upCategory", "urlCategory", "bulkImportCat"].forEach(id => {
    const sel = $(id);
    if (!sel) return;
    sel.innerHTML = `<option value="">— Tanlang —</option>` +
      cats.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  });
  $("upYear").value = new Date().getFullYear();
  if ($("urlYear")) $("urlYear").value = new Date().getFullYear();
}

function showUploadTab(tab) {
  // Barcha tablarni yashirish
  ["fileUploadTab","urlUploadTab","bulkUploadTab","watchFolderTab"].forEach(id => {
    const e = $(id); if (e) e.style.display = "none";
  });
  document.querySelectorAll(".upload-tab-btn").forEach(b => b.classList.remove("active"));
  // Kerakli tabni ko'rsatish: "bulk" → "bulkUploadTab", "file" → "fileUploadTab", etc.
  const t = $(`${tab}UploadTab`);
  if (t) t.style.display = "block";
  document.querySelectorAll(`.upload-tab-btn[data-tab="${tab}"]`).forEach(b => b.classList.add("active"));
  if (tab === "watchFolder") loadWatchFolders();
}

function dragOver(e) { e.preventDefault(); $("dropZone").classList.add("dragover"); }
function dragLeave() { $("dropZone").classList.remove("dragover"); }
function dropFiles(e) {
  e.preventDefault(); $("dropZone").classList.remove("dragover");
  handleFiles(e.dataTransfer.files);
}

function handleFiles(files) {
  for (const f of files) {
    const ext = f.name.split(".").pop().toLowerCase();
    const allowed = ["mp4","mkv","avi","mov","webm","wmv","mp3","wav","flac","m4a","ogg","opus","aac","ts",
                     "jpg","jpeg","png","gif","webp","bmp","pdf","epub","txt","fb2"];
    if (!allowed.includes(ext)) { toast(`${f.name}: ruxsat etilmagan format`, "warn"); continue; }
    State.uploadFiles.push(f);
    if (State.uploadFiles.length === 1 && !$("upTitle").value) {
      $("upTitle").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
    }
  }
  renderSelectedFiles();
}

function renderSelectedFiles() {
  const wrap = $("selectedFiles");
  wrap.innerHTML = State.uploadFiles.map((f, i) => `
    <div class="file-item">
      <span class="file-item-name">${escHtml(f.name)}</span>
      <span class="file-item-size">${fmtSize(f.size)}</span>
      <span class="file-remove" onclick="removeFile(${i})">✕</span>
    </div>`).join("");
}

function removeFile(i) { State.uploadFiles.splice(i, 1); renderSelectedFiles(); }

async function doUpload() {
  if (!State.uploadFiles.length) { toast("Fayl tanlanmagan!", "error"); return; }
  const title = $("upTitle").value.trim();
  if (!title) { toast("Sarlavha kiritilmagan!", "error"); $("upTitle").focus(); return; }
  const btn = $("uploadBtn"), prog = $("uploadProgress"), fill = $("uploadFill"), status = $("uploadStatus");
  btn.disabled = true; prog.style.display = "block";
  let uploaded = 0;
  for (let i = 0; i < State.uploadFiles.length; i++) {
    const f = State.uploadFiles[i];
    const ext = f.name.split(".").pop().toLowerCase();
    let auto_type = $("upType").value;
    if (["jpg","jpeg","png","gif","webp","bmp","svg"].includes(ext)) auto_type = "image";
    else if (["pdf","epub","txt","fb2","djvu"].includes(ext)) auto_type = "book";
    const fd = new FormData();
    fd.append("file", f);
    fd.append("title",       State.uploadFiles.length === 1 ? title : `${title} (${f.name})`);
    fd.append("description", $("upDesc").value.trim());
    fd.append("media_type",  auto_type);
    fd.append("category_id", $("upCategory").value);
    fd.append("genre",       $("upGenre").value);
    fd.append("year",        $("upYear").value);
    fd.append("rating",      $("upRating").value);
    fd.append("file_mode",   $("upMode").value);
    status.textContent = `Yuklanmoqda: ${f.name} (${i+1}/${State.uploadFiles.length})...`;
    try {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) {
            const pct = Math.round(((i + e.loaded/e.total) / State.uploadFiles.length) * 100);
            fill.style.width = pct + "%";
          }
        };
        xhr.onload = () => { uploaded++; resolve(); };
        xhr.onerror = reject;
        xhr.open("POST", "/api/upload");
        xhr.send(fd);
      });
    } catch { toast(`Xato: ${f.name}`, "error"); }
  }
  btn.disabled = false; prog.style.display = "none"; fill.style.width = "0%";
  if (uploaded > 0) {
    toast(`${uploaded} ta fayl muvaffaqiyatli yuklandi ✓`, "success");
    State.uploadFiles = []; renderSelectedFiles();
    $("upTitle").value = ""; $("upDesc").value = ""; status.textContent = "";
  }
}

async function doUrlDownload() {
  const url = $("urlInput").value.trim();
  if (!url) { toast("URL kiritilmagan!", "error"); return; }
  const btn = $("urlDownloadBtn");
  btn.disabled = true; btn.textContent = "⏳ Yuklanmoqda...";
  $("urlStatus").textContent = "Yuklanmoqda, iltimos kuting...";
  const urlModeEl = $("urlMode");
  const data = {
    url, title: $("urlTitle").value.trim(), media_type: $("urlType").value,
    category_id: $("urlCategory").value || null, genre: $("urlGenre").value.trim(),
    year: $("urlYear").value, rating: $("urlRating").value,
    description: $("urlDesc").value.trim(), url_mode: urlModeEl ? urlModeEl.value : "stream",
  };
  const res = await apiPost("/api/download-url", data);
  btn.disabled = false; btn.textContent = "➕ Qo'shish";
  if (res?.ok) {
    toast(`Yuklandi: ${res.title} ✓`, "success");
    $("urlStatus").textContent = `✅ ${res.title} (${fmtSize(res.file_size)})`;
    $("urlInput").value = ""; $("urlTitle").value = "";
  } else {
    const msg = res?.error || "Noma'lum xato";
    toast(`Xato: ${msg}`, "error");
    $("urlStatus").textContent = `❌ ${msg}`;
  }
}


// ── PLAYLISTS ──────────────────────────────
async function loadPlaylists() {
  const pls = await api("/api/playlists");
  const grid = $("playlistsGrid"), detail = $("playlistDetail");
  if (detail) detail.style.display = "none";
  State.currentPlaylistId = null;
  if (!pls?.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🎵</div><p>Pleylist yo'q. Yangi yarating!</p></div>`;
    return;
  }
  grid.innerHTML = pls.map(p => `
    <div class="playlist-card" style="border-top:3px solid ${p.cover_color||"#58a6ff"}">
      <div class="playlist-card-title">🎵 ${escHtml(p.name)}</div>
      <div class="playlist-card-count">${p.media_count} ta media</div>
      ${p.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">${escHtml(p.description)}</div>` : ""}
      <div class="playlist-card-actions">
        <button class="btn btn-primary btn-sm" onclick="openPlaylist(${p.id})">📂 Ochish</button>
        <button class="btn btn-sm" onclick="editPlaylist(${p.id})">✏</button>
        <button class="btn btn-sm btn-danger" onclick="deletePlaylist(${p.id})">🗑</button>
      </div>
    </div>`).join("");
}

async function openPlaylist(id) {
  State.currentPlaylistId = id;
  const [pl, media] = await Promise.all([api(`/api/playlists/${id}`), api(`/api/playlists/${id}/media`)]);
  const grid = $("playlistsGrid"), detail = $("playlistDetail");
  grid.style.display = "none"; detail.style.display = "block";
  const items = media || [];
  detail.innerHTML = `
    <div class="playlist-detail-header">
      <button class="btn btn-sm" onclick="backToPlaylists()">← Orqaga</button>
      <h2 style="margin:0 12px">🎵 ${escHtml(pl?.name || "Pleylist")}</h2>
      ${pl?.description ? `<span style="color:var(--text-secondary);font-size:13px">${escHtml(pl.description)}</span>` : ""}
      <div style="margin-left:auto;display:flex;gap:8px">
        ${items.length > 0 ? `<button class="btn btn-primary btn-sm" onclick="playPlaylistAll(${id})">▶ Hammasini o'yna</button>` : ""}
        <button class="btn btn-sm" onclick="showAddMediaToPlaylist(${id})">➕ Media qo'sh</button>
      </div>
    </div>
    <div id="playlistMediaList" class="playlist-media-list">
      ${!items.length
        ? `<div class="empty-state"><div class="empty-icon">📭</div><p>Bu pleylist bo'sh.</p></div>`
        : items.map((m, i) => playlistMediaItem(m, i, id, items)).join("")}
    </div>`;
  detail.scrollIntoView({ behavior: "smooth" });
}

function playlistMediaItem(m, index, plId, allItems) {
  const emoji = mediaTypeIcon(m.media_type);
  const playable = allItems.filter(x => x.media_type==="video"||x.media_type==="audio");
  window.__plCacheMap = window.__plCacheMap || {};
  const cacheKey = `pl_${plId}_${m.id}`;
  window.__plCacheMap[cacheKey] = { items: playable, index };
  const action = m.media_type==="image" ? `openImageViewer(${m.id})`
               : m.media_type==="book"  ? `openBookViewer(${m.id})`
               : `(function(){var c=window.__plCacheMap['${cacheKey}'];openPlayer(${m.id},${plId},c.items,c.index);})()`;
  return `<div class="playlist-item" data-id="${m.id}">
    <span class="pl-index">${index+1}</span>
    <span class="pl-icon">${emoji}</span>
    <div class="pl-info">
      <div class="pl-title">${escHtml(m.title)}</div>
      <div class="pl-meta">${m.category_name?escHtml(m.category_name)+" · ":""}${m.year>0?m.year:""}</div>
    </div>
    <div class="pl-actions">
      <button class="btn btn-primary btn-sm" onclick="${action}">▶</button>
      <button class="btn btn-sm btn-danger" onclick="removeFromPlaylist(${plId}, ${m.id})">✕</button>
    </div>
  </div>`;
}

function backToPlaylists() {
  $("playlistDetail").style.display = "none";
  $("playlistsGrid").style.display = "";
  State.currentPlaylistId = null;
  loadPlaylists();
}

async function playPlaylistAll(plId) {
  const media = await api(`/api/playlists/${plId}/media`);
  if (!media?.length) { toast("Pleylist bo'sh", "warn"); return; }
  const playable = media.filter(m => m.media_type==="video"||m.media_type==="audio");
  if (!playable.length) { toast("O'ynatib bo'lmaydigan media", "warn"); return; }
  openPlayer(playable[0].id, plId, playable, 0);
}

function showCreatePlaylist() {
  $("createPlaylistModal").style.display = "flex";
  setTimeout(() => { const i=$("newPlName"); if(i){i.focus();i.value="";} }, 60);
}
function closeCreatePlaylist() { $("createPlaylistModal").style.display = "none"; }

async function doCreatePlaylist() {
  const name = $("newPlName").value.trim();
  if (!name) { toast("Nom kiritilmagan!", "error"); return; }
  const res = await apiPost("/api/playlists", {
    name, description: $("newPlDesc").value.trim(), cover_color: $("newPlColor").value
  });
  if (res?.ok) {
    toast("Pleylist yaratildi ✓", "success");
    $("newPlName").value = ""; $("newPlDesc").value = "";
    closeCreatePlaylist(); loadPlaylists();
  }
}

async function editPlaylist(id) {
  const pl = await api(`/api/playlists/${id}`);
  if (!pl) return;
  $("editPlId").value    = id;
  $("editPlName").value  = pl.name || "";
  $("editPlDesc").value  = pl.description || "";
  $("editPlColor").value = pl.cover_color || "#58a6ff";
  $("editPlaylistModal").style.display = "flex";
}
function closeEditPlaylist() { $("editPlaylistModal").style.display = "none"; }

async function doEditPlaylist() {
  const id = $("editPlId").value;
  const data = { name: $("editPlName").value.trim(), description: $("editPlDesc").value.trim(), cover_color: $("editPlColor").value };
  if (!data.name) { toast("Nom kiritilmagan!", "error"); return; }
  const res = await apiPut(`/api/playlists/${id}`, data);
  if (res?.ok) { toast("Saqlandi ✓", "success"); closeEditPlaylist(); loadPlaylists(); }
}

async function deletePlaylist(id) {
  if (!confirm("Bu pleylistni o'chirishni tasdiqlaysizmi?")) return;
  const res = await api(`/api/playlists/${id}`, { method: "DELETE" });
  if (res?.ok) { toast("O'chirildi", "success"); loadPlaylists(); }
}

async function removeFromPlaylist(plId, mediaId) {
  const res = await apiPost(`/api/playlists/${plId}/remove`, { media_id: mediaId });
  if (res?.ok) { toast("O'chirildi", "success"); openPlaylist(plId); }
}

async function showAddToPlaylist(mediaId) {
  const pls = await api("/api/playlists");
  if (!pls?.length) {
    if (confirm("Pleylist yo'q. Yaratishni xohlaysizmi?")) { navigate("playlists"); showCreatePlaylist(); }
    return;
  }
  $("quickAddMediaId").value = mediaId;
  $("quickAddPlList").innerHTML = pls.map(p => `
    <div class="quick-pl-item" onclick="doQuickAddToPlaylist(${p.id}, ${mediaId})">
      <span style="color:${p.cover_color||"#58a6ff"}">🎵</span>
      <span>${escHtml(p.name)}</span>
      <span style="color:var(--text-muted);font-size:12px">${p.media_count} ta</span>
    </div>`).join("");
  $("quickAddToPlaylistModal").style.display = "flex";
}
function closeQuickAddToPlaylist() { $("quickAddToPlaylistModal").style.display = "none"; }

async function doQuickAddToPlaylist(plId, mediaId) {
  const res = await apiPost(`/api/playlists/${plId}/add`, { media_id: mediaId });
  closeQuickAddToPlaylist();
  toast(res?.ok ? "Pleylistga qo'shildi ✓" : "Allaqachon mavjud", res?.ok ? "success" : "warn");
}

async function showAddMediaToPlaylist(plId) {
  $("addMtoPl_plId").value = plId;
  await loadAddMediaToPlaylistList(plId, "");
  $("addMediaToPlaylistModal").style.display = "flex";
}

async function loadAddMediaToPlaylistList(plId, search) {
  const list = $("addMtoPl_list");
  list.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const type  = ($("addMtoPl_type")||{}).value || "";
  const media = await api(`/api/media-for-playlist?playlist_id=${plId}&search=${encodeURIComponent(search)}&type=${type}`);
  if (!media) { list.innerHTML = "<p>Xato</p>"; return; }
  if (!media.length) { list.innerHTML = `<div class="empty-state"><p>Hech narsa topilmadi</p></div>`; return; }
  list.innerHTML = media.map(m => `
    <div class="add-media-item ${m.in_playlist?"in-playlist":""}">
      <span>${mediaTypeIcon(m.media_type)}</span>
      <div style="flex:1;min-width:0">
        <div class="add-media-title">${escHtml(m.title)}</div>
        <div style="font-size:11px;color:var(--text-muted)">${m.category_name||""} ${m.year>0?m.year:""}</div>
      </div>
      ${m.in_playlist
        ? `<button class="btn btn-sm" disabled style="opacity:0.5">✓ Bor</button>`
        : `<button class="btn btn-primary btn-sm" onclick="addMediaToPlaylist(${plId}, ${m.id}, this)">+ Qo'sh</button>`}
    </div>`).join("");
}

async function addMediaToPlaylist(plId, mediaId, btn) {
  const res = await apiPost(`/api/playlists/${plId}/add`, { media_id: mediaId });
  if (res?.ok) {
    btn.textContent = "✓ Qo'shildi"; btn.disabled = true; btn.classList.remove("btn-primary");
    toast("Qo'shildi ✓", "success");
    if (State.currentPlaylistId === plId) openPlaylist(plId);
  } else toast("Allaqachon mavjud", "warn");
}

function closeAddMediaToPlaylist() { $("addMediaToPlaylistModal").style.display = "none"; }

let addMediaSearchTimer;
function debounceAddMediaSearch() {
  clearTimeout(addMediaSearchTimer);
  addMediaSearchTimer = setTimeout(() => {
    loadAddMediaToPlaylistList(parseInt($("addMtoPl_plId").value), $("addMtoPl_search").value);
  }, 350);
}

// ── HISTORY ────────────────────────────────
async function loadHistory() {
  const data = await api("/api/history");
  const wrap = $("historyTable");
  if (!data?.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🕐</div><p>Tarix bo'sh</p></div>`;
    return;
  }
  wrap.innerHTML = `<table>
    <thead><tr><th>#</th><th>Sarlavha</th><th>Tur</th><th>Kategoriya</th><th>Reyting</th><th>Vaqt</th></tr></thead>
    <tbody>${data.map((h, i) => `
      <tr style="cursor:pointer" onclick="openPlayer(${h.id})">
        <td style="color:var(--text-muted)">${i+1}</td>
        <td>${escHtml(h.title)}</td>
        <td><span class="badge badge-${h.media_type}">${mediaTypeIcon(h.media_type)} ${h.media_type}</span></td>
        <td>${h.category_name ? escHtml(h.category_name) : "—"}</td>
        <td class="stars">${stars(h.rating)}</td>
        <td style="color:var(--text-secondary)">${fmtDate(h.played_at)}</td>
      </tr>`).join("")}</tbody>
  </table>`;
}

async function clearHistory() {
  if (!confirm("Barcha ko'rish tarixini o'chirishni tasdiqlaysizmi?")) return;
  const res = await api("/api/history", { method: "DELETE" });
  if (res?.ok) { toast("Tarix tozalandi ✓", "success"); loadHistory(); }
}


// ── ADMIN ──────────────────────────────────
async function showAdminTab(tab) {
  State.adminTab = tab;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  const tabs = ["media","categories","settings","backup"];
  tabs.forEach((t, i) => {
    const btn = document.querySelectorAll(".tab-btn")[i];
    if (btn) btn.classList.toggle("active", t === tab);
  });
  await loadAdminTab(tab);
}

async function loadAdminTab(tab) {
  const content = $("adminContent");
  if (tab === "media") {
    content.innerHTML = `
      <div class="admin-toolbar">
        <input type="text" class="filter-input" id="adminSearch" placeholder="🔍 Qidirish..." oninput="reloadAdminMedia()">
        <select class="filter-select" id="adminTypeFilter" onchange="reloadAdminMedia()">
          <option value="">Barchasi</option>
          <option value="video">🎬 Video</option>
          <option value="audio">🎵 Audio</option>
          <option value="image">🖼 Rasm</option>
          <option value="book">📚 Kitob</option>
        </select>
        <button class="btn btn-sm" onclick="selectAllAdmin()">☑ Hammasi</button>
        <button class="btn btn-sm btn-danger" onclick="batchDeleteAdmin()">🗑 O'chir</button>
        <button class="btn btn-sm" onclick="cleanOrphans()">🧹 Orphan tozala</button>
      </div>
      <div class="admin-table-wrap">
        <table id="adminTable">
          <thead><tr>
            <th><input type="checkbox" id="checkAll" onchange="toggleAll(this)"></th>
            <th>Sarlavha</th><th>Tur</th><th>Kategoriya</th>
            <th>Janr</th><th>Yil</th><th>⭐</th><th>👁</th><th>Hajm</th><th>Amallar</th>
          </tr></thead>
          <tbody id="adminTbody"></tbody>
        </table>
      </div>`;
    await reloadAdminMedia();
  } else if (tab === "categories") {
    const cats = await api("/api/categories");
    content.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:16px;align-items:flex-end">
        <div class="form-group"><label>Nomi</label>
          <input type="text" id="newCatName" class="form-input" placeholder="Kategoriya nomi">
        </div>
        <div class="form-group"><label>Rang</label>
          <input type="color" id="newCatColor" value="#58a6ff" style="height:38px;width:60px;padding:2px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-secondary);cursor:pointer">
        </div>
        <button class="btn btn-primary" onclick="addCategory()">+ Qo'shish</button>
      </div>
      <table>
        <thead><tr><th>Rang</th><th>Nomi</th><th>Amallar</th></tr></thead>
        <tbody>${(cats||[]).map(c => `
          <tr>
            <td><span style="background:${c.color};width:16px;height:16px;display:inline-block;border-radius:50%"></span></td>
            <td>${escHtml(c.name)}</td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteCategory(${c.id})">🗑</button></td>
          </tr>`).join("")}
        </tbody>
      </table>`;
  } else if (tab === "settings") {
    const settings = await api("/api/settings");
    const s = settings || {};
    content.innerHTML = `
      <div class="card">
        <div class="settings-section">
          <h3>🎬 Player sozlamalari</h3>
          <div class="settings-row">
            <div><div class="settings-label">Standart ovoz</div></div>
            <input type="number" class="form-input" id="s_volume" value="${s.default_volume||80}" min="0" max="100" style="width:80px">
          </div>
          <div class="settings-row">
            <div><div class="settings-label">Avtomatik ijro</div></div>
            <select class="form-input" id="s_autoplay" style="width:120px">
              <option value="on" ${s.autoplay==="on"?"selected":""}>Yoqilgan</option>
              <option value="off" ${s.autoplay==="off"?"selected":""}>O'chirilgan</option>
            </select>
          </div>
          <div class="settings-row">
            <div><div class="settings-label">Sahifadagi medialar</div></div>
            <select class="form-input" id="s_perpage" style="width:100px">
              ${[12,24,48,96].map(n=>`<option value="${n}" ${(s.per_page||"24")==String(n)?"selected":""}>${n}</option>`).join("")}
            </select>
          </div>
          <div class="settings-row">
            <div><div class="settings-label">Mavzu</div></div>
            <select class="form-input" id="s_theme" style="width:120px" onchange="applyTheme(this.value)">
              <option value="dark" ${State.theme==="dark"?"selected":""}>🌙 Qorong'i</option>
              <option value="light" ${State.theme==="light"?"selected":""}>☀ Yorug'</option>
            </select>
          </div>
        </div>
        <button class="btn btn-primary" onclick="saveSettings()">💾 Saqlash</button>
      </div>`;
  } else if (tab === "backup") {
    content.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:600px">
        <div class="card">
          <h3 style="margin-bottom:12px">📤 Eksport</h3>
          <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">Barcha ma'lumotlarni JSON sifatida yuklab olish</p>
          <button class="btn btn-primary" onclick="doExport()">⬇ Yuklab olish</button>
        </div>
        <div class="card">
          <h3 style="margin-bottom:12px">📥 Import</h3>
          <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">JSON zaxira faylini import qilish</p>
          <input type="file" id="importFile" accept=".json" style="display:none" onchange="doImport(this)">
          <button class="btn" onclick="$('importFile').click()">📂 Fayl tanlash</button>
        </div>
      </div>`;
  }
}

async function reloadAdminMedia() {
  const search = ($("adminSearch")||{}).value || "";
  const mtype  = ($("adminTypeFilter")||{}).value || "";
  const media  = await api(`/api/media?search=${encodeURIComponent(search)}&type=${mtype}&limit=200`);
  const tbody  = $("adminTbody");
  if (!tbody || !media) return;
  tbody.innerHTML = (media.media||[]).map(m => `
    <tr>
      <td><input type="checkbox" data-id="${m.id}"></td>
      <td>${escHtml(m.title)}</td>
      <td><span class="badge badge-${m.media_type}">${mediaTypeIcon(m.media_type)} ${m.media_type}</span></td>
      <td>${m.category_name||"—"}</td>
      <td>${m.genre||"—"}</td>
      <td>${m.year>0?m.year:"—"}</td>
      <td class="stars">${(m.rating||0).toFixed(1)}</td>
      <td style="color:var(--text-secondary)">${m.views||0}</td>
      <td>${fmtSize(m.file_size)}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="openRenameModal(${m.id})" title="Nomini o'zgartir">🏷</button>
        <button class="btn btn-sm" onclick="openEdit(${m.id})">✏</button>
        <button class="btn btn-sm" onclick="openCommentsModal(${m.id})" title="Izohlar">💬</button>
        <button class="btn btn-sm btn-danger" onclick="deleteMedia(${m.id})">🗑</button>
      </td>
    </tr>`).join("");
}

function toggleAll(cb) { document.querySelectorAll("#adminTbody input[type=checkbox]").forEach(c => c.checked = cb.checked); }
function selectAllAdmin() { document.querySelectorAll("#adminTbody input[type=checkbox]").forEach(c => c.checked = true); }

async function batchDeleteAdmin() {
  const ids = [...document.querySelectorAll("#adminTbody input[type=checkbox]:checked")].map(c => parseInt(c.dataset.id));
  if (!ids.length) { toast("Hech narsa tanlanmadi", "warn"); return; }
  if (!confirm(`${ids.length} ta mediani o'chirishni tasdiqlaysizmi?`)) return;
  const res = await apiPost("/api/media/batch-delete", { ids });
  if (res) { toast(`${res.deleted} ta o'chirildi ✓`, "success"); reloadAdminMedia(); }
}

async function cleanOrphans() {
  const res = await apiPost("/api/media/clean-orphans", {});
  if (res) {
    toast(res.deleted>0 ? `${res.deleted} ta orphan o'chirildi ✓` : "Orphan topilmadi", "info");
    reloadAdminMedia();
  }
}

async function addCategory() {
  const name = ($("newCatName").value||"").trim(), color = $("newCatColor").value;
  if (!name) { toast("Kategoriya nomi kiritilmagan!", "error"); return; }
  const res = await apiPost("/api/categories", { name, color });
  if (res?.ok) { toast("Kategoriya qo'shildi ✓", "success"); await loadAdminTab("categories"); }
  else toast("Bu nom allaqachon mavjud", "error");
}

async function deleteCategory(id) {
  if (!confirm("Bu kategoriyani o'chirishni tasdiqlaysizmi?")) return;
  const res = await api(`/api/categories/${id}`, { method: "DELETE" });
  if (res?.ok) { toast("O'chirildi", "success"); loadAdminTab("categories"); }
}

async function saveSettings() {
  const data = { default_volume: $("s_volume").value, autoplay: $("s_autoplay").value, per_page: $("s_perpage").value };
  State.libLimit = parseInt(data.per_page) || 24;
  const res = await apiPost("/api/settings", data);
  if (res?.ok) toast("Sozlamalar saqlandi ✓", "success");
}

function doExport() { window.open("/api/backup/export", "_blank"); toast("Eksport boshlandi", "info"); }

async function doImport(inp) {
  const file = inp.files[0]; if (!file) return;
  const fd = new FormData(); fd.append("file", file);
  const res = await fetch("/api/backup/import", { method: "POST", body: fd });
  const data = await res.json();
  if (data.ok) { toast("Import muvaffaqiyatli ✓", "success"); loadHome(); }
  else toast("Import xatosi", "error");
}

// ── KEYBOARD SHORTCUTS ─────────────────────
document.addEventListener("keydown", e => {
  if ($("playerModal").style.display === "none") return;
  if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;
  const el = getMediaEl();
  switch (e.code) {
    case "Space":      e.preventDefault(); togglePlay(); break;
    case "ArrowLeft":  e.preventDefault(); seekRelative(-10); break;
    case "ArrowRight": e.preventDefault(); seekRelative(10); break;
    case "ArrowUp":    e.preventDefault(); { const v=Math.min(100,State.player.savedVol+10); $("volBar").value=v; setVolume(v); } break;
    case "ArrowDown":  e.preventDefault(); { const v=Math.max(0,State.player.savedVol-10); $("volBar").value=v; setVolume(v); } break;
    case "KeyM": toggleMute(); break;
    case "KeyF": toggleFullscreen(); break;
    case "Escape": closePlayer(); break;
    case "KeyN": playlistNext(); break;
    case "KeyP": playlistPrev(); break;
    case "KeyL": toggleLoop(); break;
    case "KeyS": takeScreenshot(); break;
  }
});

// ── SHORTCUTS MODAL ────────────────────────
function showShortcuts() { $("shortcutsModal").style.display = "flex"; }
function closeShortcuts() { $("shortcutsModal").style.display = "none"; }

// ── QUICK SEARCH ───────────────────────────
$("quickSearch").addEventListener("input", function() {
  const val = this.value.trim();
  if (val) { navigate("library"); $("libSearch").value = val; debounceSearch(); }
});

// ── INIT ───────────────────────────────────
(async function init() {
  applyTheme(State.theme);
  const settings = await api("/api/settings");
  if (settings?.per_page) State.libLimit = parseInt(settings.per_page) || 24;
  loadHome();
})();
