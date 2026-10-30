# 部署指南

[English](README.md)

本仓库包含一个可自托管的照片/视频画廊。本文只说明安装、配置、升级与运维。

## 环境要求

- Ubuntu 22.04 或 24.04
- Node.js 22+（推荐 24）
- Nginx
- ffmpeg / ffprobe（视频封面）
- 用于 HTTPS 的域名与 DNS
- 可选：2 GB VPS 建议配置 2 GB swap

## 项目结构

```text
server/          Express API、SQLite、上传处理
web/             Vite 前端
scripts/         管理员创建、演示数据、备份、E2E
tests/           API 集成测试
deploy/          systemd 与 Nginx 配置
```

## 配置

复制示例：

```bash
cp .env.example .env
```

| 变量 | 生产示例 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 本地 HTTP 调试用 `development` |
| `HOST` | `127.0.0.1` | Node 只监听本机，由 Nginx 对外 |
| `PORT` | `3000` | 内部 API 端口 |
| `TRUST_PROXY` | `1` | Nginx 在前面时开启 |
| `APP_ORIGIN` | `https://photos.example.com` | 必须与浏览器地址完全一致，末尾无斜杠 |
| `DATA_DIR` | `/opt/moon-isle/data` | 数据库与上传目录 |
| `UPLOAD_DIR` | `/opt/moon-isle/data/uploads` | 原文件与衍生图 |
| `UPLOAD_TMP_DIR` | `/opt/moon-isle/data/uploads-tmp` | 分片临时目录，禁止公开 |
| `COOKIE_SECURE` | `true` | 仅本地 HTTP 调试时为 `false` |
| `ADMIN_USERNAME` | `admin` | 初始管理员账号 |
| `ADMIN_PASSWORD` | 空 | 建议使用 `npm run create-admin` |
| `MAX_IMAGE_MB` | `80` | 单张图片上限 |
| `MAX_VIDEO_MB` | `2048` | 单个视频上限 |
| `CHUNK_SIZE_MB` | `8` | 必须小于 Nginx 请求体上限 |
| `MAX_MEDIA` | `5000` | 媒体总数上限 |

本地 HTTP 配置：

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
TRUST_PROXY=0
APP_ORIGIN=http://127.0.0.1:5173
COOKIE_SECURE=false
DATA_DIR=./data
UPLOAD_DIR=./data/uploads
UPLOAD_TMP_DIR=./data/uploads-tmp
ADMIN_USERNAME=admin
ADMIN_PASSWORD=
```

`PORT=3000` 是 Node API 端口；`APP_ORIGIN` 是浏览器访问地址。Vite 开发时页面是 `5173`，通过代理访问 3000；用 `npm start` 时页面和 API 都是 3000。如果在本地用 3000 端口打开生产构建，设置：

```dotenv
APP_ORIGIN=http://127.0.0.1:3000
```

## 本地安装

```bash
npm ci
cp .env.example .env
# 编辑 .env
npm run dev
```

打开 <http://127.0.0.1:5173>。Vite 会把 `/api` 和 `/uploads` 代理到 3000。

创建管理员：

```bash
npm run create-admin
```

本地构建并运行：

```bash
npm run build
npm start
```

## 生产部署（Ubuntu）

### 1. 安装依赖

```bash
sudo apt update
sudo apt install -y nginx ffmpeg build-essential curl git certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

2 GB 内存的机器建议在构建前加 swap：

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2. 创建用户与目录

```bash
sudo adduser --system --group --home /opt/moon-isle --shell /usr/sbin/nologin photos
sudo mkdir -p /opt/moon-isle /var/backups/moon-isle
sudo chown -R photos:photos /opt/moon-isle /var/backups/moon-isle
```

### 3. 上传源码

在本地项目目录执行：

```bash
rsync -az --exclude node_modules --exclude .env --exclude data --exclude release \
  ./ user@photos.example.com:/tmp/moon-isle/
ssh user@photos.example.com
sudo rsync -a /tmp/moon-isle/ /opt/moon-isle/
sudo chown -R photos:photos /opt/moon-isle
```

或者从 Git 克隆：

```bash
sudo -u photos git clone <仓库地址> /opt/moon-isle
```

### 4. 环境变量

```bash
cd /opt/moon-isle
sudo -u photos cp .env.example .env
sudo -u photos nano .env
sudo chmod 600 .env
```

生产配置：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
TRUST_PROXY=1
APP_ORIGIN=https://photos.example.com
COOKIE_SECURE=true
DATA_DIR=/opt/moon-isle/data
UPLOAD_DIR=/opt/moon-isle/data/uploads
UPLOAD_TMP_DIR=/opt/moon-isle/data/uploads-tmp
ADMIN_USERNAME=admin
ADMIN_PASSWORD=
```

`APP_ORIGIN` 必须与实际访问地址完全一致；不一致会导致 403。

### 5. 安装、构建、创建管理员

```bash
sudo -H -u photos mkdir -p data/uploads data/uploads-tmp
sudo -H -u photos npm ci
sudo -H -u photos npm run build
sudo -H -u photos npm prune --omit=dev
sudo -H -u photos node scripts/create-admin.js --username admin
```

### 6. systemd

```bash
sudo cp deploy/photos.service /etc/systemd/system/moon-isle.service
sudo systemctl daemon-reload
sudo systemctl enable --now moon-isle
sudo systemctl status moon-isle --no-pager
sudo journalctl -u moon-isle -n 50 --no-pager
```

### 7. Nginx 与 HTTPS

```bash
sudo systemctl start nginx
sudo certbot certonly --nginx -d photos.example.com \
  --email you@example.com --agree-tos --no-eff-email

cd /opt/moon-isle
sudo cp deploy/nginx.conf /etc/nginx/sites-available/moon-isle
sudo sed -i 's/photos.example.com/your-domain.example/g' /etc/nginx/sites-available/moon-isle
sudo ln -sfn /etc/nginx/sites-available/moon-isle /etc/nginx/sites-enabled/moon-isle
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

上传目录必须使用分区鉴权。将现有配置中的对应块替换为：

```nginx
location = /_upload_auth {
    internal;
    proxy_pass http://127.0.0.1:3000/api/auth/verify-upload;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Cookie $http_cookie;
    proxy_set_header X-Original-URI $request_uri;
}

location /uploads/ {
    auth_request /_upload_auth;
    alias /opt/moon-isle/data/uploads/;
    add_header Cache-Control "private, no-store" always;
    expires off;
}
```

让 Nginx 读取生成文件：

```bash
sudo usermod -aG photos www-data
sudo chgrp -R photos /opt/moon-isle/web/dist /opt/moon-isle/data
sudo chmod -R g+rX /opt/moon-isle/web/dist /opt/moon-isle/data
sudo systemctl restart nginx
```

### 8. 验证

```bash
curl https://photos.example.com/api/health
sudo certbot renew --dry-run
```

预期：

```json
{"ok":true}
```

## 升级

先备份，再替换代码；不要覆盖 `.env` 和 `data/`：

```bash
cd /opt/moon-isle
sudo -H -u photos node scripts/backup.js /var/backups/moon-isle/app-$(date +%F-%H%M).db

# 上传并解压新版本后
sudo rsync -a --exclude='.env' --exclude='data/' /tmp/moon-isle-new/ /opt/moon-isle/
sudo chown -R photos:photos /opt/moon-isle/web
sudo systemctl restart moon-isle
```

如果新版本包含 `deploy/nginx.conf` 变更，请只合并相关的 location 配置，不要直接覆盖正在使用的证书配置。

## 备份

```bash
sudo chmod +x /opt/moon-isle/deploy/backup.sh
sudo /opt/moon-isle/deploy/backup.sh
```

脚本使用 SQLite 在线备份 API，并打包上传目录。请把备份同步到另一台机器或对象存储。恢复时停止服务，恢复 `data/app.db` 与 `data/uploads/`，修正权限后启动。

## 安全检查

- 不要对公网开放 3000 端口
- 生产使用 HTTPS，并设置 `COOKIE_SECURE=true`
- `APP_ORIGIN` 必须与真实访问源一致
- Nginx 前置时设置 `TRUST_PROXY=1`
- 不要把 `.env`、`data/`、上传文件、数据库提交到 Git
- `/uploads/` 必须经过 `auth_request` 与 `verify-upload`
- 设置强管理员密码，并从 `.env` 删除一次性密码
- 升级前先备份

## 许可证

MIT，见 [LICENSE](LICENSE)。
