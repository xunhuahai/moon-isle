import { icons } from './icons.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const stripExtension = (name) => {
  const clean = String(name || '');
  const index = clean.lastIndexOf('.');
  return index > 0 ? clean.slice(0, index) : clean;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const formatShortDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
};

export const wallMethods = {
  bindWallUi() {
    this.dom.wallBackButton?.addEventListener('click', () => this.closeWall());
    this.dom.wallUploadButton?.addEventListener('click', () => this.requestUpload());
    this.dom.wallMenuButton?.addEventListener('click', () => {
      this.closeUserMenu();
      this.handleMoonClick();
    });
    let resizeTimer;
    window.addEventListener('resize', () => {
      if (!this.state.wallOpen) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.renderWall(), 160);
    });
    this.dom.wallPlane?.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.wall-card')) event.stopPropagation();
    });
    this.dom.wallStage?.addEventListener('click', (event) => {
      if (this.state.wallFocusOpen) return;
      const direct = event.target.closest('[data-wall-media]');
      const card = direct || this.findWallCardAt(event.clientX, event.clientY);
      if (!card) return;
      if (!direct && this.wallDragMoved) return;
      const media = this.state.media.find((entry) => entry.id === card.dataset.wallMedia);
      if (media) this.openWallFocus(media, card);
    });
    // 最后一道兜底：即使 3D 命中测试把 click 判给了 stage/背景，
    // 只要点击位置落在某张照片的投影区域内，就打开照片。
    document.addEventListener('click', (event) => {
      if (!this.state.wallOpen || this.state.wallFocusOpen) return;
      if (!this.dom.wallView.contains(event.target)) return;
      if (event.target.closest('.wall-head, .wall-zoom, .wall-focus')) return;
      const card = event.target.closest('[data-wall-media]') || this.findWallCardAt(event.clientX, event.clientY);
      if (!card) return;
      const media = this.state.media.find((entry) => entry.id === card.dataset.wallMedia);
      if (media) this.openWallFocus(media, card);
    });
    this.dom.wallStage?.addEventListener('pointermove', (event) => {
      if (event.buttons || this.state.wallFocusOpen) return;
      const direct = event.target.closest('[data-wall-media]');
      const card = direct || this.findWallCardAt(event.clientX, event.clientY, 18);
      this.setWallHover(card);
    });
    this.dom.wallStage?.addEventListener('pointerleave', () => this.setWallHover(null));
    this.dom.wallZoomIn?.addEventListener('click', () => this.wallZoomStep(1));
    this.dom.wallZoomOut?.addEventListener('click', () => this.wallZoomStep(-1));
    this.dom.wallZoomReset?.addEventListener('click', () => this.resetWallZoom());
    this.dom.wallFocus?.addEventListener('click', (event) => {
      if (event.target.closest('[data-wall-close]')) this.closeWallFocus();
    });
    this.dom.wallFocusDetail?.addEventListener('click', () => {
      const media = this.state.wallFocusMedia;
      if (!media) return;
      this.closeWallFocus();
      this.openDetail(media);
    });
    this.bindWallTilt();
    this.buildWarpStreaks();
  },

  setWallHover(card) {
    if (this._wallHoveredCard === card) return;
    this._wallHoveredCard?.classList.remove('is-hovered');
    this._wallHoveredCard = card || null;
    if (card) {
      card.classList.add('is-hovered');
      this.dom.wallPlane?.classList.add('has-hover');
    } else {
      this.dom.wallPlane?.classList.remove('has-hover');
    }
  },

  findWallCardAt(clientX, clientY, nearestLimit = 120) {
    if (!this.dom.wallPlane) return null;
    const cards = [...this.dom.wallPlane.querySelectorAll('[data-wall-media]')];
    let hit = null;
    let hitArea = Infinity;
    let nearest = null;
    let nearestDistance = nearestLimit;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (
        clientX >= rect.left - 5 && clientX <= rect.right + 5
        && clientY >= rect.top - 5 && clientY <= rect.bottom + 5
      ) {
        const area = rect.width * rect.height;
        if (area < hitArea) { hit = card; hitArea = area; }
      }
      const distance = Math.hypot(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2));
      if (distance < nearestDistance) { nearest = card; nearestDistance = distance; }
    }
    // 3D 变换下命中测试偶尔会落到 stage 背景；用投影包围盒兜底。
    return hit || nearest;
  },

  bindWallTilt() {
    const stage = this.dom.wallStage;
    const view = this.dom.wallView;
    if (!stage || !view) return;
    // 平面模式：不再让整墙随鼠标/拖动旋转，保留滚轮纵向浏览。
    return;
    let drag = null;
    stage.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') return;
      if (event.target.closest('.wall-card') || event.target.closest('button')) return;
      drag = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, tiltX: 0, tiltY: 0 };
      this.wallDragMoved = false;
      stage.setPointerCapture?.(event.pointerId);
      view.classList.add('is-dragging');
    });
    stage.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) {
        this.wallDragMoved = true;
      }
      const tiltX = Math.max(-6, Math.min(8, drag.tiltX + dy * 0.014));
      const tiltY = Math.max(-7, Math.min(7, drag.tiltY + dx * 0.012));
      view.style.setProperty('--wall-tilt-x', tiltX + 'deg');
      view.style.setProperty('--wall-tilt-y', tiltY + 'deg');
    });
    const endDrag = () => {
      drag = null;
      view.classList.remove('is-dragging');
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('pointerleave', () => { if (drag) endDrag(); });
    stage.addEventListener('dblclick', (event) => {
      if (event.target.closest('.wall-card')) return;
      view.style.setProperty('--wall-tilt-x', '0deg');
      view.style.setProperty('--wall-tilt-y', '0deg');
    });
    view.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch' || drag) return;
      // 鼠标停在卡片上时冻结视差，避免卡片从光标下“滑走”导致点不中。
      if (event.target.closest('.wall-card')) return;
      const px = (event.clientX / window.innerWidth - 0.5) * 2;
      const py = (event.clientY / window.innerHeight - 0.5) * 2;
      view.style.setProperty('--wall-px', (px * 4.4).toFixed(2) + 'deg');
      view.style.setProperty('--wall-py', (-py * 3.1).toFixed(2) + 'deg');
    });
    view.addEventListener('pointerleave', () => {
      if (drag) return;
      view.style.setProperty('--wall-px', '0deg');
      view.style.setProperty('--wall-py', '0deg');
    });
  },

  async handleMoonClick() {
    if (!this.state.user) {
      this.pendingAction = 'wall';
      this.openLogin('登录后进入月亮内部');
      return;
    }
    if (!this.state.permissions.inside) {
      this.toast('仅管理员可进入', 'error');
      return;
    }
    this.enterWall();
  },

  syncWallSpaceUI() {
    this.dom.wallView?.classList.add('is-inside');
    if (this.dom.wallTitle) this.dom.wallTitle.textContent = '月亮内部';
    if (this.dom.wallEyebrow) this.dom.wallEyebrow.textContent = 'INNER MOON · PRIVATE WALL';
    const isAdmin = this.state.user?.role === 'admin';
    if (this.dom.wallUploadButton) {
      this.dom.wallUploadButton.hidden = !isAdmin || !this.state.permissions?.upload;
    }
    const label = this.dom.wallUploadButton?.querySelector('span');
    if (label) label.textContent = '放入月亮内部';
    const hint = this.dom.wallView?.querySelector('.wall-hint span:last-child');
    if (hint) hint.textContent = '仅管理员与获授权成员可见 · 滚轮浏览 · 点击照片放大查看';
  },

  handleMediaSelect(media) {
    // 只有点击月亮才触发登录；游客点击星星/照片不弹登录。
    if (!this.state.user) return;
    this.openDetail(media);
  },

  handleStarSelect(mediaList) {
    if (!this.state.user) return;
    this.openStarGallery(mediaList);
  },

  applyWallScale() {
    if (!this.dom.wallView) return;
    const base = 1;
    const scale = base * this.state.wallZoom * this.state.wallEnterScale;
    this.dom.wallView.style.setProperty('--wall-scale', scale.toFixed(4));
  },

  updateWallZoomUI() {
    const percent = Math.round(this.state.wallZoom * 100);
    if (this.dom.wallZoomPercent) this.dom.wallZoomPercent.textContent = percent + '%';
    if (this.dom.wallZoomIn) this.dom.wallZoomIn.disabled = this.state.wallZoom >= 1.6;
    if (this.dom.wallZoomOut) this.dom.wallZoomOut.disabled = this.state.wallZoom <= 0.7;
  },

  wallZoomStep(direction) {
    this.setWallZoom(this.state.wallZoom + direction * 0.12);
  },

  setWallZoom(value) {
    this.state.wallZoom = clamp(Number(value) || 1, 0.7, 1.6);
    this.applyWallScale();
    this.updateWallZoomUI();
  },

  resetWallZoom() {
    this.setWallZoom(1);
  },

  openWallFocus(media, card) {
    if (!media || !this.state.user) return;
    this.closeWallFocus();
    this.state.wallFocusOpen = true;
    this.state.wallFocusMedia = media;
    this.state.wallFocusCard = card || null;
    const isVideo = media.type === 'video';
    const note = media.note?.content?.trim();
    if (this.dom.wallFocusMedia) {
      this.dom.wallFocusMedia.innerHTML = isVideo
        ? `<video controls playsinline preload="metadata" poster="${escapeHtml(media.urls.thumb)}" src="${escapeHtml(media.urls.source)}"></video>`
        : `<img src="${escapeHtml(media.urls.preview)}" alt="${escapeHtml(media.originalName)}" />`;
    }
    if (this.dom.wallFocusEyebrow) this.dom.wallFocusEyebrow.textContent = isVideo ? 'VIDEO IN FOCUS' : 'PHOTO IN FOCUS';
    if (this.dom.wallFocusTitle) this.dom.wallFocusTitle.textContent = stripExtension(media.originalName);
    if (this.dom.wallFocusMeta) {
      this.dom.wallFocusMeta.textContent = `${media.owner?.username || '未知'} · ${formatShortDate(media.createdAt)} · ${isVideo ? '视频' : '照片'}`;
    }
    if (this.dom.wallFocusNote) this.dom.wallFocusNote.textContent = note || '这张照片还没有备注。';
    this.dom.wallFocus?.classList.add('is-open');
    this.dom.wallFocus?.setAttribute('aria-hidden', 'false');
    card?.classList.add('is-selected');
    document.body.classList.add('wall-focus-open');
  },

  closeWallFocus() {
    if (!this.state.wallFocusOpen) return;
    this.state.wallFocusOpen = false;
    this.state.wallFocusMedia = null;
    this.state.wallFocusCard?.classList.remove('is-selected');
    this.state.wallFocusCard = null;
    this.dom.wallFocus?.querySelectorAll('video').forEach((video) => video.pause());
    this.dom.wallFocus?.classList.remove('is-open');
    this.dom.wallFocus?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('wall-focus-open');
  },

  buildWarpStreaks() {
    const root = this.dom.warpStreaks;
    if (!root || root.childElementCount) return;
    const colors = ['#fff1c6', '#9fdcff', '#c9a7ff', '#8fffe0', '#ff9fc8', '#ffc46b'];
    for (let i = 0; i < 110; i += 1) {
      const streak = document.createElement('span');
      streak.className = 'warp-streak';
      streak.style.setProperty('--a', `${(Math.random() * 360).toFixed(1)}deg`);
      streak.style.setProperty('--l', `${(24 + Math.random() * 170).toFixed(1)}px`);
      const distance = 4 + Math.random() * 38;
      streak.style.setProperty('--d1', `${distance.toFixed(1)}vmax`);
      streak.style.setProperty('--d2', `${(distance * 2.1).toFixed(1)}vmax`);
      streak.style.setProperty('--w', `${(0.7 + Math.random() * 2.2).toFixed(2)}px`);
      streak.style.setProperty('--c', colors[i % colors.length]);
      streak.style.setProperty('--delay', `${(Math.random() * 0.32).toFixed(2)}s`);
      streak.style.setProperty('--dur', `${(0.5 + Math.random() * 0.55).toFixed(2)}s`);
      root.appendChild(streak);
    }
  },

  async enterWall() {
    if (!this.state.user) {
      this.pendingAction = 'wall';
      this.openLogin('登录后进入月亮内部');
      return;
    }
    if (!this.state.permissions.inside) {
      this.toast('仅管理员可进入', 'error');
      return;
    }
    if (this.state.wallOpen || this.state.warping) return;
    if (this.state.space !== 'inside') {
      this.state.space = 'inside';
      await this.refreshMedia({ silent: true });
    }
    this.playWarpTransition();
  },

  playWarpTransition() {
    const overlay = this.dom.warpOverlay;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!overlay || reduced) {
      this.openWall();
      return;
    }
    clearTimeout(this.warpOpenTimer);
    clearTimeout(this.warpEndTimer);
    this.state.warping = true;
    overlay.classList.remove('is-active');
    void overlay.offsetWidth;
    overlay.classList.add('is-active');
    this.warpOpenTimer = window.setTimeout(() => {
      if (this.state.user) this.openWall();
    }, 640);
    this.warpEndTimer = window.setTimeout(() => {
      overlay.classList.remove('is-active');
      this.state.warping = false;
    }, 1480);
  },

  openWall() {
    if (!this.state.permissions.inside) {
      this.toast('仅管理员可进入', 'error');
      return;
    }
    this.state.space = 'inside';
    if (this._wallClosing) {
      clearTimeout(this.wallCloseTimer);
      this._wallClosing = false;
      this.dom.wallView.classList.remove('is-leaving');
    }
    if (!this.state.user) {
      this.pendingAction = 'wall';
      this.openLogin('登录后进入你的沉浸式 3D 照片墙');
      return;
    }
    if (this.state.selected) this.closeDetail();
    this.closeWallFocus();
    this.setWallHover(null);
    this.state.wallOpen = true;
    this.state.wallZoom = 1;
    this.state.wallEnterScale = 0.72;
    this.syncWallSpaceUI();
    this.renderWall();
    this.dom.wallView.style.setProperty('--wall-tilt-x', '0deg');
    this.dom.wallView.style.setProperty('--wall-tilt-y', '0deg');
    this.dom.wallView.style.setProperty('--wall-px', '0deg');
    this.dom.wallView.style.setProperty('--wall-py', '0deg');
    this.applyWallScale();
    this.updateWallZoomUI();
    this.dom.wallView.classList.add('is-open');
    this.dom.wallView.setAttribute('aria-hidden', 'false');
    document.body.classList.add('wall-open');
    this.dom.wallStage.scrollTop = 0;
    this.dom.wallStage.focus?.({ preventScroll: true });
    this.dom.wallView.classList.add('is-entering');
    void this.dom.wallView.offsetWidth;
    requestAnimationFrame(() => {
      this.state.wallEnterScale = 1;
      this.applyWallScale();
    });
    clearTimeout(this.wallEnterTimer);
    this.wallEnterTimer = window.setTimeout(() => this.dom.wallView.classList.remove('is-entering'), 1300);
  },

  closeWall({ immediate = false } = {}) {
    if (!this.state.wallOpen || this._wallClosing) return;
    this.setWallHover(null);
    this.closeWallFocus();
    if (this.state.selected) this.closeDetail();
    const wasInside = this.state.space === 'inside';
    // 退出时立刻回到月亮外，避免快速再点月亮时误入内部。
    if (wasInside) this.state.space = 'outside';
    const finish = () => {
      this._wallClosing = false;
      this.state.wallOpen = false;
      this.dom.wallView.classList.remove('is-open', 'is-leaving', 'is-entering', 'is-inside');
      this.dom.wallView.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('wall-open');
      clearTimeout(this.wallCloseTimer);
      if (wasInside) {
        this.state.space = 'outside';
        this.refreshMedia({ silent: true });
      }
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (immediate || reduced) {
      finish();
      return;
    }
    this._wallClosing = true;
    this.dom.wallView.classList.add('is-leaving');
    this.dom.wallView.classList.remove('is-entering');
    this.wallCloseTimer = window.setTimeout(finish, 660);
  },

  renderWall() {
    if (!this.dom.wallPlane) return;
    this.setWallHover(null);
    this.applyWallScale();
    const list = Array.isArray(this.state.media) ? this.state.media : [];
    if (this.dom.wallMosaic) {
      const count = list.length ? 24 : 0;
      this.dom.wallMosaic.innerHTML = count && list.length
        ? Array.from({ length: count }, (_, index) => {
            const media = list[index % list.length];
            return `<img src="${escapeHtml(media.urls.thumb)}" alt="" loading="lazy" />`;
          }).join('')
        : '';
    }
    this.syncWallSpaceUI();
    if (this.dom.wallSubtitle) {
      this.dom.wallSubtitle.textContent = list.length
        ? `${list.length} 份记忆 · 仅管理员与获授权成员可见`
        : '月亮内部还是空的，只有管理员可以在这里上传。';
    }
    if (!list.length) {
      this.dom.wallPlane.innerHTML = `
        <div class="wall-empty">
          <strong>月亮内部还空着</strong>
          <p>只有管理员可以在这里上传照片或视频。</p>
        </div>
      `;
      return;
    }
    const width = window.innerWidth;
    const columnCount = width < 620 ? 3 : width < 1100 ? 5 : 6;
    const curve = width < 620 ? 2.9 : 5.2;
    const groups = Array.from({ length: columnCount }, () => []);
    // 平面网格按照片实际数量排布，不复制照片来填空位。
    list.forEach((media, index) => groups[index % columnCount].push(media));
    let displayIndex = 0;
    this.dom.wallPlane.innerHTML = groups.map((items, columnIndex) => {
      const center = (columnCount - 1) / 2;
      const offset = columnIndex - center;
      const tilt = (-offset * curve).toFixed(2);
      const depth = (-Math.abs(offset) * 88).toFixed(0);
      const lift = (Math.abs(offset) * 20).toFixed(0);
      const cards = items.map((media) => {
        const isVideo = media.type === 'video';
        const index = displayIndex;
        displayIndex += 1;
        return `
          <button class="wall-card" type="button" data-wall-media="${escapeHtml(media.id)}" style="--i:${Math.min(index, 50)};--z:${(((index % 5) - 2) * 6).toFixed(1)}px" aria-label="查看 ${escapeHtml(media.originalName)}">
            <span class="wall-card-media">
              <img src="${escapeHtml(media.urls.thumb)}" alt="${escapeHtml(media.originalName)}" loading="lazy" />
              <span class="wall-card-badge">${isVideo ? icons.play + '<span>视频</span>' : icons.image + '<span>照片</span>'}</span>
              <span class="wall-card-overlay">
                <span class="wall-card-title">${escapeHtml(stripExtension(media.originalName))}</span>
                <span class="wall-card-meta">${escapeHtml(media.owner?.username || '未知')} · ${formatShortDate(media.createdAt)}</span>
              </span>
            </span>
          </button>
        `;
      }).join('');
      return `<div class="wall-col" style="--col-tilt:${tilt}deg;--col-z:${depth}px;--col-y:${lift}px">${cards}</div>`;
    }).join('');
  },
};
