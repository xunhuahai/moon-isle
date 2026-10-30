import 'dotenv/config';
import sharp from 'sharp';

const base = (process.env.DEMO_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, '');
const adminUser = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) throw new Error('请先在 .env 设置 ADMIN_PASSWORD 或通过环境变量传入');
const args = new Set(process.argv.slice(2));

const cookies = new Map();
const rememberCookies = (res) => {
  const list = res.headers.getSetCookie?.() || [];
  for (const raw of list) {
    const [pair] = raw.split(';');
    const index = pair.indexOf('=');
    if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
};
const cookieHeader = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

let csrf = '';
const request = async (path, { method = 'GET', body, raw = false } = {}) => {
  const headers = { Accept: 'application/json', Cookie: cookieHeader() };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (body !== undefined && !Buffer.isBuffer(body)) headers['Content-Type'] = 'application/json';
  if (Buffer.isBuffer(body)) headers['Content-Type'] = 'application/octet-stream';
  const res = await fetch(base + path, {
    method, headers, body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)),
  });
  rememberCookies(res);
  if (!raw) {
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data?.error?.message || ''}`);
    return data;
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return res;
};

const palettes = [
  ['#171f3c', '#4e6e91', '#d2a86f', '#0b1022'],
  ['#101a32', '#335c77', '#efbd83', '#050b18'],
  ['#291c3d', '#7a5a82', '#f4c393', '#100a1c'],
  ['#102c36', '#3f7c7c', '#e8c79d', '#061619'],
  ['#211b35', '#5e4d76', '#d9b58a', '#0b0815'],
  ['#1b2437', '#50708a', '#e1c5a1', '#080d16'],
  ['#2d1e29', '#775b62', '#f0cba4', '#120a10'],
  ['#14242f', '#4a7076', '#e9cda5', '#070f14'],
];

const titles = [
  '月光落在山脊', '潮汐之间', '风经过松林', '把黄昏留住', '远方的灯塔',
  '雾中列车', '海边的旧梦', '银河入海', '沙丘与晚风', '清晨第一束光',
  '湖心无声', '夜航星图', '穿过云层', '山谷回声', '在日落之前',
  '蓝色时刻', '岛屿来信', '风从海上来', '雪线之上', '我们看过的星',
  '漫长的夏天', '潮声入眠',
];

const notes = {
  1: '那天风很大，月亮从山后升起来的时候，所有人都安静了。',
  2: '退潮后留下的水洼，像一小片倒过来的天空。',
  5: '灯塔每十二秒亮一次。我们在礁石上数到第四十次才舍得回去。',
  7: '如果记忆有颜色，这一页应该是深蓝里的一点金色。',
  9: '沙子还留着白天的温度，风把脚印慢慢抹平。',
  12: '凌晨三点的银河。相机架了四十分钟，冻得说不出话。',
  15: '太阳落下去之后，天空还有很久才真正黑透。',
  18: '雪线以上没有信号，也没有别的声音，只有心跳。',
  20: '那年夏天我们总在屋顶看星星，直到楼下传来叫我们回家的声音。',
};

const makeSvg = (index) => {
  const portrait = index % 5 === 0;
  const width = portrait ? 1080 : 1600;
  const height = portrait ? 1440 : 1000;
  const palette = palettes[index % palettes.length];
  const [skyA, skyB, sun, deep] = palette;
  const random = (() => {
    let t = index * 991 + 17;
    return () => {
      t = (t * 1664525 + 1013904223) % 4294967296;
      return t / 4294967296;
    };
  })();
  const sunX = width * (0.2 + random() * 0.6);
  const sunY = height * (0.24 + random() * 0.2);
  const sunR = Math.min(width, height) * (0.09 + random() * 0.1);
  const horizon = height * (0.58 + random() * 0.14);
  const stars = Array.from({ length: 70 }, () =>
    `<circle cx="${(random() * width).toFixed(1)}" cy="${(random() * horizon * 0.8).toFixed(1)}" r="${(0.6 + random() * 1.4).toFixed(1)}" fill="#fff7e7" opacity="${(0.12 + random() * 0.5).toFixed(2)}"/>`
  ).join('');
  const ridge = (yOffset, amplitude, color, opacity) => {
    const points = [];
    for (let i = 0; i <= 12; i += 1) {
      const x = (width / 12) * i;
      const y = yOffset + Math.sin(i * 1.31 + index) * amplitude + (random() - 0.5) * amplitude * 0.8;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return `<polygon points="0,${height} ${points.join(' ')} ${width},${height}" fill="${color}" opacity="${opacity}"/>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stop-color="${skyA}"/><stop offset=".62" stop-color="${skyB}"/><stop offset="1" stop-color="${sun}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="${sun}" stop-opacity=".95"/><stop offset=".35" stop-color="${sun}" stop-opacity=".42"/><stop offset="1" stop-color="${sun}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${skyB}" stop-opacity=".65"/><stop offset="1" stop-color="${deep}"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#sky)"/>
    ${stars}
    <circle cx="${sunX}" cy="${sunY}" r="${sunR * 3.8}" fill="url(#glow)" opacity=".55"/>
    <circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="${sun}" opacity=".9"/>
    <rect y="${horizon}" width="${width}" height="${height - horizon}" fill="url(#sea)"/>
    ${ridge(horizon + 12, 42, deep, .7)}
    ${ridge(horizon + 45, 62, '#03070d', .82)}
    <path d="M0 ${horizon + 8} Q ${width * .3} ${horizon - 18} ${width * .58} ${horizon + 6} T ${width} ${horizon - 2}" fill="none" stroke="${sun}" stroke-opacity=".38" stroke-width="2"/>
    <rect width="${width}" height="${height}" fill="${deep}" opacity=".06"/>
  </svg>`;
};

const login = async () => {
  const csrfRes = await fetch(base + '/api/auth/csrf', { headers: { Accept: 'application/json' } });
  rememberCookies(csrfRes);
  const csrfData = await csrfRes.json();
  csrf = csrfData.csrfToken;
  await request('/api/auth/login', { method: 'POST', body: { username: adminUser, password: adminPassword } });
};

const uploadImage = async (title, index) => {
  const image = await sharp(Buffer.from(makeSvg(index))).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const filename = `${title}.jpg`;
  const init = await request('/api/media/init', {
    method: 'POST',
    body: { filename, mime: 'image/jpeg', size: image.length },
  });
  for (let part = 1; part <= init.totalParts; part += 1) {
    const start = (part - 1) * init.chunkSize;
    const end = Math.min(image.length, start + init.chunkSize);
    await request(`/api/media/upload/${init.uploadId}/${part}`, {
      method: 'PUT', body: image.subarray(start, end), raw: true,
    });
  }
  const result = await request('/api/media/complete', { method: 'POST', body: { uploadId: init.uploadId } });
  return result.media;
};

const main = async () => {
  await login();
  const list = await request('/api/media?limit=1');
  if (list.total > 0 && !args.has('--force')) {
    console.log(`画廊已有 ${list.total} 个媒体，跳过演示写入。使用 --force 仍然写入。`);
    return;
  }
  console.log(`正在向 ${base} 写入 ${titles.length} 张演示照片…`);
  for (let i = 0; i < titles.length; i += 1) {
    const title = titles[i];
    const media = await uploadImage(title, i);
    const note = notes[i + 1];
    if (note) await request(`/api/media/${media.id}/note`, { method: 'PUT', body: { content: note } });
    process.stdout.write(`  ${String(i + 1).padStart(2, '0')}/${titles.length}  ${title}\n`);
  }
  console.log('演示数据写入完成。');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
