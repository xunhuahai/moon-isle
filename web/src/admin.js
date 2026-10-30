import { api } from './api.js';
import { icons, roleLabel, roleDescription } from './icons.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
};

const initials = (name) => [...String(name || '？')].slice(0, 2).join('');

export const adminMethods = {
  async openAdmin() {
    if (this.state.user?.role !== 'admin') {
      this.toast('需要管理员权限', 'error');
      return;
    }
    this.closeUserMenu();
    const modal = this.openModal({
      size: 'wide',
      eyebrow: 'CONTROL ROOM',
      title: '用户与权限',
      description: '管理员可创建账号、调整角色与启用状态，并可授权谁可以查看月亮内部。',
      body: '<div class="form-note" style="padding:22px 0;text-align:center;">正在读取用户列表…</div>',
      footer: '<button class="btn btn-ghost" type="button" data-close>关闭</button>',
    });
    this.adminModal = modal;
    await this.loadAdminUsers(modal);
  },

  async loadAdminUsers(modal) {
    try {
      const data = await api.users();
      this.renderAdmin(modal, data.users);
    } catch (error) {
      const body = modal.backdrop.querySelector('.modal-body');
      if (body) body.innerHTML = `<p class="form-error">${escapeHtml(error.message || '读取用户失败')}</p>`;
    }
  },

  renderAdmin(modal, users) {
    const body = modal.backdrop.querySelector('.modal-body');
    if (!body) return;
    const rows = users.map((user) => {
      const self = user.id === this.state.user?.id;
      const roleOptions = ['admin', 'uploader', 'viewer'].map((role) =>
        `<option value="${role}" ${user.role === role ? 'selected' : ''}>${roleLabel[role]}</option>`
      ).join('');
      const roleCell = self
        ? `<span class="role-badge ${user.role}">${roleLabel[user.role]}</span>`
        : `<select class="table-select" data-role-select data-user-id="${user.id}" aria-label="修改 ${escapeHtml(user.username)} 的角色" title="${roleDescription[user.role]}">${roleOptions}</select>`;
      const statusCell = `<span class="status-dot ${user.status === 'disabled' ? 'disabled' : ''}">${user.status === 'active' ? '正常' : '已停用'}</span>`;
      const insideCell = user.role === 'admin'
        ? '<span class="inside-badge">始终可见</span>'
        : `<label class="inside-access"><input type="checkbox" data-inside-access data-user-id="${user.id}" ${user.insideAccess ? 'checked' : ''} /><span>${user.insideAccess ? '已授权' : '未授权'}</span></label>`;
      const actions = self
        ? '<span class="form-note">当前账号</span>'
        : `<div class="table-actions">
            <button class="table-action" type="button" data-admin-action="reset" data-user-id="${user.id}" title="重置密码">${icons.key}</button>
            <button class="table-action" type="button" data-admin-action="toggle-status" data-user-id="${user.id}" title="${user.status === 'active' ? '停用账号' : '启用账号'}">${user.status === 'active' ? icons.lock : icons.check}</button>
          </div>`;
      return `
        <tr>
          <td>
            <div class="user-person">
              <span class="user-person-avatar">${escapeHtml(initials(user.username))}</span>
              <div><strong>${escapeHtml(user.username)}</strong><small>创建于 ${formatDate(user.createdAt)}</small></div>
            </div>
          </td>
          <td>${roleCell}</td>
          <td>${statusCell}</td>
          <td>${insideCell}</td>
          <td><span class="form-note">${user.mediaCount} 颗</span></td>
          <td>${actions}</td>
        </tr>
      `;
    }).join('');

    body.innerHTML = `
      <form class="admin-create" id="createUserForm" novalidate>
        <div class="field"><label for="newUsername">新账号</label><input id="newUsername" name="username" maxlength="32" placeholder="3–32 位" required /></div>
        <div class="field"><label for="newUserPassword">初始密码</label><input id="newUserPassword" name="password" type="password" minlength="10" autocomplete="new-password" placeholder="至少 10 位" required /></div>
        <div class="field"><label for="newUserRole">角色</label><select id="newUserRole" name="role"><option value="uploader">上传者</option><option value="viewer">访客</option><option value="admin">管理员</option></select></div>
        <label class="create-inside"><input id="newUserInside" type="checkbox" /><span>允许查看月亮内部</span></label>
        <button class="btn btn-primary" type="submit" id="createUserSubmit">${icons.plus}<span>创建</span></button>
      </form>
      <p class="form-error" id="adminError"></p>
      <div class="section-label"><span>全部用户</span><small>${users.length} 个账号</small></div>
      <table class="user-table">
        <thead><tr><th>用户</th><th>角色</th><th>状态</th><th>月亮内部</th><th>记忆</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    const errorEl = body.querySelector('#adminError');
    const form = body.querySelector('#createUserForm');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorEl.textContent = '';
      const submit = body.querySelector('#createUserSubmit');
      submit.disabled = true;
      try {
        await api.createUser({
          username: body.querySelector('#newUsername').value.trim(),
          password: body.querySelector('#newUserPassword').value,
          role: body.querySelector('#newUserRole').value,
          insideAccess: body.querySelector('#newUserInside').checked,
        });
        this.toast('新账号已创建', 'success');
        await this.loadAdminUsers(modal);
      } catch (error) {
        errorEl.textContent = error.message || '创建失败';
        submit.disabled = false;
      }
    });

    body.onchange = async (event) => {
      const inside = event.target.closest('[data-inside-access]');
      if (inside) {
        inside.disabled = true;
        try {
          await api.updateUser(Number(inside.dataset.userId), { insideAccess: inside.checked });
          this.toast(inside.checked ? '已允许查看月亮内部' : '已取消月亮内部权限', 'success');
        } catch (error) {
          this.toast(error.message || '权限更新失败', 'error');
        }
        await this.loadAdminUsers(modal);
        return;
      }
      const select = event.target.closest('[data-role-select]');
      if (!select) return;
      select.disabled = true;
      try {
        await api.updateUser(Number(select.dataset.userId), { role: select.value });
        this.toast('角色已更新', 'success');
        await this.loadAdminUsers(modal);
      } catch (error) {
        this.toast(error.message || '角色更新失败', 'error');
        await this.loadAdminUsers(modal);
      }
    };

    body.onclick = (event) => {
      const button = event.target.closest('[data-admin-action]');
      if (!button) return;
      const user = users.find((entry) => entry.id === Number(button.dataset.userId));
      if (!user) return;
      if (button.dataset.adminAction === 'reset') this.openResetPassword(modal, user);
      if (button.dataset.adminAction === 'toggle-status') {
        if (user.status === 'active') {
          this.openConfirm({
            title: '停用这个账号？',
            message: `${user.username} 将立即退出登录，且无法再上传或修改任何内容。`,
            confirmText: '停用账号',
            danger: true,
            onConfirm: async () => {
              await api.updateUser(user.id, { status: 'disabled' });
              this.toast('账号已停用', 'success');
              await this.loadAdminUsers(modal);
            },
          });
        } else {
          api.updateUser(user.id, { status: 'active' })
            .then(() => { this.toast('账号已启用', 'success'); return this.loadAdminUsers(modal); })
            .catch((error) => this.toast(error.message || '操作失败', 'error'));
        }
      }
    };
  },

  openResetPassword(parentModal, user) {
    const modal = this.openModal({
      size: 'small',
      eyebrow: 'RESET CREDENTIALS',
      title: '重置密码',
      description: `为 ${user.username} 设置新的登录密码，旧会话会立即失效。`,
      body: `
        <form id="resetPasswordForm" novalidate>
          <div class="field"><label for="resetNewPassword">新密码</label><input id="resetNewPassword" type="password" autocomplete="new-password" minlength="10" required placeholder="至少 10 位" /></div>
          <div class="field"><label for="resetConfirmPassword">确认新密码</label><input id="resetConfirmPassword" type="password" autocomplete="new-password" required /></div>
          <p class="form-error" id="resetError"></p>
          <button class="btn btn-primary btn-block" type="submit" id="resetSubmit">保存新密码</button>
        </form>
      `,
      footer: '<button class="btn btn-ghost" type="button" data-close>取消</button>',
    });
    const form = modal.backdrop.querySelector('#resetPasswordForm');
    const errorEl = modal.backdrop.querySelector('#resetError');
    modal.backdrop.querySelector('#resetNewPassword').focus();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorEl.textContent = '';
      const password = modal.backdrop.querySelector('#resetNewPassword').value;
      const confirm = modal.backdrop.querySelector('#resetConfirmPassword').value;
      if (password.length < 10) { errorEl.textContent = '密码至少需要 10 位'; return; }
      if (password !== confirm) { errorEl.textContent = '两次输入的密码不一致'; return; }
      const submit = modal.backdrop.querySelector('#resetSubmit');
      submit.disabled = true;
      try {
        await api.resetPassword(user.id, password);
        modal.close();
        this.toast('密码已重置', 'success');
        await this.loadAdminUsers(parentModal);
      } catch (error) {
        errorEl.textContent = error.message || '重置失败';
        submit.disabled = false;
      }
    });
  },
};
