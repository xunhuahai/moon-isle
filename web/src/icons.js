const icon = (paths, viewBox = '0 0 24 24') =>
  `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  upload: icon('<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>'),
  close: icon('<path d="m6 6 12 12"/><path d="M18 6 6 18"/>'),
  user: icon('<circle cx="12" cy="8" r="3.2"/><path d="M5.5 20c.6-3.5 3.1-5.4 6.5-5.4s5.9 1.9 6.5 5.4"/>'),
  shield: icon('<path d="M12 3 5 6v5.2c0 4.4 3 7.4 7 9.8 4-2.4 7-5.4 7-9.8V6l-7-3Z"/><path d="m9.2 12 2 2 3.8-4"/>'),
  trash: icon('<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="m6.5 7 .8 12h9.4l.8-12"/><path d="M10 11v4.5M14 11v4.5"/>'),
  edit: icon('<path d="m4 16.8-.7 4 4-.7L18.7 8.7a2.1 2.1 0 0 0 0-3l-.4-.4a2.1 2.1 0 0 0-3 0L4 16.8Z"/><path d="m13.5 7 3.5 3.5"/>'),
  check: icon('<path d="m5 12.5 4.3 4.3L19 7"/>'),
  play: icon('<path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" stroke="none"/>'),
  logout: icon('<path d="M14 5V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1"/><path d="M9 12h11"/><path d="m17 8 4 4-4 4"/>'),
  key: icon('<circle cx="8.5" cy="15.5" r="4.5"/><path d="m11.8 12.2 8.2-8.2"/><path d="M17 4.5 20.5 8"/><path d="m14.5 7 2 2"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  arrowLeft: icon('<path d="m15 18-6-6 6-6"/>'),
  image: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>'),
  video: icon('<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>'),
  sparkle: icon('<path d="M12 3c.6 4.7 2.3 6.4 7 7-4.7.6-6.4 2.3-7 7-.6-4.7-2.3-6.4-7-7 4.7-.6 6.4-2.3 7-7Z"/><path d="M19 16c.2 1.8.9 2.5 2.7 2.7-1.8.2-2.5.9-2.7 2.7-.2-1.8-.9-2.5-2.7-2.7 1.8-.2 2.5-.9 2.7-2.7Z"/>'),
  refresh: icon('<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4v7h-7"/>'),
  lock: icon('<rect x="4.5" y="10" width="15" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/>'),
  eye: icon('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'),
};

export const roleLabel = { admin: '管理员', uploader: '上传者', viewer: '访客' };
export const roleDescription = {
  admin: '可上传、删除、编辑所有备注并管理用户',
  uploader: '可上传并编辑自己媒体的备注',
  viewer: '仅浏览照片墙，不可修改内容',
};
