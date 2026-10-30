import { config, paths } from './config.js';
import { createApp } from './app.js';
import { cleanupExpiredSessions, cleanupStaleUploads, closeDb, seedAdmin } from './db.js';

if (config.isProduction && !config.appOrigin) {
  console.warn('[security] 生产环境未设置 APP_ORIGIN，Origin 校验将关闭。请填写 https://你的域名');
}
if (config.isProduction && !config.cookieSecure) {
  console.warn('[security] 生产环境 COOKIE_SECURE=false，登录 Cookie 可能通过明文 HTTP 传输。');
}
if (config.isProduction && !config.trustProxy) {
  console.warn('[security] 生产环境 TRUST_PROXY=false，Nginx 反向代理后限流看到的会是同一个内网 IP。');
}

const app = createApp();

await seedAdmin();
cleanupExpiredSessions();
cleanupStaleUploads();

const sessionCleanup = setInterval(cleanupExpiredSessions, 60 * 60 * 1000);
const uploadCleanup = setInterval(cleanupStaleUploads, 60 * 60 * 1000);
sessionCleanup.unref?.();
uploadCleanup.unref?.();

const server = app.listen(config.port, config.host, () => {
  console.log(`\n  月屿 · 星月照片墙 API 已启动`);
  console.log(`  地址: http://${config.host}:${config.port}`);
  console.log(`  数据: ${paths.data}`);
  console.log(`  上传: ${paths.uploads}`);
  console.log(`  模式: ${config.nodeEnv}\n`);
});

const shutdown = (signal) => {
  console.log(`[shutdown] 收到 ${signal}，正在关闭...`);
  clearInterval(sessionCleanup);
  clearInterval(uploadCleanup);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
