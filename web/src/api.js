export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || '请求失败');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let csrfToken = null;
let csrfPromise = null;

export const getCsrfToken = async (force = false) => {
  if (csrfToken && !force) return csrfToken;
  if (csrfPromise) return csrfPromise;
  csrfPromise = fetch('/api/auth/csrf', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
    .then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, 'CSRF_BOOTSTRAP_FAILED', '无法建立安全会话');
      const data = await res.json();
      csrfToken = data.csrfToken;
      return csrfToken;
    })
    .finally(() => { csrfPromise = null; });
  return csrfPromise;
};

const parseResponse = async (res) => {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
};

export const request = async (path, options = {}, retry = true) => {
  const method = options.method || 'GET';
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  let body = options.body;
  if (body !== undefined && body !== null && !(body instanceof FormData) && typeof body !== 'string') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  if (unsafe) headers['X-CSRF-Token'] = await getCsrfToken();

  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers,
    body,
    cache: 'no-store',
  });
  const data = await parseResponse(res);
  if (!res.ok) {
    const err = data?.error || {};
    if (res.status === 403 && err.code === 'CSRF_INVALID' && retry) {
      await getCsrfToken(true);
      return request(path, options, false);
    }
    if (res.status === 401) window.dispatchEvent(new CustomEvent('moon:unauthorized'));
    throw new ApiError(res.status, err.code || 'REQUEST_FAILED', err.message || '请求失败', err.details);
  }
  return data;
};

export const api = {
  me: () => request('/api/auth/me'),
  login: (username, password) => request('/api/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword, newPassword) => request('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } }),
  media: (limit = 300, offset = 0, zone = 'outside') => request(`/api/media?limit=${limit}&offset=${offset}&zone=${encodeURIComponent(zone)}`),
  mediaItem: (id) => request(`/api/media/${encodeURIComponent(id)}`),
  initUpload: (payload) => request('/api/media/init', { method: 'POST', body: payload }),
  uploadStatus: (uploadId) => request(`/api/media/upload/${encodeURIComponent(uploadId)}/status`),
  completeUpload: (uploadId) => request('/api/media/complete', { method: 'POST', body: { uploadId } }),
  deleteMedia: (id) => request(`/api/media/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  saveNote: (id, content) => request(`/api/media/${encodeURIComponent(id)}/note`, { method: 'PUT', body: { content } }),
  users: () => request('/api/admin/users'),
  createUser: (payload) => request('/api/admin/users', { method: 'POST', body: payload }),
  updateUser: (id, payload) => request(`/api/admin/users/${id}`, { method: 'PATCH', body: payload }),
  resetPassword: (id, password) => request(`/api/admin/users/${id}/password`, { method: 'POST', body: { password } }),
};

export const uploadPart = ({ uploadId, part, blob, onProgress }) => new Promise((resolve, reject) => {
  getCsrfToken().then((token) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/media/upload/${encodeURIComponent(uploadId)}/${part}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-CSRF-Token', token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = '分片上传失败';
      let code = 'UPLOAD_FAILED';
      try {
        const data = JSON.parse(xhr.responseText);
        message = data?.error?.message || message;
        code = data?.error?.code || code;
      } catch { /* ignore */ }
      if (xhr.status === 401) window.dispatchEvent(new CustomEvent('moon:unauthorized'));
      reject(new ApiError(xhr.status, code, message));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', '网络连接中断，可重试续传'));
    xhr.ontimeout = () => reject(new ApiError(0, 'TIMEOUT', '分片上传超时，可重试续传'));
    xhr.timeout = 180_000;
    xhr.send(blob);
  }).catch(reject);
});
