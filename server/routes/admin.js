import express from 'express';
import { hashPassword, requireRole } from '../auth.js';
import { countActiveAdmins, createUser, db, findUserById, publicUser } from '../db.js';
import { HttpError, asyncHandler } from '../errors.js';
import { writeLimiter } from '../security.js';

const router = express.Router();
const requireAdmin = requireRole('admin');
const ROLES = new Set(['admin', 'uploader', 'viewer']);
const STATUSES = new Set(['active', 'disabled']);
const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,32}$/u;

const usersWithStats = () => db.prepare(`
  SELECT u.id, u.username, u.role, u.status, u.inside_access, u.created_at,
         (SELECT COUNT(*) FROM media m WHERE m.owner_id = u.id) AS media_count
  FROM users u ORDER BY u.id ASC
`).all().map((u) => ({ ...publicUser(u), mediaCount: u.media_count }));

router.get('/users', requireAdmin, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ users: usersWithStats() });
}));

router.post('/users', requireAdmin, writeLimiter, asyncHandler(async (req, res) => {
  const { username, password, role = 'viewer', insideAccess = false } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
    throw new HttpError(400, 'INVALID_USERNAME', '账号需为 3–32 位字母、数字、中文、下划线、点或短横线');
  }
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) {
    throw new HttpError(400, 'WEAK_PASSWORD', '密码至少需要 10 位');
  }
  if (!ROLES.has(role)) throw new HttpError(400, 'INVALID_ROLE', '角色无效');
  const clean = username.trim();
  try {
    const hash = await hashPassword(password);
    const user = createUser({ username: clean, passwordHash: hash, role, insideAccess: Boolean(insideAccess) });
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      throw new HttpError(409, 'USERNAME_TAKEN', '该账号已存在');
    }
    throw error;
  }
}));

router.patch('/users/:id', requireAdmin, writeLimiter, asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_USER', '用户编号无效');
  const user = findUserById(id);
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', '用户不存在');
  if (id === req.user.id) throw new HttpError(400, 'SELF_CHANGE', '不能修改自己的角色或状态');

  const nextRole = req.body?.role ?? user.role;
  const nextStatus = req.body?.status ?? user.status;
  const nextInside = req.body?.insideAccess === undefined
    ? Boolean(user.inside_access)
    : Boolean(req.body.insideAccess);
  if (!ROLES.has(nextRole)) throw new HttpError(400, 'INVALID_ROLE', '角色无效');
  if (!STATUSES.has(nextStatus)) throw new HttpError(400, 'INVALID_STATUS', '状态无效');
  if (nextRole === user.role && nextStatus === user.status && nextInside === Boolean(user.inside_access)) {
    return res.json({ user: publicUser(user) });
  }

  const losesAdmin = user.role === 'admin' && user.status === 'active' && (nextRole !== 'admin' || nextStatus !== 'active');
  if (losesAdmin && countActiveAdmins() <= 1) {
    throw new HttpError(400, 'LAST_ADMIN', '至少需要保留一名可用管理员');
  }

  db.prepare('UPDATE users SET role = ?, status = ?, inside_access = ? WHERE id = ?')
    .run(nextRole, nextStatus, nextInside ? 1 : 0, id);
  if (nextStatus === 'disabled') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.json({ user: publicUser(findUserById(id)) });
}));

router.post('/users/:id/password', requireAdmin, writeLimiter, asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_USER', '用户编号无效');
  const user = findUserById(id);
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', '用户不存在');
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) {
    throw new HttpError(400, 'WEAK_PASSWORD', '密码至少需要 10 位');
  }
  const hash = await hashPassword(password);
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  });
  tx();
  res.json({ ok: true });
}));

export default router;
