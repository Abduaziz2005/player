"""
Media Player Pro — Web Edition v9.0
Ishga tushirish: python app.py

YANGILIKLAR v9.0:
 1. Parol himoyasi (Login/Logout + sessiya)
 2. Faylni qurilmaga yuklashni cheklash (Content-Disposition bloklash)
 3. Sidebar ochish/yopish (frontend, saqlanadi)
 4. Internet ruxsati — admin panel yoqish/o'chirish + sabab ko'rsatish
 5. Internet holati (online/offline) UI indicator
 6. +5 yangi funksiya:
    - Kechiktirilgan o'chirish (Scheduled Delete)
    - Media rating izohi (Review)
    - Ko'rishlar cheklov (Age/Passcode lock)
    - Tezkor eksport (ZIP arxiv)
    - Xabarnomalar (Notification center)
"""
import os, sys, json, shutil, sqlite3, subprocess, threading, zipfile
import webbrowser, mimetypes, urllib.request, urllib.parse, hashlib, re, uuid, secrets
from pathlib import Path
from datetime import datetime, timedelta
from functools import wraps
from flask import (Flask, render_template, request, jsonify, send_file,
                   abort, Response, stream_with_context, session, redirect, url_for)
from werkzeug.utils import secure_filename


# ── PATHS ─────────────────────────────────────
BASE_DIR    = Path(__file__).parent
DB_PATH     = BASE_DIR / "data"   / "media.db"
MEDIA_DIR   = BASE_DIR / "uploads"
BACKUP_DIR  = BASE_DIR / "backups"
THUMB_DIR   = BASE_DIR / "static" / "thumbs"
BOOKS_DIR   = BASE_DIR / "uploads" / "books"
IMAGES_DIR  = BASE_DIR / "uploads" / "images"
SUBS_DIR    = BASE_DIR / "uploads" / "subs"
TRASH_DIR   = BASE_DIR / "trash"
EXPORT_DIR  = BASE_DIR / "exports"

for d in [BASE_DIR/"data", MEDIA_DIR, BACKUP_DIR, THUMB_DIR,
          BOOKS_DIR, IMAGES_DIR, SUBS_DIR, TRASH_DIR, EXPORT_DIR]:
    d.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {
    "video": {"mp4","mkv","avi","mov","webm","wmv","flv","m4v","ts","3gp"},
    "audio": {"mp3","wav","flac","m4a","ogg","opus","aac","wma"},
    "image": {"jpg","jpeg","png","gif","webp","bmp","svg"},
    "book":  {"pdf","epub","fb2","txt","djvu"},
    "sub":   {"srt","vtt","ass","ssa"},
}
ALL_ALLOWED = {e for exts in ALLOWED_EXTENSIONS.values() for e in exts}
MAX_CONTENT_LENGTH = 50 * 1024 * 1024 * 1024  # 50 GB

# Download queue
_dq: dict = {}
_dq_lock  = threading.Lock()

# Notification queue (server-side)
_notifs: list = []
_notif_lock   = threading.Lock()


def _ytdlp_bin():
    for cmd in ("yt-dlp", "yt_dlp", sys.executable + " -m yt_dlp"):
        try:
            r = subprocess.run(cmd.split() + ["--version"], capture_output=True, timeout=5)
            if r.returncode == 0: return cmd.split()
        except Exception: pass
    return None

def _ffprobe_info(filepath: str) -> dict:
    try:
        r = subprocess.run(
            ["ffprobe","-v","quiet","-print_format","json",
             "-show_streams","-show_format", filepath],
            capture_output=True, text=True, timeout=15)
        if r.returncode == 0: return json.loads(r.stdout)
    except Exception: pass
    return {}

def push_notif(title, body, kind="info"):
    """Server-side xabarnoma qo'shish"""
    with _notif_lock:
        _notifs.insert(0, {
            "id":    str(uuid.uuid4())[:8],
            "title": title, "body": body, "kind": kind,
            "read":  False,
            "ts":    datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
        # Max 100 ta saqlash
        if len(_notifs) > 100:
            _notifs.pop()


# ── DATABASE ──────────────────────────────────
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL, color TEXT DEFAULT '#58a6ff',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL, file_path TEXT NOT NULL,
            media_type TEXT DEFAULT 'video',
            category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            genre TEXT DEFAULT '', year INTEGER DEFAULT 0,
            rating REAL DEFAULT 0.0, duration INTEGER DEFAULT 0,
            file_size INTEGER DEFAULT 0, thumbnail TEXT DEFAULT '',
            is_favorite INTEGER DEFAULT 0, file_mode TEXT DEFAULT 'copy',
            description TEXT DEFAULT '', views INTEGER DEFAULT 0,
            source_url TEXT DEFAULT '', subtitle TEXT DEFAULT '',
            md5 TEXT DEFAULT '', deleted INTEGER DEFAULT 0,
            deleted_at TEXT DEFAULT '', locked INTEGER DEFAULT 0,
            lock_code TEXT DEFAULT '', review TEXT DEFAULT '',
            scheduled_delete TEXT DEFAULT '',
            added_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL, color TEXT DEFAULT '#58a6ff'
        );
        CREATE TABLE IF NOT EXISTS media_tags (
            media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
            tag_id   INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
            PRIMARY KEY (media_id, tag_id)
        );
        CREATE TABLE IF NOT EXISTS bookmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
            position INTEGER NOT NULL, label TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
            rating REAL DEFAULT 0.0, text TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
            played_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id INTEGER UNIQUE NOT NULL REFERENCES media(id) ON DELETE CASCADE,
            position INTEGER DEFAULT 0, duration INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS playlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            description TEXT DEFAULT '', cover_color TEXT DEFAULT '#58a6ff',
            is_smart INTEGER DEFAULT 0, smart_filter TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS playlist_media (
            playlist_id INTEGER NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
            media_id    INTEGER NOT NULL REFERENCES media(id)    ON DELETE CASCADE,
            position INTEGER DEFAULT 0,
            added_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (playlist_id, media_id)
        );
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
            content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS watch_time (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
            seconds INTEGER DEFAULT 0, watched_at TEXT DEFAULT (date('now'))
        );
        CREATE TABLE IF NOT EXISTS watch_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL, active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL, target TEXT DEFAULT '',
            detail TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS download_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL,
            title TEXT DEFAULT '', status TEXT DEFAULT 'done',
            file_size INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            description TEXT DEFAULT '', filter_json TEXT DEFAULT '{}',
            cover_color TEXT DEFAULT '#58a6ff', created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_media_type    ON media(media_type);
        CREATE INDEX IF NOT EXISTS idx_media_fav     ON media(is_favorite);
        CREATE INDEX IF NOT EXISTS idx_media_deleted ON media(deleted);
        CREATE INDEX IF NOT EXISTS idx_history_dt    ON history(played_at DESC);
        CREATE INDEX IF NOT EXISTS idx_activity_dt   ON activity_log(created_at DESC);
        """)
        self.conn.commit()
        for cat, color in [
            ("Filmlar","#58a6ff"),("Seriyallar","#3fb950"),
            ("Multfilmlar","#d29922"),("Hujjatli","#8b949e"),
            ("Musiqa","#f85149"),("Rasmlar","#da7bff"),
            ("Kitoblar","#ff9500"),("Boshqa","#79b8ff"),
        ]:
            self.conn.execute("INSERT OR IGNORE INTO categories(name,color) VALUES(?,?)",(cat,color))
        self.conn.commit()


    def _migrate(self):
        media_cols = {r[1] for r in self.conn.execute("PRAGMA table_info(media)").fetchall()}
        for col, sql in {
            "file_mode":        "ALTER TABLE media ADD COLUMN file_mode TEXT DEFAULT 'copy'",
            "description":      "ALTER TABLE media ADD COLUMN description TEXT DEFAULT ''",
            "views":            "ALTER TABLE media ADD COLUMN views INTEGER DEFAULT 0",
            "source_url":       "ALTER TABLE media ADD COLUMN source_url TEXT DEFAULT ''",
            "subtitle":         "ALTER TABLE media ADD COLUMN subtitle TEXT DEFAULT ''",
            "md5":              "ALTER TABLE media ADD COLUMN md5 TEXT DEFAULT ''",
            "deleted":          "ALTER TABLE media ADD COLUMN deleted INTEGER DEFAULT 0",
            "deleted_at":       "ALTER TABLE media ADD COLUMN deleted_at TEXT DEFAULT ''",
            "locked":           "ALTER TABLE media ADD COLUMN locked INTEGER DEFAULT 0",
            "lock_code":        "ALTER TABLE media ADD COLUMN lock_code TEXT DEFAULT ''",
            "review":           "ALTER TABLE media ADD COLUMN review TEXT DEFAULT ''",
            "scheduled_delete": "ALTER TABLE media ADD COLUMN scheduled_delete TEXT DEFAULT ''",
        }.items():
            if col not in media_cols:
                try: self.conn.execute(sql); self.conn.commit()
                except Exception: pass
        # playlist migration
        pl_cols = {r[1] for r in self.conn.execute("PRAGMA table_info(playlist)").fetchall()}
        for col, sql in {
            "cover_color":  "ALTER TABLE playlist ADD COLUMN cover_color TEXT DEFAULT '#58a6ff'",
            "is_smart":     "ALTER TABLE playlist ADD COLUMN is_smart INTEGER DEFAULT 0",
            "smart_filter": "ALTER TABLE playlist ADD COLUMN smart_filter TEXT DEFAULT ''",
        }.items():
            if col not in pl_cols:
                try: self.conn.execute(sql); self.conn.commit()
                except Exception: pass
        # reviews table check
        tbls = {r[0] for r in self.conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "reviews" not in tbls:
            try:
                self.conn.execute("""CREATE TABLE IF NOT EXISTS reviews (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
                    rating REAL DEFAULT 0.0, text TEXT DEFAULT '',
                    created_at TEXT DEFAULT (datetime('now'))
                )""")
                self.conn.commit()
            except Exception: pass

    # ── Helpers ──────────────────────────────
    def _d(self, r): return dict(r) if r else None
    def _row(self, sql, p=()):
        with self._lock: return self.conn.execute(sql, p).fetchone()
    def _rows(self, sql, p=()):
        with self._lock: return [dict(r) for r in self.conn.execute(sql, p).fetchall()]
    def _exec(self, sql, p=()):
        with self._lock: self.conn.execute(sql, p); self.conn.commit()
    def _ins(self, sql, p=()):
        with self._lock:
            c = self.conn.execute(sql, p); self.conn.commit(); return c.lastrowid

    # ── Settings ─────────────────────────────
    def get_setting(self, key, default=""):
        r = self._row("SELECT value FROM settings WHERE key=?", (key,))
        return r["value"] if r else default

    def set_setting(self, key, value):
        with self._lock:
            self.conn.execute("""INSERT INTO settings(key,value) VALUES(?,?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value""", (key, str(value)))
            self.conn.commit()

    def get_all_settings(self):
        return {r["key"]: r["value"] for r in self._rows("SELECT key,value FROM settings")}

    # ── Activity Log ─────────────────────────
    def log(self, action, target="", detail=""):
        self._exec("INSERT INTO activity_log(action,target,detail) VALUES(?,?,?)",
                   (action, str(target), str(detail)))

    def get_activity_log(self, limit=200):
        return self._rows("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?", (limit,))

    def clear_activity_log(self): self._exec("DELETE FROM activity_log")


    # ── Media CRUD ────────────────────────────
    def add_media(self, title, file_path, media_type, category_id=None,
                  genre="", year=0, rating=0.0, duration=0, file_size=0,
                  file_mode="copy", description="", source_url="",
                  subtitle="", thumbnail=""):
        mid = self._ins("""INSERT INTO media
              (title,file_path,media_type,category_id,genre,year,rating,
               duration,file_size,file_mode,description,source_url,subtitle,thumbnail)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (title, file_path, media_type, category_id or None, genre,
             year, min(max(float(rating),0),5), duration, file_size,
             file_mode, description, source_url, subtitle, thumbnail))
        self.log("add", title, f"type={media_type}")
        return mid

    def get_media(self, search="", category_id=None, media_type=None,
                  genre=None, year=None, favorites_only=False, tag_ids=None,
                  sort="added_at", limit=500, offset=0, include_deleted=False):
        q = """SELECT m.*, c.name as category_name, c.color as category_color,
               p.position as saved_position, p.duration as saved_duration,
               GROUP_CONCAT(DISTINCT t.name) as tag_names
        FROM media m
        LEFT JOIN categories c ON m.category_id=c.id
        LEFT JOIN progress p   ON m.id=p.media_id
        LEFT JOIN media_tags mt ON m.id=mt.media_id
        LEFT JOIN tags t        ON mt.tag_id=t.id
        WHERE 1=1"""
        pr = []
        if not include_deleted: q += " AND m.deleted=0"
        if search:
            q += " AND (m.title LIKE ? OR m.genre LIKE ? OR m.description LIKE ? OR t.name LIKE ?)"
            pr += [f"%{search}%"] * 4
        if category_id: q += " AND m.category_id=?"; pr.append(category_id)
        if media_type and media_type != "all": q += " AND m.media_type=?"; pr.append(media_type)
        if genre:       q += " AND m.genre LIKE ?"; pr.append(f"%{genre}%")
        if year:        q += " AND m.year=?"; pr.append(year)
        if favorites_only: q += " AND m.is_favorite=1"
        if tag_ids:
            ph = ",".join("?" * len(tag_ids))
            q += f" AND mt.tag_id IN ({ph})"; pr += tag_ids
        sm = {"added_at":"m.added_at DESC","title":"m.title ASC",
              "rating":"m.rating DESC","views":"m.views DESC","year":"m.year DESC"}
        q += f" GROUP BY m.id ORDER BY {sm.get(sort,'m.added_at DESC')} LIMIT ? OFFSET ?"
        pr += [limit, offset]
        return self._rows(q, pr)

    def get_media_by_id(self, mid):
        row = self._row("""SELECT m.*, c.name as category_name, c.color as category_color,
                   p.position as saved_position, p.duration as saved_duration
            FROM media m LEFT JOIN categories c ON m.category_id=c.id
            LEFT JOIN progress p ON m.id=p.media_id WHERE m.id=?""", (mid,))
        if not row: return None
        d = dict(row)
        d["tags"]      = self._rows("SELECT t.* FROM tags t JOIN media_tags mt ON t.id=mt.tag_id WHERE mt.media_id=?", (mid,))
        d["bookmarks"] = self.get_bookmarks(mid)
        return d

    def soft_delete(self, media_id):
        self._exec("UPDATE media SET deleted=1, deleted_at=datetime('now') WHERE id=?", (media_id,))
        r = self._row("SELECT title FROM media WHERE id=?", (media_id,))
        self.log("trash", r["title"] if r else media_id)

    def restore_media(self, media_id):
        self._exec("UPDATE media SET deleted=0, deleted_at='' WHERE id=?", (media_id,))
        r = self._row("SELECT title FROM media WHERE id=?", (media_id,))
        self.log("restore", r["title"] if r else media_id)

    def delete_media_permanent(self, media_id):
        r = self._row("SELECT file_path,file_mode,title FROM media WHERE id=?", (media_id,))
        if r and r["file_mode"] == "copy":
            fp = Path(r["file_path"])
            if fp.exists() and str(MEDIA_DIR) in str(fp):
                try: fp.unlink()
                except Exception: pass
        self._exec("DELETE FROM media WHERE id=?", (media_id,))
        if r: self.log("delete_permanent", r["title"])

    def delete_orphans(self):
        rows = self._rows("SELECT id,file_path FROM media WHERE deleted=0")
        n = 0
        for m in rows:
            if not Path(m["file_path"]).exists():
                self.soft_delete(m["id"]); n += 1
        return n

    def toggle_favorite(self, media_id):
        self._exec("UPDATE media SET is_favorite=NOT is_favorite WHERE id=?", (media_id,))
        r = self._row("SELECT is_favorite FROM media WHERE id=?", (media_id,))
        return bool(r["is_favorite"]) if r else False

    def update_rating(self, media_id, rating):
        self._exec("UPDATE media SET rating=? WHERE id=?",(min(max(float(rating),0),5), media_id))

    def update_media_meta(self, media_id, **kw):
        allowed = {"title","genre","year","rating","category_id","description",
                   "duration","thumbnail","subtitle","locked","lock_code","review"}
        sets = {k:v for k,v in kw.items() if k in allowed}
        if not sets: return
        sql = "UPDATE media SET " + ",".join(f"{k}=?" for k in sets) + " WHERE id=?"
        self._exec(sql, list(sets.values()) + [media_id])

    def rename_media_file(self, media_id, new_title, new_filename=None):
        row = self._row("SELECT file_path,file_mode FROM media WHERE id=?", (media_id,))
        if not row: return False, "Media topilmadi"
        old = Path(row["file_path"])
        if new_filename and row["file_mode"] == "copy" and old.exists():
            safe = secure_filename(new_filename)
            if not safe: return False, "Noto'g'ri fayl nomi"
            new = old.parent / safe
            if new.exists() and new != old: return False, "Bu nom bilan fayl allaqachon mavjud"
            try:
                old.rename(new)
                self._exec("UPDATE media SET title=?,file_path=? WHERE id=?",(new_title,str(new),media_id))
                return True, str(new)
            except Exception as e: return False, str(e)
        self._exec("UPDATE media SET title=? WHERE id=?", (new_title, media_id))
        return True, row["file_path"]

    def batch_update(self, ids, fields):
        allowed = {"category_id","genre","year","rating"}
        sets = {k:v for k,v in fields.items() if k in allowed and v not in (None,"")}
        if not sets or not ids: return 0
        ph = ",".join("?" * len(ids))
        sql = "UPDATE media SET " + ",".join(f"{k}=?" for k in sets) + f" WHERE id IN ({ph})"
        self._exec(sql, list(sets.values()) + ids)
        self.log("batch_edit", f"{len(ids)} media", str(sets))
        return len(ids)

    def increment_views(self, mid):
        self._exec("UPDATE media SET views=views+1 WHERE id=?", (mid,))

    def get_trash(self):
        return self._rows("""SELECT m.*, c.name as category_name FROM media m
            LEFT JOIN categories c ON m.category_id=c.id
            WHERE m.deleted=1 ORDER BY m.deleted_at DESC""")

    def empty_trash(self):
        rows = self._rows("SELECT id FROM media WHERE deleted=1")
        for r in rows: self.delete_media_permanent(r["id"])
        return len(rows)

    # ── Media Lock (yangi) ────────────────────
    def lock_media(self, media_id, code):
        self._exec("UPDATE media SET locked=1, lock_code=? WHERE id=?", (code, media_id))
        self.log("lock", media_id)

    def unlock_media(self, media_id):
        self._exec("UPDATE media SET locked=0, lock_code='' WHERE id=?", (media_id,))
        self.log("unlock", media_id)

    def check_lock(self, media_id, code):
        r = self._row("SELECT lock_code FROM media WHERE id=? AND locked=1", (media_id,))
        return r and r["lock_code"] == code

    # ── Scheduled Delete (yangi) ──────────────
    def set_scheduled_delete(self, media_id, when_dt: str):
        self._exec("UPDATE media SET scheduled_delete=? WHERE id=?", (when_dt, media_id))
        self.log("schedule_delete", media_id, when_dt)

    def process_scheduled_deletes(self):
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        rows = self._rows("""SELECT id,title FROM media
            WHERE scheduled_delete != '' AND scheduled_delete <= ? AND deleted=0""", (now,))
        for r in rows:
            self.soft_delete(r["id"])
            push_notif("Kechiktirilgan o'chirish", f'"{r["title"]}" savatga yuborildi', "info")
        return len(rows)

    # ── Reviews (yangi) ──────────────────────
    def add_review(self, media_id, rating, text):
        return self._ins("INSERT INTO reviews(media_id,rating,text) VALUES(?,?,?)",
                         (media_id, min(max(float(rating),0),5), text))

    def get_reviews(self, media_id):
        return self._rows("SELECT * FROM reviews WHERE media_id=? ORDER BY created_at DESC", (media_id,))

    def delete_review(self, review_id):
        self._exec("DELETE FROM reviews WHERE id=?", (review_id,))


    # ── Tags ─────────────────────────────────
    def get_tags(self): return self._rows("SELECT * FROM tags ORDER BY name")
    def add_tag(self, name, color="#58a6ff"):
        try: return self._ins("INSERT INTO tags(name,color) VALUES(?,?)", (name,color))
        except Exception: return None
    def delete_tag(self, tag_id): self._exec("DELETE FROM tags WHERE id=?", (tag_id,))
    def set_media_tags(self, media_id, tag_ids):
        self._exec("DELETE FROM media_tags WHERE media_id=?", (media_id,))
        for tid in tag_ids:
            try: self._exec("INSERT OR IGNORE INTO media_tags VALUES(?,?)", (media_id,tid))
            except Exception: pass
    def get_media_by_tag(self, tag_id, limit=200):
        return self._rows("""SELECT m.*, c.name as category_name FROM media m
            LEFT JOIN categories c ON m.category_id=c.id
            JOIN media_tags mt ON m.id=mt.media_id
            WHERE mt.tag_id=? AND m.deleted=0 ORDER BY m.added_at DESC LIMIT ?""", (tag_id,limit))

    # ── Bookmarks ────────────────────────────
    def get_bookmarks(self, media_id):
        return self._rows("SELECT * FROM bookmarks WHERE media_id=? ORDER BY position", (media_id,))
    def add_bookmark(self, media_id, pos_ms, label=""):
        return self._ins("INSERT INTO bookmarks(media_id,position,label) VALUES(?,?,?)",
                         (media_id, pos_ms, label))
    def delete_bookmark(self, bm_id): self._exec("DELETE FROM bookmarks WHERE id=?", (bm_id,))

    # ── Notes ────────────────────────────────
    def get_note(self, media_id):
        return self._d(self._row("SELECT * FROM notes WHERE media_id=?", (media_id,)))
    def upsert_note(self, media_id, content):
        ex = self._row("SELECT id FROM notes WHERE media_id=?", (media_id,))
        if ex:
            self._exec("UPDATE notes SET content=?,updated_at=datetime('now') WHERE media_id=?",
                       (content, media_id))
        else:
            self._ins("INSERT INTO notes(media_id,content) VALUES(?,?)", (media_id, content))

    # ── Progress ─────────────────────────────
    def update_progress(self, media_id, pos_ms, dur_ms):
        if dur_ms <= 0: return
        with self._lock:
            self.conn.execute("""INSERT INTO progress(media_id,position,duration,updated_at)
                VALUES(?,?,?,datetime('now'))
                ON CONFLICT(media_id) DO UPDATE SET
                  position=excluded.position, duration=excluded.duration,
                  updated_at=excluded.updated_at""", (media_id,pos_ms,dur_ms))
            self.conn.commit()
    def get_progress(self, media_id):
        r = self._row("SELECT position,duration FROM progress WHERE media_id=?", (media_id,))
        return {"position":r["position"],"duration":r["duration"]} if r else {"position":0,"duration":0}
    def get_continue_watching(self, limit=10):
        return self._rows("""SELECT m.*, p.position, p.duration,
               ROUND(p.position*100.0/MAX(p.duration,1),1) as pct,
               c.name as category_name, c.color as category_color
            FROM progress p JOIN media m ON p.media_id=m.id
            LEFT JOIN categories c ON m.category_id=c.id
            WHERE p.duration>0 AND (p.position*100.0/p.duration) BETWEEN 2 AND 95
              AND m.media_type IN ('video','audio') AND m.deleted=0
            ORDER BY p.updated_at DESC LIMIT ?""", (limit,))

    # ── History ──────────────────────────────
    def add_history(self, media_id): self._exec("INSERT INTO history(media_id) VALUES(?)", (media_id,))
    def get_history(self, limit=200):
        return self._rows("""SELECT m.title,h.played_at,m.id,m.media_type,m.rating,
               c.name as category_name
            FROM history h JOIN media m ON h.media_id=m.id
            LEFT JOIN categories c ON m.category_id=c.id
            WHERE m.deleted=0 ORDER BY h.played_at DESC LIMIT ?""", (limit,))
    def clear_history(self): self._exec("DELETE FROM history")

    # ── Watch Time ───────────────────────────
    def add_watch_time(self, media_id, seconds):
        today = datetime.now().strftime("%Y-%m-%d")
        with self._lock:
            ex = self.conn.execute("SELECT id FROM watch_time WHERE media_id=? AND watched_at=?",
                                   (media_id,today)).fetchone()
            if ex:
                self.conn.execute("UPDATE watch_time SET seconds=seconds+? WHERE id=?",(seconds,ex["id"]))
            else:
                self.conn.execute("INSERT INTO watch_time(media_id,seconds,watched_at) VALUES(?,?,?)",
                                  (media_id,seconds,today))
            self.conn.commit()
    def get_daily_watch_stats(self, days=30):
        start = (datetime.now()-timedelta(days=days)).strftime("%Y-%m-%d")
        return self._rows("""SELECT watched_at, SUM(seconds) as total_seconds
            FROM watch_time WHERE watched_at>=? GROUP BY watched_at ORDER BY watched_at""", (start,))
    def get_weekly_watch_stats(self):
        rows = self._rows("""SELECT strftime('%W-%Y',watched_at) as week_label,
               SUM(seconds) as total_seconds
            FROM watch_time GROUP BY week_label ORDER BY watched_at DESC LIMIT 12""")
        return list(reversed(rows))
    def get_total_watch_time(self):
        r = self._row("SELECT SUM(seconds) as total FROM watch_time")
        return r["total"] if r and r["total"] else 0

    # ── Categories ───────────────────────────
    def get_categories(self): return self._rows("SELECT * FROM categories ORDER BY name")
    def add_category(self, name, color="#58a6ff"):
        try: self._exec("INSERT INTO categories(name,color) VALUES(?,?)",(name,color)); return True
        except Exception: return False
    def delete_category(self, cid):
        self._exec("UPDATE media SET category_id=NULL WHERE category_id=?", (cid,))
        self._exec("DELETE FROM categories WHERE id=?", (cid,))

    # ── Playlists ────────────────────────────
    def get_playlists(self):
        return self._rows("""SELECT p.*, COUNT(pm.media_id) as media_count
            FROM playlist p LEFT JOIN playlist_media pm ON p.id=pm.playlist_id
            WHERE p.is_smart=0 GROUP BY p.id ORDER BY p.created_at DESC""")
    def create_playlist(self, name, description="", cover_color="#58a6ff"):
        return self._ins("INSERT INTO playlist(name,description,cover_color) VALUES(?,?,?)",
                         (name,description,cover_color))
    def update_playlist(self, pid, **kw):
        sets,vals=[],[]
        for k in ("name","description","cover_color"):
            if k in kw and kw[k] is not None: sets.append(f"{k}=?"); vals.append(kw[k])
        if sets: vals.append(pid); self._exec(f"UPDATE playlist SET {','.join(sets)} WHERE id=?", vals)
    def delete_playlist(self, pid): self._exec("DELETE FROM playlist WHERE id=?", (pid,))
    def get_playlist_by_id(self, pid): return self._d(self._row("SELECT * FROM playlist WHERE id=?", (pid,)))
    def get_playlist_media(self, pid):
        return self._rows("""SELECT m.*, pm.position as playlist_pos, pm.added_at as playlist_added,
               c.name as category_name, c.color as category_color
            FROM playlist_media pm JOIN media m ON pm.media_id=m.id
            LEFT JOIN categories c ON m.category_id=c.id
            WHERE pm.playlist_id=? AND m.deleted=0 ORDER BY pm.position""", (pid,))
    def add_to_playlist(self, pid, mid):
        r = self._row("SELECT COUNT(*) as c FROM playlist_media WHERE playlist_id=?", (pid,))
        pos = r["c"] if r else 0
        try:
            with self._lock:
                self.conn.execute("INSERT INTO playlist_media(playlist_id,media_id,position) VALUES(?,?,?)",
                                  (pid,mid,pos)); self.conn.commit()
            return True
        except Exception: return False
    def remove_from_playlist(self, pid, mid):
        self._exec("DELETE FROM playlist_media WHERE playlist_id=? AND media_id=?", (pid,mid))
    def reorder_playlist(self, pid, ids):
        with self._lock:
            for i,mid in enumerate(ids):
                self.conn.execute("UPDATE playlist_media SET position=? WHERE playlist_id=? AND media_id=?",
                                  (i,pid,mid))
            self.conn.commit()

    # ── Collections ──────────────────────────
    def get_collections(self): return self._rows("SELECT * FROM collections ORDER BY created_at DESC")
    def create_collection(self, name, description="", filter_json="{}", cover_color="#58a6ff"):
        return self._ins("INSERT INTO collections(name,description,filter_json,cover_color) VALUES(?,?,?,?)",
                         (name,description,filter_json,cover_color))
    def delete_collection(self, cid): self._exec("DELETE FROM collections WHERE id=?", (cid,))
    def get_collection_media(self, cid, limit=200):
        row = self._row("SELECT filter_json FROM collections WHERE id=?", (cid,))
        if not row: return []
        try: f = json.loads(row["filter_json"])
        except Exception: return []
        return self.get_media(search=f.get("search",""), media_type=f.get("type",""),
                              genre=f.get("genre",""), year=f.get("year"),
                              favorites_only=f.get("favorites",False), limit=limit)

    # ── Top Media ────────────────────────────
    def get_top_media(self, sort_by="views", limit=20):
        sm = {"views":"m.views DESC","rating":"m.rating DESC,m.views DESC"}
        return self._rows(f"""SELECT m.*, c.name as category_name, c.color as category_color,
               COALESCE(wt.total_seconds,0) as total_watch_seconds
            FROM media m LEFT JOIN categories c ON m.category_id=c.id
            LEFT JOIN (SELECT media_id,SUM(seconds) as total_seconds
                       FROM watch_time GROUP BY media_id) wt ON m.id=wt.media_id
            WHERE m.deleted=0 ORDER BY {sm.get(sort_by,'m.views DESC')} LIMIT ?""", (limit,))

    # ── Watch Folders ────────────────────────
    def get_watch_folders(self): return self._rows("SELECT * FROM watch_folders ORDER BY created_at DESC")
    def add_watch_folder(self, path):
        try: self._exec("INSERT INTO watch_folders(path) VALUES(?)", (path,)); return True
        except Exception: return False
    def remove_watch_folder(self, fid): self._exec("DELETE FROM watch_folders WHERE id=?", (fid,))
    def toggle_watch_folder(self, fid):
        r = self._row("SELECT active FROM watch_folders WHERE id=?", (fid,))
        if r:
            nv = 0 if r["active"] else 1
            self._exec("UPDATE watch_folders SET active=? WHERE id=?", (nv,fid)); return bool(nv)
        return False

    # ── Download History ─────────────────────
    def add_download_history(self, url, title="", status="done", file_size=0):
        self._exec("INSERT INTO download_history(url,title,status,file_size) VALUES(?,?,?,?)",
                   (url,title,status,file_size))
    def get_download_history(self, limit=100):
        return self._rows("SELECT * FROM download_history ORDER BY created_at DESC LIMIT ?", (limit,))
    def clear_download_history(self): self._exec("DELETE FROM download_history")

    # ── Stats ────────────────────────────────
    def get_stats(self):
        def sc(sql): r=self._row(sql); return r[0] if r else 0
        tw = self.get_total_watch_time()
        return {
            "total":        sc("SELECT COUNT(*) FROM media WHERE deleted=0"),
            "videos":       sc("SELECT COUNT(*) FROM media WHERE media_type='video' AND deleted=0"),
            "audio":        sc("SELECT COUNT(*) FROM media WHERE media_type='audio' AND deleted=0"),
            "images":       sc("SELECT COUNT(*) FROM media WHERE media_type='image' AND deleted=0"),
            "books":        sc("SELECT COUNT(*) FROM media WHERE media_type='book' AND deleted=0"),
            "favorites":    sc("SELECT COUNT(*) FROM media WHERE is_favorite=1 AND deleted=0"),
            "history":      sc("SELECT COUNT(*) FROM history"),
            "total_size_mb":round((sc("SELECT SUM(file_size) FROM media WHERE deleted=0") or 0)/1048576,1),
            "playlists":    sc("SELECT COUNT(*) FROM playlist WHERE is_smart=0"),
            "categories":   sc("SELECT COUNT(*) FROM categories"),
            "total_watch_h":round(tw/3600,1),
            "comments":     sc("SELECT COUNT(*) FROM comments"),
            "tags":         sc("SELECT COUNT(*) FROM tags"),
            "trash":        sc("SELECT COUNT(*) FROM media WHERE deleted=1"),
            "downloads":    sc("SELECT COUNT(*) FROM download_history"),
            "bookmarks":    sc("SELECT COUNT(*) FROM bookmarks"),
            "collections":  sc("SELECT COUNT(*) FROM collections"),
            "reviews":      sc("SELECT COUNT(*) FROM reviews"),
            "locked":       sc("SELECT COUNT(*) FROM media WHERE locked=1 AND deleted=0"),
        }

    # ── Duplicates / Storage ─────────────────
    def find_duplicates(self):
        return self._rows("""SELECT md5, COUNT(*) as cnt, GROUP_CONCAT(id) as ids,
               GROUP_CONCAT(title,' || ') as titles
            FROM media WHERE md5!='' AND deleted=0 GROUP BY md5 HAVING cnt>1""")
    def get_storage_stats(self):
        return self._rows("""SELECT media_type, COUNT(*) as count, SUM(file_size) as total_bytes
            FROM media WHERE deleted=0 GROUP BY media_type""")

    # ── Backup ───────────────────────────────
    def export_database(self, path):
        data = {"version":"9.0","exported_at":datetime.now().isoformat(),
                "categories":self._rows("SELECT * FROM categories"),
                "media":     self._rows("SELECT * FROM media WHERE deleted=0"),
                "playlists": self._rows("SELECT * FROM playlist"),
                "tags":      self._rows("SELECT * FROM tags")}
        with open(path,"w",encoding="utf-8") as f: json.dump(data, f, ensure_ascii=False, indent=2)

    def import_database(self, path):
        with open(path,encoding="utf-8") as f: data = json.load(f)
        for c in data.get("categories",[]):
            try: self._exec("INSERT OR IGNORE INTO categories(name,color) VALUES(?,?)",
                            (c["name"],c.get("color","#58a6ff")))
            except Exception: pass
        for m in data.get("media",[]):
            try:
                with self._lock:
                    self.conn.execute("""INSERT OR IGNORE INTO media
                        (title,file_path,media_type,genre,year,rating,is_favorite,added_at,description)
                        VALUES(?,?,?,?,?,?,?,?,?)""",
                        (m["title"],m["file_path"],m.get("media_type","video"),
                         m.get("genre",""),m.get("year",0),m.get("rating",0),
                         m.get("is_favorite",0),m.get("added_at",""),m.get("description","")))
                    self.conn.commit()
            except Exception: pass

    def get_genres(self):
        return [r["genre"] for r in self._rows(
            "SELECT DISTINCT genre FROM media WHERE genre!='' AND deleted=0 ORDER BY genre")]
    def get_years(self):
        return [r["year"] for r in self._rows(
            "SELECT DISTINCT year FROM media WHERE year>0 AND deleted=0 ORDER BY year DESC")]


# ── FLASK APP ─────────────────────────────────
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
app.config["SECRET_KEY"] = secrets.token_hex(32)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)
db = Database()

def allowed_file(fn): return "." in fn and fn.rsplit(".",1)[1].lower() in ALL_ALLOWED
def get_media_type(fn):
    ext = fn.rsplit(".",1)[1].lower() if "." in fn else ""
    for k,v in ALLOWED_EXTENSIONS.items():
        if ext in v: return k
    return "video"

# ── AUTH HELPERS ──────────────────────────────
def _get_password():
    """DB dan parolni olish"""
    return db.get_setting("app_password", "")

def _is_logged_in():
    return session.get("authenticated") is True

def require_auth(f):
    """Parol himoyasi decorator"""
    @wraps(f)
    def decorated(*args, **kwargs):
        if _get_password() and not _is_logged_in():
            if request.is_json:
                return jsonify({"error":"Avtorizatsiya talab etiladi", "auth_required":True}), 401
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return decorated

def check_internet_allowed():
    """Internet ruxsatini tekshirish"""
    return db.get_setting("internet_allowed", "on") == "on"

def check_download_allowed():
    """Faylni qurilmaga yuklab olish ruxsatini tekshirish"""
    return db.get_setting("allow_download", "off") == "on"

# ── SCHEDULED DELETE CHECKER ──────────────────
def _scheduled_delete_worker():
    """Har minutda kechiktirilgan o'chirishlarni tekshirish"""
    while True:
        import time
        time.sleep(60)
        try: db.process_scheduled_deletes()
        except Exception: pass

threading.Thread(target=_scheduled_delete_worker, daemon=True).start()


# ── AUTH ROUTES ───────────────────────────────
@app.route("/login", methods=["GET"])
def login_page():
    if not _get_password() or _is_logged_in():
        return redirect("/")
    return render_template("login.html")

@app.route("/api/auth/login", methods=["POST"])
def api_login():
    data = request.get_json()
    pwd  = (data.get("password") or "").strip()
    stored = _get_password()
    if not stored:
        session["authenticated"] = True
        session.permanent = True
        return jsonify({"ok": True})
    if hashlib.sha256(pwd.encode()).hexdigest() == stored:
        session["authenticated"] = True
        session.permanent = True
        db.log("login", "success")
        return jsonify({"ok": True})
    db.log("login_fail", "wrong_password")
    return jsonify({"error": "Noto'g'ri parol"}), 401

@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    session.clear()
    db.log("logout")
    return jsonify({"ok": True})

@app.route("/api/auth/status")
def api_auth_status():
    pwd_set = bool(_get_password())
    return jsonify({"logged_in": _is_logged_in(), "password_set": pwd_set})

@app.route("/api/auth/set-password", methods=["POST"])
@require_auth
def api_set_password():
    data = request.get_json()
    new_pwd = (data.get("password") or "").strip()
    if new_pwd:
        hashed = hashlib.sha256(new_pwd.encode()).hexdigest()
        db.set_setting("app_password", hashed)
    else:
        db.set_setting("app_password", "")  # Parolni olib tashlash
    db.log("password_changed")
    return jsonify({"ok": True})

@app.route("/api/auth/change-password", methods=["POST"])
@require_auth
def api_change_password():
    data = request.get_json()
    old_pwd = (data.get("old_password") or "").strip()
    new_pwd = (data.get("new_password") or "").strip()
    stored  = _get_password()
    if stored and hashlib.sha256(old_pwd.encode()).hexdigest() != stored:
        return jsonify({"error": "Eski parol noto'g'ri"}), 401
    if new_pwd:
        db.set_setting("app_password", hashlib.sha256(new_pwd.encode()).hexdigest())
    else:
        db.set_setting("app_password", "")
    db.log("password_changed")
    return jsonify({"ok": True})

# ── MAIN ROUTES ───────────────────────────────
@app.route("/")
@require_auth
def index():
    return render_template("index.html")

@app.route("/favicon.ico")
def favicon(): return "", 204

# ── INTERNET PERMISSION ROUTES ────────────────
@app.route("/api/internet/status")
@require_auth
def api_internet_status():
    allowed = check_internet_allowed()
    reason  = db.get_setting("internet_reason", "")
    return jsonify({"allowed": allowed, "reason": reason})

@app.route("/api/internet/toggle", methods=["POST"])
@require_auth
def api_internet_toggle():
    data   = request.get_json()
    on_off = data.get("allowed", True)
    reason = (data.get("reason") or "").strip()
    db.set_setting("internet_allowed", "on" if on_off else "off")
    db.set_setting("internet_reason", reason)
    db.log("internet_toggle", "on" if on_off else "off", reason)
    return jsonify({"ok": True, "allowed": on_off})

# ── DOWNLOAD PERMISSION ROUTE ─────────────────
@app.route("/api/download-permission/status")
@require_auth
def api_dl_perm_status():
    return jsonify({"allowed": check_download_allowed()})


# ── NOTIFICATION ROUTES ───────────────────────
@app.route("/api/notifications")
@require_auth
def api_notifs():
    with _notif_lock:
        return jsonify(list(_notifs))

@app.route("/api/notifications/read-all", methods=["POST"])
@require_auth
def api_notifs_read_all():
    with _notif_lock:
        for n in _notifs: n["read"] = True
    return jsonify({"ok": True})

@app.route("/api/notifications/<nid>", methods=["DELETE"])
@require_auth
def api_notif_delete(nid):
    with _notif_lock:
        idx = next((i for i,n in enumerate(_notifs) if n["id"]==nid), None)
        if idx is not None: _notifs.pop(idx)
    return jsonify({"ok": True})

@app.route("/api/notifications/clear", methods=["POST"])
@require_auth
def api_notifs_clear():
    with _notif_lock: _notifs.clear()
    return jsonify({"ok": True})

# ── MEDIA LOCK ROUTES ─────────────────────────
@app.route("/api/media/<int:mid>/lock", methods=["POST"])
@require_auth
def api_lock_media(mid):
    data = request.get_json()
    code = (data.get("code") or "").strip()
    if not code: return jsonify({"error": "Kod kiritilmagan"}), 400
    db.lock_media(mid, code)
    return jsonify({"ok": True})

@app.route("/api/media/<int:mid>/unlock", methods=["POST"])
@require_auth
def api_unlock_media(mid):
    data = request.get_json()
    code = (data.get("code") or "").strip()
    if db.check_lock(mid, code):
        db.unlock_media(mid)
        return jsonify({"ok": True})
    return jsonify({"error": "Noto'g'ri kod"}), 401

@app.route("/api/media/<int:mid>/check-lock", methods=["POST"])
@require_auth
def api_check_lock(mid):
    data = request.get_json()
    code = (data.get("code") or "").strip()
    ok = db.check_lock(mid, code)
    return jsonify({"ok": ok})

# ── REVIEW ROUTES ─────────────────────────────
@app.route("/api/media/<int:mid>/reviews")
@require_auth
def api_get_reviews(mid): return jsonify(db.get_reviews(mid))

@app.route("/api/media/<int:mid>/reviews", methods=["POST"])
@require_auth
def api_add_review(mid):
    data = request.get_json()
    rating = float(data.get("rating", 0))
    text   = (data.get("text") or "").strip()
    if not text and not rating: return jsonify({"error": "Reyting yoki matn kiritilmagan"}), 400
    rid = db.add_review(mid, rating, text)
    return jsonify({"ok": True, "id": rid})

@app.route("/api/reviews/<int:rid>", methods=["DELETE"])
@require_auth
def api_delete_review(rid):
    db.delete_review(rid); return jsonify({"ok": True})

# ── SCHEDULED DELETE ROUTES ───────────────────
@app.route("/api/media/<int:mid>/schedule-delete", methods=["POST"])
@require_auth
def api_schedule_delete(mid):
    data = request.get_json()
    when = (data.get("when") or "").strip()
    if not when: return jsonify({"error": "Vaqt kiritilmagan"}), 400
    db.set_scheduled_delete(mid, when)
    return jsonify({"ok": True})

@app.route("/api/media/<int:mid>/cancel-schedule", methods=["POST"])
@require_auth
def api_cancel_schedule(mid):
    db._exec("UPDATE media SET scheduled_delete='' WHERE id=?", (mid,))
    return jsonify({"ok": True})

# ── EXPORT ZIP ROUTE ──────────────────────────
@app.route("/api/export/zip", methods=["POST"])
@require_auth
def api_export_zip():
    data    = request.get_json()
    ids     = data.get("ids", [])
    include_files = data.get("include_files", False)
    fname   = f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    zip_path = EXPORT_DIR / fname
    try:
        with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
            media_list = []
            for mid in ids:
                m = db.get_media_by_id(int(mid))
                if not m: continue
                media_list.append({k:v for k,v in m.items() if k not in ("tags","bookmarks")})
                if include_files and m.get("file_mode") == "copy":
                    fp = Path(m["file_path"])
                    if fp.exists(): zf.write(str(fp), fp.name)
            zf.writestr("media.json", json.dumps(media_list, ensure_ascii=False, indent=2))
        return send_file(str(zip_path), as_attachment=True, download_name=fname)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── HOME & STATS ──────────────────────────────
@app.route("/api/stats")
@require_auth
def api_stats(): return jsonify(db.get_stats())

@app.route("/api/home")
@require_auth
def api_home():
    return jsonify({"stats": db.get_stats(),
                    "recent": db.get_media(limit=12),
                    "continue_watching": db.get_continue_watching(limit=8)})

# ── MEDIA CRUD ────────────────────────────────
@app.route("/api/media")
@require_auth
def api_media_list():
    tag_ids = [int(x) for x in request.args.getlist("tag_id") if x.isdigit()]
    limit   = request.args.get("limit",24,type=int)
    page    = request.args.get("page",1,type=int)
    media   = db.get_media(
        search=request.args.get("search",""),
        category_id=request.args.get("category_id",type=int),
        media_type=request.args.get("type",""),
        genre=request.args.get("genre",""),
        year=request.args.get("year",type=int),
        favorites_only=request.args.get("favorites","false")=="true",
        tag_ids=tag_ids or None,
        sort=request.args.get("sort","added_at"),
        limit=limit, offset=(page-1)*limit)
    return jsonify({"media":media,"page":page})

@app.route("/api/media/<int:mid>", methods=["GET"])
@require_auth
def api_media_get(mid):
    m = db.get_media_by_id(mid)
    if not m: return jsonify({"error":"Topilmadi"}), 404
    return jsonify(m)

@app.route("/api/media/<int:mid>", methods=["PUT"])
@require_auth
def api_media_update(mid):
    data = request.get_json()
    kw = {k:v for k,v in data.items()
          if k in {"title","genre","year","rating","category_id","description",
                   "duration","thumbnail","subtitle"}}
    db.update_media_meta(mid, **kw)
    if "tags" in data:
        db.set_media_tags(mid, [int(t) for t in data["tags"] if str(t).isdigit()])
    return jsonify({"ok":True})

@app.route("/api/media/<int:mid>", methods=["DELETE"])
@require_auth
def api_media_delete(mid):
    perm = request.args.get("permanent","false")=="true"
    if perm: db.delete_media_permanent(mid)
    else:    db.soft_delete(mid)
    return jsonify({"ok":True})

@app.route("/api/media/<int:mid>/favorite", methods=["POST"])
@require_auth
def api_toggle_fav(mid):
    return jsonify({"is_favorite": db.toggle_favorite(mid)})

@app.route("/api/media/<int:mid>/rating", methods=["POST"])
@require_auth
def api_set_rating(mid):
    db.update_rating(mid, float(request.get_json().get("rating",0)))
    return jsonify({"ok":True})

@app.route("/api/media/<int:mid>/rename", methods=["POST"])
@require_auth
def api_rename(mid):
    d = request.get_json()
    title = (d.get("title") or "").strip()
    if not title: return jsonify({"error":"Sarlavha kiritilmagan"}), 400
    ok, res = db.rename_media_file(mid, title, (d.get("filename") or "").strip() or None)
    return jsonify({"ok":ok,"file_path":res}) if ok else (jsonify({"error":res}), 400)

@app.route("/api/media/batch-delete", methods=["POST"])
@require_auth
def api_batch_delete():
    ids = request.get_json().get("ids",[])
    for mid in ids: db.soft_delete(mid)
    return jsonify({"deleted":len(ids)})

@app.route("/api/media/batch-edit", methods=["POST"])
@require_auth
def api_batch_edit():
    d = request.get_json()
    return jsonify({"updated": db.batch_update(d.get("ids",[]), d.get("fields",{}))})

@app.route("/api/media/clean-orphans", methods=["POST"])
@require_auth
def api_clean_orphans():
    return jsonify({"deleted": db.delete_orphans()})

@app.route("/api/media/duplicates")
@require_auth
def api_duplicates(): return jsonify(db.find_duplicates())

@app.route("/api/media/<int:mid>/info")
@require_auth
def api_media_info(mid):
    m = db.get_media_by_id(mid)
    if not m: return jsonify({"error":"Topilmadi"}), 404
    info = _ffprobe_info(m["file_path"]) if m.get("file_mode") != "url" else {}
    return jsonify({"media":m,"ffprobe":info})

# ── STREAMING (download cheklash) ─────────────
@app.route("/api/stream/<int:mid>")
@require_auth
def api_stream(mid):
    from flask import redirect as rdir
    m = db.get_media_by_id(mid)
    if not m: abort(404)
    # Qulflangan media tekshiruvi
    if m.get("locked"):
        return jsonify({"error":"Media qulflangan","locked":True}), 403
    db.add_history(mid); db.increment_views(mid)
    if m.get("file_mode") == "url":
        if not check_internet_allowed():
            return jsonify({"error":"Internet ruxsat etilmagan"}), 403
        return rdir(m["file_path"])
    fp = Path(m["file_path"])
    if not fp.exists(): return jsonify({"error":"Fayl topilmadi"}), 404
    mime, _ = mimetypes.guess_type(str(fp))
    mime_map = {
        ".mp4":"video/mp4",".mkv":"video/x-matroska",".webm":"video/webm",
        ".avi":"video/x-msvideo",".mov":"video/quicktime",".m4v":"video/mp4",
        ".mp3":"audio/mpeg",".wav":"audio/wav",".flac":"audio/flac",
        ".ogg":"audio/ogg",".m4a":"audio/mp4",".aac":"audio/aac",
        ".pdf":"application/pdf",".jpg":"image/jpeg",".jpeg":"image/jpeg",
        ".png":"image/png",".gif":"image/gif",".webp":"image/webp",
    }
    if not mime: mime = mime_map.get(fp.suffix.lower(),"application/octet-stream")
    fs  = fp.stat().st_size
    rng = request.headers.get("Range")

    # ── DOWNLOAD CHEKLASH ─────────────────────
    # ?download=1 parametri bilan yuklashni so'rasa ruxsatni tekshir
    if request.args.get("download") == "1":
        if not check_download_allowed():
            return jsonify({"error":"Faylni qurilmaga yuklash taqiqlangan. Admin panelda yoqing."}), 403
        return send_file(str(fp), as_attachment=True, download_name=fp.name)

    # Streaming (oddiy ko'rish uchun — download yo'q)
    if rng:
        b1,b2 = 0, None
        mg = re.search(r"(\d+)-(\d*)", rng)
        if mg:
            if mg.group(1): b1=int(mg.group(1))
            if mg.group(2): b2=int(mg.group(2))
        length = (b2-b1+1) if b2 is not None else fs-b1
        b2 = b1+length-1
        def gen():
            with open(fp,"rb") as fh:
                fh.seek(b1); rem=length
                while rem:
                    ch=fh.read(min(65536,rem))
                    if not ch: break
                    rem-=len(ch); yield ch
        # Content-Disposition inline — qurilmaga yuklab olmaydi
        resp = Response(stream_with_context(gen()), 206, headers={
            "Content-Range": f"bytes {b1}-{b2}/{fs}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(length),
            "Content-Type": mime,
            "Content-Disposition": "inline",  # DOWNLOAD BLOKLASH
            "X-Content-Type-Options": "nosniff",
        })
        return resp
    # Non-range response ham inline
    response = send_file(str(fp), mimetype=mime, conditional=True)
    response.headers["Content-Disposition"] = "inline"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


# ── ALL REMAINING ROUTES ──────────────────────
@app.route("/api/media/<int:mid>/progress", methods=["GET"])
@require_auth
def api_get_progress(mid): return jsonify(db.get_progress(mid))

@app.route("/api/media/<int:mid>/progress", methods=["POST"])
@require_auth
def api_save_progress(mid):
    d=request.get_json(); db.update_progress(mid,d.get("position",0),d.get("duration",0))
    return jsonify({"ok":True})

@app.route("/api/media/<int:mid>/watch-time", methods=["POST"])
@require_auth
def api_add_watch_time(mid):
    s=int(request.get_json().get("seconds",0))
    if s>0: db.add_watch_time(mid,s)
    return jsonify({"ok":True})

@app.route("/api/watch-stats")
@require_auth
def api_watch_stats():
    period=request.args.get("period","daily")
    data=db.get_weekly_watch_stats() if period=="weekly" else db.get_daily_watch_stats(request.args.get("days",30,type=int))
    return jsonify({"data":data,"total_seconds":db.get_total_watch_time()})

# Comments
@app.route("/api/media/<int:mid>/comments", methods=["GET"])
@require_auth
def api_comments(mid):
    return jsonify(db._rows("SELECT * FROM comments WHERE media_id=? ORDER BY created_at DESC",(mid,)))

@app.route("/api/media/<int:mid>/comments", methods=["POST"])
@require_auth
def api_add_comment(mid):
    content=(request.get_json().get("content") or "").strip()
    if not content: return jsonify({"error":"Bo'sh izoh"}),400
    cid=db._ins("INSERT INTO comments(media_id,content) VALUES(?,?)",(mid,content))
    return jsonify({"ok":True,"id":cid})

@app.route("/api/comments/<int:cid>", methods=["DELETE"])
@require_auth
def api_del_comment(cid):
    db._exec("DELETE FROM comments WHERE id=?",(cid,)); return jsonify({"ok":True})

# Notes
@app.route("/api/media/<int:mid>/note")
@require_auth
def api_get_note(mid): return jsonify(db.get_note(mid) or {})

@app.route("/api/media/<int:mid>/note", methods=["POST"])
@require_auth
def api_save_note(mid):
    db.upsert_note(mid,(request.get_json().get("content") or "").strip()); return jsonify({"ok":True})

# Bookmarks
@app.route("/api/media/<int:mid>/bookmarks")
@require_auth
def api_get_bookmarks(mid): return jsonify(db.get_bookmarks(mid))

@app.route("/api/media/<int:mid>/bookmarks", methods=["POST"])
@require_auth
def api_add_bookmark(mid):
    d=request.get_json()
    return jsonify({"ok":True,"id":db.add_bookmark(mid,d.get("position",0),d.get("label",""))})

@app.route("/api/bookmarks/<int:bid>", methods=["DELETE"])
@require_auth
def api_del_bookmark(bid):
    db.delete_bookmark(bid); return jsonify({"ok":True})

# Tags
@app.route("/api/tags")
@require_auth
def api_tags(): return jsonify(db.get_tags())

@app.route("/api/tags", methods=["POST"])
@require_auth
def api_add_tag():
    d=request.get_json(); tid=db.add_tag(d.get("name","").strip(),d.get("color","#58a6ff"))
    return jsonify({"ok":bool(tid),"id":tid})

@app.route("/api/tags/<int:tid>", methods=["DELETE"])
@require_auth
def api_delete_tag(tid): db.delete_tag(tid); return jsonify({"ok":True})

@app.route("/api/media/<int:mid>/tags", methods=["POST"])
@require_auth
def api_set_tags(mid):
    db.set_media_tags(mid,request.get_json().get("tag_ids",[])); return jsonify({"ok":True})

@app.route("/api/tags/<int:tid>/media")
@require_auth
def api_tag_media(tid): return jsonify(db.get_media_by_tag(tid))

# Collections
@app.route("/api/collections")
@require_auth
def api_collections(): return jsonify(db.get_collections())

@app.route("/api/collections", methods=["POST"])
@require_auth
def api_create_collection():
    d=request.get_json()
    cid=db.create_collection(d.get("name",""),d.get("description",""),
                             json.dumps(d.get("filter",{})),d.get("cover_color","#58a6ff"))
    return jsonify({"ok":True,"id":cid})

@app.route("/api/collections/<int:cid>", methods=["DELETE"])
@require_auth
def api_delete_collection(cid): db.delete_collection(cid); return jsonify({"ok":True})

@app.route("/api/collections/<int:cid>/media")
@require_auth
def api_collection_media(cid): return jsonify(db.get_collection_media(cid))

# Trash
@app.route("/api/trash")
@require_auth
def api_trash(): return jsonify(db.get_trash())

@app.route("/api/trash/<int:mid>/restore", methods=["POST"])
@require_auth
def api_restore(mid): db.restore_media(mid); return jsonify({"ok":True})

@app.route("/api/trash/<int:mid>", methods=["DELETE"])
@require_auth
def api_perm_delete(mid): db.delete_media_permanent(mid); return jsonify({"ok":True})

@app.route("/api/trash/empty", methods=["POST"])
@require_auth
def api_empty_trash(): return jsonify({"deleted":db.empty_trash()})

# Storage & Activity
@app.route("/api/storage")
@require_auth
def api_storage(): return jsonify(db.get_storage_stats())

@app.route("/api/activity")
@require_auth
def api_activity(): return jsonify(db.get_activity_log(request.args.get("limit",200,type=int)))

@app.route("/api/activity", methods=["DELETE"])
@require_auth
def api_clear_activity(): db.clear_activity_log(); return jsonify({"ok":True})

# History
@app.route("/api/history")
@require_auth
def api_history(): return jsonify(db.get_history(200))

@app.route("/api/history", methods=["DELETE"])
@require_auth
def api_clear_history(): db.clear_history(); return jsonify({"ok":True})

# Categories
@app.route("/api/categories")
@require_auth
def api_categories(): return jsonify(db.get_categories())

@app.route("/api/categories", methods=["POST"])
@require_auth
def api_add_category():
    d=request.get_json(); ok=db.add_category(d.get("name",""),d.get("color","#58a6ff"))
    return jsonify({"ok":ok})

@app.route("/api/categories/<int:cid>", methods=["DELETE"])
@require_auth
def api_del_category(cid): db.delete_category(cid); return jsonify({"ok":True})

# Playlists
@app.route("/api/playlists")
@require_auth
def api_playlists(): return jsonify(db.get_playlists())

@app.route("/api/playlists", methods=["POST"])
@require_auth
def api_create_playlist():
    d=request.get_json()
    pid=db.create_playlist(d.get("name",""),d.get("description",""),d.get("cover_color","#58a6ff"))
    return jsonify({"ok":True,"id":pid})

@app.route("/api/playlists/<int:pid>", methods=["GET"])
@require_auth
def api_playlist_get(pid):
    pl=db.get_playlist_by_id(pid)
    return jsonify(pl) if pl else (jsonify({"error":"Topilmadi"}),404)

@app.route("/api/playlists/<int:pid>", methods=["PUT"])
@require_auth
def api_playlist_update(pid):
    d=request.get_json(); db.update_playlist(pid,**{k:d.get(k) for k in ("name","description","cover_color")})
    return jsonify({"ok":True})

@app.route("/api/playlists/<int:pid>", methods=["DELETE"])
@require_auth
def api_playlist_del(pid): db.delete_playlist(pid); return jsonify({"ok":True})

@app.route("/api/playlists/<int:pid>/media")
@require_auth
def api_playlist_media(pid): return jsonify(db.get_playlist_media(pid))

@app.route("/api/playlists/<int:pid>/add", methods=["POST"])
@require_auth
def api_playlist_add(pid):
    return jsonify({"ok":db.add_to_playlist(pid,request.get_json().get("media_id"))})

@app.route("/api/playlists/<int:pid>/remove", methods=["POST"])
@require_auth
def api_playlist_remove(pid):
    db.remove_from_playlist(pid,request.get_json().get("media_id")); return jsonify({"ok":True})

@app.route("/api/playlists/<int:pid>/reorder", methods=["POST"])
@require_auth
def api_playlist_reorder(pid):
    db.reorder_playlist(pid,request.get_json().get("media_ids",[])); return jsonify({"ok":True})

@app.route("/api/media-for-playlist")
@require_auth
def api_media_for_playlist():
    pid=request.args.get("playlist_id",type=int)
    media=db.get_media(search=request.args.get("search",""),media_type=request.args.get("type",""),limit=200)
    if pid:
        ex={m["id"] for m in db.get_playlist_media(pid)}
        for m in media: m["in_playlist"]=m["id"] in ex
    return jsonify(media)

# Top media
@app.route("/api/top-media")
@require_auth
def api_top():
    return jsonify(db.get_top_media(request.args.get("sort","views"),request.args.get("limit",20,type=int)))

# Settings
@app.route("/api/settings")
@require_auth
def api_settings(): return jsonify(db.get_all_settings())

@app.route("/api/settings", methods=["POST"])
@require_auth
def api_save_settings():
    for k,v in request.get_json().items(): db.set_setting(k,v)
    return jsonify({"ok":True})

# Backup
@app.route("/api/backup/export")
@require_auth
def api_export():
    fname=f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    path=BACKUP_DIR/fname; db.export_database(str(path))
    return send_file(str(path),as_attachment=True,download_name=fname)

@app.route("/api/backup/import", methods=["POST"])
@require_auth
def api_import():
    if "file" not in request.files: return jsonify({"error":"Fayl topilmadi"}),400
    f=request.files["file"]; p=BACKUP_DIR/secure_filename(f.filename)
    f.save(str(p)); db.import_database(str(p)); return jsonify({"ok":True})

@app.route("/api/genres")
@require_auth
def api_genres(): return jsonify(db.get_genres())

@app.route("/api/years")
@require_auth
def api_years(): return jsonify(db.get_years())

# Download history
@app.route("/api/download-history")
@require_auth
def api_dl_history(): return jsonify(db.get_download_history())

@app.route("/api/download-history", methods=["DELETE"])
@require_auth
def api_clear_dl_history(): db.clear_download_history(); return jsonify({"ok":True})


# ── SUBTITLE / THUMBNAIL ──────────────────────
@app.route("/api/media/<int:mid>/subtitle", methods=["POST"])
@require_auth
def api_upload_subtitle(mid):
    if "file" not in request.files: return jsonify({"error":"Fayl topilmadi"}),400
    f=request.files["file"]
    ext=f.filename.rsplit(".",1)[-1].lower() if "." in f.filename else ""
    if ext not in ALLOWED_EXTENSIONS["sub"]: return jsonify({"error":"Faqat .srt/.vtt/.ass"}),400
    fname=f"sub_{mid}_{secure_filename(f.filename)}"; dst=SUBS_DIR/fname; f.save(str(dst))
    sub_url=f"/static/subs/{fname}"; db.update_media_meta(mid,subtitle=sub_url)
    return jsonify({"ok":True,"subtitle":sub_url})

@app.route("/static/subs/<path:fname>")
@require_auth
def serve_sub(fname): return send_file(str(SUBS_DIR/fname))

@app.route("/api/media/<int:mid>/thumbnail", methods=["POST"])
@require_auth
def api_upload_thumbnail(mid):
    if "file" not in request.files: return jsonify({"error":"Fayl topilmadi"}),400
    f=request.files["file"]
    ext=f.filename.rsplit(".",1)[-1].lower() if "." in f.filename else "jpg"
    if ext not in {"jpg","jpeg","png","webp"}: return jsonify({"error":"Faqat rasm fayllari"}),400
    fname=f"thumb_{mid}.{ext}"; dst=THUMB_DIR/fname; f.save(str(dst))
    url=f"/static/thumbs/{fname}"; db.update_media_meta(mid,thumbnail=url)
    return jsonify({"ok":True,"thumbnail":url})

# ── UPLOAD ────────────────────────────────────
@app.route("/api/upload", methods=["POST"])
@require_auth
def api_upload():
    if "file" not in request.files: return jsonify({"error":"Fayl topilmadi"}),400
    file=request.files["file"]
    if not file.filename or not allowed_file(file.filename):
        return jsonify({"error":"Ruxsat etilmagan fayl"}),400
    fn=secure_filename(file.filename); m_type=request.form.get("media_type") or get_media_type(fn)
    dest=IMAGES_DIR if m_type=="image" else BOOKS_DIR if m_type=="book" else MEDIA_DIR
    dst=dest/fn; c=1
    while dst.exists(): dst=dest/f"{Path(fn).stem}_{c}{Path(fn).suffix}"; c+=1
    file.save(str(dst))
    try:
        h=hashlib.md5()
        with open(dst,"rb") as fh:
            for chunk in iter(lambda: fh.read(65536),b""): h.update(chunk)
        md5=h.hexdigest()
    except Exception: md5=""
    mid=db.add_media(title=request.form.get("title",Path(fn).stem.replace("_"," ").title()),
        file_path=str(dst),media_type=m_type,
        category_id=request.form.get("category_id",type=int),
        genre=request.form.get("genre",""),
        year=request.form.get("year",datetime.now().year,type=int),
        rating=request.form.get("rating",0.0,type=float),
        file_size=dst.stat().st_size,
        file_mode=request.form.get("file_mode","copy"),
        description=request.form.get("description",""))
    db._exec("UPDATE media SET md5=? WHERE id=?",(md5,mid))
    return jsonify({"ok":True,"id":mid,"title":request.form.get("title",""),"file_size":dst.stat().st_size})

# ── URL DOWNLOAD ──────────────────────────────
@app.route("/api/download-url", methods=["POST"])
@require_auth
def api_download_url():
    if not check_internet_allowed():
        return jsonify({"error":"Internet ruxsat etilmagan. Admin paneldan yoqing."}), 403
    d=request.get_json(); url=(d.get("url") or "").strip()
    if not url: return jsonify({"error":"URL kiritilmagan"}),400
    title=d.get("title","").strip(); m_type=d.get("media_type","video")
    cat_id=d.get("category_id"); desc=d.get("description",""); url_mode=d.get("url_mode","stream")
    try:
        parsed=urllib.parse.urlparse(url)
        fn=secure_filename(os.path.basename(parsed.path) or "media")
        if not fn or "." not in fn: fn=f"media_{int(datetime.now().timestamp())}.mp4"
        if not title: title=Path(fn).stem.replace("_"," ").title()
        if url_mode=="stream":
            mid=db.add_media(title=title,file_path=url,media_type=m_type,
                category_id=cat_id,description=desc,source_url=url,file_mode="url")
            return jsonify({"ok":True,"id":mid,"title":title,"file_size":0})
        ext=fn.rsplit(".",1)[-1].lower()
        if ext not in ALL_ALLOWED: return jsonify({"error":f"Ruxsat etilmagan: .{ext}"}),400
        dest=IMAGES_DIR if m_type=="image" else BOOKS_DIR if m_type=="book" else MEDIA_DIR
        dst=dest/fn; c=1
        while dst.exists(): dst=dest/f"{Path(fn).stem}_{c}{Path(fn).suffix}"; c+=1
        req_h=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0"})
        with urllib.request.urlopen(req_h,timeout=120) as resp:
            with open(str(dst),"wb") as f: shutil.copyfileobj(resp,f)
        mid=db.add_media(title=title,file_path=str(dst),media_type=m_type,
            category_id=cat_id,description=desc,file_size=dst.stat().st_size,source_url=url)
        db.add_download_history(url,title,"done",dst.stat().st_size)
        return jsonify({"ok":True,"id":mid,"title":title,"file_size":dst.stat().st_size})
    except Exception as e: return jsonify({"error":str(e)}),500

# ── WATCH FOLDERS ─────────────────────────────
@app.route("/api/watch-folders", methods=["GET"])
@require_auth
def api_wf_list(): return jsonify(db.get_watch_folders())

@app.route("/api/watch-folders", methods=["POST"])
@require_auth
def api_wf_add():
    ps=(request.get_json().get("path") or "").strip()
    if not ps: return jsonify({"error":"Yo'l kiritilmagan"}),400
    p=Path(ps)
    if not p.exists() or not p.is_dir(): return jsonify({"error":"Papka mavjud emas"}),400
    ok=db.add_watch_folder(str(p))
    return jsonify({"ok":ok}) if ok else (jsonify({"error":"Allaqachon mavjud"}),400)

@app.route("/api/watch-folders/<int:fid>", methods=["DELETE"])
@require_auth
def api_wf_del(fid): db.remove_watch_folder(fid); return jsonify({"ok":True})

@app.route("/api/watch-folders/<int:fid>/toggle", methods=["POST"])
@require_auth
def api_wf_toggle(fid): return jsonify({"active":db.toggle_watch_folder(fid)})

@app.route("/api/watch-folders/<int:fid>/scan", methods=["POST"])
@require_auth
def api_wf_scan(fid):
    folders=db.get_watch_folders(); f=next((x for x in folders if x["id"]==fid),None)
    if not f: return jsonify({"error":"Topilmadi"}),404
    p=Path(f["path"])
    if not p.exists(): return jsonify({"error":"Papka yo'q"}),400
    existing={m["file_path"] for m in db.get_media(limit=50000)}; added=0
    for fp in p.iterdir():
        if not fp.is_file(): continue
        ext=fp.suffix.lstrip(".").lower()
        if ext not in ALL_ALLOWED or str(fp) in existing: continue
        db.add_media(title=fp.stem.replace("_"," ").title(),file_path=str(fp),
                     media_type=get_media_type(fp.name),file_size=fp.stat().st_size,file_mode="link")
        added+=1
    if added>0: push_notif("Watch Folder", f"{added} ta yangi fayl qo'shildi", "success")
    return jsonify({"ok":True,"added":added})

# ── BULK IMPORT ───────────────────────────────
@app.route("/api/bulk-import-folder", methods=["POST"])
@require_auth
def api_bulk_import():
    d=request.get_json(); ps=(d.get("path") or "").strip()
    if not ps: return jsonify({"error":"Yo'l kiritilmagan"}),400
    p=Path(ps)
    if not p.exists() or not p.is_dir(): return jsonify({"error":"Papka mavjud emas"}),400
    existing={m["file_path"] for m in db.get_media(limit=50000)}
    added=skipped=0
    it=p.rglob("*") if d.get("recursive") else p.iterdir()
    for fp in it:
        if not fp.is_file(): continue
        ext=fp.suffix.lstrip(".").lower()
        if ext not in ALL_ALLOWED: continue
        if str(fp) in existing: skipped+=1; continue
        db.add_media(title=fp.stem.replace("_"," ").title(),file_path=str(fp),
                     media_type=get_media_type(fp.name),category_id=d.get("category_id"),
                     file_size=fp.stat().st_size,file_mode="link")
        added+=1
    if added>0: push_notif("Bulk Import", f"{added} ta fayl import qilindi", "success")
    return jsonify({"ok":True,"added":added,"skipped":skipped})


# ── YT-DLP ────────────────────────────────────
import uuid as _uuid

def _ytdlp_worker(job_id, url, fmt, meta):
    with _dq_lock: _dq[job_id].update({"status":"running","progress":0,"speed":"","eta":""})
    if not check_internet_allowed():
        with _dq_lock: _dq[job_id].update({"status":"error","error":"Internet ruxsat etilmagan"})
        return
    ytbin=_ytdlp_bin()
    if not ytbin:
        with _dq_lock: _dq[job_id].update({"status":"error","error":"yt-dlp o'rnatilmagan: pip install yt-dlp"})
        db.add_download_history(url,meta.get("title",""),"error",0); return
    out_tmpl=str(MEDIA_DIR/"%(title)s.%(ext)s")
    cmd=ytbin+[
        "--no-playlist" if not meta.get("playlist") else "--yes-playlist",
        "-f",fmt or "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format","mp4",
        "--write-thumbnail","--convert-thumbnails","jpg",
        "--output",out_tmpl,"--newline",url]
    try:
        proc=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        filename=""
        for line in proc.stdout:
            line=line.strip()
            m=re.search(r"\[download\]\s+([\d.]+)%.*?at\s+([\d.]+\S+).*?ETA\s+(\S+)",line)
            if m:
                with _dq_lock: _dq[job_id].update({"progress":float(m.group(1)),"speed":m.group(2),"eta":m.group(3)})
            if "[download] Destination:" in line: filename=line.split("Destination:")[-1].strip()
            if "Merging formats into" in line: filename=line.split('"')[1] if '"' in line else filename
        proc.wait()
        if proc.returncode==0 and filename and Path(filename).exists():
            fp=Path(filename); m_type=get_media_type(fp.name)
            title=meta.get("title") or fp.stem.replace("_"," ").replace("-"," ").title()
            thumb_path=""
            for ext2 in (".jpg",".png",".webp"):
                tp=fp.with_suffix(ext2)
                if tp.exists():
                    dest=THUMB_DIR/f"dl_{job_id}{ext2}"; shutil.move(str(tp),str(dest))
                    thumb_path=f"/static/thumbs/dl_{job_id}{ext2}"; break
            mid=db.add_media(title=title,file_path=str(fp),media_type=m_type,
                category_id=meta.get("category_id"),genre=meta.get("genre",""),
                year=meta.get("year",0),rating=0.0,file_size=fp.stat().st_size,
                file_mode="copy",description=meta.get("description",""),
                source_url=url,thumbnail=thumb_path)
            db.add_download_history(url,title,"done",fp.stat().st_size)
            push_notif("Yuklash tugadi", f'"{title}" muvaffaqiyatli yuklandi', "success")
            with _dq_lock: _dq[job_id].update({"status":"done","progress":100,"media_id":mid,"title":title})
        else:
            err="Yuklash tugadi, lekin fayl topilmadi"
            db.add_download_history(url,meta.get("title",""),"error",0)
            with _dq_lock: _dq[job_id].update({"status":"error","error":err})
    except Exception as e:
        db.add_download_history(url,meta.get("title",""),"error",0)
        with _dq_lock: _dq[job_id].update({"status":"error","error":str(e)})

@app.route("/api/ytdl/info", methods=["POST"])
@require_auth
def api_ytdl_info():
    if not check_internet_allowed():
        return jsonify({"error":"Internet ruxsat etilmagan. Admin paneldan yoqing."}),403
    url=(request.get_json().get("url") or "").strip()
    if not url: return jsonify({"error":"URL kiritilmagan"}),400
    ytbin=_ytdlp_bin()
    if not ytbin: return jsonify({"error":"yt-dlp o'rnatilmagan. pip install yt-dlp"}),400
    try:
        r=subprocess.run(ytbin+["--dump-json","--no-playlist",url],
                         capture_output=True,text=True,timeout=30)
        if r.returncode!=0: return jsonify({"error":r.stderr[:300] or "URL ma'lumoti olib bo'lmadi"}),400
        info=json.loads(r.stdout.split("\n")[0])
        formats=[]
        for f in info.get("formats",[]):
            if f.get("vcodec","none")!="none":
                formats.append({"format_id":f.get("format_id"),"ext":f.get("ext"),
                    "height":f.get("height"),"filesize":f.get("filesize") or f.get("filesize_approx",0),
                    "label":f"{f.get('height','?')}p {f.get('ext','')}"})
        formats=sorted({f["height"]:f for f in formats if f["height"]}.values(),
                       key=lambda x:x["height"] or 0,reverse=True)
        return jsonify({"title":info.get("title",""),"thumbnail":info.get("thumbnail",""),
                        "duration":info.get("duration",0),"uploader":info.get("uploader",""),
                        "formats":formats[:10]})
    except Exception as e: return jsonify({"error":str(e)}),500

@app.route("/api/ytdl/download", methods=["POST"])
@require_auth
def api_ytdl_download():
    if not check_internet_allowed():
        return jsonify({"error":"Internet ruxsat etilmagan"}),403
    d=request.get_json(); url=(d.get("url") or "").strip()
    if not url: return jsonify({"error":"URL kiritilmagan"}),400
    fmt=d.get("format","")
    meta={k:d.get(k) for k in ("title","category_id","genre","year","description","playlist")}
    job_id=str(_uuid.uuid4())[:8]
    with _dq_lock: _dq[job_id]={"status":"queued","progress":0,"url":url,
        "title":meta.get("title","Yuklanmoqda..."),"speed":"","eta":"","media_id":None,"error":""}
    threading.Thread(target=_ytdlp_worker,args=(job_id,url,fmt,meta),daemon=True).start()
    return jsonify({"ok":True,"job_id":job_id})

@app.route("/api/ytdl/queue")
@require_auth
def api_ytdl_queue():
    with _dq_lock: return jsonify(dict(_dq))

@app.route("/api/ytdl/queue/<job_id>", methods=["DELETE"])
@require_auth
def api_ytdl_cancel(job_id):
    with _dq_lock:
        if job_id in _dq: del _dq[job_id]
    return jsonify({"ok":True})

@app.route("/api/ytdl/queue/clear", methods=["POST"])
@require_auth
def api_ytdl_clear_done():
    with _dq_lock:
        done=[k for k,v in _dq.items() if v["status"] in ("done","error")]
        for k in done: del _dq[k]
    return jsonify({"cleared":len(done)})

# ── ENTRY POINT ───────────────────────────────
def open_browser():
    import time; time.sleep(1.2)
    webbrowser.open("http://localhost:5500")

if __name__ == "__main__":
    print("="*60)
    print("  🎬  Media Player Pro v9.0  —  Web Edition")
    print("="*60)
    print(f"  📂  Papka  : {BASE_DIR}")
    print(f"  🌐  URL    : http://localhost:5500")
    pwd = _get_password()
    pwd_status = "✅ O'rnatilgan" if pwd else "❌ Yo'q (himoyasiz)"
    print(f"  🔐  Parol  : {pwd_status}")
    ytbin=_ytdlp_bin()
    print(f"  🎬  yt-dlp : {'✅' if ytbin else '❌ pip install yt-dlp'}")
    ffp=subprocess.run(["ffprobe","-version"],capture_output=True)
    print(f"  🎞  ffprobe: {'✅' if ffp.returncode==0 else '❌ (ixtiyoriy)'}")
    print("="*60)
    threading.Thread(target=open_browser,daemon=True).start()
    app.run(host="0.0.0.0",port=5500,debug=False,threaded=True)
