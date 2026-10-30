import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { fileTypeFromFile } from 'file-type';
import { config, paths } from './config.js';
import { db, findUserById } from './db.js';
import { HttpError, assert } from './errors.js';

const execFileAsync = promisify(execFile);

export const ALLOWED_TYPES = new Map([
  ['image/jpeg', { kind: 'image', ext: 'jpg', extensions: ['jpg', 'jpeg'] }],
  ['image/png', { kind: 'image', ext: 'png', extensions: ['png'] }],
  ['image/webp', { kind: 'image', ext: 'webp', extensions: ['webp'] }],
  ['image/gif', { kind: 'image', ext: 'gif', extensions: ['gif'] }],
  ['image/avif', { kind: 'image', ext: 'avif', extensions: ['avif'] }],
  ['video/mp4', { kind: 'video', ext: 'mp4', extensions: ['mp4', 'm4v'] }],
  ['video/webm', { kind: 'video', ext: 'webm', extensions: ['webm'] }],
  ['video/quicktime', { kind: 'video', ext: 'mov', extensions: ['mov'] }],
]);

const EXT_TO_MIME = new Map();
for (const [mime, meta] of ALLOWED_TYPES) {
  for (const ext of meta.extensions) EXT_TO_MIME.set(ext, mime);
}

const MIME_ALIASES = new Map([
  ['image/jpg', 'image/jpeg'],
  ['image/pjpeg', 'image/jpeg'],
  ['video/x-m4v', 'video/mp4'],
]);

export const normalizeMime = (mime) => {
  const clean = String(mime || '').split(';')[0].trim().toLowerCase();
  return MIME_ALIASES.get(clean) || clean;
};

export const mimeFromFilename = (name) => {
  const ext = path.extname(String(name || '')).slice(1).toLowerCase();
  return EXT_TO_MIME.get(ext) || '';
};

export const sanitizeOriginalName = (name) => {
  const raw = String(name || '').replace(/\\/g, '/').split('/').pop() || '';
  const clean = raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...clean];
  return (chars.length ? chars.slice(0, 160).join('') : '未命名媒体');
};

export const validateInitPayload = ({ originalName, mime, size }) => {
  assert(typeof originalName === 'string' && originalName.trim().length > 0, 400, 'INVALID_FILE', '缺少文件名');
  const safeName = sanitizeOriginalName(originalName);
  let declaredMime = normalizeMime(mime);
  if (!declaredMime) declaredMime = mimeFromFilename(safeName);
  const meta = ALLOWED_TYPES.get(declaredMime);
  assert(meta, 415, 'UNSUPPORTED_TYPE', '仅支持 JPG/PNG/WebP/GIF/AVIF 图片与 MP4/WebM/MOV 视频');

  const ext = path.extname(safeName).slice(1).toLowerCase();
  assert(meta.extensions.includes(ext), 415, 'EXTENSION_MISMATCH', '文件扩展名与类型不匹配');
  const bytes = Number(size);
  assert(Number.isSafeInteger(bytes) && bytes > 0, 400, 'INVALID_SIZE', '文件大小无效');
  const maxBytes = meta.kind === 'video' ? config.maxVideoBytes : config.maxImageBytes;
  assert(bytes <= maxBytes, 413, 'FILE_TOO_LARGE', `文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB 限制`);

  const totalParts = Math.ceil(bytes / config.chunkBytes);
  assert(totalParts >= 1 && totalParts <= 4096, 400, 'TOO_MANY_PARTS', '文件过大或分片参数异常');
  return { safeName, mime: declaredMime, meta, size: bytes, totalParts, chunkSize: config.chunkBytes };
};

const publicMediaSelect = `
  SELECT m.*, u.username AS owner_username,
         n.content AS note_content, n.updated_at AS note_updated_at, n.updated_by AS note_updated_by,
         nu.username AS note_updated_username
  FROM media m
  JOIN users u ON u.id = m.owner_id
  LEFT JOIN notes n ON n.media_id = m.id
  LEFT JOIN users nu ON nu.id = n.updated_by
`;

export const getMediaRow = (id) => db.prepare(`${publicMediaSelect} WHERE m.id = ?`).get(id);

export const MEDIA_ZONES = new Set(['outside', 'inside']);

export const normalizeZone = (zone) => {
  const value = String(zone || 'outside').toLowerCase();
  assert(MEDIA_ZONES.has(value), 400, 'INVALID_ZONE', '照片分区无效');
  return value;
};

export const canViewMedia = (row, viewer) => Boolean(
  viewer && row && (row.zone === 'outside' || viewer.role === 'admin' || viewer.insideAccess)
);

export const listMedia = ({ limit = 200, offset = 0, zone = 'outside' } = {}) => {
  const safeZone = normalizeZone(zone);
  const total = db.prepare('SELECT COUNT(*) AS count FROM media WHERE zone = ?').get(safeZone).count;
  const rows = db.prepare(`${publicMediaSelect} WHERE m.zone = ? ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`)
    .all(safeZone, limit, offset);
  return { rows, total };
};

export const serializeMedia = (row, viewer) => {
  if (!row) return null;
  const canSee = canViewMedia(row, viewer);
  const canModify = Boolean(canSee && viewer && (viewer.role === 'admin' || (viewer.role === 'uploader' && viewer.id === row.owner_id)));
  return {
    id: row.id,
    type: row.type,
    originalName: row.original_name,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    duration: row.duration,
    createdAt: row.created_at,
    zone: row.zone || 'outside',
    owner: { id: row.owner_id, username: row.owner_username },
    note: row.note_content == null ? null : {
      content: row.note_content,
      updatedAt: row.note_updated_at,
      updatedBy: row.note_updated_by ? { id: row.note_updated_by, username: row.note_updated_username } : null,
    },
    urls: canSee ? {
      thumb: `/uploads/${row.thumb_key}`,
      preview: `/uploads/${row.preview_key || row.thumb_key}`,
      source: `/uploads/${row.storage_key}`,
    } : { thumb: null, preview: null, source: null },
    permissions: {
      editNote: canModify,
      delete: canModify,
    },
  };
};

const tempDirFor = (upload) => path.join(paths.tmp, upload.temp_key);
const partPath = (upload, index) => path.join(tempDirFor(upload), `part-${index}.part`);
const partSize = (upload, index) =>
  index < upload.total_parts ? upload.chunk_size : upload.size - upload.chunk_size * (upload.total_parts - 1);

export const createUploadRecord = ({ user, originalName, mime, size, zone = 'outside' }) => {
  const data = validateInitPayload({ originalName, mime, size });
  const safeZone = normalizeZone(zone);
  assert(safeZone !== 'inside' || user.role === 'admin', 403, 'FORBIDDEN', '只有管理员可以上传到月亮内部');
  const mediaCount = db.prepare('SELECT COUNT(*) AS count FROM media').get().count;
  assert(mediaCount < config.maxMedia, 507, 'GALLERY_FULL', '画廊存储数量已达上限');

  const id = crypto.randomUUID();
  const now = Date.now();
  fs.mkdirSync(path.join(paths.tmp, id), { recursive: true });
  db.prepare(`INSERT INTO uploads
    (id, owner_id, original_name, mime, size, chunk_size, total_parts, temp_key, status, zone, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
    .run(id, user.id, data.safeName, data.mime, data.size, data.chunkSize, data.totalParts, id, safeZone, now, now);
  return {
    uploadId: id,
    originalName: data.safeName,
    mime: data.mime,
    size: data.size,
    chunkSize: data.chunkSize,
    totalParts: data.totalParts,
    zone: safeZone,
    uploadedParts: [],
  };
};

export const getUploadForUser = (uploadId, user) => {
  assert(/^[0-9a-f-]{36}$/i.test(String(uploadId || '')), 400, 'INVALID_UPLOAD', '上传任务无效');
  const upload = db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId);
  assert(upload, 404, 'UPLOAD_NOT_FOUND', '上传任务不存在或已过期');
  assert(upload.owner_id === user.id || user.role === 'admin', 403, 'FORBIDDEN', '无权操作此上传任务');
  return upload;
};

export const uploadedPartIndexes = (upload) => {
  const dir = tempDirFor(upload);
  if (!fs.existsSync(dir)) return [];
  const parts = [];
  for (const name of fs.readdirSync(dir)) {
    const match = /^part-(\d+)\.part$/.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    if (index >= 1 && index <= upload.total_parts) {
      try {
        if (fs.statSync(path.join(dir, name)).size === partSize(upload, index)) parts.push(index);
      } catch { /* ignore */ }
    }
  }
  return parts.sort((a, b) => a - b);
};

export const uploadStatus = (upload, user) => {
  const parts = uploadedPartIndexes(upload);
  return {
    uploadId: upload.id,
    status: upload.status,
    mediaId: upload.media_id,
    originalName: upload.original_name,
    mime: upload.mime,
    size: upload.size,
    chunkSize: upload.chunk_size,
    zone: upload.zone || 'outside',
    totalParts: upload.total_parts,
    uploadedParts: parts,
    complete: upload.status === 'completed',
  };
};

export const writeUploadPart = async ({ uploadId, part, user, buffer }) => {
  const upload = getUploadForUser(uploadId, user);
  assert(upload.status === 'open', 409, 'UPLOAD_CLOSED', '上传任务已结束');
  const index = Number(part);
  assert(Number.isInteger(index) && index >= 1 && index <= upload.total_parts, 400, 'INVALID_PART', '分片序号无效');
  assert(Buffer.isBuffer(buffer) && buffer.length > 0, 400, 'EMPTY_PART', '分片内容为空');
  const expected = partSize(upload, index);
  assert(buffer.length === expected, 400, 'PART_SIZE_MISMATCH', `分片 ${index} 大小不正确，应为 ${expected} 字节`);

  const dir = tempDirFor(upload);
  await fsp.mkdir(dir, { recursive: true });
  const target = partPath(upload, index);
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(temp, buffer, { flag: 'wx' });
  await fsp.rm(target, { force: true });
  await fsp.rename(temp, target);
  db.prepare('UPDATE uploads SET updated_at = ? WHERE id = ?').run(Date.now(), upload.id);
  return { uploadedPart: index };
};

const combineParts = async (upload) => {
  const finalPath = path.join(tempDirFor(upload), 'assembled.bin');
  await fsp.rm(finalPath, { force: true });
  const dest = fs.createWriteStream(finalPath, { flags: 'wx' });
  try {
    for (let i = 1; i <= upload.total_parts; i += 1) {
      const file = partPath(upload, i);
      const stat = await fsp.stat(file);
      assert(stat.size === partSize(upload, i), 400, 'UPLOAD_INCOMPLETE', `分片 ${i} 大小异常`);
      const source = fs.createReadStream(file);
      source.pipe(dest, { end: false });
      await once(source, 'end');
    }
    dest.end();
    await once(dest, 'finish');
  } catch (error) {
    dest.destroy();
    await fsp.rm(finalPath, { force: true }).catch(() => {});
    throw error;
  }
  const stat = await fsp.stat(finalPath);
  assert(stat.size === upload.size, 400, 'SIZE_MISMATCH', '合并后的文件大小与声明不符');
  return finalPath;
};

const periodKey = () => {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}/${month}`;
};

const runOptional = async (command, args, options = {}) => {
  try {
    return await execFileAsync(command, args, { timeout: 25_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, ...options });
  } catch {
    return null;
  }
};

const probeVideo = async (file) => {
  const result = await runOptional(config.ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration:stream=width,height,duration',
    '-of', 'json', file,
  ]);
  if (!result) return { duration: null, width: null, height: null };
  try {
    const info = JSON.parse(result.stdout);
    const streams = (info.streams || []).filter((s) => s.width && s.height);
    const duration = Number(info.format?.duration || streams[0]?.duration);
    return {
      duration: Number.isFinite(duration) ? duration : null,
      width: streams[0]?.width || null,
      height: streams[0]?.height || null,
    };
  } catch {
    return { duration: null, width: null, height: null };
  }
};

const placeholderPoster = async (file) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
    <defs>
      <radialGradient id="bg" cx="50%" cy="42%" r="72%">
        <stop offset="0%" stop-color="#28304f"/><stop offset="55%" stop-color="#111625"/><stop offset="100%" stop-color="#050711"/>
      </radialGradient>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fff2c9" stop-opacity=".95"/><stop offset="100%" stop-color="#fff2c9" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1600" height="1000" fill="url(#bg)"/>
    <circle cx="800" cy="500" r="260" fill="url(#glow)" opacity=".2"/>
    <circle cx="800" cy="500" r="104" fill="#090d19" stroke="#f7e7bd" stroke-opacity=".55" stroke-width="2"/>
    <path d="M775 450 L848 500 L775 550 Z" fill="#f7e7bd"/>
    <text x="800" y="690" text-anchor="middle" fill="#a7b0c9" font-family="Arial, sans-serif" font-size="28" letter-spacing="12">VIDEO</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
};

const makeImageArtifacts = async (source, tempBase) => {
  let metadata;
  try {
    metadata = await sharp(source, { failOn: 'error', limitInputPixels: 120_000_000, animated: false }).metadata();
    assert(metadata.width && metadata.height, 415, 'INVALID_IMAGE', '无法读取图片尺寸');
    const pipeline = sharp(source, { failOn: 'error', limitInputPixels: 120_000_000, animated: false })
      .rotate()
      .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86, effort: 4 });
    const preview = await pipeline.toBuffer();
    const thumb = await sharp(preview).resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 3 }).toBuffer();
    await fsp.writeFile(`${tempBase}-preview.webp`, preview);
    await fsp.writeFile(`${tempBase}-thumb.webp`, thumb);
    const orientation = Number(metadata.orientation || 1);
    const swapped = orientation >= 5 && orientation <= 8;
    return {
      width: swapped ? metadata.height : metadata.width,
      height: swapped ? metadata.width : metadata.height,
      preview: true,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(415, 'INVALID_IMAGE', '图片文件损坏或格式不受支持');
  }
};

const makeVideoArtifacts = async (source, tempBase) => {
  const info = await probeVideo(source);
  let poster = null;
  const capture = await runOptional(config.ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.7', '-i', source,
    '-frames:v', '1', '-vf', "scale='min(1600,iw)':-2", '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 15 * 1024 * 1024 });
  if (capture && capture.stdout?.length) poster = capture.stdout;
  if (!poster) poster = await placeholderPoster(source);
  const preview = await sharp(poster).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84, effort: 4 }).toBuffer();
  const thumb = await sharp(preview).resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80, effort: 3 }).toBuffer();
  await fsp.writeFile(`${tempBase}-preview.webp`, preview);
  await fsp.writeFile(`${tempBase}-thumb.webp`, thumb);
  return { ...info, preview: true };
};

const moveFile = async (source, target) => {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  try {
    await fsp.rename(source, target);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fsp.copyFile(source, target);
    await fsp.rm(source, { force: true });
  }
};

const removeTemp = async (upload) => {
  await fsp.rm(tempDirFor(upload), { recursive: true, force: true }).catch(() => {});
};

const completing = new Set();

export const completeUpload = async ({ uploadId, user }) => {
  const upload = getUploadForUser(uploadId, user);
  if (upload.status === 'completed' && upload.media_id) {
    return getMediaRow(upload.media_id);
  }
  assert(upload.status === 'open', 409, 'UPLOAD_CLOSED', '上传任务已结束');
  if (completing.has(upload.id)) throw new HttpError(409, 'UPLOAD_BUSY', '正在合并，请稍候');
  completing.add(upload.id);
  let assembled = null;
  try {
    const uploaded = uploadedPartIndexes(upload);
    assert(uploaded.length === upload.total_parts, 400, 'UPLOAD_INCOMPLETE', `仍有 ${upload.total_parts - uploaded.length} 个分片未上传`);
    assembled = await combineParts(upload);

    const detected = await fileTypeFromFile(assembled);
    assert(detected && ALLOWED_TYPES.has(detected.mime), 415, 'INVALID_FILE', '无法识别文件真实类型');
    const actual = ALLOWED_TYPES.get(detected.mime);
    const declared = ALLOWED_TYPES.get(upload.mime);
    assert(actual.kind === declared.kind, 415, 'TYPE_MISMATCH', '文件真实类型与声明不符');

    const id = crypto.randomUUID();
    const period = periodKey();
    const base = path.join(paths.tmp, upload.temp_key);
    const imageArtifacts = actual.kind === 'image'
      ? await makeImageArtifacts(assembled, base)
      : await makeVideoArtifacts(assembled, base);

    const originalKey = `media/${period}/${id}.${actual.ext}`;
    const thumbKey = `thumbs/${period}/${id}.webp`;
    const previewKey = `previews/${period}/${id}.webp`;
    const createdAt = new Date().toISOString();

    const insert = db.transaction(() => {
      db.prepare(`INSERT INTO media
        (id, owner_id, type, original_name, storage_key, thumb_key, preview_key, mime, size, width, height, duration, status, zone, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`)
        .run(id, upload.owner_id, actual.kind, upload.original_name, originalKey, thumbKey, previewKey,
          detected.mime, upload.size, imageArtifacts.width || null, imageArtifacts.height || null,
          imageArtifacts.duration || null, upload.zone || 'outside', createdAt);
      db.prepare("UPDATE uploads SET status = 'completed', media_id = ?, updated_at = ? WHERE id = ?")
        .run(id, Date.now(), upload.id);
    });

    try {
      await moveFile(assembled, path.join(paths.uploads, originalKey));
      await moveFile(`${base}-thumb.webp`, path.join(paths.uploads, thumbKey));
      await moveFile(`${base}-preview.webp`, path.join(paths.uploads, previewKey));
      insert();
    } catch (error) {
      db.prepare("UPDATE uploads SET status = 'failed', updated_at = ? WHERE id = ?").run(Date.now(), upload.id);
      await Promise.all([
        fsp.rm(path.join(paths.uploads, originalKey), { force: true }),
        fsp.rm(path.join(paths.uploads, thumbKey), { force: true }),
        fsp.rm(path.join(paths.uploads, previewKey), { force: true }),
      ]).catch(() => {});
      throw error;
    }

    await removeTemp(upload);
    return getMediaRow(id);
  } finally {
    completing.delete(upload.id);
  }
};

export const getMediaByStorageKey = (key) => {
  const clean = String(key || '').replace(/^\/+/, '');
  if (!clean) return null;
  return db.prepare(`SELECT * FROM media WHERE storage_key = ? OR thumb_key = ? OR preview_key = ? LIMIT 1`)
    .get(clean, clean, clean);
};

export const canModifyMedia = (row, user) => Boolean(
  user && row && canViewMedia(row, user)
  && (user.role === 'admin' || (user.role === 'uploader' && user.id === row.owner_id))
);

export const deleteMedia = async (id, user) => {
  assert(/^[0-9a-f-]{36}$/i.test(String(id || '')), 400, 'INVALID_MEDIA', '媒体编号无效');
  const row = getMediaRow(id);
  assert(row, 404, 'MEDIA_NOT_FOUND', '媒体不存在或已删除');
  assert(canModifyMedia(row, user), 403, 'FORBIDDEN', '无权删除此媒体');
  db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
  await Promise.all([
    fsp.rm(path.join(paths.uploads, row.storage_key), { force: true }),
    fsp.rm(path.join(paths.uploads, row.thumb_key), { force: true }),
    fsp.rm(path.join(paths.uploads, row.preview_key || row.thumb_key), { force: true }),
  ]).catch(() => {});
};

export const normalizeNote = (content) => {
  assert(typeof content === 'string', 400, 'INVALID_NOTE', '备注内容无效');
  const clean = content.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  assert(clean.length <= 2000, 400, 'NOTE_TOO_LONG', '备注最多 2000 个字符');
  return clean;
};

export const saveNote = (id, content, user) => {
  assert(/^[0-9a-f-]{36}$/i.test(String(id || '')), 400, 'INVALID_MEDIA', '媒体编号无效');
  const row = getMediaRow(id);
  assert(row, 404, 'MEDIA_NOT_FOUND', '媒体不存在或已删除');
  assert(canModifyMedia(row, user), 403, 'FORBIDDEN', '无权编辑此媒体的备注');
  const clean = normalizeNote(content);
  if (!clean) {
    db.prepare('DELETE FROM notes WHERE media_id = ?').run(id);
    return null;
  }
  db.prepare(`INSERT INTO notes (media_id, content, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(media_id) DO UPDATE SET content = excluded.content, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(id, clean, user.id, new Date().toISOString());
  return getMediaRow(id);
};

export const adminStats = () => {
  return {
    media: db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM media').get(),
    users: db.prepare('SELECT COUNT(*) AS count FROM users').get(),
  };
};
