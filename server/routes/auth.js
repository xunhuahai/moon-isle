import express from 'express';
import {
  authCsrfHandler, createSession, destroySession, hashPassword,
  requireAuth, verifyPassword,
} from '../auth.js';
import { loginLimiter } from '../security.js';
import { db, findUserByUsername, publicUser } from '../db.js';
import { HttpError, asyncHandler } from '../errors.js';

const router = express.Router();

const userPayload = (user) => ({
  user: publicUser(user),
  permissions: {
    upload: Boolean(user && (user.role === 'admin' || user.role === 'uploader')),
    moderate: Boolean(user && user.role === 'admin'),
    manageUsers: Boolean(user && user.role === 'admin'),
    inside: Boolean(user && (user.role === 'admin' || user.insideAccess || user.inside_access)),
  },
});

router.get('/csrf', authCsrfHandler);

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw new HttpError(400, 'INVALID_CREDENTIALS', '请输入账号和密码');
  }
  const cleanUsername = username.trim();
  if (cleanUsername.length < 1 || cleanUsername.length > 64 || password.length < 1 || password.length > 200) {
    throw new HttpError(400, 'INVALID_CREDENTIALS', '账号或密码格式不正确');
  }

  const user = findUserByUsername(cleanUsername);
  const passwordOk = await verifyPassword(password, user?.password_hash);
  if (!user || !passwordOk) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', '账号或密码错误');
  }
  if (user.status !== 'active') {
    throw new HttpError(403, 'ACCOUNT_DISABLED', '账号已被停用，请联系管理员');
  }

  // 登录时清理旧会话，随后创建全新会话，避免会话固定。
  destroySession(req, res);
  createSession(res, user.id);
  res.set('Cache-Control', 'no-store');
  res.json(userPayload(user));
}));

router.post('/logout', asyncHandler(async (req, res) => {
  destroySession(req, res);
  res.status(204).end();
}));

router.get('/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) {
    return res.json({ user: null, permissions: { upload: false, moderate: false, manageUsers: false, inside: false } });
  }
  return res.json(userPayload(req.user));
});

router.post('/password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    throw new HttpError(400, 'INVALID_PASSWORD', '请输入当前密码与新密码');
  }
  if (newPassword.length < 10 || newPassword.length > 200) {
    throw new HttpError(400, 'WEAK_PASSWORD', '新密码至少需要 10 位');
  }
  const row = findUserByUsername(req.user.username);
  const ok = await verifyPassword(currentPassword, row?.password_hash);
  if (!ok) throw new HttpError(403, 'INVALID_PASSWORD', '当前密码不正确');
  const hash = await hashPassword(newPassword);
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
  });
  tx();
  createSession(res, req.user.id);
  res.json({ ok: true });
}));

export default router;
