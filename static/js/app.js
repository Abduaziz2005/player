/* =============================================
   Media Player Pro v8.0 — app.js
   ============================================= */

// ── STATE ─────────────────────────────────────
const State = {
  page: "home",
  viewMode: "grid",
  libPage: 1,
  libLimit: 24,
  theme: localStorage.getItem("theme") || "dark",
  sidebarCollapsed: localStorage.getItem("sidebarCollapsed") === "1",
  categories: [],
  tags: [],
  uploadFiles: [],
  selection: new Set(),
  adminTab: "media",
  currentPlaylistId: null,
  charts: {},
  player: {
    mediaId: null, mediaType: null, seeking: false,
    isMuted: false, savedVol: 80,
    playlistId: null, playlistItems: [], playlistIndex: -1,
    loopEnabled: false, loopStart: 0, loopEnd: 0,
    watchStartTime: null,
    audioCtx: null, gainBass: null, gainMid: null, gainTreble: null,
  },
  queue: {},
  queueTimer: null,
  searchTimer: null,
};

// ── DOM ───────────────────────────────────────
const $ = id => document.getElementById(id);
function escHtml(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── THEME ─────────────────────────────────────
function applyTheme(t) {
  State.theme = t;
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("theme", t);
  const btn = $("themeToggle");
  if (btn) btn.textContent = t === "dark" ? "☀" : "🌙";
}
function toggleTheme() { applyTheme(State.theme === "dark" ? "light" : "dark"); }

// ── SIDEBAR ───────────────────────────────────
function toggleSidebar() {
  State.sidebarCollapsed = !State.sidebarCollapsed;
  document.getElementById("sidebar").classList.toggle("collapsed", State.sidebarCollapsed);
  document.getElementById("mainContent").classList.toggle("sidebar-collapsed", State.sidebarCollapsed);
  localStorage.setItem("sidebarCollapsed", State.sidebarCollapsed ? "1" : "0");
}

// ── API ───────────────────────────────────────
async function api(path, opts = {}) {
  try {
    const res = await fetch(path, {
      headers: opts.body && typeof opts.body === "string"
        ? { "Content-Type": "application/json" } : {},
      ...opts,
    });
    if (!res.ok && res.status !== 404) {
      const err = await res.json().catch(() => ({}));
      console.warn("API error", path, err);
      return null;
    }
    return await res.json();
  } catch (e) { console.error("fetch error", path, e); return null; }
}
const apiPost = (p, d) => api(p, { method:"POST", body: JSON.stringify(d) });
const apiPut  = (p, d) => api(p, { method:"PUT",  body: JSON.stringify(d) });
const apiDel  = (p)    => api(p, { method:"DELETE" });

// ── TOAST ─────────────────────────────────────
let _toastTimer;
function toast(msg, kind = "info", dur = 3200) {
  const t = $("toast");
  t.className = `toast ${kind}`;
  t.textContent = ({ info:"ℹ", success:"✅", error:"❌", warn:"⚠" }[kind]||"ℹ") + "  " + msg;
  t.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove("show"), dur);
}

// ── FORMAT HELPERS ────────────────────────────
function fmtSize(b) {
  if (!b) return "—";
  if (b > 1073741824) return (b/1073741824).toFixed(1)+" GB";
  if (b > 1048576)    return (b/1048576).toFixed(1)+" MB";
  return (b/1024).toFixed(0)+" KB";
}
function fmtTime(ms) {
  if (!ms) return "0:00";
  const s=Math.floor(ms/1000), m=Math.floor(s/60), h=Math.floor(m/60);
  return h ? `${h}:${String(m%60).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`
           : `${m}:${String(s%60).padStart(2,"0")}`;
}
function fmtSeconds(s) {
  if (!s) return "0 daqiqa";
  if (s<60) return `${s}s`;
  if (s<3600) return `${Math.floor(s/60)} daqiqa`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}
function fmtDate(str) { return str ? str.substring(0,16).replace("T"," ") : "—"; }
function stars(r) { return "⭐".repeat(Math.round(r||0)) || "☆☆☆☆☆"; }
function mIcon(t) { return {video:"🎬",audio:"🎵",image:"🖼",book:"📚"}[t]||"📄"; }

// ── NAVIGATION ────────────────────────────────
function navigate(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const pg = $(`page-${page}`);
  if (pg) pg.classList.add("active");
  const btn = document.querySelector(`.nav-btn[data-page="${page}"]`);
  if (btn) btn.classList.add("active");
  State.page = page;
  const loaders = {
    home:        loadHome,
    library:     () => { loadCategories(); loadTags(); loadGenres(); loadLibrary(); },
    download:    () => { showDlTab("ytdl"); loadDownloadCategories(); },
    playlists:   loadPlaylists,
    collections: loadCollections,
    tags:        loadTagsPage,
    history:     loadHistory,
    stats:       loadStatsPage,
    top:         loadTopPage,
    trash:       loadTrash,
    activity:    loadActivity,
    storage:     loadStorage,
    admin:       () => showAdminTab("media"),
  };
  if (loaders[page]) loaders[page]();
  // trash badge
  updateTrashBadge();
}

document.querySelectorAll(".nav-btn").forEach(b => {
  b.addEventListener("click", () => navigate(b.dataset.page));
});

async function updateTrashBadge() {
  const trash = await api("/api/trash");
  const badge = $("trashBadge");
  if (!badge) return;
  if (trash && trash.length > 0) {
    badge.textContent = trash.length;
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }
}

// ── QUICK SEARCH ──────────────────────────────
$("quickSearch").addEventListener("input", function () {
  const v = this.value.trim();
  if (v) { navigate("library"); $("libSearch").value = v; loadLibrary(); }
});


// ── HOME ──────────────────────────────────────
async function loadHome() {
  const data = await api("/api/home");
  if (!data) return;
  const s = data.stats;
  $("statsGrid").innerHTML = [
    ["🎬","Video",       s.videos,          "var(--accent)"],
    ["🎵","Audio",       s.audio,           "var(--accent-warn)"],
    ["🖼","Rasm",        s.images,          "var(--accent-purple)"],
    ["📚","Kitob",       s.books,           "var(--accent-orange)"],
    ["❤","Sevimli",     s.favorites,       "var(--accent-danger)"],
    ["🎵","Pleylist",    s.playlists,       "var(--accent)"],
    ["🏷","Teglar",      s.tags,            "var(--accent-success)"],
    ["⏱","Ko'rish(h)",  s.total_watch_h,   "var(--accent-success)"],
    ["💾","Hajm(MB)",    s.total_size_mb,   "var(--text-secondary)"],
    ["📋","Jami",        s.total,           "var(--text-secondary)"],
  ].map(([i,l,v,c]) => `
    <div class="stat-card" onclick="navigate('library')">
      <div class="stat-val" style="color:${c}">${v}</div>
      <div class="stat-label">${i} ${l}</div>
    </div>`).join("");

  const cs = $("continueSection");
  if (data.continue_watching?.length) {
    cs.innerHTML = `<h2 class="section-hdr">⏯ Davom ettiring</h2>
      <div class="continue-scroll">${data.continue_watching.map(m => `
        <div class="continue-card" onclick="openPlayer(${m.id})">
          ${m.thumbnail ? `<img src="${m.thumbnail}" class="continue-thumb" onerror="this.style.display='none'">` : ""}
          <div class="continue-title">${escHtml(m.title)}</div>
          <div class="mini-progress"><div class="mini-progress-fill" style="width:${m.pct}%"></div></div>
          <div class="continue-pct">${(m.pct||0).toFixed(0)}% ko'rildi</div>
          <button class="btn btn-primary btn-sm" style="width:100%;margin-top:4px">▶ Davom</button>
        </div>`).join("")}</div>`;
  } else cs.innerHTML = "";

  $("recentSection").innerHTML = data.recent?.length
    ? `<h2 class="section-hdr">🕐 Oxirgi qo'shilganlar</h2>
       <div class="media-grid">${data.recent.map(m => mediaCard(m)).join("")}</div>`
    : `<div class="empty-state"><div class="empty-icon">📭</div>
       <p>Hozircha media yo'q.</p><br>
       <button class="btn btn-primary" onclick="navigate('download')">⬇ Yuklash</button></div>`;
}

// ── LIBRARY ───────────────────────────────────
let _libTimer;
function debounceSearch() {
  clearTimeout(_libTimer);
  _libTimer = setTimeout(() => { State.libPage = 1; loadLibrary(); }, 350);
}

async function loadLibrary(page) {
  if (page) State.libPage = page;
  $("mediaGrid").innerHTML = `<div class="loading"><div class="spinner"></div> Yuklanmoqda...</div>`;
  const tagId = $("libTagFilter")?.value || "";
  const params = new URLSearchParams({
    search:      $("libSearch")?.value || "",
    type:        $("libType")?.value   || "",
    category_id: $("libCategory")?.value || "",
    genre:       $("libGenre")?.value  || "",
    favorites:   $("libFav")?.checked  || false,
    sort:        $("libSort")?.value   || "added_at",
    page:        State.libPage,
    limit:       State.libLimit,
  });
  if (tagId) params.append("tag_id", tagId);
  const data = await api(`/api/media?${params}`);
  if (!data) { $("mediaGrid").innerHTML = `<div class="empty-state"><p>Xato yuz berdi</p></div>`; return; }
  const media = data.media || [];
  if (!media.length) {
    $("mediaGrid").innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>Hech narsa topilmadi</p></div>`;
    $("libPagination").innerHTML = ""; return;
  }
  $("mediaGrid").className = State.viewMode === "grid" ? "media-grid" : "media-grid list-view";
  $("mediaGrid").innerHTML = media.map(m =>
    State.viewMode === "grid" ? mediaCard(m) : listItem(m)).join("");
  const pag = $("libPagination");
  const prev = State.libPage > 1, next = media.length === State.libLimit;
  pag.innerHTML = (prev || next) ? `
    ${prev ? `<button class="page-btn" onclick="loadLibrary(${State.libPage-1})">← Oldingi</button>` : ""}
    <span class="page-btn active">${State.libPage}</span>
    ${next ? `<button class="page-btn" onclick="loadLibrary(${State.libPage+1})">Keyingi →</button>` : ""}` : "";
}

async function loadCategories() {
  const cats = await api("/api/categories");
  if (!cats) return;
  State.categories = cats;
  const cur = $("libCategory")?.value;
  if ($("libCategory")) {
    $("libCategory").innerHTML = `<option value="">Barcha kategoriyalar</option>` +
      cats.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
    $("libCategory").value = cur || "";
  }
}

async function loadTags() {
  const tags = await api("/api/tags");
  if (!tags) return;
  State.tags = tags;
  if ($("libTagFilter")) {
    const cur = $("libTagFilter").value;
    $("libTagFilter").innerHTML = `<option value="">Barcha teglar</option>` +
      tags.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
    $("libTagFilter").value = cur || "";
  }
}

async function loadGenres() {
  const g = await api("/api/genres");
  if (!g || !$("libGenre")) return;
  const cur = $("libGenre").value;
  $("libGenre").innerHTML = `<option value="">Barcha janrlar</option>` +
    g.map(x => `<option value="${x}">${x}</option>`).join("");
  $("libGenre").value = cur || "";
}

function setView(mode) {
  State.viewMode = mode;
  $("gridViewBtn").classList.toggle("active", mode === "grid");
  $("listViewBtn").classList.toggle("active", mode === "list");
  loadLibrary();
}

// ── MEDIA CARD ────────────────────────────────
function mediaCard(m) {
  const fav   = m.is_favorite ? 1 : 0;
  const pos   = parseInt(m.saved_position) || 0;
  const dur   = parseInt(m.saved_duration) || 0;
  const pct   = dur > 0 ? Math.round(pos*100/dur) : 0;
  const sel   = State.selection.has(m.id);
  const click = m.media_type==="image" ? `openImageViewer(${m.id})`
              : m.media_type==="book"  ? `openBookViewer(${m.id})`
              : `openPlayer(${m.id})`;
  const thumb = m.thumbnail
    ? `<img src="${m.thumbnail}" class="card-thumb-img" onerror="this.style.display='none'">`
    : `<span style="font-size:38px">${mIcon(m.media_type)}</span>`;
  return `<div class="media-card ${sel?"selected":""}" id="mc-${m.id}">
    <div class="card-thumb">
      ${thumb}
      <div class="card-play-overlay" onclick="${click}">▶</div>
      <label class="card-check-wrap" onclick="event.stopPropagation()">
        <input type="checkbox" class="card-check" data-id="${m.id}"
               ${sel?"checked":""} onchange="toggleSelection(${m.id},this.checked)">
      </label>
      ${m.media_type==="video"||m.media_type==="audio" ? `
        <div class="card-duration">${m.duration?fmtTime(m.duration*1000):""}</div>` : ""}
    </div>
    <div class="card-body">
      <div class="card-title" title="${escHtml(m.title)}">${escHtml(m.title)}</div>
      <div class="card-meta">
        <span>${m.category_name?`<span class="cat-dot" style="background:${m.category_color}"></span>${escHtml(m.category_name)}`:"—"}</span>
        <span>${m.year>0?m.year:""}</span>
      </div>
      <div class="card-meta">
        <span class="stars">${stars(m.rating)} ${(m.rating||0).toFixed(1)}</span>
        <span style="color:var(--text-muted);font-size:10px">${m.views?`👁 ${m.views}`:""}</span>
      </div>
      ${m.tag_names?`<div class="card-tags">${m.tag_names.split(",").map(t=>`<span class="tag-badge">${t}</span>`).join("")}</div>`:""}
      ${pct>0?`<div class="card-progress"><div class="card-progress-fill" style="width:${pct}%"></div></div>`:""}
    </div>
    <div class="card-actions">
      <button class="card-btn fav ${fav?"active":""}" onclick="toggleFav(${m.id},this)">${fav?"❤":"♡"}</button>
      <button class="card-btn play" onclick="${click}">▶ Play</button>
      <button class="card-btn" onclick="showAddToPlaylist(${m.id})" title="Pleylist">➕</button>
      <button class="card-btn" onclick="openEdit(${m.id})">✏</button>
      <button class="card-btn danger" onclick="deleteMedia(${m.id})">🗑</button>
    </div>
  </div>`;
}

function listItem(m) {
  const click = m.media_type==="image" ? `openImageViewer(${m.id})`
              : m.media_type==="book"  ? `openBookViewer(${m.id})`
              : `openPlayer(${m.id})`;
  return `<div class="list-item">
    <label onclick="event.stopPropagation()">
      <input type="checkbox" data-id="${m.id}"
             onchange="toggleSelection(${m.id},this.checked)"
             ${State.selection.has(m.id)?"checked":""}></label>
    <span class="list-item-icon">${mIcon(m.media_type)}</span>
    <div class="list-item-info">
      <div class="list-item-title">${escHtml(m.title)}</div>
      <div class="list-item-meta">
        ${m.category_name?escHtml(m.category_name)+" · ":""}
        ${m.year>0?m.year+" · ":""}
        ${stars(m.rating)} ${(m.rating||0).toFixed(1)}
        ${m.views?` · 👁 ${m.views}`:""}
        ${m.tag_names?` · 🏷 ${m.tag_names}`:""}
        · ${fmtSize(m.file_size)}
      </div>
    </div>
    <div class="list-item-actions">
      <button class="btn btn-primary btn-sm" onclick="${click}">▶</button>
      <button class="btn btn-sm" onclick="openEdit(${m.id})">✏</button>
      <button class="btn btn-sm" onclick="showAddToPlaylist(${m.id})">➕</button>
      <button class="btn btn-sm danger" onclick="deleteMedia(${m.id})">🗑</button>
    </div>
  </div>`;
}

// ── SELECTION (Batch) ─────────────────────────
function toggleSelection(id, checked) {
  if (checked) State.selection.add(id);
  else State.selection.delete(id);
  updateBatchBar();
  const card = document.getElementById(`mc-${id}`);
  if (card) card.classList.toggle("selected", checked);
}

function updateBatchBar() {
  const n = State.selection.size;
  const bar = $("batchBar");
  if (!bar) return;
  bar.style.display = n > 0 ? "flex" : "none";
  $("batchCount").textContent = `${n} ta tanlangan`;
  const btn = $("batchEditBtn");
  if (btn) btn.style.display = n > 0 ? "" : "none";
}

function clearSelection() {
  State.selection.clear();
  document.querySelectorAll(".card-check, .list-item input[type=checkbox]")
    .forEach(c => c.checked = false);
  document.querySelectorAll(".media-card").forEach(c => c.classList.remove("selected"));
  updateBatchBar();
}

function showBatchEdit() {
  if (!State.selection.size) { toast("Hech narsa tanlanmadi","warn"); return; }
  $("batchEditCount").textContent = State.selection.size;
  // Fill categories
  if ($("batchCategory")) {
    $("batchCategory").innerHTML = `<option value="">— O'zgartirmaslik —</option>` +
      State.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  }
  $("batchGenre").value = ""; $("batchYear").value = ""; $("batchRating").value = "";
  $("batchEditModal").style.display = "flex";
}
function closeBatchEdit() { $("batchEditModal").style.display = "none"; }

async function doBatchEdit() {
  const fields = {};
  const cat = $("batchCategory").value;
  const gen = $("batchGenre").value.trim();
  const yr  = $("batchYear").value;
  const rt  = $("batchRating").value;
  if (cat) fields.category_id = parseInt(cat);
  if (gen) fields.genre = gen;
  if (yr)  fields.year  = parseInt(yr);
  if (rt)  fields.rating = parseFloat(rt);
  if (!Object.keys(fields).length) { toast("Hech narsa o'zgartirilmadi","warn"); return; }
  const res = await apiPost("/api/media/batch-edit", {
    ids: Array.from(State.selection), fields });
  if (res) {
    toast(`${res.updated} ta media yangilandi ✓`, "success");
    closeBatchEdit(); clearSelection(); loadLibrary();
  }
}

async function batchDeleteSelected() {
  if (!State.selection.size) { toast("Hech narsa tanlanmadi","warn"); return; }
  if (!confirm(`${State.selection.size} ta mediani savatga yuborishni tasdiqlaysizmi?`)) return;
  await apiPost("/api/media/batch-delete", { ids: Array.from(State.selection) });
  toast(`${State.selection.size} ta media savatga yuborildi`, "success");
  clearSelection(); loadLibrary(); updateTrashBadge();
}

async function addSelectedToPlaylist() {
  if (!State.selection.size) return;
  const pls = await api("/api/playlists");
  if (!pls?.length) { toast("Pleylist yo'q","warn"); return; }
  const name = pls.map((p,i) => `${i+1}. ${p.name}`).join("\n");
  const idx  = prompt(`Qaysi pleylistga?\n${name}\nRaqamni kiriting:`);
  const pl   = pls[parseInt(idx)-1];
  if (!pl) return;
  let added = 0;
  for (const id of State.selection) {
    const r = await apiPost(`/api/playlists/${pl.id}/add`, { media_id: id });
    if (r?.ok) added++;
  }
  toast(`${added} ta media qo'shildi ✓`, "success");
  clearSelection();
}


// ── MEDIA ACTIONS ─────────────────────────────
async function toggleFav(id, btn) {
  const r = await apiPost(`/api/media/${id}/favorite`, {});
  if (r) {
    btn.textContent = r.is_favorite ? "❤" : "♡";
    btn.classList.toggle("active", r.is_favorite);
    toast(r.is_favorite ? "Sevimlilarga qo'shildi ❤" : "Olib tashlandi", "info");
  }
}

async function deleteMedia(id) {
  if (!confirm("Bu mediani savatga yuborishni tasdiqlaysizmi?")) return;
  await apiDel(`/api/media/${id}`);
  toast("Savatga yuborildi 🗑", "info");
  if (State.page === "library") loadLibrary();
  else if (State.page === "home") loadHome();
  updateTrashBadge();
}

// ── EDIT MODAL ────────────────────────────────
async function openEdit(id) {
  const m = await api(`/api/media/${id}`);
  if (!m) return;
  $("editId").value    = id;
  $("editTitle").value = m.title || "";
  $("editDesc").value  = m.description || "";
  $("editGenre").value = m.genre || "";
  $("editYear").value  = m.year  || new Date().getFullYear();
  $("editRating").value = m.rating || 0;
  // categories
  if (!State.categories.length) State.categories = await api("/api/categories") || [];
  $("editCategory").innerHTML = `<option value="">— Kategoriyasiz —</option>` +
    State.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  $("editCategory").value = m.category_id || "";
  // tags picker
  if (!State.tags.length) State.tags = await api("/api/tags") || [];
  const activeTags = new Set((m.tags||[]).map(t => t.id));
  $("editTagsWrap").innerHTML = State.tags.map(t => `
    <label class="tag-picker-item">
      <input type="checkbox" value="${t.id}" ${activeTags.has(t.id)?"checked":""}>
      <span class="tag-badge" style="background:${t.color}20;color:${t.color};border-color:${t.color}">${t.name}</span>
    </label>`).join("") || `<span style="color:var(--text-muted);font-size:12px">Teg yo'q. Avval teg yarating.</span>`;
  $("editModal").style.display = "flex";
}
function closeEdit() { $("editModal").style.display = "none"; }

async function saveEdit() {
  const id = parseInt($("editId").value);
  const tagIds = [...$("editTagsWrap").querySelectorAll("input:checked")]
    .map(i => parseInt(i.value));
  const data = {
    title:       $("editTitle").value.trim(),
    description: $("editDesc").value.trim(),
    genre:       $("editGenre").value.trim(),
    year:        parseInt($("editYear").value) || 0,
    rating:      parseFloat($("editRating").value) || 0,
    category_id: parseInt($("editCategory").value) || null,
    tags:        tagIds,
  };
  if (!data.title) { toast("Sarlavha kiritilmagan!","error"); return; }
  await apiPut(`/api/media/${id}`, data);
  toast("Saqlandi ✓","success"); closeEdit();
  if (State.page==="library") loadLibrary();
  else if (State.page==="home") loadHome();
}

// ── RENAME MODAL ──────────────────────────────
async function openRenameModal(id) {
  const m = await api(`/api/media/${id}`);
  if (!m) return;
  $("renameId").value = id;
  $("renameTitle").value = m.title || "";
  const fn = m.file_path ? m.file_path.split(/[\\/]/).pop() : "";
  $("renameFilename").value = fn;
  $("renameFilenameRow").style.display = m.file_mode === "copy" ? "flex" : "none";
  $("renameModal").style.display = "flex";
  setTimeout(() => $("renameTitle").focus(), 60);
}
function closeRenameModal() { $("renameModal").style.display = "none"; }

async function doRename() {
  const id    = $("renameId").value;
  const title = $("renameTitle").value.trim();
  const fn    = $("renameFilename").value.trim();
  if (!title) { toast("Sarlavha kiritilmagan!","error"); return; }
  const res = await apiPost(`/api/media/${id}/rename`, { title, filename: fn });
  if (res?.ok) {
    toast("Nom o'zgartirildi ✓","success"); closeRenameModal();
    if (State.page==="library") loadLibrary();
    else if (State.page==="admin") reloadAdminMedia();
  } else toast(res?.error || "Xato","error");
}

// ── THUMBNAIL UPLOAD ──────────────────────────
function openThumbUpload(id) {
  $("thumbMediaId").value = id;
  $("thumbModal").style.display = "flex";
}

async function doThumbUpload(inp) {
  const file = inp.files[0]; if (!file) return;
  const id   = $("thumbMediaId").value;
  const fd   = new FormData(); fd.append("file", file);
  const res  = await fetch(`/api/media/${id}/thumbnail`, { method:"POST", body:fd });
  const data = await res.json();
  if (data.ok) {
    toast("Thumbnail saqlandi ✓","success");
    $("thumbModal").style.display = "none";
    if (State.page==="library") loadLibrary();
  } else toast(data.error || "Xato","error");
}

// ── SUBTITLE UPLOAD ───────────────────────────
function openSubUpload(id) {
  $("subMediaId").value = id;
  $("subModal").style.display = "flex";
}

async function doSubUpload(inp) {
  const file = inp.files[0]; if (!file) return;
  const id   = $("subMediaId").value;
  const fd   = new FormData(); fd.append("file", file);
  const res  = await fetch(`/api/media/${id}/subtitle`, { method:"POST", body:fd });
  const data = await res.json();
  if (data.ok) {
    toast("Subtitr biriktirildi ✓","success");
    $("subModal").style.display = "none";
    State.player.subtitle = data.subtitle;
  } else toast(data.error || "Xato","error");
}

// ── SHARE / EMBED ─────────────────────────────
function shareMedia(id) {
  if (!id) return;
  const link  = `${location.origin}/api/stream/${id}`;
  const embed = `<video controls src="${link}" style="width:100%;max-width:800px"></video>`;
  $("shareLink").value  = link;
  $("shareEmbed").value = embed;
  $("shareModal").style.display = "flex";
}

function copyShareLink() {
  navigator.clipboard.writeText($("shareLink").value)
    .then(() => toast("Havola nusxalandi ✓","success"))
    .catch(() => { $("shareLink").select(); document.execCommand("copy"); toast("Nusxalandi","success"); });
}

function copyEmbed() {
  navigator.clipboard.writeText($("shareEmbed").value)
    .then(() => toast("Embed kodi nusxalandi ✓","success"))
    .catch(() => { $("shareEmbed").select(); document.execCommand("copy"); });
}

// ── MEDIA INFO (ffprobe) ──────────────────────
async function showMediaInfo(id) {
  $("mediaInfoModal").style.display = "flex";
  $("mediaInfoContent").innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const data = await api(`/api/media/${id}/info`);
  if (!data) { $("mediaInfoContent").innerHTML = `<p style="color:var(--accent-danger)">Xato yuz berdi</p>`; return; }
  const m = data.media || {};
  const ff = data.ffprobe || {};
  const streams = ff.streams || [];
  const fmt = ff.format || {};
  let html = `<table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:6px 10px;color:var(--text-secondary);width:140px">Sarlavha</td><td style="padding:6px 10px"><strong>${escHtml(m.title)}</strong></td></tr>
    <tr><td style="padding:6px 10px;color:var(--text-secondary)">Fayl yo'li</td><td style="padding:6px 10px;font-size:11px;word-break:break-all">${escHtml(m.file_path)}</td></tr>
    <tr><td style="padding:6px 10px;color:var(--text-secondary)">Hajm</td><td style="padding:6px 10px">${fmtSize(m.file_size)}</td></tr>
    <tr><td style="padding:6px 10px;color:var(--text-secondary)">Ko'rishlar</td><td style="padding:6px 10px">${m.views||0}</td></tr>`;
  if (fmt.duration) html += `<tr><td style="padding:6px 10px;color:var(--text-secondary)">Davomiylik</td><td style="padding:6px 10px">${fmtTime(parseFloat(fmt.duration)*1000)}</td></tr>`;
  if (fmt.bit_rate) html += `<tr><td style="padding:6px 10px;color:var(--text-secondary)">Bitrate</td><td style="padding:6px 10px">${Math.round(fmt.bit_rate/1000)} kbps</td></tr>`;
  for (const s of streams) {
    if (s.codec_type === "video") {
      html += `<tr><td style="padding:6px 10px;color:var(--accent)">Video</td><td style="padding:6px 10px">${s.codec_name} · ${s.width}x${s.height} · ${s.avg_frame_rate} fps</td></tr>`;
    } else if (s.codec_type === "audio") {
      html += `<tr><td style="padding:6px 10px;color:var(--accent-warn)">Audio</td><td style="padding:6px 10px">${s.codec_name} · ${s.sample_rate}Hz · ${s.channels}ch</td></tr>`;
    }
  }
  if (!streams.length) html += `<tr><td colspan="2" style="padding:10px;color:var(--text-muted);text-align:center">ffprobe topilmadi (ixtiyoriy)</td></tr>`;
  html += `</table>`;
  $("mediaInfoContent").innerHTML = html;
}


// ── DOWNLOAD CENTER ───────────────────────────
function showDlTab(tab) {
  document.querySelectorAll(".dl-tab-content").forEach(el => el.style.display = "none");
  document.querySelectorAll(".dl-tab-btn").forEach(b => b.classList.remove("active"));
  const t = $(`dtab-${tab}`);
  if (t) t.style.display = "block";
  document.querySelectorAll(`.dl-tab-btn[data-dtab="${tab}"]`).forEach(b => b.classList.add("active"));
  if (tab === "watch")  loadWatchFolders();
  if (tab === "dlhist") loadDlHistory();
  if (tab === "ytdl")   { loadQueue(); startQueuePoller(); }
}

async function loadDownloadCategories() {
  const cats = await api("/api/categories") || [];
  ["ytCategory","upCategory","bulkCat","batchCategory"].forEach(id => {
    const sel = $(id); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">— Tanlang —</option>` +
      cats.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
    sel.value = cur || "";
  });
  if ($("upYear")) $("upYear").value = new Date().getFullYear();
  if ($("ytYear")) $("ytYear").value = new Date().getFullYear();
}

// ── yt-dlp ────────────────────────────────────
async function ytdlGetInfo() {
  const url = $("ytUrl").value.trim();
  if (!url) { toast("URL kiritilmagan!","error"); return; }
  const box = $("ytInfoBox");
  box.style.display = "none";
  toast("Ma'lumot olinmoqda...","info");
  const info = await apiPost("/api/ytdl/info", { url });
  if (!info || info.error) { toast(info?.error || "Xato","error"); return; }
  $("ytThumb").src    = info.thumbnail || "";
  $("ytTitle").textContent = info.title || url;
  $("ytUploader").textContent = info.uploader ? `👤 ${info.uploader}` : "";
  $("ytDuration").textContent = info.duration ? `⏱ ${fmtTime(info.duration*1000)}` : "";
  $("ytCustomTitle").value = info.title || "";
  // formats
  $("ytFormat").innerHTML = `<option value="">🔝 Eng yaxshi sifat</option>` +
    (info.formats||[]).map(f => `<option value="${f.format_id}">${f.label} ${f.filesize?("("+fmtSize(f.filesize)+")"):""}` ).join("");
  box.style.display = "block";
  toast("Ma'lumot olindi ✓","success");
}

async function ytdlStartDownload() {
  const url = $("ytUrl").value.trim();
  if (!url) { toast("URL kiritilmagan!","error"); return; }
  const res = await apiPost("/api/ytdl/download", {
    url,
    format:      $("ytFormat")?.value || "",
    title:       $("ytCustomTitle")?.value?.trim() || "",
    category_id: $("ytCategory")?.value || null,
    genre:       $("ytGenre")?.value?.trim() || "",
    year:        parseInt($("ytYear")?.value) || 0,
    playlist:    $("ytPlaylist")?.checked || false,
  });
  if (res?.ok) {
    toast("Navbatga qo'shildi ✓","success");
    $("ytUrl").value = ""; $("ytInfoBox").style.display = "none";
    loadQueue(); startQueuePoller();
  } else toast(res?.error || "Xato","error");
}

async function loadQueue() {
  const queue = await api("/api/ytdl/queue");
  const el = $("ytQueue"); if (!el) return;
  State.queue = queue || {};
  const jobs = Object.entries(State.queue);
  if (!jobs.length) {
    el.innerHTML = `<div class="empty-state" style="padding:20px"><div class="empty-icon" style="font-size:28px">📭</div><p>Navbat bo'sh</p></div>`;
    return;
  }
  el.innerHTML = jobs.map(([jid, j]) => {
    const statusIcon = {queued:"⏳",running:"⬇",done:"✅",error:"❌"}[j.status]||"⏳";
    const pctBar = j.status==="running"
      ? `<div class="queue-progress-wrap"><div class="queue-progress-fill" style="width:${j.progress||0}%"></div></div>` : "";
    const info = j.status==="running"
      ? `<span class="queue-speed">${j.speed||""} ETA:${j.eta||""} ${(j.progress||0).toFixed(1)}%</span>` : "";
    return `<div class="queue-item queue-${j.status}">
      <div class="queue-icon">${statusIcon}</div>
      <div class="queue-info">
        <div class="queue-title">${escHtml(j.title||j.url||"")}</div>
        ${pctBar}${info}
        ${j.error ? `<div class="queue-error">${escHtml(j.error)}</div>` : ""}
      </div>
      <div class="queue-actions">
        ${j.status==="done"&&j.media_id ? `<button class="btn btn-sm btn-primary" onclick="openPlayer(${j.media_id})">▶</button>` : ""}
        <button class="btn btn-sm" onclick="cancelQueueJob('${jid}')">✕</button>
      </div>
    </div>`;
  }).join("");
}

async function cancelQueueJob(jid) {
  await apiDel(`/api/ytdl/queue/${jid}`);
  loadQueue();
}

async function ytdlClearDone() {
  await apiPost("/api/ytdl/queue/clear", {});
  loadQueue(); toast("Tugaganlar tozalandi","info");
}

function startQueuePoller() {
  if (State.queueTimer) return;
  State.queueTimer = setInterval(async () => {
    if (State.page !== "download") { clearInterval(State.queueTimer); State.queueTimer = null; return; }
    const queue = await api("/api/ytdl/queue");
    const running = queue && Object.values(queue).some(j => j.status==="running"||j.status==="queued");
    State.queue = queue || {};
    loadQueue();
    if (!running) { clearInterval(State.queueTimer); State.queueTimer = null; }
  }, 2000);
}

// ── FILE UPLOAD ───────────────────────────────
function dragOver(e) { e.preventDefault(); $("dropZone")?.classList.add("dragover"); }
function dragLeave()  { $("dropZone")?.classList.remove("dragover"); }
function dropFiles(e) {
  e.preventDefault(); $("dropZone")?.classList.remove("dragover");
  handleFiles(e.dataTransfer.files);
}

function handleFiles(files) {
  const allowed = new Set(["mp4","mkv","avi","mov","webm","wmv","mp3","wav","flac","m4a","ogg",
    "opus","aac","ts","jpg","jpeg","png","gif","webp","bmp","pdf","epub","txt","fb2"]);
  for (const f of files) {
    const ext = f.name.split(".").pop().toLowerCase();
    if (!allowed.has(ext)) { toast(`${f.name}: ruxsat etilmagan format`,"warn"); continue; }
    State.uploadFiles.push(f);
    if (State.uploadFiles.length===1 && !$("upTitle")?.value) {
      if ($("upTitle")) $("upTitle").value = f.name.replace(/\.[^.]+$/,"")
        .replace(/[_-]/g," ").replace(/\b\w/g, c=>c.toUpperCase());
    }
  }
  renderSelectedFiles();
}

function renderSelectedFiles() {
  const w = $("selectedFiles"); if (!w) return;
  w.innerHTML = State.uploadFiles.map((f,i) => `
    <div class="file-item">
      <span class="file-item-name">${escHtml(f.name)}</span>
      <span class="file-item-size">${fmtSize(f.size)}</span>
      <span class="file-remove" onclick="removeUploadFile(${i})">✕</span>
    </div>`).join("");
}
function removeUploadFile(i) { State.uploadFiles.splice(i,1); renderSelectedFiles(); }

async function doUpload() {
  if (!State.uploadFiles.length) { toast("Fayl tanlanmagan!","error"); return; }
  const title = $("upTitle")?.value?.trim();
  if (!title) { toast("Sarlavha kiritilmagan!","error"); return; }
  const btn = $("uploadBtn"), prog = $("uploadProgress"),
        fill = $("uploadFill"), status = $("uploadStatus");
  btn.disabled = true; if (prog) prog.style.display = "block";
  let done = 0;
  for (let i=0; i<State.uploadFiles.length; i++) {
    const f = State.uploadFiles[i];
    const ext = f.name.split(".").pop().toLowerCase();
    let mtype = $("upType")?.value || "video";
    if (["jpg","jpeg","png","gif","webp","bmp"].includes(ext)) mtype = "image";
    else if (["pdf","epub","txt","fb2"].includes(ext)) mtype = "book";
    const fd = new FormData();
    fd.append("file",f);
    fd.append("title", State.uploadFiles.length===1 ? title : `${title} (${f.name})`);
    fd.append("description", $("upDesc")?.value?.trim()||"");
    fd.append("media_type", mtype);
    fd.append("category_id", $("upCategory")?.value||"");
    fd.append("genre", $("upGenre")?.value?.trim()||"");
    fd.append("year",  $("upYear")?.value||"");
    fd.append("rating", $("upRating")?.value||"0");
    fd.append("file_mode", $("upMode")?.value||"copy");
    if (status) status.textContent = `Yuklanmoqda: ${f.name} (${i+1}/${State.uploadFiles.length})...`;
    try {
      await new Promise((resolve,reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = e => {
          if (e.lengthComputable && fill)
            fill.style.width = Math.round(((i+e.loaded/e.total)/State.uploadFiles.length)*100)+"%";
        };
        xhr.onload = () => { done++; resolve(); };
        xhr.onerror = reject;
        xhr.open("POST","/api/upload"); xhr.send(fd);
      });
    } catch { toast(`Xato: ${f.name}`,"error"); }
  }
  btn.disabled = false;
  if (prog) prog.style.display = "none";
  if (fill) fill.style.width = "0%";
  if (done) {
    toast(`${done} ta fayl yuklandi ✓`,"success");
    State.uploadFiles = []; renderSelectedFiles();
    if ($("upTitle")) $("upTitle").value = "";
    if (status) status.textContent = "";
  }
}

// ── BULK IMPORT ───────────────────────────────
async function doBulkImport() {
  const path = $("bulkPath")?.value?.trim();
  if (!path) { toast("Papka yo'li kiritilmagan!","error"); return; }
  const btn = $("bulkBtn");
  if (btn) { btn.disabled=true; btn.textContent="⏳ Yuklanmoqda..."; }
  const res = await apiPost("/api/bulk-import-folder", {
    path, category_id: $("bulkCat")?.value||null,
    recursive: $("bulkRecursive")?.checked||false });
  if (btn) { btn.disabled=false; btn.textContent="📂 Import"; }
  const status = $("bulkStatus");
  if (res?.ok) {
    toast(`✅ ${res.added} ta fayl qo'shildi (${res.skipped} ta mavjud)`,"success");
    if (status) status.textContent = `✅ Qo'shildi: ${res.added} ta · Mavjud: ${res.skipped} ta`;
  } else {
    toast(res?.error || "Xato","error");
    if (status) status.textContent = `❌ ${res?.error||"Xato"}`;
  }
}

// ── WATCH FOLDERS ─────────────────────────────
async function loadWatchFolders() {
  const list = $("watchFolderList"); if (!list) return;
  const folders = await api("/api/watch-folders");
  if (!folders?.length) {
    list.innerHTML = `<div class="empty-state" style="padding:20px"><div class="empty-icon" style="font-size:28px">📂</div><p>Kuzatilayotgan papka yo'q</p></div>`;
    return;
  }
  list.innerHTML = folders.map(f => `
    <div class="watch-folder-item ${f.active?"":"inactive"}">
      <div class="wf-icon">${f.active?"👁":"⏸"}</div>
      <div class="wf-info">
        <div class="wf-path">${escHtml(f.path)}</div>
        <div class="wf-meta">Qo'shilgan: ${fmtDate(f.created_at)}</div>
      </div>
      <div class="wf-actions">
        <button class="btn btn-sm" onclick="scanWatchFolder(${f.id})">🔍 Skan</button>
        <button class="btn btn-sm" onclick="toggleWatchFolder(${f.id})">${f.active?"⏸":"▶"}</button>
        <button class="btn btn-sm btn-danger" onclick="removeWatchFolder(${f.id})">🗑</button>
      </div>
    </div>`).join("");
}

async function addWatchFolder() {
  const p = $("watchPath")?.value?.trim();
  if (!p) { toast("Yo'l kiritilmagan!","error"); return; }
  const r = await apiPost("/api/watch-folders", { path: p });
  if (r?.ok) { toast("Papka qo'shildi ✓","success"); $("watchPath").value=""; loadWatchFolders(); }
  else toast(r?.error || "Xato","error");
}

async function removeWatchFolder(id) {
  if (!confirm("Papkani kuzatuvdan olib tashlaysizmi?")) return;
  await apiDel(`/api/watch-folders/${id}`);
  loadWatchFolders(); toast("Olib tashlandi","info");
}

async function toggleWatchFolder(id) {
  const r = await apiPost(`/api/watch-folders/${id}/toggle`, {});
  toast(r?.active ? "Yoqildi" : "To'xtatildi","info"); loadWatchFolders();
}

async function scanWatchFolder(id) {
  toast("Skan boshlanmoqda...","info");
  const r = await apiPost(`/api/watch-folders/${id}/scan`, {});
  if (r?.ok) { toast(`Skan tugadi: ${r.added} ta yangi fayl`,"success"); loadWatchFolders(); }
  else toast(r?.error || "Xato","error");
}

async function scanAllFolders() {
  const fs = await api("/api/watch-folders");
  if (!fs?.length) { toast("Kuzatilayotgan papka yo'q","warn"); return; }
  let total = 0;
  for (const f of fs.filter(x=>x.active)) {
    const r = await apiPost(`/api/watch-folders/${f.id}/scan`, {});
    if (r?.ok) total += r.added;
  }
  toast(`Jami ${total} ta yangi fayl qo'shildi`,"success");
}

// ── DOWNLOAD HISTORY ──────────────────────────
async function loadDlHistory() {
  const list = $("dlHistoryList"); if (!list) return;
  const data = await api("/api/download-history");
  if (!data?.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>Yuklovchi tarixi bo'sh</p></div>`;
    return;
  }
  list.innerHTML = `<table style="width:100%">
    <thead><tr><th>Sarlavha</th><th>URL</th><th>Hajm</th><th>Status</th><th>Vaqt</th></tr></thead>
    <tbody>${data.map(d=>`<tr>
      <td>${escHtml(d.title||"—")}</td>
      <td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        <a href="${escHtml(d.url)}" target="_blank" style="color:var(--accent)">${escHtml(d.url)}</a></td>
      <td>${fmtSize(d.file_size)}</td>
      <td><span class="badge ${d.status==="done"?"badge-ok":"badge-err"}">${d.status}</span></td>
      <td style="color:var(--text-muted)">${fmtDate(d.created_at)}</td>
    </tr>`).join("")}</tbody></table>`;
}

async function clearDlHistory() {
  if (!confirm("Yuklovchi tarixini o'chirishni tasdiqlaysizmi?")) return;
  await apiDel("/api/download-history");
  toast("Tarix tozalandi","info"); loadDlHistory();
}


// ── TAGS PAGE ─────────────────────────────────
async function loadTagsPage() {
  const tags = await api("/api/tags");
  State.tags = tags || [];
  const grid = $("tagsGrid");
  if (!tags?.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🏷</div><p>Hozircha teg yo'q</p></div>`;
    return;
  }
  grid.innerHTML = tags.map(t => `
    <div class="tag-card" style="border-left:4px solid ${t.color}">
      <div class="tag-card-name" style="color:${t.color}">${escHtml(t.name)}</div>
      <div class="tag-card-actions">
        <button class="btn btn-sm" onclick="loadTagMedia(${t.id},'${escHtml(t.name)}')">📚 Media</button>
        <button class="btn btn-sm btn-danger" onclick="deleteTag(${t.id})">🗑</button>
      </div>
    </div>`).join("");
}

async function addTag() {
  const name = $("newTagName")?.value?.trim();
  if (!name) { toast("Teg nomi kiritilmagan!","error"); return; }
  const color = $("newTagColor")?.value || "#58a6ff";
  const r = await apiPost("/api/tags", { name, color });
  if (r?.ok) {
    toast("Teg qo'shildi ✓","success");
    if ($("newTagName")) $("newTagName").value = "";
    loadTagsPage(); loadTags();
  } else toast("Bu nom allaqachon mavjud","error");
}

async function deleteTag(id) {
  if (!confirm("Bu tegni o'chirishni tasdiqlaysizmi?")) return;
  await apiDel(`/api/tags/${id}`);
  toast("O'chirildi","info"); loadTagsPage(); loadTags();
}

async function loadTagMedia(tagId, tagName) {
  const sec = $("tagMediaSection");
  if (!sec) return;
  $("tagMediaTitle").textContent = `🏷 "${tagName}" tegi bilan medialar`;
  sec.style.display = "block";
  const media = await api(`/api/tags/${tagId}/media`);
  $("tagMediaGrid").innerHTML = media?.length
    ? media.map(m => mediaCard(m)).join("")
    : `<div class="empty-state"><p>Bu teg bilan media yo'q</p></div>`;
  sec.scrollIntoView({ behavior:"smooth" });
}

// ── COLLECTIONS ───────────────────────────────
async function loadCollections() {
  const cols = await api("/api/collections");
  const grid = $("collectionsGrid");
  if (!cols?.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><p>To'plam yo'q. Yangi yarating!</p></div>`;
    return;
  }
  grid.innerHTML = cols.map(c => `
    <div class="playlist-card" style="border-top:3px solid ${c.cover_color||"#58a6ff"}">
      <div class="playlist-card-title">📂 ${escHtml(c.name)}</div>
      ${c.description?`<div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">${escHtml(c.description)}</div>`:""}
      <div class="playlist-card-actions">
        <button class="btn btn-primary btn-sm" onclick="openCollection(${c.id})">📂 Ochish</button>
        <button class="btn btn-sm btn-danger" onclick="deleteCollection(${c.id})">🗑</button>
      </div>
    </div>`).join("");
}

function showCreateCollection() {
  ["colName","colDesc","colGenre","colSearch"].forEach(id => { if ($(id)) $(id).value=""; });
  if ($("colType")) $("colType").value = "";
  if ($("colFav"))  $("colFav").checked = false;
  $("createCollectionModal").style.display = "flex";
}

async function doCreateCollection() {
  const name = $("colName")?.value?.trim();
  if (!name) { toast("Nom kiritilmagan!","error"); return; }
  const filter = {
    type:      $("colType")?.value || "",
    genre:     $("colGenre")?.value?.trim() || "",
    search:    $("colSearch")?.value?.trim() || "",
    favorites: $("colFav")?.checked || false,
  };
  const r = await apiPost("/api/collections", {
    name, description: $("colDesc")?.value?.trim()||"",
    filter, cover_color: $("colColor")?.value||"#58a6ff" });
  if (r?.ok) {
    toast("To'plam yaratildi ✓","success");
    $("createCollectionModal").style.display = "none";
    loadCollections();
  }
}

async function openCollection(id) {
  const sec = $("collectionDetail"); if (!sec) return;
  $("collectionsGrid").style.display = "none";
  sec.style.display = "block";
  const media = await api(`/api/collections/${id}/media`);
  sec.innerHTML = `
    <button class="btn btn-sm" onclick="backToCollections()">← Orqaga</button>
    <div class="media-grid" style="margin-top:16px">
      ${media?.length ? media.map(m=>mediaCard(m)).join("") : `<div class="empty-state"><p>Bu to'plamda media yo'q</p></div>`}
    </div>`;
}

function backToCollections() {
  $("collectionDetail").style.display = "none";
  $("collectionsGrid").style.display = "";
}

async function deleteCollection(id) {
  if (!confirm("Bu to'plamni o'chirishni tasdiqlaysizmi?")) return;
  await apiDel(`/api/collections/${id}`);
  toast("O'chirildi","info"); loadCollections();
}

// ── TRASH ─────────────────────────────────────
async function loadTrash() {
  const list = $("trashList"); if (!list) return;
  const data = await api("/api/trash");
  if (!data?.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🗑</div><p>Savat bo'sh</p></div>`;
    return;
  }
  list.innerHTML = `<table style="width:100%">
    <thead><tr><th>Media</th><th>Tur</th><th>Kategoriya</th><th>O'chirilgan</th><th>Amallar</th></tr></thead>
    <tbody>${data.map(m=>`<tr>
      <td>${escHtml(m.title)}</td>
      <td><span class="badge badge-${m.media_type}">${mIcon(m.media_type)} ${m.media_type}</span></td>
      <td>${m.category_name||"—"}</td>
      <td style="color:var(--text-muted)">${fmtDate(m.deleted_at)}</td>
      <td style="display:flex;gap:4px">
        <button class="btn btn-sm btn-primary" onclick="restoreMedia(${m.id})">↩ Tiklash</button>
        <button class="btn btn-sm btn-danger" onclick="permDelete(${m.id})">🗑 O'chir</button>
      </td>
    </tr>`).join("")}</tbody></table>`;
}

async function restoreMedia(id) {
  await apiPost(`/api/trash/${id}/restore`, {});
  toast("Tiklandi ✓","success"); loadTrash(); updateTrashBadge();
}

async function permDelete(id) {
  if (!confirm("Butunlay o'chirishni tasdiqlaysizmi? Bu amalni qaytarib bo'lmaydi!")) return;
  await apiDel(`/api/trash/${id}`);
  toast("Butunlay o'chirildi","info"); loadTrash(); updateTrashBadge();
}

async function emptyTrash() {
  if (!confirm("Savatdagi barcha medialarni butunlay o'chirishni tasdiqlaysizmi?")) return;
  const r = await apiPost("/api/trash/empty", {});
  toast(`${r?.deleted||0} ta o'chirildi`,"info"); loadTrash(); updateTrashBadge();
}

// ── ACTIVITY LOG ──────────────────────────────
async function loadActivity() {
  const list = $("activityList"); if (!list) return;
  const data = await api("/api/activity?limit=300");
  if (!data?.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>Faoliyat jurnali bo'sh</p></div>`;
    return;
  }
  const icons = { add:"➕", trash:"🗑", restore:"↩", delete_permanent:"💥",
    batch_edit:"✏", rename:"🏷", import:"📦", scan:"🔍" };
  list.innerHTML = `<div class="activity-list">${data.map(a=>`
    <div class="activity-item">
      <div class="activity-icon">${icons[a.action]||"📌"}</div>
      <div class="activity-body">
        <div class="activity-action">${escHtml(a.action)}: <strong>${escHtml(a.target)}</strong></div>
        ${a.detail?`<div class="activity-detail">${escHtml(a.detail)}</div>`:""}
      </div>
      <div class="activity-time">${fmtDate(a.created_at)}</div>
    </div>`).join("")}</div>`;
}

async function clearActivity() {
  if (!confirm("Faoliyat jurnalini tozalashni tasdiqlaysizmi?")) return;
  await apiDel("/api/activity");
  toast("Tozalandi","info"); loadActivity();
}

// ── STORAGE ANALYZER ─────────────────────────
async function loadStorage() {
  const [rows, stats] = await Promise.all([api("/api/storage"), api("/api/stats")]);
  const wrap = $("storageWrap"); if (!wrap) return;
  const totalMb = stats?.total_size_mb || 0;
  const colors = { video:"#58a6ff", audio:"#d29922", image:"#da7bff", book:"#ff9500" };
  wrap.innerHTML = `
    <div class="storage-overview">
      <div class="stat-card">
        <div class="stat-val" style="color:var(--accent)">${totalMb} MB</div>
        <div class="stat-label">💾 Jami hajm</div>
      </div>
      ${(rows||[]).map(r => `
        <div class="stat-card">
          <div class="stat-val" style="color:${colors[r.media_type]||"#79b8ff"}">${fmtSize(r.total_bytes)}</div>
          <div class="stat-label">${mIcon(r.media_type)} ${r.media_type} (${r.count} ta)</div>
        </div>`).join("")}
    </div>
    <div class="card" style="margin-top:16px;padding:20px">
      <h3 style="margin-bottom:12px;font-size:13px;color:var(--text-secondary)">📊 Disk foydalanish</h3>
      <canvas id="storageChart" style="max-height:260px"></canvas>
    </div>`;
  // Chart
  if (rows?.length) {
    setTimeout(() => {
      const ctx = $("storageChart")?.getContext("2d");
      if (!ctx) return;
      if (State.charts.storageChart) { State.charts.storageChart.destroy(); }
      State.charts.storageChart = new Chart(ctx, {
        type: "doughnut",
        data: {
          labels: rows.map(r => `${mIcon(r.media_type)} ${r.media_type}`),
          datasets: [{ data: rows.map(r => Math.round(r.total_bytes/1048576)),
            backgroundColor: rows.map(r => colors[r.media_type]||"#79b8ff") }]
        },
        options: { responsive:true, plugins:{ legend:{ labels:{ color: State.theme==="dark"?"#e6edf3":"#1f2328" }}}}
      });
    }, 100);
  }
}

async function findDuplicates() {
  const btn = $("findDupBtn");
  if (btn) { btn.disabled=true; btn.textContent="🔍 Qidirilmoqda..."; }
  const dups = await api("/api/media/duplicates");
  if (btn) { btn.disabled=false; btn.textContent="🔍 Topish"; }
  const list = $("duplicatesList"); if (!list) return;
  if (!dups?.length) {
    list.innerHTML = `<div class="empty-state" style="padding:20px"><p>✅ Takroriy fayl topilmadi</p></div>`;
    return;
  }
  list.innerHTML = dups.map(d => `
    <div class="dup-item card" style="margin-bottom:8px;padding:14px">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">MD5: ${d.md5}</div>
      <div>${d.titles.split(" || ").map(t => `<div style="padding:4px 0">📄 ${escHtml(t)}</div>`).join("")}</div>
    </div>`).join("");
}


// ── VIDEO / AUDIO PLAYER ──────────────────────
async function openPlayer(id, playlistId, playlistItems, plIndex) {
  if (State.player.mediaId === id && $("playerModal").style.display !== "none") return;
  const m = await api(`/api/media/${id}`);
  if (!m) { toast("Media topilmadi","error"); return; }
  if (m.media_type === "image") { openImageViewer(id); return; }
  if (m.media_type === "book")  { openBookViewer(id); return; }

  Object.assign(State.player, {
    mediaId: id, mediaType: m.media_type,
    playlistId: playlistId||null,
    playlistItems: playlistItems||[],
    playlistIndex: plIndex!==undefined ? plIndex : -1,
    loopEnabled: false, loopStart: 0, loopEnd: 0,
    watchStartTime: Date.now(),
  });

  $("playerTitle").textContent = m.title;
  $("playerModal").style.display = "flex";

  const vid = $("videoEl"), aud = $("audioEl");
  const streamUrl = `/api/stream/${id}`;

  // Playlist nav
  const nav = $("playerPlaylistNav");
  if (nav) {
    nav.style.display = (playlistItems?.length > 1) ? "flex" : "none";
    if ($("plPrevBtn")) $("plPrevBtn").disabled = (plIndex||0) <= 0;
    if ($("plNextBtn")) $("plNextBtn").disabled = (plIndex||0) >= (playlistItems?.length||1)-1;
    if ($("plNavLabel")) $("plNavLabel").textContent = `${(plIndex||0)+1} / ${playlistItems?.length||1}`;
  }

  if (m.media_type === "audio") {
    vid.style.display = "none"; aud.style.display = "block";
    aud.src = streamUrl;
  } else {
    vid.style.display = "block"; aud.style.display = "none";
    vid.src = streamUrl;
  }

  setupPlayerEvents(m.media_type === "audio" ? aud : vid, id);
  const el = getMediaEl();

  // Progress resume
  const prog = await api(`/api/media/${id}/progress`);
  if (prog?.position > 1000) {
    if (el.readyState >= 1) el.currentTime = prog.position / 1000;
    else el.addEventListener("loadedmetadata", function once() {
      el.currentTime = prog.position / 1000;
      el.removeEventListener("loadedmetadata", once);
    });
  }

  // Subtitle
  const sub = m.subtitle;
  if (sub && m.media_type === "video") {
    const track = $("subTrack");
    if (track) { track.src = sub; track.style.display = ""; }
    if ($("subStatus")) $("subStatus").textContent = "✅ Yuklangan";
    if ($("subSelector")) $("subSelector").style.display = "flex";
  } else {
    if ($("subSelector")) $("subSelector").style.display = "none";
  }

  // Bookmarks
  loadPlayerBookmarks(id);

  // Info
  $("playerInfo").innerHTML = [
    m.media_type==="video" ? "🎬 Video" : "🎵 Audio",
    m.category_name ? `🏷 ${escHtml(m.category_name)}` : "",
    m.year>0 ? `📆 ${m.year}` : "",
    (m.rating||0)>0 ? `⭐ ${m.rating.toFixed(1)}` : "",
    m.genre ? `🎭 ${escHtml(m.genre)}` : "",
    m.file_size ? `💾 ${fmtSize(m.file_size)}` : "",
    m.views ? `👁 ${m.views}` : "",
  ].filter(Boolean).map(t=>`<span>${t}</span>`).join("");

  const vol = parseInt(localStorage.getItem("vol")||"80");
  if ($("volBar")) $("volBar").value = vol;
  if ($("volLabel")) $("volLabel").textContent = vol+"%";
  el.volume = vol / 100;

  updateLoopUI();
  $("subSelector") && ($("subSelector").style.display = m.media_type==="video" ? "flex" : "none");
  el.play().catch(() => { if($("playerStatus")) $("playerStatus").textContent = "▶ Play tugmasini bosing"; });
}

function setupPlayerEvents(el, mediaId) {
  const newEl = el.cloneNode(true);
  el.parentNode.replaceChild(newEl, el);
  if (newEl.id === "videoEl") window._videoEl = newEl;
  else window._audioEl = newEl;

  let lastSavedSec = -1;

  newEl.onloadedmetadata = () => {
    if ($("playerStatus")) $("playerStatus").textContent = "✅ Tayyor";
    if ($("timeDur")) $("timeDur").textContent = fmtTime(newEl.duration * 1000);
    if ($("seekBar")) $("seekBar").max = 1000;
    if (!State.player.loopEnd) State.player.loopEnd = newEl.duration;
  };

  newEl.ontimeupdate = () => {
    if (State.player.seeking) return;
    const pct = newEl.duration ? (newEl.currentTime / newEl.duration) * 1000 : 0;
    if ($("seekBar")) $("seekBar").value = pct;
    if ($("timeCur")) $("timeCur").textContent = fmtTime(newEl.currentTime * 1000);
    // Loop
    if (State.player.loopEnabled && State.player.loopEnd > State.player.loopStart &&
        newEl.currentTime >= State.player.loopEnd)
      newEl.currentTime = State.player.loopStart;
    // Progress — every 10s
    const curSec = Math.floor(newEl.currentTime / 10);
    if (curSec !== lastSavedSec && newEl.duration > 0) {
      lastSavedSec = curSec;
      apiPost(`/api/media/${mediaId}/progress`, {
        position: Math.floor(newEl.currentTime * 1000),
        duration: Math.floor(newEl.duration * 1000),
      });
    }
  };

  newEl.onplay  = () => { if ($("playBtn")) $("playBtn").textContent = "⏸"; if ($("overlayIcon")) $("overlayIcon").style.display = "none"; };
  newEl.onpause = () => { if ($("playBtn")) $("playBtn").textContent = "▶"; if ($("overlayIcon")) $("overlayIcon").style.display = "flex"; };
  newEl.onended = () => {
    if ($("playerStatus")) $("playerStatus").textContent = "⏹ Tugadi";
    if (newEl.duration > 0)
      apiPost(`/api/media/${mediaId}/progress`, {
        position: Math.floor(newEl.duration * 1000),
        duration: Math.floor(newEl.duration * 1000),
      });
    saveWatchTime();
    playlistNext();
  };
  newEl.onerror   = () => { if ($("playerStatus")) $("playerStatus").textContent = "❌ Yuklashda xato"; };
  newEl.onwaiting = () => { if ($("playerStatus")) $("playerStatus").textContent = "⏳ Buffer..."; };
  newEl.oncanplay = () => { if ($("playerStatus")) $("playerStatus").textContent = "✅ Tayyor"; };
}

function getMediaEl() {
  return State.player.mediaType === "audio"
    ? (window._audioEl || $("audioEl"))
    : (window._videoEl || $("videoEl"));
}

function togglePlay() { const el=getMediaEl(); if(el) el.paused ? el.play() : el.pause(); }
function seekRelative(s) { const el=getMediaEl(); if(el) el.currentTime = Math.max(0,Math.min(el.duration||0,el.currentTime+s)); }
function onSeekMove(v)   { State.player.seeking=true; const el=getMediaEl(); if(el&&el.duration) $("timeCur").textContent=fmtTime((v/1000)*el.duration*1000); }
function onSeekRelease(v){ const el=getMediaEl(); if(el?.duration) el.currentTime=(v/1000)*el.duration; setTimeout(()=>{State.player.seeking=false;},100); }
function setVolume(v) {
  const el=getMediaEl(); if(el) el.volume=v/100;
  if($("volLabel")) $("volLabel").textContent=v+"%";
  localStorage.setItem("vol",v); State.player.savedVol=parseInt(v);
  if($("muteBtn")) $("muteBtn").textContent=v==0?"🔇":v<50?"🔉":"🔊";
}
function toggleMute() {
  const el=getMediaEl(); if(!el) return;
  State.player.isMuted = !State.player.isMuted;
  el.muted = State.player.isMuted;
  if($("muteBtn")) $("muteBtn").textContent = State.player.isMuted?"🔇":"🔊";
}
function setSpeed(v) { const el=getMediaEl(); if(el) el.playbackRate=parseFloat(v); }
function toggleFullscreen() {
  const wrap = (window._videoEl||$("videoEl")).closest(".player-wrap")||document.body;
  if (!document.fullscreenElement) wrap.requestFullscreen?.();
  else document.exitFullscreen?.();
}

function saveWatchTime() {
  if (!State.player.watchStartTime || !State.player.mediaId) return;
  const s = Math.round((Date.now()-State.player.watchStartTime)/1000);
  if (s > 5) apiPost(`/api/media/${State.player.mediaId}/watch-time`, { seconds: s });
  State.player.watchStartTime = null;
}

function closePlayer() {
  const el = getMediaEl();
  if (el && !el.paused && el.duration > 0)
    apiPost(`/api/media/${State.player.mediaId}/progress`, {
      position: Math.floor(el.currentTime*1000),
      duration: Math.floor(el.duration*1000),
    });
  saveWatchTime();
  [window._videoEl, window._audioEl].forEach(e => { if(e){e.pause();e.src="";} });
  $("playerModal").style.display = "none";
  Object.assign(State.player, { mediaId:null, playlistItems:[], playlistIndex:-1, loopEnabled:false });
  if ($("equalizerPanel")) $("equalizerPanel").style.display = "none";
}

function playlistPrev() {
  const {playlistItems,playlistIndex} = State.player;
  if (playlistIndex > 0) openPlayer(playlistItems[playlistIndex-1].id, State.player.playlistId, playlistItems, playlistIndex-1);
}
function playlistNext() {
  const {playlistItems,playlistIndex} = State.player;
  if (playlistIndex >= 0 && playlistIndex < playlistItems.length-1)
    openPlayer(playlistItems[playlistIndex+1].id, State.player.playlistId, playlistItems, playlistIndex+1);
}


// ── PiP / Screenshot / Loop ───────────────────
async function togglePiP() {
  const vid = window._videoEl || $("videoEl");
  if (!vid || State.player.mediaType !== "video") { toast("Faqat video uchun","warn"); return; }
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      if ($("pipBtn")) $("pipBtn").textContent = "📺 PiP";
    } else {
      await vid.requestPictureInPicture();
      if ($("pipBtn")) $("pipBtn").textContent = "📺 ✓";
      toast("PiP yoqildi 📺","success");
    }
  } catch { toast("Brauzer PiP-ni qo'llamaydi","error"); }
}

function takeScreenshot() {
  const vid = window._videoEl || $("videoEl");
  if (!vid || vid.readyState < 2) { toast("Video hali yuklanmadi","warn"); return; }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = vid.videoWidth||1280; canvas.height = vid.videoHeight||720;
    canvas.getContext("2d").drawImage(vid, 0, 0);
    const a = document.createElement("a");
    a.download = `screenshot_${State.player.mediaId}_${Math.floor(vid.currentTime)}s.png`;
    a.href = canvas.toDataURL("image/png"); a.click();
    toast("Screenshot saqlandi 📸","success");
  } catch(e) { toast("Screenshot xatosi: "+e.message,"error"); }
}

function toggleLoop() {
  State.player.loopEnabled = !State.player.loopEnabled;
  const el = getMediaEl();
  if (el && !State.player.loopStart && !State.player.loopEnd) el.loop = State.player.loopEnabled;
  updateLoopUI();
  toast(State.player.loopEnabled ? "Loop yoqildi 🔁" : "Loop o'chirildi","info");
}
function setLoopStart() { const el=getMediaEl(); if(el){ State.player.loopStart=el.currentTime; updateLoopUI(); toast(`Loop boshi: ${fmtTime(el.currentTime*1000)}`,"info"); } }
function setLoopEnd()   { const el=getMediaEl(); if(el){ State.player.loopEnd=el.currentTime;   updateLoopUI(); toast(`Loop oxiri: ${fmtTime(el.currentTime*1000)}`,"info"); } }
function resetLoop()    {
  State.player.loopStart=0; State.player.loopEnd=0; State.player.loopEnabled=false;
  const el=getMediaEl(); if(el) el.loop=false;
  updateLoopUI(); toast("Loop tozalandi","info");
}
function updateLoopUI() {
  const btn = $("loopBtn");
  if (btn) { btn.classList.toggle("active",State.player.loopEnabled); btn.textContent=State.player.loopEnabled?"🔁 ✓":"🔁"; }
  const info = $("loopInfo");
  if (info) {
    if (State.player.loopStart>0 || State.player.loopEnd>0) {
      info.textContent = `[${fmtTime(State.player.loopStart*1000)} — ${fmtTime(State.player.loopEnd*1000)}]`;
      info.style.display = "inline";
    } else info.style.display = "none";
  }
}

// ── EQUALIZER (Web Audio API) ─────────────────
function toggleEqualizer() {
  const panel = $("equalizerPanel");
  if (panel) panel.style.display = panel.style.display==="none" ? "block" : "none";
}

function applyEQ() {
  const bass   = parseFloat($("eqBass")?.value||0);
  const mid    = parseFloat($("eqMid")?.value||0);
  const treble = parseFloat($("eqTreble")?.value||0);
  if ($("eqBassVal")) $("eqBassVal").textContent = bass > 0 ? `+${bass}` : bass;
  if ($("eqMidVal"))  $("eqMidVal").textContent  = mid  > 0 ? `+${mid}`  : mid;
  if ($("eqTrebleVal")) $("eqTrebleVal").textContent = treble>0 ? `+${treble}` : treble;
  const p = State.player;
  // Lazy-init AudioContext
  if (!p.audioCtx) {
    try {
      const el = getMediaEl(); if (!el) return;
      const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const src = ctx.createMediaElementSource(el);
      const bq  = f => ctx.createBiquadFilter();
      p.audioCtx = ctx;
      p.gainBass   = bq(); p.gainBass.type   = "lowshelf";  p.gainBass.frequency.value   = 200;
      p.gainMid    = bq(); p.gainMid.type    = "peaking";   p.gainMid.frequency.value    = 1000;
      p.gainTreble = bq(); p.gainTreble.type = "highshelf"; p.gainTreble.frequency.value = 5000;
      src.connect(p.gainBass); p.gainBass.connect(p.gainMid);
      p.gainMid.connect(p.gainTreble); p.gainTreble.connect(ctx.destination);
    } catch(e) { toast("AudioContext xatosi: "+e.message,"error"); return; }
  }
  if (p.gainBass)   p.gainBass.gain.value   = bass;
  if (p.gainMid)    p.gainMid.gain.value    = mid;
  if (p.gainTreble) p.gainTreble.gain.value = treble;
}

function eqPreset(bass, mid, treble) {
  if ($("eqBass"))   $("eqBass").value   = bass;
  if ($("eqMid"))    $("eqMid").value    = mid;
  if ($("eqTreble")) $("eqTreble").value = treble;
  applyEQ(); toast("EQ preset qo'llanildi","info");
}

// ── BOOKMARKS (player) ────────────────────────
async function loadPlayerBookmarks(mediaId) {
  const bms = await api(`/api/media/${mediaId}/bookmarks`);
  const el  = getMediaEl();
  const bmList = $("bookmarksList");
  // Markers on seek bar
  const markers = $("bookmarkMarkers");
  if (markers && el?.duration) {
    markers.innerHTML = (bms||[]).map(b => {
      const pct = (b.position/1000/el.duration)*100;
      return `<div class="bm-marker" style="left:${pct}%" title="${escHtml(b.label||fmtTime(b.position))}" onclick="seekToBm(${b.position/1000})"></div>`;
    }).join("");
  }
  if (bmList) {
    bmList.style.display = bms?.length ? "flex" : "none";
    bmList.innerHTML = (bms||[]).map(b => `
      <button class="bm-item" onclick="seekToBm(${b.position/1000})" title="${escHtml(b.label||"")}">
        🔖 ${escHtml(b.label || fmtTime(b.position))}
        <span onclick="event.stopPropagation();deleteBm(${b.id},${mediaId})" class="bm-del">✕</span>
      </button>`).join("");
  }
}

function seekToBm(sec) { const el=getMediaEl(); if(el) el.currentTime=sec; }

function addBookmarkAtCurrent() {
  const el = getMediaEl();
  if (!el || !State.player.mediaId) return;
  const pos = Math.floor(el.currentTime * 1000);
  $("bmPosition").value = pos;
  $("bmMediaId").value  = State.player.mediaId;
  $("bmLabel").value    = "";
  $("bookmarkModal").style.display = "flex";
  setTimeout(() => $("bmLabel").focus(), 60);
}

async function saveBookmark() {
  const pos   = parseInt($("bmPosition").value);
  const mid   = parseInt($("bmMediaId").value);
  const label = $("bmLabel")?.value?.trim() || "";
  if (!mid) return;
  await apiPost(`/api/media/${mid}/bookmarks`, { position: pos, label });
  $("bookmarkModal").style.display = "none";
  loadPlayerBookmarks(mid);
  toast("Bookmark saqlandi 🔖","success");
}

function closeBookmarkModal() { $("bookmarkModal").style.display = "none"; }

async function deleteBm(bmId, mediaId) {
  await apiDel(`/api/bookmarks/${bmId}`);
  loadPlayerBookmarks(mediaId);
  toast("Bookmark o'chirildi","info");
}

// ── NOTES ─────────────────────────────────────
async function openNoteModal(mediaId) {
  if (!mediaId) return;
  $("noteMediaId").value = mediaId;
  const note = await api(`/api/media/${mediaId}/note`);
  if ($("noteContent")) $("noteContent").value = note?.content || "";
  $("noteModal").style.display = "flex";
  setTimeout(() => $("noteContent")?.focus(), 60);
}
function closeNoteModal() { $("noteModal").style.display = "none"; }

async function saveNote() {
  const mid = $("noteMediaId")?.value;
  const content = $("noteContent")?.value?.trim() || "";
  if (!mid) return;
  await apiPost(`/api/media/${mid}/note`, { content });
  toast("Eslatma saqlandi 📝","success"); closeNoteModal();
}

// ── COMMENTS ──────────────────────────────────
async function openCommentsModal(mediaId) {
  if (!mediaId) return;
  $("commentsMediaId").value = mediaId;
  $("newCommentText").value = "";
  $("commentsModal").style.display = "flex";
  await loadComments(mediaId);
}
function closeCommentsModal() { $("commentsModal").style.display = "none"; }

async function loadComments(mediaId) {
  const list = $("commentsList"); if (!list) return;
  const data = await api(`/api/media/${mediaId}/comments`);
  if (!data?.length) {
    list.innerHTML = `<div class="empty-state" style="padding:16px"><div class="empty-icon" style="font-size:28px">💬</div><p>Izoh yo'q</p></div>`;
    return;
  }
  list.innerHTML = data.map(c => `
    <div class="comment-item">
      <div class="comment-content">${escHtml(c.content)}</div>
      <div class="comment-meta">
        <span>🕐 ${fmtDate(c.created_at)}</span>
        <button class="btn btn-sm" style="color:var(--accent-danger);padding:2px 6px;font-size:11px"
          onclick="deleteComment(${c.id},${mediaId})">🗑</button>
      </div>
    </div>`).join("");
}

async function addComment() {
  const mid = $("commentsMediaId")?.value;
  const txt = $("newCommentText")?.value?.trim();
  if (!txt) { toast("Izoh bo'sh","warn"); return; }
  const r = await apiPost(`/api/media/${mid}/comments`, { content: txt });
  if (r?.ok) { $("newCommentText").value=""; await loadComments(mid); toast("Izoh qo'shildi ✓","success"); }
}

async function deleteComment(cid, mid) {
  if (!confirm("Izohni o'chirishni tasdiqlaysizmi?")) return;
  await apiDel(`/api/comments/${cid}`);
  await loadComments(mid); toast("O'chirildi","info");
}

// ── SUBTITLE loader ───────────────────────────
async function loadSubtitle(mediaId) {
  const m = await api(`/api/media/${mediaId}`);
  if (!m?.subtitle) { toast("Subtitr biriktirilmagan. Avval yuklang.","warn"); openSubUpload(mediaId); return; }
  const track = $("subTrack");
  if (track) { track.src = m.subtitle; }
  if ($("subStatus")) $("subStatus").textContent = "✅ "+m.subtitle.split("/").pop();
  toast("Subtitr yuklandi ✓","success");
}

// ── IMAGE VIEWER ──────────────────────────────
async function openImageViewer(id) {
  const m = await api(`/api/media/${id}`);
  if (!m) return;
  $("imageViewerTitle").textContent = m.title;
  $("imageViewerImg").src = `/api/stream/${id}`;
  $("imageViewerInfo").innerHTML = [
    m.category_name ? `🏷 ${escHtml(m.category_name)}` : "",
    m.description   ? escHtml(m.description) : "",
  ].filter(Boolean).join(" · ");
  $("imageViewerModal").style.display = "flex";
}
function closeImageViewer() { $("imageViewerModal").style.display = "none"; }

// ── BOOK VIEWER ───────────────────────────────
async function openBookViewer(id) {
  const m = await api(`/api/media/${id}`);
  if (!m) return;
  $("bookViewerTitle").textContent = m.title;
  const ext = (m.file_path||"").split(".").pop().toLowerCase();
  if (ext === "pdf") {
    $("bookViewerFrame").src = `/api/stream/${id}`;
    $("bookViewerFrame").style.display = "block";
    $("bookViewerText").style.display  = "none";
  } else if (ext === "txt") {
    $("bookViewerFrame").style.display = "none";
    $("bookViewerText").style.display  = "block";
    $("bookViewerText").innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
    try {
      const txt = await (await fetch(`/api/stream/${id}`)).text();
      $("bookViewerText").innerHTML = `<pre class="txt-content">${escHtml(txt)}</pre>`;
    } catch { $("bookViewerText").innerHTML = `<p style="color:var(--accent-danger);padding:20px">❌ O'qib bo'lmadi</p>`; }
  } else {
    $("bookViewerFrame").style.display = "none";
    $("bookViewerText").style.display  = "block";
    $("bookViewerText").innerHTML = `<div style="padding:32px;text-align:center">
      <p style="font-size:56px">📚</p><p style="font-size:18px;font-weight:600;margin:12px 0">${escHtml(m.title)}</p>
      <a href="/api/stream/${id}" target="_blank" class="btn btn-primary" style="display:inline-block;margin:4px">🔗 Ochish</a>
      <a href="/api/stream/${id}" download class="btn" style="display:inline-block;margin:4px">⬇ Yuklab olish</a>
    </div>`;
  }
  $("bookViewerModal").style.display = "flex";
}
function closeBookViewer() { $("bookViewerModal").style.display = "none"; }


// ── PLAYLISTS ─────────────────────────────────
async function loadPlaylists() {
  const pls = await api("/api/playlists");
  const grid = $("playlistsGrid"), det = $("playlistDetail");
  if (det) det.style.display = "none"; State.currentPlaylistId = null;
  if (!pls?.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🎵</div><p>Pleylist yo'q</p></div>`;
    return;
  }
  grid.innerHTML = pls.map(p=>`
    <div class="playlist-card" style="border-top:3px solid ${p.cover_color||"#58a6ff"}">
      <div class="playlist-card-title">🎵 ${escHtml(p.name)}</div>
      <div class="playlist-card-count">${p.media_count} ta media</div>
      ${p.description?`<div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">${escHtml(p.description)}</div>`:""}
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
  $("playlistsGrid").style.display = "none";
  const det = $("playlistDetail"); det.style.display = "block";
  const items = media || [];
  const playable = items.filter(m=>m.media_type==="video"||m.media_type==="audio");
  det.innerHTML = `
    <div class="playlist-detail-header">
      <button class="btn btn-sm" onclick="backToPlaylists()">← Orqaga</button>
      <h2 style="margin:0 12px">🎵 ${escHtml(pl?.name||"Pleylist")}</h2>
      ${pl?.description?`<span style="color:var(--text-secondary);font-size:13px">${escHtml(pl.description)}</span>`:""}
      <div style="margin-left:auto;display:flex;gap:8px">
        ${playable.length?`<button class="btn btn-primary btn-sm" onclick="playPlaylistAll(${id})">▶ Hammasi</button>`:""}
        <button class="btn btn-sm" onclick="showAddMediaToPlaylist(${id})">➕ Qo'sh</button>
      </div>
    </div>
    <div class="playlist-media-list">
      ${!items.length
        ? `<div class="empty-state"><div class="empty-icon">📭</div><p>Bo'sh pleylist</p></div>`
        : items.map((m,i) => playlistItem(m,i,id,items)).join("")}
    </div>`;
  det.scrollIntoView({ behavior:"smooth" });
}

function playlistItem(m,i,plId,all) {
  const pl = all.filter(x=>x.media_type==="video"||x.media_type==="audio");
  const ki = `plc_${plId}_${m.id}`;
  window.__plc = window.__plc||{};
  window.__plc[ki] = { items:pl, index:i };
  const act = m.media_type==="image" ? `openImageViewer(${m.id})`
            : m.media_type==="book"  ? `openBookViewer(${m.id})`
            : `(function(){var c=window.__plc['${ki}'];openPlayer(${m.id},${plId},c.items,c.index);})()`;
  return `<div class="playlist-item">
    <span class="pl-index">${i+1}</span>
    <span class="pl-icon">${mIcon(m.media_type)}</span>
    <div class="pl-info">
      <div class="pl-title">${escHtml(m.title)}</div>
      <div class="pl-meta">${m.category_name?escHtml(m.category_name)+" · ":""}${m.year>0?m.year:""}</div>
    </div>
    <div class="pl-actions">
      <button class="btn btn-primary btn-sm" onclick="${act}">▶</button>
      <button class="btn btn-sm btn-danger" onclick="removeFromPlaylist(${plId},${m.id})">✕</button>
    </div>
  </div>`;
}

function backToPlaylists() {
  $("playlistDetail").style.display = "none";
  $("playlistsGrid").style.display  = "";
  State.currentPlaylistId = null; loadPlaylists();
}

async function playPlaylistAll(plId) {
  const media = await api(`/api/playlists/${plId}/media`);
  if (!media?.length) { toast("Pleylist bo'sh","warn"); return; }
  const pl = media.filter(m=>m.media_type==="video"||m.media_type==="audio");
  if (!pl.length) { toast("O'ynatib bo'lmaydigan media yo'q","warn"); return; }
  openPlayer(pl[0].id, plId, pl, 0);
}

function showCreatePlaylist() {
  $("createPlaylistModal").style.display = "flex";
  setTimeout(() => { if($("newPlName")){$("newPlName").value="";$("newPlName").focus();} },60);
}
function closeCreatePlaylist() { $("createPlaylistModal").style.display = "none"; }

async function doCreatePlaylist() {
  const name = $("newPlName")?.value?.trim();
  if (!name) { toast("Nom kiritilmagan!","error"); return; }
  const r = await apiPost("/api/playlists", { name, description:$("newPlDesc")?.value?.trim()||"", cover_color:$("newPlColor")?.value||"#58a6ff" });
  if (r?.ok) { toast("Pleylist yaratildi ✓","success"); $("newPlName").value=""; $("newPlDesc").value=""; closeCreatePlaylist(); loadPlaylists(); }
}

async function editPlaylist(id) {
  const pl = await api(`/api/playlists/${id}`); if (!pl) return;
  $("editPlId").value=""; // reset
  $("editPlId").value=id;
  $("editPlName").value=pl.name||"";
  $("editPlDesc").value=pl.description||"";
  $("editPlColor").value=pl.cover_color||"#58a6ff";
  $("editPlaylistModal").style.display="flex";
}
function closeEditPlaylist() { $("editPlaylistModal").style.display="none"; }

async function doEditPlaylist() {
  const id = $("editPlId").value;
  const name = $("editPlName")?.value?.trim();
  if (!name) { toast("Nom kiritilmagan!","error"); return; }
  await apiPut(`/api/playlists/${id}`, { name, description:$("editPlDesc")?.value?.trim()||"", cover_color:$("editPlColor")?.value });
  toast("Saqlandi ✓","success"); closeEditPlaylist(); loadPlaylists();
}

async function deletePlaylist(id) {
  if (!confirm("Bu pleylistni o'chirishni tasdiqlaysizmi?")) return;
  await apiDel(`/api/playlists/${id}`);
  toast("O'chirildi","info"); loadPlaylists();
}

async function removeFromPlaylist(plId,mid) {
  await apiPost(`/api/playlists/${plId}/remove`, { media_id:mid });
  toast("O'chirildi","info"); openPlaylist(plId);
}

async function showAddToPlaylist(mediaId) {
  const pls = await api("/api/playlists");
  if (!pls?.length) { if(confirm("Pleylist yo'q. Yaratishni xohlaysizmi?")) { navigate("playlists"); showCreatePlaylist(); } return; }
  $("quickAddMediaId").value = mediaId;
  $("quickAddPlList").innerHTML = pls.map(p=>`
    <div class="quick-pl-item" onclick="doQuickAdd(${p.id},${mediaId})">
      <span style="color:${p.cover_color||'#58a6ff'}">🎵</span>
      <span>${escHtml(p.name)}</span>
      <span style="color:var(--text-muted);font-size:12px">${p.media_count} ta</span>
    </div>`).join("");
  $("quickAddToPlaylistModal").style.display="flex";
}
function closeQuickAddToPlaylist() { $("quickAddToPlaylistModal").style.display="none"; }

async function doQuickAdd(plId,mediaId) {
  const r = await apiPost(`/api/playlists/${plId}/add`, { media_id:mediaId });
  closeQuickAddToPlaylist();
  toast(r?.ok ? "Qo'shildi ✓" : "Allaqachon mavjud", r?.ok?"success":"warn");
}

async function showAddMediaToPlaylist(plId) {
  $("addMtoPl_plId").value=plId;
  await loadAddMediaToPlaylistList(plId,"");
  $("addMediaToPlaylistModal").style.display="flex";
}

async function loadAddMediaToPlaylistList(plId,search) {
  const list=$("addMtoPl_list"); if(!list) return;
  list.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  const type=($("addMtoPl_type")||{}).value||"";
  const media=await api(`/api/media-for-playlist?playlist_id=${plId}&search=${encodeURIComponent(search)}&type=${type}`);
  if(!media){list.innerHTML="<p>Xato</p>";return;}
  if(!media.length){list.innerHTML=`<div class="empty-state"><p>Topilmadi</p></div>`;return;}
  list.innerHTML=media.map(m=>`
    <div class="add-media-item ${m.in_playlist?"in-playlist":""}">
      <span>${mIcon(m.media_type)}</span>
      <div style="flex:1;min-width:0">
        <div class="add-media-title">${escHtml(m.title)}</div>
        <div style="font-size:11px;color:var(--text-muted)">${m.category_name||""} ${m.year>0?m.year:""}</div>
      </div>
      ${m.in_playlist
        ? `<button class="btn btn-sm" disabled style="opacity:0.5">✓ Bor</button>`
        : `<button class="btn btn-primary btn-sm" onclick="addToPlaylist(${plId},${m.id},this)">+ Qo'sh</button>`}
    </div>`).join("");
}

async function addToPlaylist(plId,mid,btn) {
  const r=await apiPost(`/api/playlists/${plId}/add`,{media_id:mid});
  if(r?.ok){btn.textContent="✓";btn.disabled=true;btn.classList.remove("btn-primary");toast("Qo'shildi ✓","success");}
  else toast("Allaqachon mavjud","warn");
}
function closeAddMediaToPlaylist() { $("addMediaToPlaylistModal").style.display="none"; }

let _addMTimer;
function debounceAddMediaSearch() {
  clearTimeout(_addMTimer);
  _addMTimer = setTimeout(() =>
    loadAddMediaToPlaylistList(parseInt($("addMtoPl_plId").value), $("addMtoPl_search").value), 350);
}


// ── HISTORY ───────────────────────────────────
async function loadHistory() {
  const data = await api("/api/history");
  const w = $("historyTable"); if (!w) return;
  if (!data?.length) { w.innerHTML=`<div class="empty-state"><div class="empty-icon">🕐</div><p>Tarix bo'sh</p></div>`; return; }
  w.innerHTML=`<table><thead><tr><th>#</th><th>Sarlavha</th><th>Tur</th><th>Kategoriya</th><th>Reyting</th><th>Vaqt</th></tr></thead>
    <tbody>${data.map((h,i)=>`
      <tr style="cursor:pointer" onclick="openPlayer(${h.id})">
        <td style="color:var(--text-muted)">${i+1}</td>
        <td>${escHtml(h.title)}</td>
        <td><span class="badge badge-${h.media_type}">${mIcon(h.media_type)} ${h.media_type}</span></td>
        <td>${h.category_name?escHtml(h.category_name):"—"}</td>
        <td class="stars">${stars(h.rating)}</td>
        <td style="color:var(--text-secondary)">${fmtDate(h.played_at)}</td>
      </tr>`).join("")}</tbody></table>`;
}

async function clearHistory() {
  if (!confirm("Ko'rish tarixini tozalashni tasdiqlaysizmi?")) return;
  await apiDel("/api/history");
  toast("Tarix tozalandi ✓","success"); loadHistory();
}

// ── STATS ─────────────────────────────────────
async function loadStatsPage() {
  const period=($("statsPeriodSel")||{}).value||"daily";
  const wrap=$("statsChartWrap"); if(!wrap) return;
  wrap.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  const res=await api(`/api/watch-stats?period=${period}&days=${period==="weekly"?90:30}`);
  if(!res){wrap.innerHTML=`<div class="empty-state"><p>Ma'lumot yo'q</p></div>`;return;}
  if($("totalWatchTime")) $("totalWatchTime").textContent=fmtSeconds(res.total_seconds);
  const {data}=res;
  if(!data?.length){wrap.innerHTML=`<div class="empty-state"><div class="empty-icon">📊</div><p>Ko'rish tarixi yo'q</p></div>`;return;}
  wrap.innerHTML=`<canvas id="watchChart" style="max-height:320px"></canvas>`;
  const labels=data.map(d=>period==="weekly"?d.week_label:d.watched_at);
  const values=data.map(d=>Math.round(d.total_seconds/60));
  if(State.charts.watchChart){State.charts.watchChart.destroy();delete State.charts.watchChart;}
  const ctx=$("watchChart").getContext("2d");
  const dark=State.theme==="dark";
  State.charts.watchChart=new Chart(ctx,{
    type:"bar",
    data:{labels,datasets:[{label:"Ko'rish vaqti (daqiqa)",data:values,
      backgroundColor:"rgba(88,166,255,0.7)",borderColor:"#58a6ff",borderWidth:1,borderRadius:4}]},
    options:{responsive:true,plugins:{legend:{labels:{color:dark?"#e6edf3":"#1f2328"}},
      tooltip:{callbacks:{label:c=>`${c.parsed.y} daqiqa (${fmtSeconds(c.parsed.y*60)})`}}},
      scales:{x:{ticks:{color:dark?"#8b949e":"#57606a"},grid:{color:dark?"#21262d":"#d1d9e0"}},
               y:{ticks:{color:dark?"#8b949e":"#57606a",callback:v=>v+"daq"},grid:{color:dark?"#21262d":"#d1d9e0"}}}}
  });
  // Top watch by media
  const topW=$("watchTimePerMedia"); if(!topW) return;
  const top=await api("/api/top-media?sort=views&limit=10");
  if(!top?.length){topW.innerHTML="";return;}
  topW.innerHTML=`<h3 class="section-hdr" style="margin-top:24px">⏱ Media bo'yicha</h3>
    <div class="watch-time-list">${top.filter(m=>m.total_watch_seconds>0).map(m=>`
      <div class="watch-time-item">
        <span class="wt-icon">${mIcon(m.media_type)}</span>
        <div class="wt-info">
          <div class="wt-title">${escHtml(m.title)}</div>
          <div class="wt-bar-wrap"><div class="wt-bar" style="width:${Math.min(100,m.total_watch_seconds/3600*20)}%"></div></div>
        </div>
        <span class="wt-time">${fmtSeconds(m.total_watch_seconds)}</span>
      </div>`).join("")||"<p style='color:var(--text-muted);padding:10px'>Ma'lumot yo'q</p>"}</div>`;
}

// ── TOP MEDIA ─────────────────────────────────
async function loadTopPage() {
  const sort=($("topSortSel")||{}).value||"views";
  const wrap=$("topMediaList"); if(!wrap) return;
  wrap.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  const media=await api(`/api/top-media?sort=${sort}&limit=30`);
  if(!media?.length){wrap.innerHTML=`<div class="empty-state"><div class="empty-icon">🏆</div><p>Hali media yo'q</p></div>`;return;}
  wrap.innerHTML=media.map((m,i)=>{
    const medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":`<span style="color:var(--text-muted)">#${i+1}</span>`;
    return `<div class="top-media-item">
      <div class="top-rank">${medal}</div>
      ${m.thumbnail?`<img src="${m.thumbnail}" class="top-thumb" onerror="this.style.display='none'">`:
        `<div class="top-icon">${mIcon(m.media_type)}</div>`}
      <div class="top-info">
        <div class="top-title">${escHtml(m.title)}</div>
        <div class="top-meta">
          ${m.category_name?`<span class="cat-dot" style="background:${m.category_color}"></span>${escHtml(m.category_name)} · `:""}
          ${m.year>0?m.year+" · ":""}<span class="stars">${stars(m.rating)}</span> ${(m.rating||0).toFixed(1)}
        </div>
      </div>
      <div class="top-stats">
        <div class="top-stat">👁 ${m.views||0}</div>
        ${m.total_watch_seconds>0?`<div class="top-stat">⏱ ${fmtSeconds(m.total_watch_seconds)}</div>`:""}
      </div>
      <button class="btn btn-primary btn-sm" onclick="openPlayer(${m.id})">▶ Play</button>
    </div>`;
  }).join("");
}

// ── ADMIN ─────────────────────────────────────
async function showAdminTab(tab) {
  State.adminTab=tab;
  document.querySelectorAll(".tab-btn").forEach((b,i)=>b.classList.toggle("active",["media","categories","settings","backup"][i]===tab));
  await loadAdminTab(tab);
}

async function loadAdminTab(tab) {
  const c=$("adminContent"); if(!c) return;
  if (tab==="media") {
    c.innerHTML=`<div class="admin-toolbar">
      <input type="text" class="filter-input" id="adminSearch" placeholder="🔍 Qidirish..." oninput="reloadAdminMedia()" style="max-width:280px">
      <select class="filter-select" id="adminTypeFilter" onchange="reloadAdminMedia()">
        <option value="">Barchasi</option><option value="video">🎬 Video</option>
        <option value="audio">🎵 Audio</option><option value="image">🖼 Rasm</option><option value="book">📚 Kitob</option>
      </select>
      <button class="btn btn-sm" onclick="selectAllAdmin()">☑ Hammasi</button>
      <button class="btn btn-sm btn-danger" onclick="adminBatchDelete()">🗑 O'chir</button>
      <button class="btn btn-sm" onclick="cleanOrphans()">🧹 Orphan</button>
    </div>
    <div class="admin-table-wrap"><table>
      <thead><tr><th><input type="checkbox" id="adminCheckAll" onchange="toggleAllAdmin(this)"></th>
        <th>Sarlavha</th><th>Tur</th><th>Kategoriya</th><th>⭐</th><th>👁</th><th>Hajm</th><th>Amallar</th>
      </tr></thead>
      <tbody id="adminTbody"></tbody>
    </table></div>`;
    await reloadAdminMedia();
  } else if (tab==="categories") {
    const cats=await api("/api/categories");
    c.innerHTML=`<div style="display:flex;gap:8px;margin-bottom:16px;align-items:flex-end">
      <div class="form-group"><label>Nomi</label><input type="text" id="newCatName" class="form-input"></div>
      <div class="form-group"><label>Rang</label><input type="color" id="newCatColor" value="#58a6ff" style="height:36px;width:60px;padding:2px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-secondary);cursor:pointer"></div>
      <button class="btn btn-primary" onclick="addCategory()">+ Qo'shish</button>
    </div>
    <table><thead><tr><th>Rang</th><th>Nomi</th><th>Amallar</th></tr></thead>
    <tbody>${(cats||[]).map(cat=>`<tr>
      <td><span style="background:${cat.color};width:14px;height:14px;display:inline-block;border-radius:50%"></span></td>
      <td>${escHtml(cat.name)}</td>
      <td><button class="btn btn-sm btn-danger" onclick="deleteCategory(${cat.id})">🗑</button></td>
    </tr>`).join("")}</tbody></table>`;
  } else if (tab==="settings") {
    const s=await api("/api/settings")||{};
    c.innerHTML=`<div class="card"><div class="settings-section"><h3>🎬 Player</h3>
      <div class="settings-row"><div><div class="settings-label">Standart ovoz</div></div>
        <input type="number" class="form-input" id="s_vol" value="${s.default_volume||80}" min="0" max="100" style="width:80px"></div>
      <div class="settings-row"><div><div class="settings-label">Avtomatik ijro</div></div>
        <select class="form-input" id="s_auto" style="width:120px">
          <option value="on" ${s.autoplay==="on"?"selected":""}>Yoq</option>
          <option value="off" ${s.autoplay==="off"?"selected":""}>O'chiq</option>
        </select></div>
      <div class="settings-row"><div><div class="settings-label">Sahifadagi media soni</div></div>
        <select class="form-input" id="s_per" style="width:100px">
          ${[12,24,48,96].map(n=>`<option value="${n}" ${(s.per_page||"24")===String(n)?"selected":""}>${n}</option>`).join("")}
        </select></div>
      <div class="settings-row"><div><div class="settings-label">Mavzu</div></div>
        <select class="form-input" id="s_theme" style="width:120px" onchange="applyTheme(this.value)">
          <option value="dark" ${State.theme==="dark"?"selected":""}>🌙 Qorong'i</option>
          <option value="light" ${State.theme==="light"?"selected":""}>☀ Yorug'</option>
        </select></div>
    </div><button class="btn btn-primary" onclick="saveSettings()">💾 Saqlash</button></div>`;
  } else if (tab==="backup") {
    c.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:600px">
      <div class="card"><h3 style="margin-bottom:12px">📤 Eksport</h3>
        <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">JSON sifatida yuklash</p>
        <button class="btn btn-primary" onclick="doExport()">⬇ Yuklab olish</button></div>
      <div class="card"><h3 style="margin-bottom:12px">📥 Import</h3>
        <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">JSON faylni import</p>
        <input type="file" id="importFile" accept=".json" style="display:none" onchange="doImport(this)">
        <button class="btn" onclick="$('importFile').click()">📂 Fayl tanlash</button></div>
    </div>`;
  }
}

async function reloadAdminMedia() {
  const s=($("adminSearch")||{}).value||"";
  const t=($("adminTypeFilter")||{}).value||"";
  const data=await api(`/api/media?search=${encodeURIComponent(s)}&type=${t}&limit=200`);
  const tbody=$("adminTbody"); if(!tbody||!data) return;
  tbody.innerHTML=(data.media||[]).map(m=>`<tr>
    <td><input type="checkbox" data-id="${m.id}"></td>
    <td>${escHtml(m.title)}</td>
    <td><span class="badge badge-${m.media_type}">${mIcon(m.media_type)} ${m.media_type}</span></td>
    <td>${m.category_name||"—"}</td>
    <td class="stars">${(m.rating||0).toFixed(1)}</td>
    <td>${m.views||0}</td>
    <td>${fmtSize(m.file_size)}</td>
    <td style="display:flex;gap:3px;flex-wrap:wrap">
      <button class="btn btn-sm" onclick="openRenameModal(${m.id})">🏷</button>
      <button class="btn btn-sm" onclick="openEdit(${m.id})">✏</button>
      <button class="btn btn-sm" onclick="showMediaInfo(${m.id})">ℹ</button>
      <button class="btn btn-sm btn-danger" onclick="deleteMedia(${m.id})">🗑</button>
    </td>
  </tr>`).join("");
}

function toggleAllAdmin(cb) { document.querySelectorAll("#adminTbody input[type=checkbox]").forEach(c=>c.checked=cb.checked); }
function selectAllAdmin()    { document.querySelectorAll("#adminTbody input[type=checkbox]").forEach(c=>c.checked=true); }

async function adminBatchDelete() {
  const ids=[...document.querySelectorAll("#adminTbody input[type=checkbox]:checked")].map(c=>parseInt(c.dataset.id));
  if(!ids.length){toast("Hech narsa tanlanmadi","warn");return;}
  if(!confirm(`${ids.length} ta mediani savatga yuborishni tasdiqlaysizmi?`)) return;
  await apiPost("/api/media/batch-delete",{ids});
  toast(`${ids.length} ta savatga yuborildi ✓`,"success");
  reloadAdminMedia(); updateTrashBadge();
}

async function cleanOrphans() {
  const r=await apiPost("/api/media/clean-orphans",{});
  toast(r?.deleted>0?`${r.deleted} ta orphan savatga yuborildi`:"Orphan topilmadi","info");
  reloadAdminMedia();
}

async function addCategory() {
  const name=($("newCatName")?.value||"").trim(), color=$("newCatColor")?.value||"#58a6ff";
  if(!name){toast("Nom kiritilmagan!","error");return;}
  const r=await apiPost("/api/categories",{name,color});
  if(r?.ok){toast("Qo'shildi ✓","success");await loadAdminTab("categories");}
  else toast("Bu nom allaqachon mavjud","error");
}

async function deleteCategory(id) {
  if(!confirm("Bu kategoriyani o'chirishni tasdiqlaysizmi?")) return;
  await apiDel(`/api/categories/${id}`);
  toast("O'chirildi","info"); loadAdminTab("categories");
}

async function saveSettings() {
  const data={default_volume:$("s_vol")?.value,autoplay:$("s_auto")?.value,per_page:$("s_per")?.value};
  State.libLimit=parseInt(data.per_page)||24;
  await apiPost("/api/settings",data);
  toast("Saqlandi ✓","success");
}

function doExport() { window.open("/api/backup/export","_blank"); toast("Eksport boshlandi","info"); }

async function doImport(inp) {
  const file=inp.files[0]; if(!file) return;
  const fd=new FormData(); fd.append("file",file);
  const res=await fetch("/api/backup/import",{method:"POST",body:fd});
  const d=await res.json();
  if(d.ok){toast("Import muvaffaqiyatli ✓","success");loadHome();}
  else toast("Import xatosi","error");
}

// ── KEYBOARD SHORTCUTS ────────────────────────
document.addEventListener("keydown", e => {
  if ($("playerModal")?.style.display === "none") return;
  if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;
  const el = getMediaEl();
  switch (e.code) {
    case "Space":     e.preventDefault(); togglePlay(); break;
    case "ArrowLeft": e.preventDefault(); seekRelative(-10); break;
    case "ArrowRight":e.preventDefault(); seekRelative(10);  break;
    case "ArrowUp":   e.preventDefault(); { const v=Math.min(100,State.player.savedVol+10); if($("volBar"))$("volBar").value=v; setVolume(v); } break;
    case "ArrowDown": e.preventDefault(); { const v=Math.max(0,State.player.savedVol-10);  if($("volBar"))$("volBar").value=v; setVolume(v); } break;
    case "KeyM": toggleMute(); break;
    case "KeyF": toggleFullscreen(); break;
    case "KeyL": toggleLoop(); break;
    case "KeyS": takeScreenshot(); break;
    case "KeyB": addBookmarkAtCurrent(); break;
    case "KeyN": playlistNext(); break;
    case "KeyP": playlistPrev(); break;
    case "KeyE": toggleEqualizer(); break;
    case "Escape": closePlayer(); break;
  }
});

function showShortcuts() { $("shortcutsModal").style.display="flex"; }
function closeShortcuts() { $("shortcutsModal").style.display="none"; }

// ── INIT ──────────────────────────────────────
(async function init() {
  applyTheme(State.theme);
  if (State.sidebarCollapsed) {
    document.getElementById("sidebar")?.classList.add("collapsed");
    document.getElementById("mainContent")?.classList.add("sidebar-collapsed");
  }
  const settings = await api("/api/settings");
  if (settings?.per_page) State.libLimit = parseInt(settings.per_page) || 24;
  loadHome();
  updateTrashBadge();
})();
