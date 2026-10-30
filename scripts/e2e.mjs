import { chromium } from 'playwright-core';
import sharp from 'sharp';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const base = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
if (!adminPassword) throw new Error('请设置 E2E_ADMIN_PASSWORD');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (error) => errors.push(error.message));

fs.mkdirSync('preview', { recursive: true });
const uploadPath = 'preview/e2e-upload.jpg';
await sharp({
  create: { width: 900, height: 600, channels: 3, background: '#5a7590' },
}).composite([{
  input: Buffer.from('<svg width="900" height="600"><rect width="900" height="600" fill="#446b82"/><circle cx="660" cy="190" r="95" fill="#f2d49c"/><path d="M0 470 Q220 350 420 460 T900 430 V600 H0Z" fill="#0a111d"/></svg>'),
  top: 0, left: 0,
}]).jpeg({ quality: 88 }).toFile(uploadPath);

await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3500);
assert.equal(await page.locator('#loadingScreen').isHidden(), true, 'loading screen should disappear');
const initialCount = Number(await page.locator('#memoryCount b').innerText());
assert.ok(initialCount > 0, 'demo media should be seeded');

// Star orbits move in 3D, and the moon is a huge solid body.
const orbitCheck = await page.evaluate(async () => {
  const scene = window.__moonApp.scene;
  const before = scene.orbiters.map((orbiter) => orbiter.spinner.rotation.y);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const changed = scene.orbiters.some((orbiter, index) => Math.abs(orbiter.spinner.rotation.y - before[index]) > 0.0005);
  return {
    count: scene.orbiters.length, moonScale: scene.moonGroup.scale.x, changed,
    hasMoonSphere: Boolean(scene.moonSphere),
    zoomRatio: scene.zoomMax / scene.baseDistance,
    floating: (scene.driftingMotes?.geometry.attributes.position.count || 0) + (scene.megaMotes?.geometry.attributes.position.count || 0),
  };
});
assert.ok(orbitCheck.count >= 8, 'there should be many colorful star orbits');
assert.ok(orbitCheck.moonScale > 1.2, 'the central moon should be enlarged');
assert.equal(orbitCheck.hasMoonSphere, true, 'the moon should be a real 3D body');
assert.equal(orbitCheck.changed, true, 'star orbits should move over time');
assert.ok(orbitCheck.zoomRatio >= 9.9, 'zoom should reach 10%');
assert.ok(orbitCheck.floating > 1500, 'there should be many floating particles');

// Photos remain hidden while logged out. Zooming out should reveal a wider cosmos down to 10%.
const lockedDetail = await page.evaluate(() => window.__moonApp.scene.cards[0].material.uniforms.uDetail.value);
assert.ok(lockedDetail < 0.05, 'visitor should see particles, not photos');
for (let i = 0; i < 4; i += 1) await page.locator('#zoomOut').click();
await page.waitForTimeout(900);
const midPercent = Number.parseInt(await page.locator('#zoomPercent').innerText(), 10);
assert.ok(midPercent < 80, 'zoom out control should reduce the percentage');
await page.evaluate(() => { window.__moonApp.scene.zoomTarget = window.__moonApp.scene.zoomMax; });
await page.waitForTimeout(1800);
const farPercent = Number.parseInt(await page.locator('#zoomPercent').innerText(), 10);
const lockedAfterZoom = await page.evaluate(() => window.__moonApp.scene.cards[0].material.uniforms.uDetail.value);
assert.ok(farPercent <= 11, 'zoom should reach the 10% cosmos view');
assert.ok(lockedAfterZoom < 0.08, 'visitor photos must stay hidden even at 10%');
await page.locator('#zoomReset').click();
await page.waitForTimeout(900);

// Clicking a star while logged out must do nothing (only the moon opens login).
const guestStar = await page.evaluate(() => {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  return window.__moonApp.scene.getStarScreenPositions()
    .filter((item) => item.visible)
    .sort((a, b) => Math.hypot(b.x - cx, b.y - cy) - Math.hypot(a.x - cx, a.y - cy))[0];
});
assert.ok(guestStar, 'expected a visible star');
await page.mouse.click(guestStar.x, guestStar.y);
await page.waitForTimeout(350);
assert.equal(await page.locator('#loginForm').isVisible(), false, 'guest star click must not open login');
assert.equal(await page.locator('.star-gallery-grid').isVisible(), false, 'guest star click must not open gallery');

// Clicking the giant central moon opens login; after admin login it enters the private inside wall.
await page.mouse.click(720, 450);
await page.waitForTimeout(500);
assert.equal(await page.locator('#loginForm').isVisible(), true, 'moon should open the login prompt');
await page.locator('#loginUsername').fill('admin');
await page.locator('#loginPassword').fill(adminPassword);
await page.locator('#loginSubmit').click();
await page.locator('#wallView.is-open').waitFor({ state: 'visible', timeout: 15000 });
assert.equal(await page.locator('#accountLabel').innerText(), 'admin');
assert.ok((await page.locator('#wallTitle').innerText()).includes('月亮内部'), 'moon should open the private inside wall');
assert.equal(await page.locator('#wallSpaceSwitch').count(), 0, 'the old outside/inside switch should be removed');

const insideBefore = await page.locator('.wall-card').count();

// Wall zoom UI.
await page.locator('#wallZoomOut').click();
await page.waitForTimeout(450);
const wallZoomAfterOut = Number.parseInt(await page.locator('#wallZoomPercent').innerText(), 10);
assert.ok(wallZoomAfterOut < 100, 'wall zoom-out should reduce the wall scale');
await page.locator('#wallZoomReset').click();
await page.waitForTimeout(350);
assert.equal(await page.locator('#wallZoomPercent').innerText(), '100%');

// Upload one private inside photo through the inside wall.
await page.locator('#wallUploadButton').click();
await page.locator('#uploadFileInput').setInputFiles(uploadPath);
await page.waitForFunction(() => document.querySelector('.upload-state.done') !== null, null, { timeout: 30000 });
await page.waitForTimeout(1400);
await page.locator('.modal-foot [data-close]').click();
await page.waitForTimeout(1200);
assert.equal(await page.locator('.wall-card').count(), insideBefore + 1, 'inside upload should add one inside photo');

// Hover, focus and full detail from the inside wall.
const wallPoint = await page.evaluate(() => {
  for (const card of document.querySelectorAll('.wall-card')) {
    const r = card.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x > 80 && x < innerWidth - 80 && y > 180 && y < innerHeight - 100) return { x, y };
  }
  return null;
});
assert.ok(wallPoint, 'expected a clickable inside wall photo');
await page.mouse.move(wallPoint.x, wallPoint.y);
await page.waitForTimeout(600);
assert.equal(await page.locator('.wall-card.is-hovered').count(), 1, 'hovered inside photo should pop out');
assert.equal(await page.locator('.wall-plane').evaluate((el) => el.classList.contains('has-hover')), true, 'other inside photos should dim on hover');
await page.mouse.click(wallPoint.x, wallPoint.y);
await page.waitForTimeout(550);
assert.equal(await page.locator('#wallFocus').evaluate((el) => el.classList.contains('is-open')), true, 'inside photo should highlight');
await page.locator('#wallFocusDetail').click();
await page.waitForTimeout(700);
assert.equal(await page.locator('#detailPanel').getAttribute('aria-hidden'), 'false', 'inside photo detail should open');

// Delete the temporary inside photo and return to the outside star field.
await page.locator('[data-action="delete-media"]').click();
await page.locator('#confirmAction').click();
await page.waitForTimeout(1800);
assert.equal(await page.locator('.wall-card').count(), insideBefore, 'inside delete should restore the inside count');
await page.locator('#wallBackButton').click();
await page.waitForTimeout(1000);
assert.equal(await page.locator('#wallView').getAttribute('aria-hidden'), 'true');
assert.equal(Number(await page.locator('#memoryCount b').innerText()), initialCount, 'closing the wall should restore outside media');

// 每颗星星最多一张照片：点击星星直接打开这张照片的详情。
const starPoint = await page.evaluate(() => {
  const app = window.__moonApp;
  const scene = app?.scene;
  if (!scene) return null;
  const positions = scene.getStarScreenPositions();
  return positions.map((position, index) => ({
    ...position,
    count: scene.starHitTargets[index]?.userData?.starMedia?.length || 0,
  })).find((item) => item.count === 1 && item.visible && item.x > 80 && item.x < innerWidth - 80 && item.y > 100 && item.y < innerHeight - 80) || null;
});
assert.ok(starPoint, 'expected a visible one-photo star');
await page.mouse.click(starPoint.x, starPoint.y);
await page.waitForTimeout(600);
assert.equal(await page.locator('#detailPanel').evaluate((el) => el.classList.contains('is-open')), true, 'one-photo star should open its detail');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Upload through the outside topbar: the only result should be a new star, never an outside wall.
await page.locator('#uploadButton').click();
await page.locator('#uploadFileInput').setInputFiles(uploadPath);
await page.waitForFunction(() => document.querySelector('.upload-state.done') !== null, null, { timeout: 30000 });
await page.waitForTimeout(1600);
assert.equal(Number(await page.locator('#memoryCount b').innerText()), initialCount + 1, 'outside upload should add one star');
assert.equal(await page.locator('#wallView').getAttribute('aria-hidden'), 'true', 'outside upload must not open a wall');
await page.locator('.modal-foot [data-close]').click();
await page.waitForTimeout(500);

// Open newest outside media, edit note, save, then delete it.
await page.evaluate(() => window.__moonApp.openDetail(window.__moonApp.state.media[0]));
await page.waitForTimeout(1100);
await page.locator('[data-action="edit-note"]').click();
await page.locator('#noteInput').fill('端到端测试备注：月光落在新的一页。');
await page.locator('[data-action="save-note"]').click();
await page.waitForTimeout(900);
assert.match(await page.locator('#noteView').innerText(), /端到端测试备注/);

await page.locator('[data-action="delete-media"]').click();
await page.locator('#confirmAction').click();
await page.waitForTimeout(1800);
assert.equal(Number(await page.locator('#memoryCount b').innerText()), initialCount, 'delete should restore outside count');
assert.equal(await page.locator('#detailPanel').getAttribute('aria-hidden'), 'true');

await page.screenshot({ path: 'preview/e2e-final.png' });
assert.deepEqual(errors, [], 'browser console should have no errors');
console.log('E2E OK: cosmic zoom, one-photo stars, star gate, inside-only wall, inside upload/delete, outside star upload, note edit');
await browser.close();
