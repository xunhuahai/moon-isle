import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { config } from './config.js';

const limiter = ({ windowMs, limit, code, message, skipSuccessfulRequests = false }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler: (req, res) => {
      res.status(429).json({ error: { code, message } });
    },
  });

export const apiLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 600,
  code: 'RATE_LIMITED',
  message: '请求过于频繁，请稍后再试',
});

export const loginLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  code: 'LOGIN_RATE_LIMITED',
  message: '登录尝试过于频繁，请 15 分钟后再试',
  skipSuccessfulRequests: true,
});

export const uploadInitLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  code: 'UPLOAD_RATE_LIMITED',
  message: '上传初始化过于频繁，请稍后再试',
});

export const uploadPartLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 2400,
  code: 'UPLOAD_RATE_LIMITED',
  message: '上传请求过于频繁，请稍后再试',
});

export const writeLimiter = limiter({
  windowMs: 10 * 60 * 1000,
  limit: 120,
  code: 'WRITE_RATE_LIMITED',
  message: '操作过于频繁，请稍后再试',
});

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
      upgradeInsecureRequests: config.isProduction ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
});
