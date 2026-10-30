import { icons } from './icons.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const stripExtension = (name) => {
  const clean = String(name || '');
  const index = clean.lastIndexOf('.');
  return index > 0 ? clean.slice(0, index) : clean;
};

export const sceneUiMethods = {
  bindSceneUi() {
    this.dom.zoomIn?.addEventListener('click', () => this.scene?.zoomStep(1));
    this.dom.zoomOut?.addEventListener('click', () => this.scene?.zoomStep(-1));
    this.dom.zoomReset?.addEventListener('click', () => this.scene?.resetZoom());
    document.addEventListener('keydown', (event) => {
      if (this.modals.length || this.state.selected) return;
      if (event.target.closest('input, textarea, select')) return;
      if (this.state.wallOpen) {
        if (event.key === '+' || event.key === '=') this.wallZoomStep(1);
        if (event.key === '-' || event.key === '_') this.wallZoomStep(-1);
        if (event.key === '0') this.resetWallZoom();
        return;
      }
      if (event.key === '+' || event.key === '=') this.scene?.zoomStep(1);
      if (event.key === '-' || event.key === '_') this.scene?.zoomStep(-1);
      if (event.key === '0') this.scene?.resetZoom();
    });
  },

  updateZoomUI(percent) {
    if (!this.dom.zoomPercent) return;
    this.dom.zoomPercent.textContent = `${percent}%`;
    if (this.dom.zoomMode) {
      this.dom.zoomMode.textContent = percent <= 25 ? '星海全景' : percent <= 75 ? '星际巡航' : '月亮视角';
    }
    if (this.dom.zoomIn) this.dom.zoomIn.disabled = percent >= 100;
    if (this.dom.zoomOut) this.dom.zoomOut.disabled = percent <= 10;
    if (!this.state.selected) {
      if (percent <= 10) {
        this.dom.hintText.textContent = this.state.user ? '已到星海全景 · 点击月亮进入照片墙' : '已到星海全景 · 点击月亮登录';
      } else if (!this.state.user) {
        this.dom.hintText.textContent = '滚轮缩小到 10% 看整片星海 · 点击月亮登录';
      } else {
        this.dom.hintText.textContent = '滚轮缩小到 10% 看星海 · 点击月亮进入照片墙';
      }
    }
  },

  openStarGallery(mediaList) {
    const list = Array.isArray(mediaList) ? mediaList : [];
    if (!list.length) return;
    if (this.state.selected) this.closeDetail();
    if (list.length === 1) {
      this.openDetail(list[0]);
      return;
    }

    const tiles = list.map((media) => {
      const isVideo = media.type === 'video';
      return `
        <button class="star-tile" type="button" data-gallery-media="${escapeHtml(media.id)}">
          <span class="star-tile-media">
            <img src="${escapeHtml(media.urls.thumb)}" alt="${escapeHtml(media.originalName)}" loading="lazy" />
            <span class="star-tile-badge">${isVideo ? icons.play + '<span>视频</span>' : icons.image + '<span>照片</span>'}</span>
          </span>
          <span class="star-tile-title">${escapeHtml(stripExtension(media.originalName))}</span>
          <span class="star-tile-meta">${escapeHtml(media.owner?.username || '未知')} · ${isVideo ? '视频' : '照片'}</span>
        </button>
      `;
    }).join('');

    const modal = this.openModal({
      size: 'wide',
      className: 'star-gallery-modal',
      eyebrow: 'STAR CLUSTER',
      title: `这颗星星里的 ${list.length} 份记忆`,
      description: '照片在默认视角下化作粒子。点击任意一张，进入完整聚焦。',
      body: `<div class="star-gallery-grid">${tiles}</div>`,
      footer: '<button class="btn btn-ghost" type="button" data-close>回到星海</button>',
    });

    modal.backdrop.addEventListener('click', (event) => {
      const tile = event.target.closest('[data-gallery-media]');
      if (!tile) return;
      const media = list.find((entry) => entry.id === tile.dataset.galleryMedia);
      if (!media) return;
      modal.close();
      this.openDetail(media);
    });
  },
};
