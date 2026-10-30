import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { db, findUserById, publicUser } from './db.js';
import { HttpError, asyncHandler } from './errors.js';

export const SESSION_COOKIE = 'moon_session';
export const CSRF_COOKIE = 'moon_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const dummyHash = bcrypt.hashSync('not-a-real-password-for-timing', 10);
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const cookieBase = () => ({
  httpOnly: false,
  secure: config.cookieSecure,
  sameSite: 'lax',
  path: '/',
});

export const setSessionCookie = (res, token) => {
  res.cookie(SESSION_COOKIE, token, {
    ...cookieBase(),
    httpOnly: true,
    maxAge: config.sessionTtlMs,
  });
};

export const clearSessionCookie = (res) => {
  res.clearCookie(SESSION_COOKIE, { ...cookieBase(), httpOnly: true });
};

export const createSession = (res, userId) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, now, now + config.sessionTtlMs);
  setSessionCookie(res, token);
  return token;
};

export const destroySession = (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
  clearSessionCookie(res);
};

export const verifyPassword = async (password, hash) => {
  try {
    return await bcrypt.compare(password, hash || dummyHash);
  } catch {
    return false;
  }
};

export const hashPassword = (password) => bcrypt.hash(password, config.bcryptRounds);

export const ensureCsrfCookie = (req, res) => {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
    token = crypto.randomBytes(32).toString('base64url');
    res.cookie(CSRF_COOKIE, token, {
      ...cookieBase(),
      httpOnly: false,
      maxAge: config.sessionTtlMs,
    });
    if (req.cookies) req.cookies[CSRF_COOKIE] = token;
  }
  return token;
};

const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};

export const csrfProtection = (req, res, next) => {
  ensureCsrfCookie(req, res);
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  if (config.appOrigin) {
    const origin = req.get('origin');
    if (origin && origin.replace(/\/+$/, '') !== config.appOrigin) {
      return next(new HttpError(403, 'ORIGIN_DENIED', '请求来源不被允许'));
    }
    if (!origin && req.get('sec-fetch-site') === 'cross-site') {
      return next(new HttpError(403, 'ORIGIN_DENIED', '请求来源不被允许'));
    }
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);
  if (!safeEqual(cookieToken, headerToken)) {
    return next(new HttpError(403, 'CSRF_INVALID', '安全校验失败，请刷新页面后重试'));
  }
  return next();
};

export const loadSession = (req, res, next) => {
  req.user = null;
  req.sessionId = null;
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || token.length > 128) return next();

  const row = db.prepare(
    'SELECT s.id AS session_id, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?'
  ).get(hashToken(token));

  if (!row) {
    clearSessionCookie(res);
    return next();
  }
  if (row.expires_at <= Date.now() || row.status !== 'active') {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    clearSessionCookie(res);
    return next();
  }
  req.sessionId = row.session_id;
  req.user = publicUser(row);
  return next();
};

export const requireAuth = (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'AUTH_REQUIRED', '请先登录'));
  return next();
};

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'AUTH_REQUIRED', '请先登录'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'FORBIDDEN', '没有执行此操作的权限'));
  return next();
};

export const canUpload = (user) => Boolean(user && (user.role === 'admin' || user.role === 'uploader'));

export const authCsrfHandler = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ csrfToken: ensureCsrfCookie(req, res) });
});
