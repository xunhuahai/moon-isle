#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/moon-isle}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/moon-isle}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
WORK_DIR="${BACKUP_DIR}/${STAMP}"

umask 077
mkdir -p "${WORK_DIR}" "${BACKUP_DIR}"
cd "${APP_DIR}"

# SQLite 在线备份（WAL 安全）
node scripts/backup.js "${WORK_DIR}/app.db"

# 上传原件、缩略图、预览图
tar -C "${APP_DIR}/data" -czf "${WORK_DIR}/uploads.tar.gz" uploads

# 打包成单文件
tar -C "${BACKUP_DIR}" -czf "${BACKUP_DIR}/moon-isle-${STAMP}.tar.gz" "${STAMP}"
rm -rf "${WORK_DIR}"

# 清理旧备份
find "${BACKUP_DIR}" -maxdepth 1 -name 'moon-isle-*.tar.gz' -type f -mtime +"${KEEP_DAYS}" -delete

echo "备份完成: ${BACKUP_DIR}/moon-isle-${STAMP}.tar.gz"
