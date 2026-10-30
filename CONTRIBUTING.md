# 参与贡献

感谢你愿意一起完善月屿。

## 开发环境

- Node.js 22+
- npm 10+
- 可选：ffmpeg / ffprobe（视频封面）
- 可选：Chrome（浏览器端 E2E）

```bash
npm ci
cp .env.example .env
npm run dev
```

前端开发地址：`http://127.0.0.1:5173`  
API 地址：`http://127.0.0.1:3000`

## 提交前检查

```bash
npm test
npm run build
```

涉及 UI 的改动，请附带截图或录屏。涉及鉴权、上传、文件访问的改动，请同时补充 `tests/api.test.js`。

## 不要提交

- `.env` 或任何真实密码
- `data/`、上传的原始照片、数据库
- `node_modules/`
- `web/dist/`
- `release/`
- 个人服务器 IP、域名、证书

## Pull Request

- 一个 PR 只解决一个问题
- 说明“为什么改”，而不只是“改了什么”
- 保持现有代码风格：原生 ES Modules、无额外框架、中文界面文案
- 新的用户可见功能请更新 README 和截图

## 安全问题

请不要在公开 Issue 中披露安全漏洞，按 [SECURITY.md](SECURITY.md) 私下报告。
