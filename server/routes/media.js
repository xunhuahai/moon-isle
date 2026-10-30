import express from 'express';
import { config } from '../config.js';
import { requireAuth, canUpload } from '../auth.js';
import { HttpError, asyncHandler } from '../errors.js';
import { writeLimiter, uploadInitLimiter, uploadPartLimiter } from '../security.js';
import {
  canViewMedia, completeUpload, createUploadRecord, deleteMedia, getMediaRow, getUploadForUser,
  listMedia, normalizeZone, saveNote, serializeMedia, uploadStatus, writeUploadPart,
} from '../media-service.js';

const router = express.Router();

const parsePaging = (query) => {
  const limit = Math.min(300, Math.max(1, Number.parseInt(query.limit, 10) || 200));
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  return { limit, offset };
};

router.get('/', asyncHandler(async (req, res) => {
  const { limit, offset } = parsePaging(req.query);
  const zone = normalizeZone(req.query.zone);
  if (zone === 'inside' && !(req.user?.role === 'admin' || req.user?.insideAccess)) {
    throw new HttpError(403, 'FORBIDDEN', '仅管理员可进入');
  }
  const { rows, total } = listMedia({ limit, offset, zone });
  res.set('Cache-Control', 'no-store');
  res.json({
    media: rows.map((row) => serializeMedia(row, req.user)),
    total,
    zone,
    limit,
    offset,
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = getMediaRow(req.params.id);
  if (!row) throw new HttpError(404, 'MEDIA_NOT_FOUND', '媒体不存在或已删除');
  if (!canViewMedia(row, req.user)) throw new HttpError(403, 'FORBIDDEN', '仅管理员可进入');
  res.set('Cache-Control', 'no-store');
  res.json({ media: serializeMedia(row, req.user) });
}));

router.post('/init', requireAuth, uploadInitLimiter, asyncHandler(async (req, res) => {
  if (!canUpload(req.user)) {
    throw new HttpError(403, 'FORBIDDEN', '当前账号没有上传权限');
  }
  const { filename, mime, size, zone } = req.body || {};
  const upload = createUploadRecord({
    user: req.user,
    originalName: filename,
    mime,
    size,
    zone: normalizeZone(zone),
  });
  res.status(201).json(upload);
}));

router.get('/upload/:id/status', requireAuth, asyncHandler(async (req, res) => {
  const upload = getUploadForUser(req.params.id, req.user);
  res.set('Cache-Control', 'no-store');
  res.json(uploadStatus(upload, req.user));
}));

router.put(
  '/upload/:id/:part',
  requireAuth,
  uploadPartLimiter,
  express.raw({ type: () => true, limit: config.chunkBytes + 1024 * 1024 }),
  asyncHandler(async (req, res) => {
    if (!canUpload(req.user)) throw new HttpError(403, 'FORBIDDEN', '当前账号没有上传权限');
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'EMPTY_PART', '分片内容为空');
    const result = await writeUploadPart({
      uploadId: req.params.id,
      part: req.params.part,
      user: req.user,
      buffer: req.body,
    });
    res.status(204).end();
  })
);

router.post('/complete', requireAuth, uploadInitLimiter, asyncHandler(async (req, res) => {
  if (!canUpload(req.user)) throw new HttpError(403, 'FORBIDDEN', '当前账号没有上传权限');
  const uploadId = req.body?.uploadId;
  if (!uploadId) throw new HttpError(400, 'INVALID_UPLOAD', '缺少上传任务编号');
  const row = await completeUpload({ uploadId, user: req.user });
  res.status(201).json({ media: serializeMedia(row, req.user) });
}));

router.put('/:id/note', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const existing = getMediaRow(req.params.id);
  if (!existing) throw new HttpError(404, 'MEDIA_NOT_FOUND', '媒体不存在或已删除');
  if (!canViewMedia(existing, req.user)) throw new HttpError(403, 'FORBIDDEN', '仅管理员可进入');
  const row = saveNote(req.params.id, req.body?.content, req.user);
  const current = row || getMediaRow(req.params.id);
  res.json({ media: current ? serializeMedia(current, req.user) : null });
}));

router.delete('/:id', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const existing = getMediaRow(req.params.id);
  if (!existing) throw new HttpError(404, 'MEDIA_NOT_FOUND', '媒体不存在或已删除');
  if (!canViewMedia(existing, req.user)) throw new HttpError(403, 'FORBIDDEN', '仅管理员可进入');
  await deleteMedia(req.params.id, req.user);
  res.status(204).end();
}));

export default router;
