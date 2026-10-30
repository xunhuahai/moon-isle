# Deployment Guide

[简体中文](README.zh-CN.md)

This repository contains a self-hosted photo/video gallery. This document covers installation, configuration, upgrades, and operations only.

## Requirements

- Ubuntu 22.04 or 24.04
- Node.js 22+ (24 recommended)
- Nginx
- ffmpeg / ffprobe for video posters
- A domain with DNS pointing to the server (for HTTPS)
- Optional: 2 GB swap on a 2 GB VPS

## Project layout

```text
server/          Express API, SQLite, upload pipeline
web/             Vite frontend
scripts/         Admin creation, demo data, backup, E2E
tests/           API integration tests
deploy/          systemd unit and Nginx config
docs/            Documentation assets (not required at runtime)
```

## Configuration

Copy the example file:

```bash
cp .env.example .env
```

| Variable | Production example | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | Use `development` for local HTTP |
| `HOST` | `127.0.0.1` | Keep Node private behind Nginx |
| `PORT` | `3000` | Internal API port |
| `TRUST_PROXY` | `1` | Nginx is in front |
| `APP_ORIGIN` | `https://photos.example.com` | Exact browser origin, no trailing slash |
| `DATA_DIR` | `/opt/moon-isle/data` | Database and uploads |
| `UPLOAD_DIR` | `/opt/moon-isle/data/uploads` | Original files and derivatives |
| `UPLOAD_TMP_DIR` | `/opt/moon-isle/data/uploads-tmp` | Chunk staging; never public |
| `COOKIE_SECURE` | `true` | Must be `false` only for local HTTP |
| `ADMIN_USERNAME` | `admin` | Initial admin username |
| `ADMIN_PASSWORD` | empty | Prefer `npm run create-admin` |
| `MAX_IMAGE_MB` | `80` | Per-image limit |
| `MAX_VIDEO_MB` | `2048` | Per-video limit |
| `CHUNK_SIZE_MB` | `8` | Must be below Nginx body limit |
| `MAX_MEDIA` | `5000` | Total media cap |

Local HTTP values:

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

`PORT=3000` is the API port. `APP_ORIGIN` is the browser origin: with Vite dev the page is `5173` and proxies to `3000`; with `npm start` both are `3000`. If you open a local production build on port 3000, set `APP_ORIGIN=http://127.0.0.1:3000`.

## Local installation

```bash
npm ci
cp .env.example .env
# edit .env
npm run dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` and `/uploads` to port 3000.

Create an admin:

```bash
npm run create-admin
```

Build and run locally:

```bash
npm run build
npm start
```

## Production installation (Ubuntu)

### 1. Packages

```bash
sudo apt update
sudo apt install -y nginx ffmpeg build-essential curl git certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

For a 2 GB VPS, add swap before building:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2. User and directories

```bash
sudo adduser --system --group --home /opt/moon-isle --shell /usr/sbin/nologin photos
sudo mkdir -p /opt/moon-isle /var/backups/moon-isle
sudo chown -R photos:photos /opt/moon-isle /var/backups/moon-isle
```

### 3. Upload source

From a local checkout:

```bash
rsync -az --exclude node_modules --exclude .env --exclude data --exclude release \
  ./ user@photos.example.com:/tmp/moon-isle/
ssh user@photos.example.com
sudo rsync -a /tmp/moon-isle/ /opt/moon-isle/
sudo chown -R photos:photos /opt/moon-isle
```

Or clone from Git:

```bash
sudo -u photos git clone <repository-url> /opt/moon-isle
```

### 4. Environment

```bash
cd /opt/moon-isle
sudo -u photos cp .env.example .env
sudo -u photos nano .env
sudo chmod 600 .env
```

Production values:

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

`APP_ORIGIN` must exactly match the browser origin, including scheme and without a trailing slash. A mismatch causes 403 responses.

### 5. Build and admin

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

### 7. Nginx and HTTPS

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

The upload location must use the zone-aware auth endpoint. Replace the approximate block in your config with:

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

Grant Nginx access to generated files:

```bash
sudo usermod -aG photos www-data
sudo chgrp -R photos /opt/moon-isle/web/dist /opt/moon-isle/data
sudo chmod -R g+rX /opt/moon-isle/web/dist /opt/moon-isle/data
sudo systemctl restart nginx
```

### 8. Verify

```bash
curl https://photos.example.com/api/health
sudo certbot renew --dry-run
```

Expected:

```json
{"ok":true}
```

## Upgrade

Back up first, then replace code without touching `.env` or `data/`:

```bash
cd /opt/moon-isle
sudo -H -u photos node scripts/backup.js /var/backups/moon-isle/app-$(date +%F-%H%M).db

# upload and unpack the new release, then:
sudo rsync -a --exclude='.env' --exclude='data/' /tmp/moon-isle-new/ /opt/moon-isle/
sudo chown -R photos:photos /opt/moon-isle/web
sudo systemctl restart moon-isle
```

If the release includes a new `deploy/nginx.conf`, review and merge the relevant location blocks; do not blindly overwrite a working certificate configuration.

## Backup

```bash
sudo chmod +x /opt/moon-isle/deploy/backup.sh
sudo /opt/moon-isle/deploy/backup.sh
```

The script uses SQLite's online backup API and archives uploads. Keep copies on another machine or object storage. Restore by stopping the service, restoring `data/app.db` and `data/uploads/`, fixing ownership, and starting the service.

## Security checklist

- Do not expose port 3000 to the internet.
- Use HTTPS in production and `COOKIE_SECURE=true`.
- Set `APP_ORIGIN` to the exact public origin.
- Set `TRUST_PROXY=1` behind Nginx.
- Keep `.env`, `data/`, uploads, and database files out of Git.
- Keep `/uploads/` behind `auth_request` and the `verify-upload` endpoint.
- Set a strong admin password and remove any bootstrap password from `.env`.
- Back up before upgrades.

## License

MIT. See [LICENSE](LICENSE).
