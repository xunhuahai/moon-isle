import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, '.test-data');
fs.rmSync(testDir, { recursive: true, force: true });
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = testDir;
process.env.UPLOAD_DIR = path.join(testDir, 'uploads');
process.env.UPLOAD_TMP_DIR = path.join(testDir, 'uploads-tmp');
process.env.COOKIE_SECURE = 'false';
process.env.TRUST_PROXY = '0';
process.env.APP_ORIGIN = '';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'TestAdmin!2026';
process.env.BCRYPT_ROUNDS = '10';
process.env.CHUNK_SIZE_MB = '1';

let app;
let seedAdmin;
let closeDb;

const bootstrap = async (agent) => {
  const res = await agent.get('/api/auth/csrf').expect(200);
  return res.body.csrfToken;
};

const loginAs = async (agent, username, password) => {
  const token = await bootstrap(agent);
  const res = await agent.post('/api/auth/login')
    .set('X-CSRF-Token', token)
    .send({ username, password })
    .expect(200);
  return { token, res };
};

const makeImage = (color = '#5b7aa8') => sharp({
  create: { width: 640, height: 420, channels: 3, background: color },
}).jpeg({ quality: 82 }).toBuffer();

const uploadImage = async (agent, csrf, { filename, buffer, mime = 'image/jpeg', zone = 'outside' }) => {
  const init = await agent.post('/api/media/init')
    .set('X-CSRF-Token', csrf)
    .send({ filename, mime, size: buffer.length, zone })
    .expect(201);
  for (let part = 1; part <= init.body.totalParts; part += 1) {
    const start = (part - 1) * init.body.chunkSize;
    const end = Math.min(buffer.length, start + init.body.chunkSize);
    await agent.put(`/api/media/upload/${init.body.uploadId}/${part}`)
      .set('X-CSRF-Token', csrf)
      .set('Content-Type', 'application/octet-stream')
      .send(buffer.subarray(start, end))
      .expect(204);
  }
  const result = await agent.post('/api/media/complete')
    .set('X-CSRF-Token', csrf)
    .send({ uploadId: init.body.uploadId })
    .expect(201);
  return result.body.media;
};

before(async () => {
  const dbModule = await import('../server/db.js');
  seedAdmin = dbModule.seedAdmin;
  closeDb = dbModule.closeDb;
  const appModule = await import('../server/app.js');
  app = appModule.createApp();
  await seedAdmin();
});

after(async () => {
  closeDb?.();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('health, CSRF and security headers', async () => {
  const health = await request(app).get('/api/health').expect(200);
  assert.equal(health.body.ok, true);
  assert.equal(health.headers['x-content-type-options'], 'nosniff');
  assert.match(health.headers['content-security-policy'] || '', /default-src 'self'/);

  const agent = request.agent(app);
  await agent.post('/api/auth/logout').send({}).expect(403);
  await agent.get('/api/media').expect(200);
});

test('login rejects bad credentials and supports session', async () => {
  const agent = request.agent(app);
  const token = await bootstrap(agent);
  await agent.post('/api/auth/login')
    .set('X-CSRF-Token', token)
    .send({ username: 'admin', password: 'wrong-password' })
    .expect(401);

  const login = await loginAs(agent, 'admin', 'TestAdmin!2026');
  assert.equal(login.res.body.user.role, 'admin');
  assert.match(login.res.headers['set-cookie'].join(';'), /HttpOnly/i);
  await request(app).get('/api/auth/verify').expect(401);
  await agent.get('/api/auth/verify').expect(204);
  const me = await agent.get('/api/auth/me').expect(200);
  assert.equal(me.body.user.username, 'admin');
  assert.equal(me.body.permissions.upload, true);
  await agent.get('/api/media').expect(200);
});

test('admin can create users and cannot demote self', async () => {
  const agent = request.agent(app);
  const { token } = await loginAs(agent, 'admin', 'TestAdmin!2026');
  const uploader = await agent.post('/api/admin/users')
    .set('X-CSRF-Token', token)
    .send({ username: 'creator', password: 'CreatorPass!2026', role: 'uploader' })
    .expect(201);
  assert.equal(uploader.body.user.role, 'uploader');
  await agent.post('/api/admin/users')
    .set('X-CSRF-Token', token)
    .send({ username: 'guest', password: 'GuestPass!2026', role: 'viewer' })
    .expect(201);
  const me = await agent.get('/api/auth/me');
  await agent.patch(`/api/admin/users/${me.body.user.id}`)
    .set('X-CSRF-Token', token)
    .send({ role: 'viewer' })
    .expect(400);
});

test('chunk upload, thumbnail, note permissions and delete', async () => {
  const admin = request.agent(app);
  const adminLogin = await loginAs(admin, 'admin', 'TestAdmin!2026');
  const creator = request.agent(app);
  const creatorLogin = await loginAs(creator, 'creator', 'CreatorPass!2026');
  const guest = request.agent(app);
  const guestLogin = await loginAs(guest, 'guest', 'GuestPass!2026');

  const buffer = await makeImage('#7f623e');
  const media = await uploadImage(creator, creatorLogin.token, { filename: '测试照片.jpg', buffer });
  assert.equal(media.type, 'image');
  assert.equal(media.width, 640);
  assert.equal(media.height, 420);
  assert.equal(media.permissions.editNote, true);
  assert.equal(media.permissions.delete, true);

  // 未登录访客列表不返回媒体文件 URL，直接请求上传文件也会被拒绝。
  const anonymousList = await request(app).get('/api/media').expect(200);
  assert.equal(anonymousList.body.media[0].urls.thumb, null);
  await request(app).get(media.urls.thumb).expect(401);

  const thumb = await creator.get(media.urls.thumb).expect(200);
  assert.match(thumb.headers['content-type'], /image\/webp/);

  const listAsCreator = await creator.get('/api/media').expect(200);
  assert.equal(listAsCreator.body.total, 1);
  assert.equal(listAsCreator.body.media[0].permissions.editNote, true);
  assert.ok(listAsCreator.body.media[0].urls.thumb);

  await creator.put(`/api/media/${media.id}/note`)
    .set('X-CSRF-Token', creatorLogin.token)
    .send({ content: '这是上传者自己的备注。' })
    .expect(200);

  const guestList = await guest.get('/api/media').expect(200);
  assert.equal(guestList.body.media[0].permissions.editNote, false);
  await guest.get(media.urls.thumb).expect(200);
  await guest.put(`/api/media/${media.id}/note`)
    .set('X-CSRF-Token', guestLogin.token)
    .send({ content: '越权修改' })
    .expect(403);
  await guest.delete(`/api/media/${media.id}`)
    .set('X-CSRF-Token', guestLogin.token)
    .expect(403);

  const adminNote = await admin.put(`/api/media/${media.id}/note`)
    .set('X-CSRF-Token', adminLogin.token)
    .send({ content: '管理员补充的备注。' })
    .expect(200);
  assert.equal(adminNote.body.media.note.content, '管理员补充的备注。');

  await creator.put(`/api/media/${media.id}/note`)
    .set('X-CSRF-Token', creatorLogin.token)
    .send({ content: 'x'.repeat(2001) })
    .expect(400);

  await creator.delete(`/api/media/${media.id}`)
    .set('X-CSRF-Token', creatorLogin.token)
    .expect(204);
  const afterDelete = await request(app).get('/api/media').expect(200);
  assert.equal(afterDelete.body.total, 0);
});


test('moon outside and inside zones enforce admin-only visibility', async () => {
  const admin = request.agent(app);
  const adminLogin = await loginAs(admin, 'admin', 'TestAdmin!2026');
  const creator = request.agent(app);
  const creatorLogin = await loginAs(creator, 'creator', 'CreatorPass!2026');
  const guest = request.agent(app);
  const guestLogin = await loginAs(guest, 'guest', 'GuestPass!2026');

  const outside = await uploadImage(creator, creatorLogin.token, {
    filename: 'outside.jpg', buffer: await makeImage('#2e5b83'), zone: 'outside',
  });
  const inside = await uploadImage(admin, adminLogin.token, {
    filename: 'inside.jpg', buffer: await makeImage('#7b4a31'), zone: 'inside',
  });
  assert.equal(outside.zone, 'outside');
  assert.equal(inside.zone, 'inside');

  const guestOutside = await guest.get('/api/media?zone=outside').expect(200);
  assert.equal(guestOutside.body.total, 1);
  assert.equal(guestOutside.body.media[0].id, outside.id);
  assert.ok(guestOutside.body.media[0].urls.thumb);
  await guest.get('/api/media?zone=inside').expect(403);
  await request(app).get('/api/media?zone=inside').expect(403);

  const adminInside = await admin.get('/api/media?zone=inside').expect(200);
  assert.equal(adminInside.body.total, 1);
  assert.equal(adminInside.body.media[0].id, inside.id);

  await guest.get(`/api/media/${inside.id}`).expect(403);
  await creator.get(`/api/media/${inside.id}`).expect(403);
  await guest.get(inside.urls.thumb).expect(403);
  await creator.get(inside.urls.thumb).expect(403);
  await admin.get(inside.urls.thumb).expect(200);
  await guest.get(outside.urls.thumb).expect(200);

  // 管理员可以授权普通访客只读查看月亮内部；授权后仍不能上传内部照片。
  const userList = await admin.get('/api/admin/users').expect(200);
  const guestUser = userList.body.users.find((user) => user.username === 'guest');
  await admin.patch(`/api/admin/users/${guestUser.id}`)
    .set('X-CSRF-Token', adminLogin.token)
    .send({ insideAccess: true })
    .expect(200);
  const grantedList = await guest.get('/api/media?zone=inside').expect(200);
  assert.equal(grantedList.body.total, 1);
  await guest.get(inside.urls.thumb).expect(200);
  await guest.post('/api/media/init')
    .set('X-CSRF-Token', guestLogin.token)
    .send({ filename: 'viewer-inside.jpg', mime: 'image/jpeg', size: 1000, zone: 'inside' })
    .expect(403);
  await admin.patch(`/api/admin/users/${guestUser.id}`)
    .set('X-CSRF-Token', adminLogin.token)
    .send({ insideAccess: false })
    .expect(200);
  await guest.get('/api/media?zone=inside').expect(403);

  await guest.get('/api/auth/verify-upload')
    .set('X-Original-URI', inside.urls.thumb)
    .expect(403);
  await admin.get('/api/auth/verify-upload')
    .set('X-Original-URI', inside.urls.thumb)
    .expect(204);

  await creator.post('/api/media/init')
    .set('X-CSRF-Token', creatorLogin.token)
    .send({ filename: 'forbidden-inside.jpg', mime: 'image/jpeg', size: 1000, zone: 'inside' })
    .expect(403);

  await creator.delete(`/api/media/${inside.id}`)
    .set('X-CSRF-Token', creatorLogin.token)
    .expect(403);

  await admin.delete(`/api/media/${inside.id}`)
    .set('X-CSRF-Token', adminLogin.token)
    .expect(204);
  await creator.delete(`/api/media/${outside.id}`)
    .set('X-CSRF-Token', creatorLogin.token)
    .expect(204);
});

test('large image uploads in multiple chunks and resumes from uploaded parts', async () => {
  const creator = request.agent(app);
  const { token } = await loginAs(creator, 'creator', 'CreatorPass!2026');
  const raw = Buffer.alloc(1800 * 1200 * 3);
  const crypto = await import('node:crypto');
  crypto.randomFillSync(raw);
  const buffer = await sharp(raw, { raw: { width: 1800, height: 1200, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  assert.ok(buffer.length > 1024 * 1024, 'test image should span multiple chunks');
  const init = await creator.post('/api/media/init')
    .set('X-CSRF-Token', token)
    .send({ filename: 'large-noise.jpg', mime: 'image/jpeg', size: buffer.length })
    .expect(201);
  assert.ok(init.body.totalParts > 1);

  // 只上传第一片，模拟中断。
  await creator.put(`/api/media/upload/${init.body.uploadId}/1`)
    .set('X-CSRF-Token', token)
    .set('Content-Type', 'application/octet-stream')
    .send(buffer.subarray(0, init.body.chunkSize))
    .expect(204);
  const status = await creator.get(`/api/media/upload/${init.body.uploadId}/status`).expect(200);
  assert.deepEqual(status.body.uploadedParts, [1]);

  // 续传其余分片并完成。
  for (let part = 2; part <= init.body.totalParts; part += 1) {
    const start = (part - 1) * init.body.chunkSize;
    const end = Math.min(buffer.length, start + init.body.chunkSize);
    await creator.put(`/api/media/upload/${init.body.uploadId}/${part}`)
      .set('X-CSRF-Token', token)
      .set('Content-Type', 'application/octet-stream')
      .send(buffer.subarray(start, end))
      .expect(204);
  }
  const result = await creator.post('/api/media/complete')
    .set('X-CSRF-Token', token)
    .send({ uploadId: init.body.uploadId })
    .expect(201);
  assert.equal(result.body.media.width, 1800);
  assert.equal(result.body.media.height, 1200);

  await creator.delete(`/api/media/${result.body.media.id}`)
    .set('X-CSRF-Token', token)
    .expect(204);
});

test('rejects spoofed file magic and oversized chunks', async () => {
  const creator = request.agent(app);
  const { token } = await loginAs(creator, 'creator', 'CreatorPass!2026');
  const fake = Buffer.from('this is definitely not a png');
  const init = await creator.post('/api/media/init')
    .set('X-CSRF-Token', token)
    .send({ filename: 'fake.png', mime: 'image/png', size: fake.length })
    .expect(201);
  await creator.put(`/api/media/upload/${init.body.uploadId}/1`)
    .set('X-CSRF-Token', token)
    .set('Content-Type', 'application/octet-stream')
    .send(fake)
    .expect(204);
  await creator.post('/api/media/complete')
    .set('X-CSRF-Token', token)
    .send({ uploadId: init.body.uploadId })
    .expect(415);

  await creator.post('/api/media/init')
    .set('X-CSRF-Token', token)
    .send({ filename: 'evil.svg', mime: 'image/svg+xml', size: 100 })
    .expect(415);

  await creator.post('/api/media/init')
    .set('X-CSRF-Token', token)
    .send({ filename: 'photo.jpg', mime: 'image/jpeg', size: 200 * 1024 * 1024 })
    .expect(413);
});

test('disabled user loses session and uploader cannot access admin API', async () => {
  const admin = request.agent(app);
  const adminLogin = await loginAs(admin, 'admin', 'TestAdmin!2026');
  const users = await admin.get('/api/admin/users').expect(200);
  const guest = users.body.users.find((user) => user.username === 'guest');
  await admin.patch(`/api/admin/users/${guest.id}`)
    .set('X-CSRF-Token', adminLogin.token)
    .send({ status: 'disabled' })
    .expect(200);
  const agent = request.agent(app);
  const token = await bootstrap(agent);
  await agent.post('/api/auth/login')
    .set('X-CSRF-Token', token)
    .send({ username: 'guest', password: 'GuestPass!2026' })
    .expect(403);

  const creator = request.agent(app);
  const creatorLogin = await loginAs(creator, 'creator', 'CreatorPass!2026');
  await creator.get('/api/admin/users').expect(403);
});
