"""
Media Player Pro — Web Edition v6.0
Flask backend + HTML/JS frontend
Ishga tushirish: python app.py

YANGILIKLAR v6.0:
- Saytdan URL orqali media yuklash
- Rasm/kitob yuklash va ko'rish (image, pdf, epub)
- Playlist: media qo'shish, o'chirish, ichida ko'rish va o'ynash
- Keyboard shortcuts panel
- Dark/Light theme toggle
- Barcha sqlite3.Row → dict() xatolari tuzatildi
- Threading xatolari tuzatildi
- Migration to'liq ishlaydi
"""

import os
import sys
import json
import shutil
import sqlite3
import subprocess
import threading
import webbrowser
import mimetypes
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime
from flask import (
    Flask, render_template, request, jsonify, send_file,
    send_from_directory, abort, Response, stream_with_context
)
from werkzeug.utils import secure_filename

# ─────────────────────────────────────────────
# PATHS
# ─────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
DB_PATH    = BASE_DIR / "data" / "media.db"
MEDIA_DIR  = BASE_DIR / "uploads"
BACKUP_DIR = BASE_DIR / "backups"
THUMB_DIR  = BASE_DIR / "static" / "thumbs"
BOOKS_DIR  = BASE_DIR / "uploads" / "books"
IMAGES_DIR = BASE_DIR / "uploads" / "images"

for d in [BASE_DIR / "data", MEDIA_DIR, BACKUP_DIR, THUMB_DIR, BOOKS_DIR, IMAGES_DIR]:
    d.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {
    "video": {"mp4", "mkv", "avi", "mov", "webm", "wmv", "flv", "m4v", "ts", "3gp"},
    "audio": {"mp3", "wav", "flac", "m4a", "ogg", "opus", "aac", "wma"},
    "image": {"jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"},
    "book":  {"pdf", "epub", "fb2", "txt", "djvu"},
}
ALL_ALLOWED = {ext for exts in ALLOWED_EXTENSIONS.values() for ext in exts}
MAX_CONTENT_LENGTH = 50 * 1024 * 1024 * 1024  # 50 GB

# ─────────────────────────────────────────────
# DATABASE
# ─────────────────────────────────────────────
class Database:
    def __init__(self):
        self.conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self._lock = threading.Lock()
        self._create_tables()
        self._migrate()

    def _create_tables(self):
        self.conn.executescript("""
        CREATE TABLE IF NOT EXISTS categories (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT UNIQUE NOT NULL,
            color      TEXT DEFAULT '#58a6ff',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS media (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT NOT NULL,
            file_path   TEXT NOT NULL,
            media_type  TEXT DEFAULT 'video',
            category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            genre       TEXT DEFAULT '',
            year        INTEGER DEFAULT 0,
            rating      REAL DEFAULT 0.0,
            duration    INTEGER DEFAULT 0,
            file_size   INTEGER DEFAULT 0,
            thumbnail   TEXT DEFAULT '',
            is_favorite INTEGER DEFAULT 0,
            file_mode   TEXT DEFAULT 'copy',
            description TEXT DEFAULT '',
            views       INTEGER DEFAULT 0,
            source_url  TEXT DEFAULT '',
            added_at    TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS history (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id  INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
            played_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS progress (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id   INTEGER UNIQUE NOT NULL REFERENCES media(id) ON DELETE CASCADE,
            position   INTEGER DEFAULT 0,
            duration   INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS playlist (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT DEFAULT '',
            cover_color TEXT DEFAULT '#58a6ff',
            created_at  TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS playlist_media (
            playlist_id INTEGER NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
            media_id    INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
            position    INTEGER DEFAULT 0,
            added_at    TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (playlist_id, media_id)
        );
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type);
        CREATE INDEX IF NOT EXISTS idx_media_fav  ON media(is_favorite);
        CREATE INDEX IF NOT EXISTS idx_history_dt ON history(played_at DESC);
        """)
        self.conn.commit()
        for cat, color in [
            ("Filmlar","#58a6ff"),("Seriyallar","#3fb950"),
            ("Multfilmlar","#d29922"),("Hujjatli","#8b949e"),
            ("Musiqa","#f85149"),("Rasmlar","#da7bff"),
            ("Kitoblar","#ff9500"),("Boshqa","#79b8ff")
        ]:
            self.conn.execute(
                "INSERT OR IGNORE INTO categories(name,color) VALUES(?,?)", (cat, color))
        self.conn.commit()

    def _migrate(self):
        cols = {r[1] for r in self.conn.execute("PRAGMA table_info(media)").fetchall()}
        migrations = {
            "file_mode":   "ALTER TABLE media ADD COLUMN file_mode TEXT DEFAULT 'copy'",
            "description": "ALTER TABLE media ADD COLUMN description TEXT DEFAULT ''",
            "views":       "ALTER TABLE media ADD COLUMN views INTEGER DEFAULT 0",
            "source_url":  "ALTER TABLE media ADD COLUMN source_url TEXT DEFAULT ''",
        }
        for col, sql in migrations.items():
            if col not in cols:
                try:
                    self.conn.execute(sql)
                    self.conn.commit()
                except Exception:
                    pass

        # playlist table migration
        pl_cols = {r[1] for r in self.conn.execute("PRAGMA table_info(playlist)").fetchall()}
        if "cover_color" not in pl_cols:
            try:
                self.conn.execute("ALTER TABLE playlist ADD COLUMN cover_color TEXT DEFAULT '#58a6ff'")
                self.conn.commit()
            except Exception:
                pass

        pm_cols = {r[1] for r in self.conn.execute("PRAGMA table_info(playlist_media)").fetchall()}
        if "added_at" not in pm_cols:
            try:
                self.conn.execute("ALTER TABLE playlist_media ADD COLUMN added_at TEXT DEFAULT (datetime('now'))")
                self.conn.commit()
            except Exception:
                pass

    def _row_to_dict(self, row):
        """sqlite3.Row ni xavfsiz dict ga aylantirish"""
        if row is None:
            return None
        return dict(row)

    def _row(self, sql, params=()):
        with self._lock:
            return self.conn.execute(sql, params).fetchone()

    def _rows(self, sql, params=()):
        with self._lock:
            rows = self.conn.execute(sql, params).fetchall()
            return [dict(r) for r in rows]

    def _exec(self, sql, params=()):
        with self._lock:
            self.conn.execute(sql, params)
            self.conn.commit()

    # ── Media CRUD ────────────────────────────
    def add_media(self, title, file_path, media_type, category_id,
                  genre, year, rating, duration=0, file_size=0,
                  file_mode="copy", description="", source_url=""):
        with self._lock:
            cur = self.conn.execute(
                """INSERT INTO media
                   (title,file_path,media_type,category_id,genre,year,rating,
                    duration,file_size,file_mode,description,source_url)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (title, file_path, media_type, category_id or None, genre,
                 year, min(max(float(rating), 0.0), 5.0),
                 duration, file_size, file_mode, description, source_url))
            self.conn.commit()
            return cur.lastrowid

    def get_media(self, search="", category_id=None, media_type=None,
                  genre=None, year=None, favorites_only=False,
                  sort="added_at", limit=500, offset=0):
        q = """
        SELECT m.*, c.name as category_name, c.color as category_color,
               p.position as saved_position, p.duration as saved_duration
        FROM media m
        LEFT JOIN categories c ON m.category_id = c.id
        LEFT JOIN progress p ON m.id = p.media_id
        WHERE 1=1
        """
        params = []
        if search:
            q += " AND (m.title LIKE ? OR m.genre LIKE ? OR m.description LIKE ?)"
            params += [f"%{search}%"] * 3
        if category_id:
            q += " AND m.category_id=?"; params.append(category_id)
        if media_type and media_type != "all":
            q += " AND m.media_type=?"; params.append(media_type)
        if genre:
            q += " AND m.genre LIKE ?"; params.append(f"%{genre}%")
        if year:
            q += " AND m.year=?"; params.append(year)
        if favorites_only:
            q += " AND m.is_favorite=1"
        sort_map = {
            "added_at": "m.added_at DESC",
            "title": "m.title ASC",
            "rating": "m.rating DESC",
            "views": "m.views DESC",
            "year": "m.year DESC",
        }
        q += f" ORDER BY {sort_map.get(sort, 'm.added_at DESC')} LIMIT ? OFFSET ?"
        params += [limit, offset]
        return self._rows(q, params)

    def get_media_by_id(self, media_id):
        row = self._row("""
            SELECT m.*, c.name as category_name, c.color as category_color,
                   p.position as saved_position, p.duration as saved_duration
            FROM media m
            LEFT JOIN categories c ON m.category_id=c.id
            LEFT JOIN progress p ON m.id=p.media_id
            WHERE m.id=?""", (media_id,))
        return self._row_to_dict(row)

    def delete_media(self, media_id):
        row = self._row("SELECT file_path,file_mode FROM media WHERE id=?", (media_id,))
        if row and row["file_mode"] == "copy":
            fp = Path(row["file_path"])
            if fp.exists() and str(MEDIA_DIR) in str(fp):
                try:
                    fp.unlink()
                except Exception:
                    pass
        self._exec("DELETE FROM media WHERE id=?", (media_id,))

    def delete_orphans(self):
        rows = self._rows("SELECT id, file_path FROM media")
        deleted = 0
        for m in rows:
            if not Path(m["file_path"]).exists():
                self.delete_media(m["id"])
                deleted += 1
        return deleted

    def toggle_favorite(self, media_id):
        self._exec("UPDATE media SET is_favorite = NOT is_favorite WHERE id=?", (media_id,))
        row = self._row("SELECT is_favorite FROM media WHERE id=?", (media_id,))
        return bool(row["is_favorite"]) if row else False

    def update_rating(self, media_id, rating):
        self._exec("UPDATE media SET rating=? WHERE id=?",
                   (min(max(float(rating), 0.0), 5.0), media_id))

    def update_media_meta(self, media_id, **kwargs):
        allowed = {"title", "genre", "year", "rating", "category_id", "description", "duration"}
        sets = {k: v for k, v in kwargs.items() if k in allowed}
        if not sets:
            return
        sql = "UPDATE media SET " + ",".join(f"{k}=?" for k in sets) + " WHERE id=?"
        self._exec(sql, list(sets.values()) + [media_id])

    def increment_views(self, media_id):
        self._exec("UPDATE media SET views = views + 1 WHERE id=?", (media_id,))

    # ── Progress ──────────────────────────────
    def update_progress(self, media_id, position_ms, duration_ms):
        if duration_ms <= 0:
            return
        with self._lock:
            self.conn.execute("""
            INSERT INTO progress(media_id,position,duration,updated_at)
            VALUES(?,?,?,datetime('now'))
            ON CONFLICT(media_id) DO UPDATE SET
              position=excluded.position, duration=excluded.duration,
              updated_at=excluded.updated_at
            """, (media_id, position_ms, duration_ms))
            self.conn.commit()

    def get_progress(self, media_id):
        row = self._row("SELECT position,duration FROM progress WHERE media_id=?", (media_id,))
        if row:
            return {"position": row["position"], "duration": row["duration"]}
        return {"position": 0, "duration": 0}

    def get_continue_watching(self, limit=10):
        return self._rows("""
        SELECT m.*, p.position, p.duration,
               ROUND(p.position*100.0/MAX(p.duration,1),1) as pct,
               c.name as category_name, c.color as category_color
        FROM progress p
        JOIN media m ON p.media_id=m.id
        LEFT JOIN categories c ON m.category_id=c.id
        WHERE p.duration>0
          AND (p.position*100.0/p.duration) < 95
          AND (p.position*100.0/p.duration) > 2
          AND m.media_type IN ('video','audio')
        ORDER BY p.updated_at DESC LIMIT ?""", (limit,))

    # ── History ───────────────────────────────
    def add_history(self, media_id):
        self._exec("INSERT INTO history(media_id) VALUES(?)", (media_id,))

    def get_history(self, limit=200):
        return self._rows("""
        SELECT m.title, h.played_at, m.id, m.media_type, m.rating,
               c.name as category_name
        FROM history h
        JOIN media m ON h.media_id=m.id
        LEFT JOIN categories c ON m.category_id=c.id
        ORDER BY h.played_at DESC LIMIT ?""", (limit,))

    def clear_history(self):
        self._exec("DELETE FROM history")

    # ── Categories ────────────────────────────
    def get_categories(self):
        return self._rows("SELECT * FROM categories ORDER BY name")

    def add_category(self, name, color="#58a6ff"):
        try:
            self._exec("INSERT INTO categories(name,color) VALUES(?,?)", (name, color))
            return True
        except Exception:
            return False

    def delete_category(self, cat_id):
        self._exec("UPDATE media SET category_id=NULL WHERE category_id=?", (cat_id,))
        self._exec("DELETE FROM categories WHERE id=?", (cat_id,))

    # ── Playlists ─────────────────────────────
    def get_playlists(self):
        return self._rows("""
        SELECT p.*, COUNT(pm.media_id) as media_count
        FROM playlist p
        LEFT JOIN playlist_media pm ON p.id=pm.playlist_id
        GROUP BY p.id ORDER BY p.created_at DESC""")

    def create_playlist(self, name, description="", cover_color="#58a6ff"):
        with self._lock:
            cur = self.conn.execute(
                "INSERT INTO playlist(name,description,cover_color) VALUES(?,?,?)",
                (name, description, cover_color))
            self.conn.commit()
            return cur.lastrowid

    def update_playlist(self, playlist_id, name=None, description=None, cover_color=None):
        sets = []
        vals = []
        if name is not None:
            sets.append("name=?"); vals.append(name)
        if description is not None:
            sets.append("description=?"); vals.append(description)
        if cover_color is not None:
            sets.append("cover_color=?"); vals.append(cover_color)
        if sets:
            vals.append(playlist_id)
            self._exec(f"UPDATE playlist SET {','.join(sets)} WHERE id=?", vals)

    def delete_playlist(self, playlist_id):
        self._exec("DELETE FROM playlist WHERE id=?", (playlist_id,))

    def add_to_playlist(self, playlist_id, media_id):
        row = self._row(
            "SELECT COUNT(*) as c FROM playlist_media WHERE playlist_id=?",
            (playlist_id,))
        pos = row["c"] if row else 0
        try:
            with self._lock:
                self.conn.execute(
                    "INSERT INTO playlist_media(playlist_id,media_id,position) VALUES(?,?,?)",
                    (playlist_id, media_id, pos))
                self.conn.commit()
            return True
        except Exception:
            return False

    def remove_from_playlist(self, playlist_id, media_id):
        self._exec(
            "DELETE FROM playlist_media WHERE playlist_id=? AND media_id=?",
            (playlist_id, media_id))

    def get_playlist_by_id(self, playlist_id):
        row = self._row("SELECT * FROM playlist WHERE id=?", (playlist_id,))
        return self._row_to_dict(row)

    def get_playlist_media(self, playlist_id):
        return self._rows("""
        SELECT m.*, pm.position as playlist_pos, pm.added_at as playlist_added,
               c.name as category_name, c.color as category_color
        FROM playlist_media pm
        JOIN media m ON pm.media_id=m.id
        LEFT JOIN categories c ON m.category_id=c.id
        WHERE pm.playlist_id=?
        ORDER BY pm.position""", (playlist_id,))

    def reorder_playlist(self, playlist_id, media_ids):
        with self._lock:
            for i, mid in enumerate(media_ids):
                self.conn.execute(
                    "UPDATE playlist_media SET position=? WHERE playlist_id=? AND media_id=?",
                    (i, playlist_id, mid))
            self.conn.commit()

    # ── Stats ─────────────────────────────────
    def get_stats(self):
        def scalar(sql):
            r = self._row(sql)
            return r[0] if r else 0
        return {
            "total":         scalar("SELECT COUNT(*) FROM media"),
            "videos":        scalar("SELECT COUNT(*) FROM media WHERE media_type='video'"),
            "audio":         scalar("SELECT COUNT(*) FROM media WHERE media_type='audio'"),
            "images":        scalar("SELECT COUNT(*) FROM media WHERE media_type='image'"),
            "books":         scalar("SELECT COUNT(*) FROM media WHERE media_type='book'"),
            "favorites":     scalar("SELECT COUNT(*) FROM media WHERE is_favorite=1"),
            "history":       scalar("SELECT COUNT(*) FROM history"),
            "total_size_mb": round((scalar("SELECT SUM(file_size) FROM media") or 0) / (1024*1024), 1),
            "playlists":     scalar("SELECT COUNT(*) FROM playlist"),
            "categories":    scalar("SELECT COUNT(*) FROM categories"),
        }

    # ── Backup ────────────────────────────────
    def export_database(self, path):
        data = {
            "version": "6.0",
            "exported_at": datetime.now().isoformat(),
            "categories": self._rows("SELECT * FROM categories"),
            "media":      self._rows("SELECT * FROM media"),
            "playlists":  self._rows("SELECT * FROM playlist"),
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def import_database(self, path):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for cat in data.get("categories", []):
            try:
                self._exec(
                    "INSERT OR IGNORE INTO categories(name,color) VALUES(?,?)",
                    (cat["name"], cat.get("color", "#58a6ff")))
            except Exception:
                pass
        for m in data.get("media", []):
            try:
                with self._lock:
                    self.conn.execute("""
                    INSERT OR IGNORE INTO media
                    (title,file_path,media_type,genre,year,rating,is_favorite,added_at,description)
                    VALUES(?,?,?,?,?,?,?,?,?)""",
                    (m["title"], m["file_path"], m.get("media_type","video"),
                     m.get("genre",""), m.get("year",0), m.get("rating",0.0),
                     m.get("is_favorite",0), m.get("added_at",""),
                     m.get("description","")))
                    self.conn.commit()
            except Exception:
                pass

    # ── Settings ──────────────────────────────
    def get_setting(self, key, default=""):
        row = self._row("SELECT value FROM settings WHERE key=?", (key,))
        return row["value"] if row else default

    def set_setting(self, key, value):
        with self._lock:
            self.conn.execute("""
            INSERT INTO settings(key,value) VALUES(?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
            (key, str(value)))
            self.conn.commit()

    def get_all_settings(self):
        rows = self._rows("SELECT key, value FROM settings")
        return {r["key"]: r["value"] for r in rows}

    # ── Search suggestions ────────────────────
    def get_genres(self):
        rows = self._rows("SELECT DISTINCT genre FROM media WHERE genre != '' ORDER BY genre")
        return [r["genre"] for r in rows]

    def get_years(self):
        rows = self._rows("SELECT DISTINCT year FROM media WHERE year > 0 ORDER BY year DESC")
        return [r["year"] for r in rows]


# ─────────────────────────────────────────────
# FLASK APP
# ─────────────────────────────────────────────
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
app.config["SECRET_KEY"] = "media_player_pro_2024"

db = Database()


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALL_ALLOWED


def get_media_type(filename):
    ext = filename.rsplit(".", 1)[1].lower() if "." in filename else ""
    if ext in ALLOWED_EXTENSIONS["video"]: return "video"
    if ext in ALLOWED_EXTENSIONS["audio"]: return "audio"
    if ext in ALLOWED_EXTENSIONS["image"]: return "image"
    if ext in ALLOWED_EXTENSIONS["book"]:  return "book"
    return "video"


# ─────────────────────────────────────────────
# ROUTES — Pages
# ─────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


# ─────────────────────────────────────────────
# API — Stats & Home
# ─────────────────────────────────────────────
@app.route("/api/stats")
def api_stats():
    return jsonify(db.get_stats())


@app.route("/api/home")
def api_home():
    stats = db.get_stats()
    recent = db.get_media(limit=12)
    continue_watching = db.get_continue_watching(limit=8)
    return jsonify({
        "stats": stats,
        "recent": recent,
        "continue_watching": continue_watching,
    })


# ─────────────────────────────────────────────
# API — Media CRUD
# ─────────────────────────────────────────────
@app.route("/api/media")
def api_media_list():
    search      = request.args.get("search", "")
    category_id = request.args.get("category_id", type=int)
    media_type  = request.args.get("type", "")
    genre       = request.args.get("genre", "")
    year        = request.args.get("year", type=int)
    favorites   = request.args.get("favorites", "false") == "true"
    sort        = request.args.get("sort", "added_at")
    page        = request.args.get("page", 1, type=int)
    limit       = request.args.get("limit", 24, type=int)
    offset      = (page - 1) * limit

    media = db.get_media(
        search=search, category_id=category_id, media_type=media_type,
        genre=genre, year=year, favorites_only=favorites,
        sort=sort, limit=limit, offset=offset
    )
    return jsonify({"media": media, "page": page, "limit": limit})


@app.route("/api/media/<int:media_id>", methods=["GET"])
def api_media_detail(media_id):
    m = db.get_media_by_id(media_id)
    if not m:
        return jsonify({"error": "Topilmadi"}), 404
    return jsonify(m)


@app.route("/api/media/<int:media_id>", methods=["PUT"])
def api_media_update(media_id):
    data = request.get_json()
    allowed = {"title", "genre", "year", "rating", "category_id", "description", "duration"}
    kwargs = {k: v for k, v in data.items() if k in allowed}
    db.update_media_meta(media_id, **kwargs)
    return jsonify({"ok": True})


@app.route("/api/media/<int:media_id>", methods=["DELETE"])
def api_media_delete(media_id):
    db.delete_media(media_id)
    return jsonify({"ok": True})


@app.route("/api/media/<int:media_id>/favorite", methods=["POST"])
def api_toggle_favorite(media_id):
    is_fav = db.toggle_favorite(media_id)
    return jsonify({"is_favorite": is_fav})


@app.route("/api/media/<int:media_id>/rating", methods=["POST"])
def api_set_rating(media_id):
    data = request.get_json()
    rating = float(data.get("rating", 0))
    db.update_rating(media_id, rating)
    return jsonify({"ok": True})


@app.route("/api/media/batch-delete", methods=["POST"])
def api_batch_delete():
    ids = request.get_json().get("ids", [])
    for mid in ids:
        db.delete_media(mid)
    return jsonify({"deleted": len(ids)})


@app.route("/api/media/clean-orphans", methods=["POST"])
def api_clean_orphans():
    n = db.delete_orphans()
    return jsonify({"deleted": n})


# ─────────────────────────────────────────────
# API — File Upload
# ─────────────────────────────────────────────
@app.route("/api/upload", methods=["POST"])
def api_upload():
    if "file" not in request.files:
        return jsonify({"error": "Fayl topilmadi"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Fayl nomi bo'sh"}), 400
    if not allowed_file(file.filename):
        return jsonify({"error": "Ruxsat etilmagan fayl turi"}), 400

    filename   = secure_filename(file.filename)
    title      = request.form.get("title", Path(filename).stem.replace("_"," ").replace("-"," ").title())
    desc       = request.form.get("description", "")
    m_type     = request.form.get("media_type") or get_media_type(filename)
    cat_id     = request.form.get("category_id", type=int)
    genre      = request.form.get("genre", "")
    year       = request.form.get("year", datetime.now().year, type=int)
    rating     = request.form.get("rating", 0.0, type=float)
    file_mode  = request.form.get("file_mode", "copy")

    # Choose destination directory
    if m_type == "image":
        dest_dir = IMAGES_DIR
    elif m_type == "book":
        dest_dir = BOOKS_DIR
    else:
        dest_dir = MEDIA_DIR

    dst = dest_dir / filename
    counter = 1
    while dst.exists():
        dst = dest_dir / f"{Path(filename).stem}_{counter}{Path(filename).suffix}"
        counter += 1

    file.save(str(dst))
    file_size = dst.stat().st_size

    media_id = db.add_media(
        title=title, file_path=str(dst), media_type=m_type,
        category_id=cat_id, genre=genre, year=year, rating=rating,
        duration=0, file_size=file_size, file_mode=file_mode, description=desc
    )

    return jsonify({"ok": True, "id": media_id, "title": title, "file_size": file_size})


# ─────────────────────────────────────────────
# API — URL Download (saytdan yuklash)
# ─────────────────────────────────────────────
@app.route("/api/download-url", methods=["POST"])
def api_download_url():
    data = request.get_json()
    url  = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "URL kiritilmagan"}), 400

    title    = data.get("title", "").strip()
    m_type   = data.get("media_type", "video")
    cat_id   = data.get("category_id")
    genre    = data.get("genre", "")
    year     = int(data.get("year") or datetime.now().year)
    rating   = float(data.get("rating") or 0)
    desc     = data.get("description", "")
    # "stream" = URL ni yuklamasdan stream qilish; "download" = serverga yuklash
    url_mode = data.get("url_mode", "stream")

    try:
        parsed   = urllib.parse.urlparse(url)
        filename = secure_filename(os.path.basename(parsed.path) or "media")
        if not filename or "." not in filename:
            filename = f"media_{int(datetime.now().timestamp())}.mp4"

        ext = filename.rsplit(".", 1)[-1].lower()

        if not title:
            title = Path(filename).stem.replace("_", " ").replace("-", " ").title()

        if url_mode == "stream":
            # Faylni yuklab olmasdan, URL ni to'g'ridan-to'g'ri bazaga saqlash
            # file_path = URL itself, file_mode = "url"
            media_id = db.add_media(
                title=title, file_path=url, media_type=m_type,
                category_id=cat_id, genre=genre, year=year, rating=rating,
                duration=0, file_size=0, file_mode="url",
                description=desc, source_url=url
            )
            return jsonify({"ok": True, "id": media_id, "title": title,
                            "file_size": 0, "mode": "stream"})

        # download mode: serverga yuklab olish
        if ext not in ALL_ALLOWED:
            return jsonify({"error": f"Ruxsat etilmagan format: .{ext}"}), 400

        if m_type == "image":
            dest_dir = IMAGES_DIR
        elif m_type == "book":
            dest_dir = BOOKS_DIR
        else:
            dest_dir = MEDIA_DIR

        dst = dest_dir / filename
        counter = 1
        while dst.exists():
            dst = dest_dir / f"{Path(filename).stem}_{counter}{Path(filename).suffix}"
            counter += 1

        headers = {"User-Agent": "Mozilla/5.0 (compatible; MediaPlayerPro/6.0)"}
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=120) as resp:
            with open(str(dst), "wb") as f:
                shutil.copyfileobj(resp, f)

        file_size = dst.stat().st_size
        media_id = db.add_media(
            title=title, file_path=str(dst), media_type=m_type,
            category_id=cat_id, genre=genre, year=year, rating=rating,
            duration=0, file_size=file_size, file_mode="copy",
            description=desc, source_url=url
        )
        return jsonify({"ok": True, "id": media_id, "title": title,
                        "file_size": file_size, "mode": "download"})

    except Exception as e:
        return jsonify({"error": f"Xato: {str(e)}"}), 500


# ─────────────────────────────────────────────
# API — Media Streaming + File Serving
# ─────────────────────────────────────────────
@app.route("/api/stream/<int:media_id>")
def api_stream(media_id):
    from flask import redirect as flask_redirect
    m = db.get_media_by_id(media_id)
    if not m:
        abort(404)

    db.add_history(media_id)
    db.increment_views(media_id)

    # URL-mode: original URL ga yo'naltirish (faylni yuklamasdan)
    if m.get("file_mode") == "url":
        return flask_redirect(m["file_path"])

    fp = Path(m["file_path"])
    if not fp.exists():
        return jsonify({"error": "Fayl topilmadi"}), 404

    mime, _ = mimetypes.guess_type(str(fp))
    if not mime:
        ext = fp.suffix.lower()
        mime_map = {
            ".mp4": "video/mp4", ".m4v": "video/mp4",
            ".mkv": "video/x-matroska", ".webm": "video/webm",
            ".avi": "video/x-msvideo", ".mov": "video/quicktime",
            ".mp3": "audio/mpeg", ".wav": "audio/wav",
            ".flac": "audio/flac", ".ogg": "audio/ogg",
            ".m4a": "audio/mp4", ".aac": "audio/aac",
            ".pdf": "application/pdf",
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".gif": "image/gif",
            ".webp": "image/webp", ".svg": "image/svg+xml",
        }
        mime = mime_map.get(ext, "application/octet-stream")

    file_size = fp.stat().st_size
    range_header = request.headers.get("Range", None)

    if range_header:
        import re
        byte1, byte2 = 0, None
        m2 = re.search(r"(\d+)-(\d*)", range_header)
        if m2:
            g = m2.groups()
            if g[0]: byte1 = int(g[0])
            if g[1]: byte2 = int(g[1])
        length = (byte2 - byte1 + 1) if byte2 is not None else file_size - byte1
        byte2 = byte1 + length - 1

        def generate():
            with open(fp, "rb") as f:
                f.seek(byte1)
                remaining = length
                while remaining:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        headers = {
            "Content-Range": f"bytes {byte1}-{byte2}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(length),
            "Content-Type": mime,
        }
        return Response(stream_with_context(generate()), 206, headers=headers)

    return send_file(str(fp), mimetype=mime, conditional=True)


@app.route("/api/media/<int:media_id>/progress", methods=["GET"])
def api_get_progress(media_id):
    return jsonify(db.get_progress(media_id))


@app.route("/api/media/<int:media_id>/progress", methods=["POST"])
def api_save_progress(media_id):
    data = request.get_json()
    db.update_progress(media_id, data.get("position", 0), data.get("duration", 0))
    return jsonify({"ok": True})


# ─────────────────────────────────────────────
# API — History
# ─────────────────────────────────────────────
@app.route("/api/history")
def api_history():
    return jsonify(db.get_history(200))


@app.route("/api/history", methods=["DELETE"])
def api_clear_history():
    db.clear_history()
    return jsonify({"ok": True})


# ─────────────────────────────────────────────
# API — Categories
# ─────────────────────────────────────────────
@app.route("/api/categories")
def api_categories():
    return jsonify(db.get_categories())


@app.route("/api/categories", methods=["POST"])
def api_add_category():
    data = request.get_json()
    ok = db.add_category(data.get("name", ""), data.get("color", "#58a6ff"))
    return jsonify({"ok": ok})


@app.route("/api/categories/<int:cat_id>", methods=["DELETE"])
def api_delete_category(cat_id):
    db.delete_category(cat_id)
    return jsonify({"ok": True})


# ─────────────────────────────────────────────
# API — Playlists (to'liq qayta yozildi)
# ─────────────────────────────────────────────
@app.route("/api/playlists")
def api_playlists():
    return jsonify(db.get_playlists())


@app.route("/api/playlists", methods=["POST"])
def api_create_playlist():
    data = request.get_json()
    pid = db.create_playlist(
        data.get("name", ""),
        data.get("description", ""),
        data.get("cover_color", "#58a6ff")
    )
    return jsonify({"ok": True, "id": pid})


@app.route("/api/playlists/<int:pl_id>", methods=["GET"])
def api_playlist_detail(pl_id):
    pl = db.get_playlist_by_id(pl_id)
    if not pl:
        return jsonify({"error": "Topilmadi"}), 404
    return jsonify(pl)


@app.route("/api/playlists/<int:pl_id>", methods=["PUT"])
def api_update_playlist(pl_id):
    data = request.get_json()
    db.update_playlist(
        pl_id,
        name=data.get("name"),
        description=data.get("description"),
        cover_color=data.get("cover_color")
    )
    return jsonify({"ok": True})


@app.route("/api/playlists/<int:pl_id>", methods=["DELETE"])
def api_delete_playlist(pl_id):
    db.delete_playlist(pl_id)
    return jsonify({"ok": True})


@app.route("/api/playlists/<int:pl_id>/media")
def api_playlist_media(pl_id):
    return jsonify(db.get_playlist_media(pl_id))


@app.route("/api/playlists/<int:pl_id>/add", methods=["POST"])
def api_playlist_add(pl_id):
    data = request.get_json()
    ok = db.add_to_playlist(pl_id, data.get("media_id"))
    return jsonify({"ok": ok})


@app.route("/api/playlists/<int:pl_id>/remove", methods=["POST"])
def api_playlist_remove(pl_id):
    data = request.get_json()
    db.remove_from_playlist(pl_id, data.get("media_id"))
    return jsonify({"ok": True})


@app.route("/api/playlists/<int:pl_id>/reorder", methods=["POST"])
def api_playlist_reorder(pl_id):
    data = request.get_json()
    db.reorder_playlist(pl_id, data.get("media_ids", []))
    return jsonify({"ok": True})


# Barcha medialarni playlist uchun (add-to-playlist modal)
@app.route("/api/media-for-playlist")
def api_media_for_playlist():
    pl_id  = request.args.get("playlist_id", type=int)
    search = request.args.get("search", "")
    m_type = request.args.get("type", "")
    all_media = db.get_media(search=search, media_type=m_type, limit=200)
    if pl_id:
        existing = {m["id"] for m in db.get_playlist_media(pl_id)}
        for m in all_media:
            m["in_playlist"] = m["id"] in existing
    return jsonify(all_media)


# ─────────────────────────────────────────────
# API — Settings
# ─────────────────────────────────────────────
@app.route("/api/settings")
def api_get_settings():
    return jsonify(db.get_all_settings())


@app.route("/api/settings", methods=["POST"])
def api_save_settings():
    data = request.get_json()
    for k, v in data.items():
        db.set_setting(k, v)
    return jsonify({"ok": True})


# ─────────────────────────────────────────────
# API — Backup & Genres/Years
# ─────────────────────────────────────────────
@app.route("/api/backup/export")
def api_export():
    fname = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    path = BACKUP_DIR / fname
    db.export_database(str(path))
    return send_file(str(path), as_attachment=True, download_name=fname)


@app.route("/api/backup/import", methods=["POST"])
def api_import():
    if "file" not in request.files:
        return jsonify({"error": "Fayl topilmadi"}), 400
    f = request.files["file"]
    path = BACKUP_DIR / secure_filename(f.filename)
    f.save(str(path))
    db.import_database(str(path))
    return jsonify({"ok": True})


@app.route("/api/genres")
def api_genres():
    return jsonify(db.get_genres())


@app.route("/api/years")
def api_years():
    return jsonify(db.get_years())


# ─────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────
def open_browser():
    import time
    time.sleep(1.2)
    webbrowser.open("http://localhost:5500")


if __name__ == "__main__":
    print("=" * 55)
    print("  🎬  Media Player Pro v6.0  —  Web Edition")
    print("=" * 55)
    print(f"  📂  Papka  : {BASE_DIR}")
    print(f"  🗄  DB     : {DB_PATH}")
    print(f"  📁  Media  : {MEDIA_DIR}")
    print(f"  🌐  URL    : http://localhost:5500")
    print("=" * 55)
    print("  Ctrl+C bosib to'xtatish mumkin")
    print()
    threading.Thread(target=open_browser, daemon=True).start()
    app.run(host="0.0.0.0", port=5500, debug=False, threaded=True)