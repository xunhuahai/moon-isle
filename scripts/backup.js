import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { paths } from '../server/config.js';

const destination = process.argv[2];
if (!destination) {
  console.error('用法: node scripts/backup.js <输出数据库文件>');
  process.exit(1);
}
fs.mkdirSync(path.dirname(destination), { recursive: true });
if (!fs.existsSync(paths.db)) {
  console.error(`数据库不存在: ${paths.db}`);
  process.exit(1);
}
const db = new Database(paths.db, { readonly: true, fileMustExist: true });
try {
  await db.backup(destination);
  console.log(`数据库已备份到 ${destination}`);
} finally {
  db.close();
}
