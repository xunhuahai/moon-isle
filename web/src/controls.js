import { icons } from './icons.js';
import { randomId } from './uuid.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export const controlMethods = {
  openModal({
    title = '', eyebrow = '', description = '', body = '', footer = '',
    className = '', size = '', showHead = true, closeOnBackdrop = true,
    onMount, onClose,
  }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const titleId = `modal-title-${randomId()}`;
    const sizeClass = size === 'wide' ? 'wide' : size === 'small' ? 'small' : '';
    backdrop.innerHTML = `
      <section class="modal ${sizeClass} ${className}" role="dialog" aria-modal="true" ${showHead ? `aria-labelledby="${titleId}"` : 'aria-label="登录"'}>
        ${showHead ? `
          <header class="modal-head">
            <div>
              <span class="eyebrow">${escapeHtml(eyebrow)}</span>
              <h2 id="${titleId}">${escapeHtml(title)}</h2>
              ${description ? `<p>${escapeHtml(description)}</p>` : ''}
            </div>
            <button class="icon-button" type="button" data-close aria-label="关闭">${icons.close}</button>
          </header>
        ` : ''}
        <div class="modal-body">${body}</div>
        ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
      </section>
    `;
    const entry = { backdrop, closed: false, onClose, previousFocus: document.activeElement };
    const close = () => {
      if (entry.closed) return;
      entry.closed = true;
      backdrop.remove();
      this.modals = this.modals.filter((item) => item !== entry);
      if (!this.modals.length) {
        document.body.classList.remove('modal-open');
        if (entry.previousFocus instanceof HTMLElement) entry.previousFocus.focus?.();
      }
      entry.onClose?.();
    };
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop && closeOnBackdrop) { close(); return; }
      if (event.target.closest('[data-close]')) close();
    });
    this.modals.push(entry);
    document.body.classList.add('modal-open');
    this.dom.modalRoot.appendChild(backdrop);
    setTimeout(() => {
      const focusTarget = backdrop.querySelector('input:not([type="hidden"]), textarea, select, button:not([data-close])');
      focusTarget?.focus?.();
    }, 30);
    const controller = { backdrop, close, entry };
    onMount?.(controller);
    return controller;
  },

  closeTopModal() {
    const entry = this.modals[this.modals.length - 1];
    if (!entry) return;
    entry.backdrop.remove();
    entry.closed = true;
    this.modals.pop();
    if (!this.modals.length) {
      document.body.classList.remove('modal-open');
      if (entry.previousFocus instanceof HTMLElement) entry.previousFocus.focus?.();
    }
    entry.onClose?.();
  },

  openConfirm({ title, message, confirmText = '确认', danger = false, onConfirm }) {
    const modal = this.openModal({
      size: 'small',
      eyebrow: 'PLEASE CONFIRM',
      title,
      body: `<p class="modal-intro">${escapeHtml(message)}</p><p class="form-error" id="confirmError"></p>`,
      footer: `
        <button class="btn btn-ghost" type="button" data-close>取消</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" id="confirmAction">${escapeHtml(confirmText)}</button>
      `,
    });
    const button = modal.backdrop.querySelector('#confirmAction');
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await onConfirm();
        modal.close();
      } catch (error) {
        const errorEl = modal.backdrop.querySelector('#confirmError');
        if (errorEl) errorEl.textContent = error.message || '操作失败';
        button.disabled = false;
      }
    });
  },

  toast(message, type = 'info', duration = 3400) {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    const icon = type === 'success' ? icons.check : type === 'error' ? icons.close : icons.sparkle;
    node.innerHTML = `${icon}<span class="toast-message"></span>`;
    node.querySelector('.toast-message').textContent = message;
    this.dom.toastRoot.appendChild(node);
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 280);
    }, duration);
  },
};
