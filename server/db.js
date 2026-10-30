import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { config, paths } from './config.js';

fs.mkdirSync(paths.data, { recursive: true });
fs.mkdirSync(paths.uploads, { recursive: true });
fs.mkdirSync(paths.tmp, { recursive: true });
fs.mkdirSync(path.join(paths.uploads, 'media'), { recursive: true });
fs.mkdirSync(path.join(paths.uploads, 'thumbs'), { recursive: true });
fs.mkdirSync(path.join(paths.uploads, 'previews'), { recursive: true });

export const db = new Database(paths.db);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'uploader', 'viewer')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    inside_access INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('image', 'video')),
    original_name TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    thumb_key TEXT NOT NULL,
    preview_key TEXT,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    duration REAL,
    status TEXT NOT NULL DEFAULT 'ready',
    zone TEXT NOT NULL DEFAULT 'outside' CHECK (zone IN ('outside', 'inside')),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_media_created ON media(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_id);

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT NOT NULL UNIQUE REFERENCES media(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    chunk_size INTEGER NOT NULL,
    total_parts INTEGER NOT NULL,
    temp_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'failed')),
    zone TEXT NOT NULL DEFAULT 'outside' CHECK (zone IN ('outside', 'inside')),
    media_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_uploads_owner ON uploads(owner_id);
`);

// 兼容已有数据库：为旧库补上月亮内外分区字段。
const ensureColumn = (table, column, definition) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};
ensureColumn('media', 'zone', "TEXT NOT NULL DEFAULT 'outside'");
ensureColumn('uploads', 'zone', "TEXT NOT NULL DEFAULT 'outside'");
ensureColumn('users', 'inside_access', 'INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE INDEX IF NOT EXISTS idx_media_zone ON media(zone)');

export const cleanupExpiredSessions = () => {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
};

export const cleanupStaleUploads = () => {
  const cutoff = Date.now() - config.uploadRetentionMs;
  const rows = db.prepare("SELECT id, temp_key FROM uploads WHERE status = 'open' AND updated_at < ?").all(cutoff);
  for (const row of rows) {
    const dir = path.join(paths.tmp, row.temp_key);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
  db.prepare("DELETE FROM uploads WHERE status = 'open' AND updated_at < ?").run(cutoff);
  try {
    const entries = fs.readdirSync(paths.tmp, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(paths.tmp, entry.name);
      const stat = fs.statSync(dir);
      if (stat.mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch { /* noop */ }
};

export const countUsers = () => db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
export const findUserByUsername = (username) =>
  db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
export const findUserById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
export const countActiveAdmins = () =>
  db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'").get().count;

export const createUser = ({ username, passwordHash, role = 'viewer', status = 'active', insideAccess = false }) => {
  const result = db.prepare(
    'INSERT INTO users (username, password_hash, role, status, inside_access) VALUES (?, ?, ?, ?, ?)'
  ).run(username, passwordHash, role, status, insideAccess ? 1 : 0);
  return findUserById(result.lastInsertRowid);
};

export const seedAdmin = async () => {
  if (countUsers() > 0) return null;
  if (!config.adminPassword) {
    console.warn('[init] users 表为空，且未设置 ADMIN_PASSWORD。请运行 npm run create-admin 创建管理员。');
    return null;
  }
  if (config.adminPassword.length < 10) {
    console.warn('[init] ADMIN_PASSWORD 少于 10 位，已跳过自动创建管理员。请使用 npm run create-admin。');
    return null;
  }
  const passwordHash = await bcrypt.hash(config.adminPassword, config.bcryptRounds);
  const user = createUser({ username: config.adminUsername, passwordHash, role: 'admin' });
  console.log(`[init] 已创建初始管理员: ${user.username}（请尽快在后台修改为强密码并移除环境变量中的明文密码）`);
  return user;
};

export const publicUser = (user) => {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    insideAccess: Boolean(user.inside_access),
    createdAt: user.created_at,
  };
};

export const closeDb = () => {
  try { db.close(); } catch { /* noop */ }
};
