# 安全策略

## 支持版本

当前维护 `1.x`。

## 报告漏洞

请通过 GitHub 仓库的 **Security → Report a vulnerability**（Private vulnerability reporting）私下报告，不要在公开 Issue 中贴出利用细节、账号、密码或服务器地址。

报告时请尽量包含：

- 影响版本 / commit
- 复现步骤
- 影响范围（未登录可读、越权、上传绕过等）
- 你认为的修复方向（可选）

## 部署安全清单

- 不要把 `.env`、`data/`、数据库或上传文件提交到 Git
- 生产必须使用 HTTPS，并设置 `COOKIE_SECURE=true`
- `APP_ORIGIN` 必须与实际访问源完全一致
- Node 只监听 `127.0.0.1`，由 Nginx 对外
- `/uploads/` 必须通过 `/api/auth/verify-upload` 做分区鉴权
- 不要对公网开放 3000 端口
- 定期备份 `data/`
