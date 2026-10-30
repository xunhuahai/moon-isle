import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { config } from '../server/config.js';
import { closeDb, createUser, findUserByUsername } from '../server/db.js';

const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const askText = (question, defaultValue = '') => new Promise((resolve, reject) => {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY) {
    reject(new Error('非交互环境请使用 --username / --password 参数或 ADMIN_PASSWORD 环境变量'));
    return;
  }
  const wasRaw = stdin.isRaw;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  stdout.write(question + (defaultValue ? ` [${defaultValue}]` : ''));
  let value = '';
  const cleanup = () => {
    stdin.off('data', onData);
    stdin.setRawMode?.(Boolean(wasRaw));
    stdin.pause();
  };
  const onData = (chunk) => {
    for (const char of chunk) {
      if (char === '\u0003') {
        cleanup(); stdout.write('\n'); process.exit(130);
      }
      if (char === '\r' || char === '\n') {
        cleanup(); stdout.write('\n'); resolve(value || defaultValue); return;
      }
      if (char === '\u007f' || char === '\b') {
        if (value.length) { value = value.slice(0, -1); stdout.write('\b \b'); }
        continue;
      }
      value += char;
      stdout.write(char);
    }
  };
  stdin.on('data', onData);
});

const askHidden = (question) => new Promise((resolve, reject) => {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY || !stdin.setRawMode) {
    reject(new Error('当前终端不支持隐藏密码输入，请使用 --password 参数'));
    return;
  }
  stdout.write(question);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let value = '';
  const cleanup = () => {
    stdin.off('data', onData);
    stdin.setRawMode(Boolean(wasRaw));
    stdin.pause();
  };
  const onData = (chunk) => {
    for (const char of chunk) {
      if (char === '\u0003') {
        cleanup(); stdout.write('\n'); process.exit(130);
      }
      if (char === '\r' || char === '\n') {
        cleanup(); stdout.write('\n'); resolve(value); return;
      }
      if (char === '\u007f' || char === '\b') {
        if (value.length) { value = value.slice(0, -1); stdout.write('\b \b'); }
        continue;
      }
      if (char === '\u001b') continue;
      value += char;
      stdout.write('*');
    }
  };
  stdin.on('data', onData);
});

const main = async () => {
  const username = (argValue('--username') || process.env.ADMIN_USERNAME || await askText('管理员账号: ')).trim();
  const role = (argValue('--role') || 'admin').trim();
  let password = argValue('--password') || process.env.ADMIN_PASSWORD || '';
  if (!password) password = await askHidden('密码（至少 10 位，输入不回显）: ');
  if (!['admin', 'uploader', 'viewer'].includes(role)) throw new Error('角色必须是 admin、uploader 或 viewer');
  if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username)) throw new Error('账号需为 3–32 位字母、数字、中文、下划线、点或短横线');
  if (password.length < 10 || password.length > 200) throw new Error('密码长度需为 10–200 位');
  if (findUserByUsername(username)) throw new Error(`账号 ${username} 已存在`);

  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  const user = createUser({ username, passwordHash, role });
  console.log(`已创建用户 #${user.id} ${user.username}（${role}）`);
  closeDb();
};

main().catch((error) => {
  console.error('创建失败：' + error.message);
  try { closeDb(); } catch { /* noop */ }
  process.exit(1);
});
