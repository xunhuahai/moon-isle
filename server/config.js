import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const num = (name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`环境变量 ${name} 无效: ${raw}`);
  }
  return value;
};

const bool = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
};

const resolvePath = (value, fallback) => {
  const target = value && value.trim() ? value.trim() : fallback;
  return path.isAbsolute(target) ? path.normalize(target) : path.resolve(rootDir, target);
};

const nodeEnv = process.env.NODE_ENV || 'development';
const dataDir = resolvePath(process.env.DATA_DIR, 'data');
const uploadDir = resolvePath(process.env.UPLOAD_DIR, path.join(dataDir, 'uploads'));
const tmpDir = resolvePath(process.env.UPLOAD_TMP_DIR, path.join(dataDir, 'uploads-tmp'));

export const config = {
  rootDir,
  nodeEnv,
  isProduction: nodeEnv === 'production',
  host: process.env.HOST || '127.0.0.1',
  port: num('PORT', 3000, 1, 65535),
  trustProxy: bool('TRUST_PROXY', false),
  appOrigin: (process.env.APP_ORIGIN || '').replace(/\/+$/, ''),
  dataDir,
  uploadDir,
  tmpDir,
  dbFile: path.join(dataDir, 'app.db'),
  webDist: path.join(rootDir, 'web', 'dist'),
  maxImageBytes: num('MAX_IMAGE_MB', 80, 1, 500) * 1024 * 1024,
  maxVideoBytes: num('MAX_VIDEO_MB', 2048, 1, 10240) * 1024 * 1024,
  chunkBytes: num('CHUNK_SIZE_MB', 8, 1, 32) * 1024 * 1024,
  maxMedia: num('MAX_MEDIA', 5000, 1, 100000),
  sessionTtlMs: num('SESSION_TTL_DAYS', 7, 1, 90) * 24 * 60 * 60 * 1000,
  cookieSecure: bool('COOKIE_SECURE', nodeEnv === 'production'),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  bcryptRounds: num('BCRYPT_ROUNDS', 12, 10, 15),
  uploadRetentionMs: 24 * 60 * 60 * 1000,
  version: '1.0.0',
};

export const paths = {
  root: rootDir,
  data: dataDir,
  uploads: uploadDir,
  tmp: tmpDir,
  db: config.dbFile,
  webDist: config.webDist,
};
