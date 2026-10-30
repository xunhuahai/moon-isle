import './style.css';
import { GalaxyScene } from './galaxy.js';
import { api, ApiError, uploadPart } from './api.js';
import { icons, roleLabel, roleDescription } from './icons.js';
import { controlMethods } from './controls.js';
import { adminMethods } from './admin.js';
import { sceneUiMethods } from './star-gallery.js';
import { wallMethods } from './wall.js';
import { randomId } from './uuid.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
};

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
};

const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const stripExtension = (name) => {
  const clean = String(name || '');
  const index = clean.lastIndexOf('.');
  return index > 0 ? clean.slice(0, index) : clean;
};

const initials = (name) => [...String(name || '？')].slice(0, 2).join('');

const extensionOf = (name) => {
  const index = String(name).lastIndexOf('.');
  return index >= 0 ? String(name).slice(index + 1).toLowerCase() : '';
};

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', mp4: 'video/mp4', m4v: 'video/mp4',
  webm: 'video/webm', mov: 'video/quicktime',
};
const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME_BY_EXT));
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'mov']);
const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const MAX_VIDEO_BYTES = 2048 * 1024 * 1024;

const fileFingerprint = (file) => `${file.name}::${file.size}::${file.lastModified}`;
const uploadStorageKey = (file, zone = 'outside') => `moon-upload:${zone}:${fileFingerprint(file)}`;

class MoonApp {
  constructor() {
    this.state = {
      user: null,
      permissions: { upload: false, moderate: false, manageUsers: false, inside: false },
      media: [],
      total: 0,
      selected: null,
      space: 'outside',
      wallOpen: false,
      warping: false,
      wallFocusOpen: false,
      wallFocusMedia: null,
      wallFocusCard: null,
      wallZoom: 1,
      wallEnterScale: 1,
    };
    this.scene = null;
    this.modals = [];
    this.uploadQueue = [];
    this.uploading = false;
    this.uploadUI = null;
    this.pendingAction = null;
    this.loadingDone = false;
    this.unauthorizedAt = 0;
    this.adminModal = null;

    this.dom = {
      canvas: $('#scene'),
      loading: $('#loadingScreen'),
      loadingText: $('#loadingText'),
      memoryCount: $('#memoryCount'),
      uploadButton: $('#uploadButton'),
      accountButton: $('#accountButton'),
      accountAvatar: $('#accountAvatar'),
      accountLabel: $('#accountLabel'),
      userMenu: $('#userMenu'),
      menuAvatar: $('#menuAvatar'),
      menuName: $('#menuName'),
      menuRole: $('#menuRole'),
      adminButton: $('#adminButton'),
      changePasswordButton: $('#changePasswordButton'),
      logoutButton: $('#logoutButton'),
      emptyState: $('#emptyState'),
      emptyCopy: $('#emptyCopy'),
      emptyAction: $('#emptyAction'),
      hint: $('#hint'),
      hintText: $('#hintText'),
      detailPanel: $('#detailPanel'),
      detailScroll: $('#detailScroll'),
      detailPhotoStage: $('#detailPhotoStage'),
      modalRoot: $('#modalRoot'),
      toastRoot: $('#toastRoot'),
      shortcut: $('#shortcut'),
      zoomDock: $('#zoomDock'),
      zoomPercent: $('#zoomPercent'),
      zoomMode: $('#zoomMode'),
      zoomIn: $('#zoomIn'),
      zoomOut: $('#zoomOut'),
      zoomReset: $('#zoomReset'),
      wallView: $('#wallView'),
      wallStage: $('#wallStage'),
      wallPlane: $('#wallPlane'),
      wallMosaic: $('#wallMosaic'),
      wallSubtitle: $('#wallSubtitle'),
      wallTitle: $('#wallTitle'),
      wallEyebrow: $('#wallEyebrow'),
      wallBackButton: $('#wallBackButton'),
      wallUploadButton: $('#wallUploadButton'),
      wallMenuButton: $('#wallMenuButton'),
      warpOverlay: $('#warpOverlay'),
      warpStreaks: $('#warpStreaks'),
      wallZoom: $('#wallZoom'),
      wallZoomIn: $('#wallZoomIn'),
      wallZoomOut: $('#wallZoomOut'),
      wallZoomReset: $('#wallZoomReset'),
      wallZoomPercent: $('#wallZoomPercent'),
      wallFocus: $('#wallFocus'),
      wallFocusMedia: $('#wallFocusMedia'),
      wallFocusEyebrow: $('#wallFocusEyebrow'),
      wallFocusTitle: $('#wallFocusTitle'),
      wallFocusMeta: $('#wallFocusMeta'),
      wallFocusNote: $('#wallFocusNote'),
      wallFocusDetail: $('#wallFocusDetail'),
    };

    this.bindGlobalEvents();
    this.init();
  }

  async init() {
    try {
      this.scene = new GalaxyScene(this.dom.canvas, {
        onSelect: (media) => this.handleMediaSelect(media),
        onSelectStar: (mediaList) => this.handleStarSelect(mediaList),
        onMoonClick: () => this.handleMoonClick(),
        onRequestClose: () => this.closeDetail(),
        onZoomChange: (percent, reveal) => this.updateZoomUI(percent, reveal),
        onTexturesProgress: (loaded, total) => {
          if (!this.loadingDone && total > 0) {
            this.dom.loadingText.textContent = `正在点亮 ${loaded} / ${total} 颗粒子…`;
          }
        },
      });
      this.updateZoomUI(100, 0);
    } catch (error) {
      console.error(error);
      this.dom.loadingText.textContent = '当前浏览器不支持 WebGL，请更换浏览器或开启图形加速。';
      this.toast('无法启动 3D 场景，请检查浏览器 WebGL 支持', 'error', 6000);
    }

    if (window.matchMedia('(pointer: coarse)').matches) {
      this.dom.hintText.textContent = '双指缩小到 10% 看星海 · 点击月亮登录';
    }

    const tasks = [this.loadSession(), this.loadMedia({ initial: true })];
    await Promise.race([Promise.allSettled(tasks), sleep(7000)]);
    this.hideLoading();
    this.updateEmptyState();
  }

  hideLoading() {
    if (this.loadingDone) return;
    this.loadingDone = true;
    this.dom.loading.classList.add('is-done');
    setTimeout(() => { this.dom.loading.hidden = true; }, 900);
  }

  bindGlobalEvents() {
    this.dom.accountButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!this.state.user) {
        this.openLogin();
        return;
      }
      const willShow = this.dom.userMenu.hidden;
      this.dom.userMenu.hidden = !willShow;
      this.dom.accountButton.setAttribute('aria-expanded', String(willShow));
    });
    this.dom.userMenu.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', () => this.closeUserMenu());
    this.dom.uploadButton.addEventListener('click', () => this.requestUpload());
    this.dom.emptyAction.addEventListener('click', () => this.requestUpload());
    this.dom.adminButton.addEventListener('click', () => { this.closeUserMenu(); this.openAdmin(); });
    this.dom.changePasswordButton.addEventListener('click', () => { this.closeUserMenu(); this.openChangePassword(); });
    this.dom.logoutButton.addEventListener('click', () => { this.closeUserMenu(); this.logout(); });
    this.dom.detailPanel.addEventListener('click', (event) => this.onDetailClick(event));
    this.dom.detailPanel.addEventListener('submit', (event) => event.preventDefault());

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (this.modals.length) { this.closeTopModal(); return; }
        if (this.state.wallFocusOpen) { this.closeWallFocus(); return; }
        if (this.state.selected) { this.closeDetail(); return; }
        if (this.state.wallOpen) { this.closeWall(); return; }
        this.closeUserMenu();
      }
    });

    this.bindSceneUi();
    this.bindWallUi();
    window.addEventListener('moon:unauthorized', () => this.handleUnauthorized());
    window.addEventListener('beforeunload', () => {
      for (const item of this.uploadQueue) {
        if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
      }
    });
  }

  closeUserMenu() {
    this.dom.userMenu.hidden = true;
    this.dom.accountButton.setAttribute('aria-expanded', 'false');
  }

  async loadSession() {
    try {
      const data = await api.me();
      this.state.user = data.user;
      this.state.permissions = data.permissions;
      this.scene?.setAuthenticated(Boolean(data.user));
      this.updateAccountUI();
      return data;
    } catch (error) {
      if (error.status >= 500) this.toast('服务器暂时无法连接', 'error');
      return null;
    }
  }

  async refreshMedia({ silent = false } = {}) {
    try {
      const data = await api.media(300, 0, this.state.space);
      this.state.media = data.media;
      this.state.total = data.total;
      this.updateCount();
      this.updateEmptyState();
      if (this.state.selected) this.closeDetail();
      if (this.scene) {
        try { await this.scene.setMedia(data.media); } catch (error) { console.error(error); }
      }
      if (this.state.wallOpen) this.renderWall();
      return data;
    } catch (error) {
      if (!silent) this.toast(error.message || '照片墙加载失败', 'error');
      console.error(error);
      return null;
    }
  }

  async loadMedia({ initial = false } = {}) {
    try {
      const data = await api.media(300, 0, this.state.space);
      this.state.media = data.media;
      this.state.total = data.total;
      this.updateCount();
      this.updateEmptyState();
      if (this.scene) {
        const loading = this.scene.setMedia(data.media).catch((error) => console.error(error));
        if (initial) await Promise.race([loading, sleep(1900)]);
      }
      return data;
    } catch (error) {
      console.error(error);
      if (initial) this.toast(error.message || '无法读取照片星系', 'error');
      return null;
    }
  }

  updateCount() {
    const count = this.dom.memoryCount.querySelector('b');
    if (count) count.textContent = String(this.state.total);
  }

  updateEmptyState() {
    if (!this.loadingDone && !this.state.total) {
      this.dom.emptyState.hidden = true;
      return;
    }
    const isUploader = this.state.permissions.upload;
    this.dom.emptyState.hidden = this.state.total > 0;
    if (!this.state.user) {
      this.dom.emptyCopy.textContent = '登录后上传第一张照片，让月亮慢慢成形。';
      this.dom.emptyAction.hidden = false;
      this.dom.emptyAction.innerHTML = `${icons.user}<span>登录后上传</span>`;
    } else if (!isUploader) {
      this.dom.emptyCopy.textContent = '当前为只读访客，联系管理员开通上传权限。';
      this.dom.emptyAction.hidden = true;
    } else {
      this.dom.emptyCopy.textContent = '上传第一张照片，让月亮慢慢成形。';
      this.dom.emptyAction.hidden = false;
      this.dom.emptyAction.innerHTML = `${icons.upload}<span>点亮第一颗星</span>`;
    }
  }

  updateAccountUI() {
    const user = this.state.user;
    const canUpload = Boolean(this.state.permissions.upload);
    this.dom.uploadButton.hidden = !canUpload;
    if (user) {
      this.dom.accountLabel.textContent = user.username;
      this.dom.accountAvatar.innerHTML = escapeHtml(initials(user.username));
      this.dom.menuAvatar.textContent = initials(user.username);
      this.dom.menuName.textContent = user.username;
      this.dom.menuRole.textContent = `${roleLabel[user.role]} · ${user.status === 'active' ? '账号正常' : '已停用'}`;
      this.dom.adminButton.hidden = user.role !== 'admin';
      this.dom.wallMenuButton.hidden = !this.state.permissions.inside;
      this.dom.changePasswordButton.hidden = false;
      this.dom.logoutButton.hidden = false;
    } else {
      this.dom.accountLabel.textContent = '登录';
      this.dom.accountAvatar.innerHTML = icons.user;
      this.dom.menuAvatar.textContent = '';
      this.dom.menuName.textContent = '';
      this.dom.menuRole.textContent = '';
      this.dom.userMenu.hidden = true;
      this.dom.wallMenuButton.hidden = true;
      this.dom.accountButton.setAttribute('aria-expanded', 'false');
    }
    if (this.dom.hintText && !this.state.selected) {
      this.dom.hintText.textContent = user
        ? '滚轮缩小到 10% 看星海 · 点击月亮进入照片墙'
        : '滚轮缩小到 10% 看整片星海 · 点击月亮登录';
    }
    this.updateEmptyState();
  }

  requestUpload() {
    if (!this.state.user) {
      this.pendingAction = 'upload';
      this.openLogin('登录后即可把照片放进星海');
      return;
    }
    if (!this.state.permissions.upload) {
      this.toast('当前账号只有浏览权限，请联系管理员开通上传权限', 'error');
      return;
    }
    this.openUpload();
  }

  async logout() {
    try { await api.logout(); } catch { /* 本地仍然清理 */ }
    this.closeWall();
    this.scene?.setAuthenticated(false);
    this.state.user = null;
    this.state.space = 'outside';
    this.state.permissions = { upload: false, moderate: false, manageUsers: false, inside: false };
    this.updateAccountUI();
    if (this.state.selected) this.closeDetail();
    await this.refreshMedia({ silent: true });
    this.toast('已离开，欢迎下次回到月屿');
  }

  handleUnauthorized() {
    if (!this.state.user) return;
    if (Date.now() - this.unauthorizedAt < 1800) return;
    this.unauthorizedAt = Date.now();
    this.closeWall();
    this.scene?.setAuthenticated(false);
    this.state.user = null;
    this.state.space = 'outside';
    this.state.permissions = { upload: false, moderate: false, manageUsers: false, inside: false };
    this.updateAccountUI();
    if (this.state.selected) this.closeDetail();
    this.refreshMedia({ silent: true });
    this.toast('登录状态已过期，请重新登录', 'error');
  }

  onDetailClick(event) {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === 'close') this.closeDetail();
    if (action === 'edit-note') this.beginNoteEdit();
    if (action === 'cancel-note') this.cancelNoteEdit();
    if (action === 'save-note') this.saveNote(actionEl);
    if (action === 'delete-media') this.confirmDelete();
  }

  openDetail(media) {
    const latest = this.state.media.find((entry) => entry.id === media.id) || media;
    this.state.selected = latest;
    this.closeUserMenu();
    this.renderDetail(latest);
    this.dom.detailPanel.classList.add('is-open');
    this.dom.detailPanel.setAttribute('aria-hidden', 'false');
    this.dom.shortcut.hidden = false;
    document.body.classList.add('detail-open');
    this.dom.detailScroll.scrollTop = 0;
    this.scene?.setDetailMode(true);
  }

  closeDetail() {
    if (!this.state.selected && !this.dom.detailPanel.classList.contains('is-open')) return;
    this.dom.detailPanel.querySelectorAll('video').forEach((video) => video.pause());
    this.dom.detailPanel.classList.remove('is-open');
    this.dom.detailPanel.setAttribute('aria-hidden', 'true');
    this.dom.shortcut.hidden = true;
    document.body.classList.remove('detail-open');
    this.state.selected = null;
    this.scene?.setDetailMode(false);
  }

  renderDetail(media) {
    const isVideo = media.type === 'video';
    const noteContent = media.note?.content || '';
    const canEdit = Boolean(media.permissions?.editNote);
    const canDelete = Boolean(media.permissions?.delete);
    const owner = media.owner?.username || '未知';
    const dimensions = media.width && media.height ? `${media.width} × ${media.height}` : '';
    const duration = isVideo ? formatDuration(media.duration) : '';
    const metaParts = [owner, media.zone === 'inside' ? '月亮内部' : '月亮外', formatDate(media.createdAt), dimensions, duration, formatBytes(media.size)].filter(Boolean);
    const updated = media.note?.updatedAt
      ? `备注由 ${escapeHtml(media.note.updatedBy?.username || '管理员')} 更新于 ${formatDateTime(media.note.updatedAt)}`
      : '';
    const mediaMarkup = isVideo
      ? `<video controls playsinline preload="metadata" poster="${escapeHtml(media.urls.thumb)}" src="${escapeHtml(media.urls.source)}"></video>`
      : `<img src="${escapeHtml(media.urls.preview)}" alt="${escapeHtml(media.originalName)}" />`;
    const typeBadge = isVideo
      ? `${icons.play}<span>视频</span>`
      : `${icons.image}<span>照片</span>`;

    if (this.dom.detailPhotoStage) {
      this.dom.detailPhotoStage.innerHTML = `<div class="detail-photo-frame">${mediaMarkup}</div>`;
    }
    this.dom.detailScroll.innerHTML = `
      <div class="detail-head">
        <span class="detail-head-label">MEMORY / ${escapeHtml(media.id.slice(0, 8).toUpperCase())}</span>
        <button class="icon-button" type="button" data-action="close" aria-label="返回星海">${icons.close}</button>
      </div>
      <div class="detail-media">
        ${mediaMarkup}
        <span class="media-badge">${typeBadge}</span>
      </div>
      <div class="detail-body">
        <span class="detail-eyebrow">${formatDate(media.createdAt).toUpperCase()}</span>
        <h2 class="detail-title">${escapeHtml(stripExtension(media.originalName))}</h2>
        <div class="detail-meta">${metaParts.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}</div>
        <div class="note-section">
          <div class="note-label">
            <span>照片备注</span>
            <small id="notePermission">${canEdit ? '可编辑' : '只读'}</small>
          </div>
          <p class="note-content ${noteContent ? '' : 'is-empty'}" id="noteView">${noteContent ? escapeHtml(noteContent) : '还没有备注。留一句话，给未来的自己。'}</p>
          <div class="note-editor" id="noteEditor">
            <textarea id="noteInput" maxlength="2000" placeholder="写下这张照片背后的故事…">${escapeHtml(noteContent)}</textarea>
            <div class="note-buttons">
              <button class="btn btn-primary btn-sm" type="button" data-action="save-note">${icons.check}<span>保存备注</span></button>
              <button class="btn btn-subtle btn-sm" type="button" data-action="cancel-note">取消</button>
            </div>
          </div>
          ${canEdit ? `<button class="note-cta" type="button" data-action="edit-note">${icons.edit}<span>${noteContent ? '修改备注' : '添加备注'}</span></button>` : ''}
        </div>
        <div class="detail-actions">
          ${canDelete ? `<button class="btn btn-danger" type="button" data-action="delete-media">${icons.trash}<span>移出星海</span></button>` : ''}
          <button class="btn btn-subtle" type="button" data-action="close">${this.state.wallOpen ? '返回照片墙' : '返回星海'}</button>
        </div>
        <div class="detail-updated" id="noteUpdated">${updated}</div>
      </div>
    `;
  }

  beginNoteEdit() {
    const view = $('#noteView', this.dom.detailScroll);
    const editor = $('#noteEditor', this.dom.detailScroll);
    const cta = $('[data-action="edit-note"]', this.dom.detailScroll);
    if (!editor) return;
    view.hidden = true;
    if (cta) cta.hidden = true;
    editor.classList.add('is-active');
    const input = $('#noteInput', editor);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  cancelNoteEdit() {
    const view = $('#noteView', this.dom.detailScroll);
    const editor = $('#noteEditor', this.dom.detailScroll);
    const cta = $('[data-action="edit-note"]', this.dom.detailScroll);
    if (!editor) return;
    view.hidden = false;
    if (cta) cta.hidden = false;
    editor.classList.remove('is-active');
    const input = $('#noteInput', editor);
    input.value = this.state.selected?.note?.content || '';
  }

  async saveNote(button) {
    const input = $('#noteInput', this.dom.detailScroll);
    if (!input || !this.state.selected) return;
    button.disabled = true;
    try {
      const data = await api.saveNote(this.state.selected.id, input.value);
      const updated = data.media;
      const index = this.state.media.findIndex((entry) => entry.id === updated.id);
      if (index >= 0) this.state.media[index] = updated;
      this.state.selected = updated;
      const view = $('#noteView', this.dom.detailScroll);
      const editor = $('#noteEditor', this.dom.detailScroll);
      const cta = $('[data-action="edit-note"]', this.dom.detailScroll);
      const empty = !updated.note?.content;
      view.textContent = empty ? '还没有备注。留一句话，给未来的自己。' : updated.note.content;
      view.classList.toggle('is-empty', empty);
      view.hidden = false;
      if (cta) {
        cta.hidden = false;
        const label = cta.querySelector('span');
        if (label) label.textContent = empty ? '添加备注' : '修改备注';
      }
      editor.classList.remove('is-active');
      const updatedEl = $('#noteUpdated', this.dom.detailScroll);
      if (updatedEl) {
        updatedEl.textContent = updated.note?.updatedAt
          ? `备注由 ${updated.note.updatedBy?.username || '管理员'} 更新于 ${formatDateTime(updated.note.updatedAt)}`
          : '';
      }
      if (this.state.wallOpen) this.renderWall();
      this.toast(empty ? '备注已清空' : '备注已保存', 'success');
    } catch (error) {
      this.toast(error.message || '备注保存失败', 'error');
    } finally {
      button.disabled = false;
    }
  }

  confirmDelete() {
    const media = this.state.selected;
    if (!media) return;
    this.openConfirm({
      title: '把这颗记忆移出星海？',
      message: `「${stripExtension(media.originalName)}」将从照片墙中删除，原文件与备注都无法恢复。`,
      confirmText: '确认删除',
      danger: true,
      onConfirm: async () => {
        await api.deleteMedia(media.id);
        this.closeDetail();
        this.toast('记忆已移出星海', 'success');
        await this.refreshMedia({ silent: true });
      },
    });
  }

  openLogin(message = '') {
    if (this.state.user) return;
    const modal = this.openModal({
      className: 'login-modal',
      size: 'small',
      showHead: false,
      closeOnBackdrop: true,
      body: `
        <button class="icon-button login-close" type="button" data-close aria-label="关闭">${icons.close}</button>
        <div class="login-emblem">
          <span class="brand-mark" aria-hidden="true"><i></i></span>
        </div>
        <div class="login-heading">
          <span class="eyebrow">WELCOME BACK TO THE ISLE</span>
          <h2>回到月屿</h2>
          <p>${escapeHtml(message || '登录后，把散落的记忆放回星空。')}</p>
        </div>
        <form id="loginForm" novalidate>
          <div class="field">
            <label for="loginUsername">账号</label>
            <input id="loginUsername" name="username" autocomplete="username" maxlength="64" placeholder="请输入账号" required />
          </div>
          <div class="field">
            <label for="loginPassword">密码</label>
            <input id="loginPassword" name="password" type="password" autocomplete="current-password" maxlength="200" placeholder="请输入密码" required />
          </div>
          <p class="form-error" id="loginError"></p>
          <button class="btn btn-primary btn-block" type="submit" id="loginSubmit">进入星海</button>
        </form>
        <div class="login-secure">${icons.lock}<span>会话通过 HttpOnly Cookie 保护</span></div>
      `,
    });

    const form = $('#loginForm', modal.backdrop);
    const errorEl = $('#loginError', form);
    $('#loginUsername', form).focus();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = $('#loginSubmit', form);
      const username = $('#loginUsername', form).value.trim();
      const password = $('#loginPassword', form).value;
      errorEl.textContent = '';
      if (!username || !password) { errorEl.textContent = '请输入账号和密码'; return; }
      submit.disabled = true;
      submit.textContent = '正在穿过星门…';
      try {
        const data = await api.login(username, password);
        this.state.user = data.user;
        this.state.permissions = data.permissions;
        this.scene?.setAuthenticated(true);
        this.updateAccountUI();
        modal.close();
        this.toast(`欢迎回来，${data.user.username}`, 'success');
        await this.refreshMedia({ silent: true });
        const pending = this.pendingAction;
        this.pendingAction = null;
        if (pending === 'upload') this.openUpload();
        else if (pending === 'admin') this.openAdmin();
        else if (pending === 'wall') {
          if (this.state.permissions.inside) this.enterWall();
          else this.toast('仅管理员可进入', 'error');
        }
      } catch (error) {
        errorEl.textContent = error.message || '登录失败';
        submit.disabled = false;
        submit.textContent = '进入星海';
      }
    });
  }

  openChangePassword() {
    if (!this.state.user) return;
    const modal = this.openModal({
      eyebrow: 'SECURITY',
      title: '修改密码',
      description: '更新后会注销其他登录会话。',
      small: true,
      body: `
        <form id="passwordForm" novalidate>
          <div class="field">
            <label for="currentPassword">当前密码</label>
            <input id="currentPassword" type="password" autocomplete="current-password" required />
          </div>
          <div class="field">
            <label for="newPassword">新密码</label>
            <input id="newPassword" type="password" autocomplete="new-password" minlength="10" required />
            <small>至少 10 位，建议混合大小写、数字与符号。</small>
          </div>
          <div class="field">
            <label for="confirmPassword">确认新密码</label>
            <input id="confirmPassword" type="password" autocomplete="new-password" required />
          </div>
          <p class="form-error" id="passwordError"></p>
          <button class="btn btn-primary btn-block" type="submit" id="passwordSubmit">保存新密码</button>
        </form>
      `,
    });
    const form = $('#passwordForm', modal.backdrop);
    const errorEl = $('#passwordError', form);
    $('#currentPassword', form).focus();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const current = $('#currentPassword', form).value;
      const next = $('#newPassword', form).value;
      const confirm = $('#confirmPassword', form).value;
      errorEl.textContent = '';
      if (next.length < 10) { errorEl.textContent = '新密码至少需要 10 位'; return; }
      if (next !== confirm) { errorEl.textContent = '两次输入的新密码不一致'; return; }
      const submit = $('#passwordSubmit', form);
      submit.disabled = true;
      try {
        await api.changePassword(current, next);
        modal.close();
        this.toast('密码已更新', 'success');
      } catch (error) {
        errorEl.textContent = error.message || '密码修改失败';
        submit.disabled = false;
      }
    });
  }

  openUpload() {
    if (!this.state.permissions.upload) {
      this.toast('没有上传权限', 'error');
      return;
    }
    const zone = this.state.wallOpen && this.state.space === 'inside' ? 'inside' : 'outside';
    if (zone === 'inside' && this.state.user?.role !== 'admin') {
      this.toast('只有管理员可以上传到月亮内部', 'error');
      return;
    }
    this.uploadZone = zone;
    const inside = zone === 'inside';
    const modal = this.openModal({
      eyebrow: inside ? 'INNER MOON · ADMIN ONLY' : 'ADD TO THE GALAXY',
      title: inside ? '把记忆放进月亮内部' : '把记忆放进星海',
      description: inside
        ? '这张照片只会出现在月亮内部，只有管理员可见。'
        : '照片会化作围绕月亮的星星，访客和上传者都能看见。',
      body: `
        <div class="upload-drop" id="uploadDrop" role="button" tabindex="0">
          <span class="upload-drop-icon">${icons.upload}</span>
          <strong>拖入照片或视频</strong>
          <span>或点击这里选择文件</span>
          <em>JPG · PNG · WEBP · GIF · AVIF · MP4 · WEBM · MOV</em>
          <input id="uploadFileInput" type="file" multiple hidden accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.m4v,.webm,.mov,image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime" />
        </div>
        <div class="upload-toolbar">
          <span>上传队列</span>
          <span class="upload-summary" id="uploadSummary">尚未选择文件</span>
        </div>
        <div class="upload-list" id="uploadList"></div>
        <p class="upload-hint">大文件按 8 MB 分片并自动重试。若网络中断，重新打开页面并再次选择同一文件，即可从已上传的分片继续。</p>
      `,
      footer: `
        <button class="btn btn-ghost" type="button" data-close>稍后再传</button>
        <button class="btn btn-primary" type="button" id="uploadChooseButton">${icons.plus}<span>选择文件</span></button>
      `,
      onClose: () => { this.uploadUI = null; },
    });

    const body = $('.modal-body', modal.backdrop);
    const drop = $('#uploadDrop', body);
    const input = $('#uploadFileInput', body);
    this.uploadUI = {
      modal,
      list: $('#uploadList', body),
      summary: $('#uploadSummary', body),
      zone,
    };

    const selectFiles = () => input.click();
    drop.addEventListener('click', selectFiles);
    drop.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectFiles(); }
    });
    $('#uploadChooseButton', modal.backdrop).addEventListener('click', selectFiles);
    input.addEventListener('change', () => {
      this.addUploadFiles([...input.files]);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach((name) => drop.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.add('is-drag');
    }));
    ['dragleave', 'drop'].forEach((name) => drop.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.remove('is-drag');
    }));
    drop.addEventListener('drop', (event) => {
      if (event.dataTransfer?.files?.length) this.addUploadFiles([...event.dataTransfer.files]);
    });
    this.uploadUI.list.addEventListener('click', (event) => {
      const action = event.target.closest('[data-upload-action]');
      if (!action) return;
      const item = this.uploadQueue.find((entry) => entry.id === action.dataset.uploadId);
      if (!item) return;
      if (action.dataset.uploadAction === 'remove' && item.status !== 'uploading') this.removeUploadItem(item);
      if (action.dataset.uploadAction === 'retry' && item.status === 'error') {
        item.status = 'pending';
        item.error = null;
        this.renderUploadQueue();
        this.startUploads();
      }
    });
    this.renderUploadQueue();
    if (this.uploadQueue.some((item) => item.status === 'pending') && !this.uploading) this.startUploads();
  }

  addUploadFiles(files) {
    let added = 0;
    for (const file of files) {
      const ext = extensionOf(file.name);
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        this.toast(`不支持的文件类型：${file.name}`, 'error');
        continue;
      }
      const zone = this.uploadUI?.zone || this.uploadZone || 'outside';
      const duplicate = this.uploadQueue.some((item) => item.status !== 'done' && item.zone === zone && fileFingerprint(item.file) === fileFingerprint(file));
      if (duplicate) continue;
      const isVideo = VIDEO_EXTENSIONS.has(ext);
      const tooLarge = file.size > (isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES);
      const item = {
        id: randomId(),
        file,
        zone: this.uploadUI?.zone || this.uploadZone || 'outside',
        isVideo,
        objectUrl: !isVideo && file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
        status: tooLarge ? 'error' : 'pending',
        error: tooLarge ? `文件超过 ${isVideo ? '2048 MB' : '80 MB'} 限制` : '',
        progress: 0,
        uploadId: null,
      };
      this.uploadQueue.push(item);
      if (!tooLarge) added += 1;
    }
    if (added) this.toast(`已加入 ${added} 个文件`, 'success', 1800);
    this.renderUploadQueue();
    if (added) this.startUploads();
  }

  removeUploadItem(item) {
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    this.uploadQueue = this.uploadQueue.filter((entry) => entry.id !== item.id);
    this.renderUploadQueue();
  }

  renderUploadQueue() {
    if (!this.uploadUI?.list) return;
    const list = this.uploadUI.list;
    const summary = this.uploadUI.summary;
    if (!this.uploadQueue.length) {
      list.innerHTML = '<p class="form-note" style="padding: 9px 2px;">还没有选择文件。一次可以选择多张照片或视频。</p>';
      summary.textContent = '尚未选择文件';
      return;
    }
    const done = this.uploadQueue.filter((item) => item.status === 'done').length;
    const failed = this.uploadQueue.filter((item) => item.status === 'error').length;
    summary.innerHTML = `已完成 <b>${done}</b> / ${this.uploadQueue.length}${failed ? ` · <span style="color:#ffb1a3">${failed} 个需重试</span>` : ''}`;
    list.innerHTML = this.uploadQueue.map((item) => {
      const stateLabel = item.status === 'uploading'
        ? `${Math.round(item.progress * 100)}%`
        : item.status === 'done' ? '已就位'
          : item.status === 'error' ? '失败' : '等待';
      const canRemove = item.status !== 'uploading';
      const thumb = item.objectUrl
        ? `<img class="upload-thumb" src="${escapeHtml(item.objectUrl)}" alt="" />`
        : `<span class="upload-thumb video">${item.isVideo ? icons.video : icons.image}</span>`;
      return `
        <div class="upload-item" data-upload-id="${item.id}">
          ${thumb}
          <div class="upload-info">
            <span class="upload-name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</span>
            <div class="upload-meta"><span>${formatBytes(item.file.size)}</span><span class="upload-state ${item.status === 'error' ? 'error' : item.status === 'done' ? 'done' : item.status === 'uploading' ? 'saving' : ''}">${stateLabel}</span></div>
            <div class="upload-bar"><i style="width:${clamp(item.progress * 100, 0, 100)}%"></i></div>
            ${item.error ? `<span class="upload-state error" style="display:block;margin-top:5px;white-space:normal;">${escapeHtml(item.error)}</span>` : ''}
          </div>
          <div class="upload-remove-actions">
            ${item.status === 'error' ? `<button class="upload-state error" type="button" data-upload-action="retry" data-upload-id="${item.id}" style="padding:4px;">重试</button>` : ''}
            ${canRemove ? `<button class="upload-remove" type="button" data-upload-action="remove" data-upload-id="${item.id}" aria-label="移除">${icons.close}</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  updateUploadRow(item) {
    if (!this.uploadUI?.list) return;
    const row = this.uploadUI.list.querySelector(`[data-upload-id="${item.id}"]`);
    if (!row) return;
    const state = $('.upload-state', row);
    if (state) {
      state.textContent = item.status === 'uploading'
        ? `${Math.round(item.progress * 100)}%`
        : item.status === 'done' ? '已就位' : item.status === 'error' ? '失败' : '等待';
      state.className = `upload-state ${item.status === 'error' ? 'error' : item.status === 'done' ? 'done' : item.status === 'uploading' ? 'saving' : ''}`;
    }
    const bar = $('.upload-bar i', row);
    if (bar) bar.style.width = `${clamp(item.progress * 100, 0, 100)}%`;
  }

  async startUploads() {
    if (this.uploading) return;
    this.uploading = true;
    let successCount = 0;
    try {
      while (true) {
        const item = this.uploadQueue.find((entry) => entry.status === 'pending');
        if (!item) break;
        const ok = await this.uploadOne(item);
        if (ok) successCount += 1;
      }
    } finally {
      this.uploading = false;
    }
    if (successCount > 0) {
      await this.refreshMedia({ silent: true });
      const failed = this.uploadQueue.filter((item) => item.status === 'error').length;
      const insideCount = this.uploadQueue.filter((item) => item.status === 'done' && item.zone === 'inside').length;
      const destination = insideCount === successCount && insideCount > 0 ? '月亮内部' : '星海';
      this.toast(failed ? `已上传 ${successCount} 个，${failed} 个需要重试` : `${successCount} 颗新记忆已进入${destination}`, failed ? 'error' : 'success', 4200);
    }
  }

  async uploadOne(item) {
    item.status = 'uploading';
    item.error = '';
    item.progress = 0;
    this.renderUploadQueue();
    const storageKey = uploadStorageKey(item.file, item.zone || this.uploadZone || 'outside');
    try {
      let info = null;
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (saved?.uploadId) {
          try {
            const status = await api.uploadStatus(saved.uploadId);
            if (status.complete) {
              localStorage.removeItem(storageKey);
              item.status = 'done';
              item.progress = 1;
              this.renderUploadQueue();
              return true;
            }
            if (status.status === 'open' && status.size === item.file.size) info = status;
            else localStorage.removeItem(storageKey);
          } catch (error) {
            if (error.status !== 404 && error.status !== 403) throw error;
            localStorage.removeItem(storageKey);
          }
        }
      } catch { localStorage.removeItem(storageKey); }

      if (!info) {
        info = await api.initUpload({
          filename: item.file.name,
          mime: item.file.type || MIME_BY_EXT[extensionOf(item.file.name)] || '',
          size: item.file.size,
          zone: item.zone || this.uploadZone || 'outside',
        });
        localStorage.setItem(storageKey, JSON.stringify({ uploadId: info.uploadId, createdAt: Date.now() }));
      }
      item.uploadId = info.uploadId;
      const uploaded = new Set(info.uploadedParts || []);
      let completedBytes = 0;
      for (let part = 1; part <= info.totalParts; part += 1) {
        if (uploaded.has(part)) {
          completedBytes += Math.min(info.chunkSize, item.file.size - (part - 1) * info.chunkSize);
        }
      }
      item.progress = completedBytes / item.file.size;
      this.updateUploadRow(item);
      this.renderUploadQueueSummary();

      for (let part = 1; part <= info.totalParts; part += 1) {
        if (uploaded.has(part)) continue;
        const start = (part - 1) * info.chunkSize;
        const end = Math.min(item.file.size, start + info.chunkSize);
        const blob = item.file.slice(start, end);
        let attempt = 0;
        while (true) {
          try {
            await uploadPart({
              uploadId: info.uploadId,
              part,
              blob,
              onProgress: (loaded) => {
                item.progress = clamp((start + loaded) / item.file.size, 0, 0.999);
                this.updateUploadRow(item);
              },
            });
            break;
          } catch (error) {
            if (error.status === 401 || error.status === 403 || error.status === 413 || error.status === 415) throw error;
            attempt += 1;
            if (attempt >= 3) throw new ApiError(error.status, error.code, `第 ${part} 个分片重试 3 次仍失败：${error.message}`);
            await sleep(700 * attempt);
          }
        }
        uploaded.add(part);
        item.progress = clamp(end / item.file.size, 0, 0.999);
        this.updateUploadRow(item);
      }

      item.progress = 0.985;
      this.updateUploadRow(item);
      let completeResult = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          completeResult = await api.completeUpload(info.uploadId);
          break;
        } catch (error) {
          if (attempt >= 3) throw error;
          await sleep(600 * attempt);
        }
      }
      localStorage.removeItem(storageKey);
      item.status = 'done';
      item.progress = 1;
      item.media = completeResult?.media;
      this.updateUploadRow(item);
      this.renderUploadQueueSummary();
      return true;
    } catch (error) {
      console.error(error);
      if ([400, 413, 415].includes(error.status)) localStorage.removeItem(storageKey);
      item.status = 'error';
      item.error = error.message || '上传失败，可重试续传';
      this.updateUploadRow(item);
      this.renderUploadQueueSummary();
      return false;
    }
  }

  renderUploadQueueSummary() {
    if (!this.uploadUI?.summary) return;
    const done = this.uploadQueue.filter((item) => item.status === 'done').length;
    const failed = this.uploadQueue.filter((item) => item.status === 'error').length;
    this.uploadUI.summary.innerHTML = `已完成 <b>${done}</b> / ${this.uploadQueue.length}${failed ? ` · <span style="color:#ffb1a3">${failed} 个需重试</span>` : ''}`;
  }

}

Object.assign(MoonApp.prototype, controlMethods, adminMethods, sceneUiMethods, wallMethods);
window.__moonApp = new MoonApp();
