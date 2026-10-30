import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config, paths } from './config.js';
import { db } from './db.js';
import { csrfProtection, loadSession } from './auth.js';
import { apiLimiter, securityHeaders } from './security.js';
import { HttpError, errorPayload } from './errors.js';
import authRoutes from './routes/auth.js';
import mediaRoutes from './routes/media.js';
import adminRoutes from './routes/admin.js';
import { canViewMedia, getMediaByStorageKey } from './media-service.js';

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.set('etag', 'strong');

  app.use(securityHeaders);
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
  });

  // Nginx auth_request 专用：每个受保护图片都会触发一次，不纳入普通 API 限流。
  app.get('/api/auth/verify', loadSession, (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user) return res.status(401).end();
    return res.status(204).end();
  });

  // Nginx auth_request：先校验登录，再按文件所属的月亮内外分区校验管理员权限。
  app.get('/api/auth/verify-upload', loadSession, (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user) return res.status(401).end();
    const original = String(req.get('x-original-uri') || '');
    const match = /^\/uploads\/([^?]+)/.exec(original);
    let key = '';
    try { key = decodeURIComponent(match?.[1] || ''); } catch { /* invalid */ }
    if (!key) return res.status(400).end();
    const row = getMediaByStorageKey(key);
    if (!row) return res.status(404).end();
    if (!canViewMedia(row, req.user)) return res.status(403).end();
    return res.status(204).end();
  });

  app.use('/api', apiLimiter, csrfProtection, loadSession, express.json({ limit: '128kb' }));

  app.get('/api/health', (req, res) => {
    try {
      db.prepare('SELECT 1 AS ok').get();
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, version: config.version, uptime: Math.round(process.uptime()) });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/media', mediaRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', (req, res) => {
    res.status(404).json(errorPayload('NOT_FOUND', '接口不存在'));
  });

  // 图片/视频文件本身也要求登录；未登录的访客只看到粒子，不加载真实照片。
  app.use('/uploads', loadSession, (req, res, next) => {
    if (!req.user) {
      res.set('Cache-Control', 'no-store');
      return res.status(401).json(errorPayload('AUTH_REQUIRED', '请先登录'));
    }
    let key = '';
    try { key = decodeURIComponent(req.path.replace(/^\/+/, '')); } catch { /* invalid */ }
    const row = key ? getMediaByStorageKey(key) : null;
    if (!row) return res.status(404).json(errorPayload('NOT_FOUND', '文件不存在'));
    if (!canViewMedia(row, req.user)) {
      res.set('Cache-Control', 'no-store');
      return res.status(403).json(errorPayload('FORBIDDEN', '月亮内部仅管理员可见'));
    }
    if (row.zone === 'inside') res.set('Cache-Control', 'private, no-store');
    return next();
  });
  app.use('/uploads', express.static(paths.uploads, {
    index: false,
    dotfiles: 'deny',
    fallthrough: true,
    maxAge: config.isProduction ? '365d' : 0,
    immutable: config.isProduction,
    setHeaders: (res) => {
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cross-Origin-Resource-Policy', 'same-origin');
    },
  }));

  const indexHtml = path.join(config.webDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.webDist, {
      index: false,
      maxAge: config.isProduction ? '1h' : 0,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.set('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('index.html')) {
          res.set('Cache-Control', 'no-cache');
        }
      },
    }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
      if (req.method !== 'GET') return next();
      return res.sendFile(indexHtml);
    });
  }

  app.use((req, res) => {
    res.status(404).json(errorPayload('NOT_FOUND', '资源不存在'));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error.status || error.statusCode || 500;
    let code = error.code || 'INTERNAL_ERROR';
    let message = error.message || '服务器内部错误';

    if (error.type === 'entity.too.large') {
      status = 413;
      code = 'BODY_TOO_LARGE';
      message = '请求体超过限制';
    } else if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      status = 400;
      code = 'INVALID_JSON';
      message = '请求格式不正确';
    } else if (!(error instanceof HttpError) && status >= 500) {
      console.error('[error]', req.method, req.originalUrl, error);
      message = '服务器内部错误';
    }

    if (status < 400 || status > 599) status = 500;
    res.status(status).json(errorPayload(code, message, error.details));
  });

  return app;
};
