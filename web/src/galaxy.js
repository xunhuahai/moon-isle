import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const COSMIC_PALETTE = [
  0x9fd8ff, 0xffd27a, 0xc8a8ff, 0x8fffe0, 0xff9fc8, 0xffb36b,
  0xa8baff, 0xfff1b8, 0x7fe9ff, 0xe4a6ff, 0xff8fa8, 0xb6ffc8,
  0xffc46b, 0x9cc9ff,
];

const smoothstep01 = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const rand = (seed) => {
  let t = seed + 0x6D2B79F5;
  return () => {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

const STAR_VERTEX = `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vTwinkle;
  varying float vFlash;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float slow = 0.5 + 0.5 * sin(uTime * (1.15 + aPhase * 1.75) + aPhase * 31.4);
    float fast = 0.5 + 0.5 * sin(uTime * 4.85 + aPhase * 21.0);
    float twinkle = clamp(slow * 0.62 + fast * 0.38, 0.0, 1.0);
    vTwinkle = twinkle;
    vFlash = pow(twinkle, 5.0);
    vColor = aColor;
    float twinkleScale = 0.82 + twinkle * 0.42;
    gl_PointSize = clamp(aSize * twinkleScale * uPixelRatio * (30.0 / max(1.0, -mv.z)), 1.7 * uPixelRatio, 10.0 * uPixelRatio);
  }
`;

const STAR_FRAGMENT = `
  varying float vTwinkle;
  varying float vFlash;
  varying vec3 vColor;

  float sdStar5(vec2 p, float r, float rf) {
    const vec2 k1 = vec2(0.809016994375, -0.587785252292);
    const vec2 k2 = vec2(-k1.x, k1.y);
    p.x = abs(p.x);
    p -= 2.0 * max(dot(k1, p), 0.0) * k1;
    p -= 2.0 * max(dot(k2, p), 0.0) * k2;
    p.x = abs(p.x);
    p.y -= r;
    vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
    float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
    return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
  }

  void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float d = sdStar5(p, 0.48, 0.47);
    float aa = max(fwidth(d), 0.012);
    float body = 1.0 - smoothstep(-aa, aa, d);
    float glow = exp(-max(d, 0.0) * 17.0) * 0.34;
    float core = exp(-max(d, 0.0) * 46.0) * vFlash;
    vec3 color = vColor * (0.74 + vFlash * 1.1);
    float alpha = clamp(body * (0.2 + 0.8 * vTwinkle) + glow * (0.1 + 0.32 * vTwinkle) + core * 0.95, 0.0, 1.0);
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

const CARD_VERTEX = `
  uniform float uTime;
  uniform float uSeed;
  uniform float uWobble;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    float t = uTime * 0.55 + uSeed * 6.28318;
    p.x += sin(t + uv.y * 3.1) * 0.012 * uWobble;
    p.y += cos(t * 0.82 + uv.x * 2.7) * 0.014 * uWobble;
    p.z += sin(t * 0.66 + uv.x * 2.2) * 0.008 * uWobble;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const CARD_FRAGMENT = `
  uniform sampler2D uMap;
  uniform float uPlaneAspect;
  uniform float uImageAspect;
  uniform float uOpacity;
  uniform float uBlur;
  uniform float uHover;
  uniform float uFocus;
  uniform float uDetail;
  uniform float uCool;
  uniform float uSeed;
  uniform vec2 uTexel;
  varying vec2 vUv;

  vec4 samplePhoto(vec2 uv) {
    if (uBlur < 0.001) return texture2D(uMap, uv);
    vec2 o = uTexel * (2.0 + uBlur * 360.0);
    return texture2D(uMap, uv) * 0.34
      + texture2D(uMap, uv + vec2(o.x, 0.0)) * 0.165
      + texture2D(uMap, uv - vec2(o.x, 0.0)) * 0.165
      + texture2D(uMap, uv + vec2(0.0, o.y)) * 0.165
      + texture2D(uMap, uv - vec2(0.0, o.y)) * 0.165;
  }


  float sdStar5(vec2 p, float r, float rf) {
    const vec2 k1 = vec2(0.809016994375, -0.587785252292);
    const vec2 k2 = vec2(-k1.x, k1.y);
    p.x = abs(p.x);
    p -= 2.0 * max(dot(k1, p), 0.0) * k1;
    p -= 2.0 * max(dot(k2, p), 0.0) * k2;
    p.x = abs(p.x);
    p.y -= r;
    vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
    float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
    return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
  }


  float roundedBox(vec2 p, float radius) {
    vec2 q = abs(p) - vec2(1.0 - radius);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  }

  void main() {
    vec2 uv = vUv;
    if (uImageAspect > uPlaneAspect) {
      uv.x = (uv.x - 0.5) * (uPlaneAspect / uImageAspect) + 0.5;
    } else {
      uv.y = (uv.y - 0.5) * (uImageAspect / uPlaneAspect) + 0.5;
    }

    vec4 photo = samplePhoto(uv);
    float detail = smoothstep(0.0, 0.82, uDetail);
    float vignette = smoothstep(0.86, 0.25, length((vUv - 0.5) * vec2(1.0, 1.08)));

    // 默认只显示粒子光点；放大/聚焦后才显影出照片本身。
    vec2 particleUv = (vUv - 0.5) * vec2(uPlaneAspect, 1.0);
    float particleRadius = 0.36 * min(uPlaneAspect, 1.0);
    vec2 starP = particleUv / max(particleRadius, 0.0001);
    float starDistance = sdStar5(starP, 0.52, 0.47);
    float glow = 1.0 - smoothstep(-0.05, 0.46, starDistance);
    vec3 warmParticle = vec3(1.0, 0.76, 0.43);
    vec3 coolParticle = vec3(0.55, 0.76, 1.0);
    vec3 particleColor = mix(warmParticle, coolParticle, clamp(uCool, 0.0, 1.0));
    particleColor *= 0.52 + glow * 1.18;
    particleColor *= 0.92 + 0.08 * sin(uSeed * 41.7);

    vec3 photoColor = photo.rgb * mix(0.7, 1.04, vignette);
    photoColor *= 1.0 + uFocus * 0.06 + uHover * 0.05;
    vec3 color = mix(particleColor, photoColor, detail);

    vec2 p = abs(vUv - 0.5) * 2.0;
    float d = roundedBox(p, 0.075);
    float aa = max(fwidth(d) * 1.25, 0.002);
    float rectMask = 1.0 - smoothstep(-aa, aa, d);
    float starMask = 1.0 - smoothstep(0.0, 0.035, starDistance);
    float mask = mix(starMask, rectMask, detail);
    float edge = (1.0 - smoothstep(0.0, 0.035, abs(d))) * detail;

    vec3 warm = vec3(1.0, 0.88, 0.66);
    vec3 cool = vec3(0.62, 0.82, 1.0);
    vec3 rimColor = mix(warm, cool, max(uFocus * 0.68, uCool * 0.55));
    color += rimColor * edge * (0.18 + uHover * 0.55 + uFocus * 0.7);
    color += particleColor * uHover * 0.14 * (1.0 - detail);

    float alpha = mask * uOpacity * mix(1.0, clamp(photo.a, 0.0, 1.0), detail);
    if (alpha < 0.012) discard;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const MOON_ATMOSPHERE_VERTEX = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const MOON_ATMOSPHERE_FRAGMENT = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.85);
    vec3 color = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.9, 0.72), 0.4);
    gl_FragColor = vec4(color, 0.07 + rim * 0.48);
    #include <colorspace_fragment>
  }
`;

const makeGlowTexture = (size = 256) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.08, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.24, 'rgba(255,255,255,0.32)');
  g.addColorStop(0.56, 'rgba(255,255,255,0.07)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const makeFlareTexture = (size = 256) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.06, 'rgba(255,255,255,.94)');
  glow.addColorStop(0.2, 'rgba(255,255,255,.3)');
  glow.addColorStop(0.55, 'rgba(255,255,255,.045)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  const horizontal = ctx.createLinearGradient(0, 0, size, 0);
  horizontal.addColorStop(0, 'rgba(255,255,255,0)');
  horizontal.addColorStop(.47, 'rgba(255,255,255,.28)');
  horizontal.addColorStop(.5, 'rgba(255,255,255,.85)');
  horizontal.addColorStop(.53, 'rgba(255,255,255,.28)');
  horizontal.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, c - 1.2, size, 2.4);

  const vertical = ctx.createLinearGradient(0, 0, 0, size);
  vertical.addColorStop(0, 'rgba(255,255,255,0)');
  vertical.addColorStop(.47, 'rgba(255,255,255,.28)');
  vertical.addColorStop(.5, 'rgba(255,255,255,.85)');
  vertical.addColorStop(.53, 'rgba(255,255,255,.28)');
  vertical.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = vertical;
  ctx.fillRect(c - 1.2, 0, 2.4, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const makeMoonTexture = (width = 1024, height = 512) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const random = rand(90210);
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, '#ded9cc');
  base.addColorStop(0.45, '#cbc4b5');
  base.addColorStop(1, '#aaa190');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 22; i += 1) {
    const x = random() * width;
    const y = height * (0.18 + random() * 0.64);
    const r = 42 + random() * 118;
    const g = ctx.createRadialGradient(x, y, r * 0.08, x, y, r);
    g.addColorStop(0, 'rgba(91, 88, 81, .18)');
    g.addColorStop(0.65, 'rgba(104, 99, 88, .1)');
    g.addColorStop(1, 'rgba(104, 99, 88, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  for (let i = 0; i < 160; i += 1) {
    const x = 20 + random() * (width - 40);
    const y = 24 + random() * (height - 48);
    const r = 2.5 + Math.pow(random(), 2) * 22;
    const g = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, r * 0.05, x, y, r);
    g.addColorStop(0, 'rgba(255, 247, 222, .1)');
    g.addColorStop(0.52, 'rgba(115, 108, 93, .12)');
    g.addColorStop(0.88, 'rgba(77, 72, 62, .16)');
    g.addColorStop(1, 'rgba(77, 72, 62, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 246, 220, .09)';
    ctx.lineWidth = Math.max(0.6, r * 0.06);
    ctx.beginPath();
    ctx.arc(x - r * 0.12, y - r * 0.12, r * 0.82, Math.PI * 0.9, Math.PI * 1.75);
    ctx.stroke();
  }

  for (let i = 0; i < 2600; i += 1) {
    const x = random() * width;
    const y = random() * height;
    ctx.fillStyle = `rgba(${random() > 0.5 ? '255, 245, 218' : '77, 72, 62'}, ${(0.02 + random() * 0.055).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.4 + random() * 1.4, 0, TAU);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
};

const makeNebulaTexture = (seed = 1) => {
  const size = 768;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const random = rand(seed);
  for (let i = 0; i < 8; i += 1) {
    const x = size * (0.18 + random() * 0.64);
    const y = size * (0.2 + random() * 0.6);
    const r = size * (0.12 + random() * 0.28);
    const color = i % 3 === 0 ? '173,144,255' : i % 3 === 1 ? '84,150,255' : '255,207,143';
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(${color},0.17)`);
    gradient.addColorStop(0.5, `rgba(${color},0.06)`);
    gradient.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const makePlaceholderTexture = (media) => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 440;
  const ctx = canvas.getContext('2d');
  const random = rand(String(media?.id || 'empty').split('').reduce((a, c) => a + c.charCodeAt(0), 7));
  const hue = 205 + random() * 85;
  const g = ctx.createLinearGradient(0, 0, 640, 440);
  g.addColorStop(0, `hsl(${hue} 38% 15%)`);
  g.addColorStop(0.5, `hsl(${hue + 26} 44% 22%)`);
  g.addColorStop(1, `hsl(${hue - 32} 44% 9%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 640, 440);
  for (let i = 0; i < 70; i += 1) {
    const x = random() * 640;
    const y = random() * 440;
    const r = 1 + random() * 9;
    ctx.fillStyle = `rgba(255,240,210,${0.03 + random() * 0.11})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  if (media?.type === 'video') {
    ctx.fillStyle = 'rgba(8,12,22,.52)';
    ctx.beginPath();
    ctx.arc(82, 358, 28, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,242,210,.65)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,244,217,.9)';
    ctx.beginPath();
    ctx.moveTo(75, 345);
    ctx.lineTo(95, 358);
    ctx.lineTo(75, 371);
    ctx.closePath();
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

const drawVideoBadge = (ctx, width, height) => {
  const x = 28;
  const y = height - 28;
  ctx.save();
  ctx.fillStyle = 'rgba(5,8,16,.58)';
  ctx.beginPath();
  ctx.arc(x, y, 18, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,242,210,.65)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,246,222,.92)';
  ctx.beginPath();
  ctx.moveTo(x - 5, y - 8);
  ctx.lineTo(x + 8, y);
  ctx.lineTo(x - 5, y + 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

export class GalaxyScene {
  constructor(canvas, options = {}) {
    if (!canvas) throw new Error('缺少 WebGL canvas');
    this.canvas = canvas;
    this.options = options;
    this.onSelect = options.onSelect || (() => {});
    this.onSelectStar = options.onSelectStar || (() => {});
    this.onMoonClick = options.onMoonClick || (() => {});
    this.onRequestClose = options.onRequestClose || (() => {});
    this.onCanvasFocus = options.onCanvasFocus || (() => {});
    this.onTexturesProgress = options.onTexturesProgress || (() => {});
    this.onZoomChange = options.onZoomChange || (() => {});
    this.allowPhotoReveal = false;

    this.isMobile = window.matchMedia('(max-width: 780px)').matches;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.65 : 2);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.isMobile,
      alpha: true,
      powerPreference: 'high-performance',
      premultipliedAlpha: true,
    });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
    this.camera.position.set(0, 0, this.isMobile ? 16.5 : 14.5);
    this.baseDistance = this.camera.position.z;
    // 100% = 当前月亮视角；10% = 拉远到整片星海，看到更多星星和悬浮粒子。
    this.zoomMin = this.baseDistance;
    this.zoomMax = this.baseDistance * 10;

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.moonAnchor = new THREE.Group();
    this.starsAnchor = new THREE.Group();
    this.root.add(this.moonAnchor, this.starsAnchor);

    this.focusLayer = new THREE.Group();
    this.scene.add(this.focusLayer);
    this.focusHolder = new THREE.Group();
    this.focusLayer.add(this.focusHolder);
    this.focusHolder.visible = false;

    this.cards = [];
    this.interactiveCards = [];
    this.starHitTargets = [];
    this.orbiters = [];
    this.twinkleMaterials = [];
    this.textures = new Set();
    this.textureCache = new Map();
    this.placeholderCache = new Map();
    this.loadPromises = [];
    this.loadedTextures = 0;
    this.expectedTextures = 0;
    this.moonGroup = new THREE.Group();
    this.moonGroup.scale.setScalar(this.isMobile ? 1.08 : 1.29);
    this.moonAnchor.add(this.moonGroup);

    this.hovered = null;
    this.focusMedia = null;
    this.focusState = null;
    this.focusCard = null;
    this.focusHalo = null;
    this.focusedId = null;
    this.pointer = new THREE.Vector2(0, 0);
    this.pointerNdc = new THREE.Vector2();
    this.drag = null;
    this.pointers = new Map();
    this.pinchStart = 0;
    this.zoomTarget = this.camera.position.z;
    this.zoomReveal = 0;
    this.lastZoomPercent = -1;
    this.lastZoomReveal = -1;
    this.rotationTarget = new THREE.Vector2(0, 0);
    this.rotationCurrent = new THREE.Vector2(0, 0);
    this.lastInteraction = performance.now();
    this.hoverDirty = false;
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.timeUniform = { value: 0 };
    this.disposed = false;
    this.detailMode = false;
    this.reducedFactor = this.reducedMotion ? 0.25 : 1;
    this.glowTexture = makeGlowTexture(256);
    this.flareTexture = makeFlareTexture(256);
    this.raycastQueued = false;

    this._buildEnvironment();
    this._bindEvents();
    this._resize();
    this._animate = this._animate.bind(this);
    this.raf = requestAnimationFrame(this._animate);
  }

  _makeStarPoints({ count, radiusMin, radiusMax, sizeMin, sizeMax, tint, flatten = 1, palette = null }) {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const random = rand(count * 73 + Math.round(radiusMax * 10));
    const base = new THREE.Color(tint);
    const paletteColors = Array.isArray(palette) ? palette.map((color) => new THREE.Color(color)) : null;
    for (let i = 0; i < count; i += 1) {
      const r = radiusMin + Math.cbrt(random()) * (radiusMax - radiusMin);
      const theta = random() * TAU;
      const phi = Math.acos(2 * random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi) * flatten;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      sizes[i] = sizeMin + random() * (sizeMax - sizeMin);
      phases[i] = random();
      const chosen = paletteColors ? paletteColors[Math.floor(random() * paletteColors.length)] : base;
      const warm = 0.86 + random() * 0.14;
      colors[i * 3] = chosen.r * warm;
      colors[i * 3 + 1] = chosen.g * warm;
      colors[i * 3 + 2] = chosen.b * warm;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        uTime: this.timeUniform,
        uPixelRatio: { value: this.pixelRatio },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.twinkleMaterials.push(material);
    return new THREE.Points(geometry, material);
  }

  _buildEnvironment() {
    this.scene.add(new THREE.AmbientLight(0xf7f2e8, 0.74));
    const keyLight = new THREE.DirectionalLight(0xfff7e8, 2.15);
    keyLight.position.set(-7, 5, 9);
    this.scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x8bb8ff, 0.8);
    rimLight.position.set(8, -2, -6);
    this.scene.add(rimLight);

    const bg = new THREE.Group();
    this.bg = bg;
    this.scene.add(bg);

    const mobileScale = this.isMobile ? 0.55 : 1;
    const backgroundStars = this._makeStarPoints({
      count: Math.round(5700 * mobileScale), radiusMin: 20, radiusMax: 70,
      sizeMin: 0.8, sizeMax: 3.4, tint: 0xaebfff, palette: COSMIC_PALETTE,
    });
    bg.add(backgroundStars);

    // 更远的深空星场：缩放到 10% 时才会显出完整层次。
    const deepStars = this._makeStarPoints({
      count: Math.round(4800 * mobileScale), radiusMin: 70, radiusMax: 230,
      sizeMin: 1.4, sizeMax: 5.2, tint: 0x9db9ff, palette: COSMIC_PALETTE, flatten: 0.82,
    });
    bg.add(deepStars);

    const dust = this._makeStarPoints({
      count: Math.round(2600 * mobileScale), radiusMin: 3.4, radiusMax: 18,
      sizeMin: 0.5, sizeMax: 2.4, tint: 0xe4d5ff, palette: COSMIC_PALETTE, flatten: 0.7,
    });
    bg.add(dust);

    // 悬浮粒子：缓慢自转的彩色尘埃层，让星海更有纵深。
    const floatingMotes = this._makeStarPoints({
      count: Math.round(3200 * mobileScale), radiusMin: 3.2, radiusMax: 28,
      sizeMin: 1.1, sizeMax: 4.8, tint: 0xcad8ff, palette: COSMIC_PALETTE, flatten: 0.76,
    });
    this.driftingMotes = floatingMotes;
    this.root.add(floatingMotes);

    const nearMotes = this._makeStarPoints({
      count: Math.round(1500 * mobileScale), radiusMin: 1.5, radiusMax: 10,
      sizeMin: 0.8, sizeMax: 3.2, tint: 0xffe4b5, palette: COSMIC_PALETTE, flatten: 0.9,
    });
    this.nearMotes = nearMotes;
    this.root.add(nearMotes);

    // 扁平星带：缩放至 10% 时像一条横贯宇宙的星河。
    const galacticBand = this._makeStarPoints({
      count: Math.round(4700 * mobileScale), radiusMin: 18, radiusMax: 110,
      sizeMin: 1.2, sizeMax: 4.8, tint: 0xc9d8ff, palette: COSMIC_PALETTE, flatten: 0.13,
    });
    galacticBand.rotation.set(1.05, 0.1, 0.18);
    this.galacticBand = galacticBand;
    bg.add(galacticBand);

    // 大颗粒悬浮光点：远看是星云尘埃，近看是前景 bokeh。
    const megaMotes = this._makeStarPoints({
      count: Math.round(1000 * mobileScale), radiusMin: 12, radiusMax: 72,
      sizeMin: 2.8, sizeMax: 6.4, tint: 0xffe2a8, palette: COSMIC_PALETTE, flatten: 0.72,
    });
    this.megaMotes = megaMotes;
    this.root.add(megaMotes);

    const moonDust = this._makeStarPoints({
      count: Math.round(1100 * mobileScale), radiusMin: 0.8, radiusMax: 4.0,
      sizeMin: 0.7, sizeMax: 3.4, tint: 0xffdda2, palette: COSMIC_PALETTE, flatten: 0.9,
    });
    this.moonGroup.add(moonDust);

    const nebula1 = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeNebulaTexture(11), color: 0x7d8fff, transparent: true,
      opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    nebula1.position.set(-10, 3, -30);
    nebula1.scale.set(64, 42, 1);
    bg.add(nebula1);

    const nebula2 = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeNebulaTexture(29), color: 0xb37cff, transparent: true,
      opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    nebula2.position.set(13, -8, -35);
    nebula2.scale.set(58, 38, 1);
    bg.add(nebula2);

    const nebula3 = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeNebulaTexture(47), color: 0x52e6d0, transparent: true,
      opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    nebula3.position.set(-42, 12, -105);
    nebula3.scale.set(155, 95, 1);
    bg.add(nebula3);

    const nebula4 = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeNebulaTexture(73), color: 0xf27ad9, transparent: true,
      opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    nebula4.position.set(45, -18, -120);
    nebula4.scale.set(170, 105, 1);
    bg.add(nebula4);

    const nebula5 = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeNebulaTexture(97), color: 0xffc46b, transparent: true,
      opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    nebula5.position.set(0, 20, -90);
    nebula5.scale.set(110, 82, 1);
    bg.add(nebula5);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTexture, color: 0xffd58c, transparent: true,
      opacity: 0.66, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.set(15.5, 15.5, 1);
    halo.position.set(0, 0, -0.8);
    this.moonGroup.add(halo);

    const moonBody = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTexture, color: 0xffe9ba, transparent: true,
      opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    moonBody.scale.set(9.8, 9.8, 1);
    moonBody.position.set(0, 0, -0.5);
    this.moonGroup.add(moonBody);

    const aura = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTexture, color: 0xbcd6ff, transparent: true,
      opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    aura.scale.set(12.5, 12.5, 1);
    aura.position.set(0, 0, -0.15);
    this.moonGroup.add(aura);

    const outerHaze = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTexture, color: 0xdfe9ff, transparent: true,
      opacity: 0.23, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    outerHaze.scale.set(20, 20, 1);
    outerHaze.position.set(0, 0, -1.2);
    this.moonGroup.add(outerHaze);

    const moonTexture = makeMoonTexture();
    this.moonTexture = moonTexture;
    const moonSphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.38, 96, 64),
      new THREE.MeshStandardMaterial({
        map: moonTexture,
        color: 0xffffff,
        roughness: 1,
        metalness: 0,
        emissive: 0x3a3021,
        emissiveIntensity: 0.38,
      })
    );
    moonSphere.rotation.y = 0.35;
    moonSphere.userData.isMoon = true;
    this.moonSphere = moonSphere;
    this.moonGroup.add(moonSphere);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.54, 64, 48),
      new THREE.ShaderMaterial({
        vertexShader: MOON_ATMOSPHERE_VERTEX,
        fragmentShader: MOON_ATMOSPHERE_FRAGMENT,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.FrontSide,
      })
    );
    atmosphere.renderOrder = 3;
    this.moonGroup.add(atmosphere);

    const rings = new THREE.Group();
    const ringMaterial = new THREE.LineBasicMaterial({
      color: 0xd6bd8d, transparent: true, opacity: 0.045,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < 3; i += 1) {
      const radius = 4.4 + i * 2.1;
      const points = [];
      for (let s = 0; s <= 160; s += 1) {
        const a = (s / 160) * TAU;
        points.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius * 0.55, 0));
      }
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), ringMaterial);
      line.rotation.x = 0.9 + i * 0.22;
      line.rotation.y = -0.18 + i * 0.12;
      line.rotation.z = i * 0.32;
      rings.add(line);
    }
    this.root.add(rings);

    this.backgroundNebulae = [nebula1, nebula2];
  }

  _loadImage(url, video = false) {
    return new Promise((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        try {
          const maxSide = 900;
          const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const ctx = canvas.getContext('2d');
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          if (video) drawVideoBadge(ctx, canvas.width, canvas.height);
          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.needsUpdate = true;
          this.textures.add(texture);
          resolve(texture);
        } catch {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  _loadImageCached(url, video = false) {
    if (!url) return Promise.resolve(null);
    const key = `${video ? 'video' : 'image'}:${url}`;
    const cached = this.textureCache.get(key);
    if (cached) return cached;
    const promise = this._loadImage(url, video);
    this.textureCache.set(key, promise);
    return promise;
  }

  _placeholderFor(media) {
    if (!this.placeholderCache.has(media.id)) {
      const texture = makePlaceholderTexture(media);
      this.placeholderCache.set(media.id, texture);
      this.textures.add(texture);
    }
    return this.placeholderCache.get(media.id);
  }

  _trackTextureLoad(promise) {
    this.expectedTextures += 1;
    const tracked = promise.then((texture) => {
      this.loadedTextures += 1;
      this.onTexturesProgress(this.loadedTextures, this.expectedTextures);
      return texture;
    });
    this.loadPromises.push(tracked);
    return tracked;
  }

  _createCard(media, options = {}) {
    const rawAspect = (Number(media.width) > 0 && Number(media.height) > 0)
      ? Number(media.width) / Number(media.height)
      : 1;
    const aspect = clamp(rawAspect, 0.62, 1.65);
    const height = options.height || 1;
    const placeholder = this._placeholderFor(media);
    const material = new THREE.ShaderMaterial({
      vertexShader: CARD_VERTEX,
      fragmentShader: CARD_FRAGMENT,
      uniforms: {
        uMap: { value: placeholder },
        uPlaneAspect: { value: aspect },
        uImageAspect: { value: aspect },
        uOpacity: { value: options.opacity ?? 1 },
        uBlur: { value: 0 },
        uHover: { value: 0 },
        uFocus: { value: options.focus ? 1 : 0 },
        uDetail: { value: options.focus ? 1 : 0.012 },
        uCool: { value: options.cool ?? Math.random() },
        uTexel: { value: new THREE.Vector2(1 / 640, 1 / 640) },
        uTime: this.timeUniform,
        uSeed: { value: Math.random() },
        uWobble: { value: options.wobble ?? 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.scale.set(height * aspect, height, 1);
    mesh.userData.card = this;
    mesh.userData.media = media;
    mesh.userData.baseHeight = height;
    mesh.userData.baseScale = new THREE.Vector3(height * aspect, height, 1);
    mesh.userData.phase = Math.random() * TAU;
    mesh.userData.bob = options.bob ?? 0.045;
    mesh.userData.baseOpacity = options.opacity ?? 1;
    mesh.userData.disposed = false;
    mesh.userData.decor = Boolean(options.decor);
    mesh.renderOrder = options.renderOrder || 0;

    const texturePromise = this._trackTextureLoad(this._loadImageCached(media.urls.thumb, media.type === 'video'));
    texturePromise.then((texture) => {
      if (!texture || mesh.userData.disposed) return;
      material.uniforms.uMap.value = texture;
      const imageAspect = texture.image.width / texture.image.height;
      material.uniforms.uImageAspect.value = imageAspect;
      material.uniforms.uTexel.value.set(1 / Math.max(1, texture.image.width), 1 / Math.max(1, texture.image.height));
      material.needsUpdate = true;
      if (options.focus) this._layoutFocus();
    });

    if (options.focus) {
      const previewPromise = this._trackTextureLoad(this._loadImageCached(media.urls.preview, media.type === 'video'));
      previewPromise.then((texture) => {
        if (!texture || mesh.userData.disposed) return;
        material.uniforms.uMap.value = texture;
        const imageAspect = texture.image.width / texture.image.height;
        material.uniforms.uImageAspect.value = imageAspect;
        material.uniforms.uTexel.value.set(1 / Math.max(1, texture.image.width), 1 / Math.max(1, texture.image.height));
        material.needsUpdate = true;
      });
    }
    return mesh;
  }


  _clusterPoints(count, radius) {
    const points = this._makeStarPoints({
      count, radiusMin: 0.05, radiusMax: radius, sizeMin: 0.6, sizeMax: 2.8, tint: 0xbfe1ff, flatten: 0.9,
    });
    return points;
  }

  _createStarTrail(tint, radius, direction, tailTint = null) {
    const segments = 34;
    const span = 0.52;
    const baseColor = new THREE.Color(tint);
    const tailColor = new THREE.Color(tailTint || tint);
    const positions = [];
    const colors = [];
    const indices = [];
    const pointPositions = [];
    const pointColors = [];
    for (let i = 0; i <= segments; i += 1) {
      const f = i / segments;
      const angle = -direction * f * span;
      const width = Math.pow(1 - f, 1.9) * (this.isMobile ? 0.085 : 0.11) + 0.003;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rIn = radius - width;
      const rOut = radius + width;
      positions.push(cos * rIn, 0, -sin * rIn);
      positions.push(cos * rOut, 0, -sin * rOut);
      const fade = Math.pow(1 - f, 2.25);
      const mixed = baseColor.clone().lerp(tailColor, Math.pow(f, 0.72));
      const r = mixed.r * fade;
      const g = mixed.g * fade;
      const b = mixed.b * fade;
      colors.push(r, g, b, r, g, b);
      pointPositions.push(cos * radius, 0, -sin * radius);
      pointColors.push(r, g, b);
      if (i < segments) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const ribbonGeometry = new THREE.BufferGeometry();
    ribbonGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    ribbonGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    ribbonGeometry.setIndex(indices);
    ribbonGeometry.computeBoundingSphere();
    const ribbon = new THREE.Mesh(
      ribbonGeometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.36,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    ribbon.frustumCulled = false;
    ribbon.renderOrder = 1;

    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3));
    pointsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(pointColors, 3));
    const points = new THREE.Points(
      pointsGeometry,
      new THREE.PointsMaterial({
        size: this.isMobile ? 0.05 : 0.04, vertexColors: true, transparent: true,
        opacity: 0.78, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      })
    );
    points.frustumCulled = false;
    points.renderOrder = 2;
    return { ribbon, points };
  }

  _buildStars(items) {
    if (!items.length) return;
    const random = rand(items.length * 13 + 5);
    const tints = COSMIC_PALETTE;
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // 每颗真实星星只承载一张照片；照片越多，星体越多。
    const chunks = shuffled.map((item) => [item]);
    const clusterCount = chunks.length;

    chunks.forEach((chunk, index) => {
      const tint = tints[index % tints.length];
      const orbit = new THREE.Group();
      const spinner = new THREE.Group();
      const angle = (index / clusterCount) * TAU + random() * 0.42;
      const radius = (this.isMobile ? 4.2 : 5.7) + random() * (this.isMobile ? 1.65 : 3.0);
      const baseY = (random() - 0.45) * (this.isMobile ? 3.6 : 3.9);
      const tiltX = (random() - 0.5) * 0.62;
      const tiltZ = (random() - 0.5) * 0.42;
      const orbitSpeed = (random() > 0.5 ? 1 : -1) * (0.02 + random() * 0.035);

      orbit.position.set(0, baseY, 0);
      orbit.rotation.set(tiltX, 0, tiltZ);
      spinner.rotation.y = angle;
      orbit.add(spinner);
      this.starsAnchor.add(orbit);

      // 完整星轨：与星星实际轨道同一平面，3D 倾斜环绕月亮。
      const ringPoints = [];
      const ringSegments = 160;
      for (let i = 0; i < ringSegments; i += 1) {
        const a = (i / ringSegments) * TAU;
        ringPoints.push(new THREE.Vector3(Math.cos(a) * radius, 0, -Math.sin(a) * radius));
      }
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(ringPoints),
        new THREE.LineBasicMaterial({
          color: tint, transparent: true, opacity: 0.085,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      ring.frustumCulled = false;
      orbit.add(ring);

      // 星轨：一条随星星一起环绕、向尾部渐隐的光带。
      const trail = this._createStarTrail(tint, radius, Math.sign(orbitSpeed) || 1, tints[(index * 5 + 3) % tints.length]);
      spinner.add(trail.ribbon, trail.points);

      const cluster = new THREE.Group();
      cluster.position.set(radius, 0, 0);
      spinner.add(cluster);

      const starHit = new THREE.Mesh(
        new THREE.SphereGeometry(this.isMobile ? 1.35 : 1.0, 10, 8),
        new THREE.MeshBasicMaterial({
          transparent: true, opacity: 0, colorWrite: false, depthWrite: false, depthTest: false,
        })
      );
      starHit.userData.starMedia = chunk;
      starHit.userData.isStarHit = true;
      cluster.add(starHit);
      this.starHitTargets.push(starHit);

      const core = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.flareTexture, color: tint,
        transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      core.scale.set(2.9, 2.9, 1);
      cluster.add(core);

      const sparkles = this._clusterPoints(Math.min(96, 54 + chunk.length * 8), 0.72);
      cluster.add(sparkles);

      const clusterCards = [];
      chunk.forEach((media, cardIndex) => {
        const localRandom = rand(index * 100 + cardIndex * 17 + 3);
        const height = (0.22 + localRandom() * 0.22) * (this.isMobile ? 0.9 : 1);
        const card = this._createCard(media, {
          height, opacity: 0.93, bob: 0.025 + localRandom() * 0.02, wobble: 1.1,
          cool: index % 3 === 0 ? 0.16 : 0.72, renderOrder: 4,
        });
        // 把同一星团里的照片沿小环散开，减少卡片相互穿插。
        const spreadAngle = (cardIndex / Math.max(1, chunk.length)) * TAU + localRandom() * 0.3;
        const spreadRadius = chunk.length > 1 ? 0.44 : 0.2;
        card.position.set(
          Math.cos(spreadAngle) * spreadRadius,
          Math.sin(spreadAngle) * spreadRadius * 0.68,
          (cardIndex % 2 ? 0.18 : -0.18) + (localRandom() - 0.5) * 0.18
        );
        card.userData.basePosition = card.position.clone();
        card.userData.clusterType = 'star';
        card.userData.phase = localRandom() * TAU;
        card.userData.cluster = cluster;
        cluster.add(card);
        clusterCards.push(card);
        this.cards.push(card);
        this.interactiveCards.push(card);
      });


      const orbiter = {
        orbit, spinner, cluster, core, ring, trail,
        radius, baseY, tiltX, tiltZ, phase: random() * TAU,
        speed: orbitSpeed, cards: clusterCards,
      };
      this.orbiters.push(orbiter);
    });
  }
  async setMedia(mediaList) {
    this._clearFocusObject();
    this.focusState = null;
    this.focusMedia = null;
    this.focusedId = null;
    this._clearCards();
    this.loadPromises = [];
    this.loadedTextures = 0;
    this.expectedTextures = 0;
    const list = Array.isArray(mediaList) ? mediaList.slice(0, 120) : [];
    this.setMediaCount = list.length;
    if (!list.length) return;
    this._buildStars(list);
    await Promise.all(this.loadPromises).catch(() => {});
  }

  _clearCards() {
    for (const card of this.cards) this._disposeCard(card);
    this.cards = [];
    this.interactiveCards = [];
    this.starHitTargets = [];
    this.orbiters = [];
    this.hovered = null;
    while (this.starsAnchor.children.length) {
      const pivot = this.starsAnchor.children.pop();
      pivot.traverse((obj) => {
        if (obj !== pivot) {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose?.();
        }
      });
    }
  }

  _disposeCard(card) {
    card.userData.disposed = true;
    card.geometry?.dispose();
    card.material?.dispose();
    card.removeFromParent();
  }

  _clearFocusObject() {
    if (this.focusCard) this._disposeCard(this.focusCard);
    this.focusCard = null;
    if (this.focusHalo) {
      this.focusHalo.material?.dispose();
      this.focusHalo.removeFromParent();
      this.focusHalo = null;
    }
    this.focusHolder.visible = false;
  }

  focus(media) {
    if (!media) return;
    this._clearFocusObject();
    this.focusState = null;
    this.focusMedia = media;
    this.focusedId = media.id;
    const rawAspect = (Number(media.width) > 0 && Number(media.height) > 0)
      ? Number(media.width) / Number(media.height)
      : 1;
    const height = 3.5;
    const card = this._createCard(media, { height, opacity: 1, focus: true, bob: 0, wobble: 0.45 });
    card.userData.isFocusCard = true;
    this.focusCard = card;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTexture, color: 0xffdf9f, transparent: true,
      opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.focusHalo = halo;
    this.focusHolder.add(halo, card);
    this.focusHolder.visible = true;
    this.focusState = { start: performance.now(), closing: false, aspect: rawAspect };
    this.focusHolder.scale.setScalar(0.9);
    this._layoutFocus();
  }

  clearFocus() {
    if (!this.focusState) {
      this._clearFocusObject();
      return;
    }
    if (this.focusState.closing) return;
    this.focusState.closing = true;
    this.focusState.closeStart = performance.now();
    this.focusedId = null;
    this.focusMedia = null;
  }

  _layoutFocus() {
    if (!this.focusCard) return;
    const camera = this.camera;
    const distance = this.isMobile ? 5.0 : 5.4;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const visibleH = 2 * Math.tan(vFov / 2) * distance;
    const visibleW = visibleH * camera.aspect;
    const aspect = clamp(this.focusState?.aspect || 1, 0.48, 1.9);
    const maxH = this.isMobile ? Math.min(visibleH * 0.235, 3.0) : Math.min(visibleH * 0.64, 4.9);
    const maxW = visibleW * (this.isMobile ? 0.8 : 0.56);
    let h = maxH;
    let w = h * aspect;
    if (w > maxW) {
      w = maxW;
      h = w / aspect;
    }
    this.focusCard.scale.set(w, h, 1);
    this.focusCard.userData.baseScale.set(w, h, 1);
    this.focusCard.userData.layoutHeight = h;
    this.focusLayer.position.set(0, 0, camera.position.z - distance);
    this.focusBasePosition = new THREE.Vector3(
      this.isMobile ? 0 : -visibleW * 0.1,
      this.isMobile ? visibleH * 0.26 : 0,
      0
    );
    this.focusHolder.position.copy(this.focusBasePosition);
    this.focusCard.position.set(0, 0, 0);
    if (this.focusHalo) {
      this.focusHalo.position.set(0, 0, -0.22);
      this.focusHalo.scale.set(w * 1.28, h * 1.28, 1);
    }
  }

  _resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this._layoutFocus();
  }

  _pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.camera.updateMatrixWorld();
    this.root.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    // 月亮优先：即使有星团从月亮前方穿过，点击月亮仍然触发登录。
    if (this.moonSphere) {
      const moonHits = this.raycaster.intersectObject(this.moonSphere, false);
      if (moonHits.length) return this.moonSphere;
    }
    const objects = [...this.interactiveCards, ...this.starHitTargets];
    if (this.focusCard && this.focusHolder.visible) objects.push(this.focusCard);
    const hits = this.raycaster.intersectObjects(objects, false);
    return hits.length ? hits[0].object : null;
  }

  _scheduleHover(clientX, clientY) {
    if (this.raycastQueued) return;
    this.raycastQueued = true;
    requestAnimationFrame(() => {
      this.raycastQueued = false;
      if (this.drag?.moved) return;
      const hit = this._pick(clientX, clientY);
      const card = hit?.userData?.media ? hit : null;
      const photoInteractive = Boolean(this.allowPhotoReveal && (card || hit?.userData?.isStarHit));
      const moonInteractive = Boolean(hit?.userData?.isMoon);
      if (card !== this.hovered) this.hovered = card;
      this.canvas.style.cursor = photoInteractive || moonInteractive ? 'pointer' : 'grab';
    });
  }

  zoomStep(direction) {
    const factor = direction > 0 ? 0.86 : 1.16;
    this.zoomTarget = clamp(this.zoomTarget * factor, this.zoomMin, this.zoomMax);
    this.lastInteraction = performance.now();
  }

  resetZoom() {
    this.zoomTarget = this.baseDistance;
    this.lastInteraction = performance.now();
  }

  setAuthenticated(value) {
    this.allowPhotoReveal = Boolean(value);
  }

  setDetailMode(value) {
    this.detailMode = Boolean(value);
    this.starsAnchor.visible = !this.detailMode && !(this.focusState && !this.focusState.closing);
  }

  _bindEvents() {
    const c = this.canvas;
    c.style.touchAction = 'none';

    c.addEventListener('pointerdown', (event) => {
      if (this.focusState && !this.focusState.closing) {
        // 聚焦时仍允许轻微拖动关闭手势，但不旋转背景。
      }
      c.setPointerCapture?.(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        this.drag = null;
        return;
      }
      this.drag = {
        x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
        startTime: performance.now(), moved: false,
      };
      this.lastInteraction = performance.now();
      c.style.cursor = 'grabbing';
    });

    c.addEventListener('pointermove', (event) => {
      this.pointer.set(
        (event.clientX / window.innerWidth) * 2 - 1,
        -((event.clientY / window.innerHeight) * 2 - 1)
      );
      if (this.pointers.has(event.pointerId)) {
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchStart > 0) {
          const delta = (this.pinchStart - distance) * 0.012;
          this.zoomTarget = clamp(this.zoomTarget + delta, this.zoomMin, this.zoomMax);
          this.pinchStart = distance;
          this.lastInteraction = performance.now();
        }
        return;
      }
      if (this.drag) {
        const dx = event.clientX - this.drag.x;
        const dy = event.clientY - this.drag.y;
        if (Math.abs(event.clientX - this.drag.startX) + Math.abs(event.clientY - this.drag.startY) > 6) {
          this.drag.moved = true;
        }
        this.rotationTarget.x = clamp(this.rotationTarget.x + dy * 0.0024, -0.62, 0.62);
        this.rotationTarget.y += dx * 0.0032;
        this.drag.x = event.clientX;
        this.drag.y = event.clientY;
        this.lastInteraction = performance.now();
      } else {
        this._scheduleHover(event.clientX, event.clientY);
      }
    });

    const endPointer = (event) => {
      const wasDrag = this.drag;
      this.pointers.delete(event.pointerId);
      if (this.pointers.size < 2) this.pinchStart = 0;
      if (this.pointers.size === 0) {
        this.drag = null;
        c.style.cursor = this.hovered ? 'pointer' : 'grab';
      }
      if (!wasDrag || wasDrag.moved) return;
      const duration = performance.now() - wasDrag.startTime;
      if (duration > 650) return;
      const hit = this.pickAt(event.clientX, event.clientY);
      if (hit?.userData?.isMoon) {
        this.onMoonClick();
      } else if (hit?.userData?.isStarHit) {
        this.onSelectStar(hit.userData.starMedia || []);
      } else if (hit) {
        const media = hit.userData.media;
        if (media) {
          if (this.focusedId !== media.id) this.onSelect(media);
        }
      } else if (this.focusState && !this.focusState.closing) {
        this.onRequestClose();
      }
    };
    c.addEventListener('pointerup', endPointer);
    c.addEventListener('pointercancel', (event) => {
      this.pointers.delete(event.pointerId);
      this.drag = null;
    });
    c.addEventListener('pointerleave', () => {
      if (!this.drag) {
        this.hovered = null;
        c.style.cursor = 'grab';
      }
    });
    c.addEventListener('wheel', (event) => {
      event.preventDefault();
      const factor = event.deltaMode === 1 ? 0.04 : 0.0014;
      this.zoomTarget = clamp(this.zoomTarget + event.deltaY * factor, this.zoomMin, this.zoomMax);
      this.lastInteraction = performance.now();
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this._resize());
  }

  pickAt(clientX, clientY) {
    return this._pick(clientX, clientY);
  }

  getStarScreenPositions() {
    this.root.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3();
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    return this.starHitTargets.map((hit) => {
      hit.getWorldPosition(v);
      const projected = v.clone().project(this.camera);
      return {
        x: (projected.x * 0.5 + 0.5) * width,
        y: (-projected.y * 0.5 + 0.5) * height,
        visible: projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 0.94 && Math.abs(projected.y) < 0.94,
      };
    });
  }

  _animate() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this._animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const motion = this.reducedFactor;
    this.timeUniform.value = t;

    const idle = performance.now() - this.lastInteraction > 4500;
    if (idle && !this.focusState) {
      this.rotationTarget.y += dt * 0.0035 * motion;
    }
    this.rotationCurrent.lerp(this.rotationTarget, 0.055);
    this.root.rotation.y = this.rotationCurrent.y + this.pointer.x * 0.060 * motion;
    this.root.rotation.x = this.rotationCurrent.x - this.pointer.y * 0.040 * motion;
    // 背景层也跟随鼠标，但幅度更小；缩放到 10% 时整片星海都有轻微视差。
    if (this.bg) {
      const bgTargetY = this.pointer.x * 0.030 * motion;
      const bgTargetX = -this.pointer.y * 0.021 * motion;
      const bgEase = 1 - Math.exp(-dt * 3.2);
      this.bg.rotation.y += (bgTargetY - this.bg.rotation.y) * bgEase;
      this.bg.rotation.x += (bgTargetX - this.bg.rotation.x) * bgEase;
    }

    this.camera.position.z += (this.zoomTarget - this.camera.position.z) * (1 - Math.exp(-dt * 9));
    if (Math.abs(this.zoomTarget - this.camera.position.z) < 0.03) this.camera.position.z = this.zoomTarget;
    const zoomPercent = clamp(Math.round((this.baseDistance / this.camera.position.z) * 100), 10, 100);
    const zoomReveal = 0;
    this.zoomReveal = zoomReveal;
    if (zoomPercent !== this.lastZoomPercent || Math.abs(zoomReveal - this.lastZoomReveal) > 0.01) {
      this.lastZoomPercent = zoomPercent;
      this.lastZoomReveal = zoomReveal;
      this.onZoomChange(zoomPercent, zoomReveal);
    }
    if (this.focusCard) this._layoutFocus();

    const focusActive = Boolean(this.focusState && !this.focusState.closing);
    // 聚焦单张照片时收起整片星团/星轨，防止它们穿过前景照片。
    this.starsAnchor.visible = !this.detailMode && !focusActive;
    for (const card of this.cards) {
      const isHovered = card === this.hovered && !focusActive;
      const isFocusedOriginal = focusActive && card.userData.media?.id === this.focusedId;
      const u = card.material.uniforms;
      const targetOpacity = focusActive ? (isFocusedOriginal ? 0.0 : 0.16) : card.userData.baseOpacity;
      const targetBlur = focusActive && !isFocusedOriginal ? 0.0055 : 0;
      const targetDetail = focusActive ? 0 : this.zoomReveal;
      u.uOpacity.value += (targetOpacity - u.uOpacity.value) * 0.1;
      u.uBlur.value += (targetBlur - u.uBlur.value) * 0.1;
      u.uHover.value += ((isHovered ? 1 : 0) - u.uHover.value) * 0.14;
      u.uDetail.value += (targetDetail - u.uDetail.value) * 0.075;

      const base = card.userData.basePosition;
      if (base) {
        const phase = card.userData.phase || 0;
        const bob = card.userData.bob || 0;
        card.position.x = base.x + Math.sin(t * 0.42 * motion + phase) * bob * 0.45;
        card.position.y = base.y + Math.cos(t * 0.55 * motion + phase) * bob;
        card.position.z = base.z + Math.sin(t * 0.33 * motion + phase * 1.3) * bob * 0.35;
      }
      const hoverScale = 1 + u.uHover.value * 0.035;
      const dimScale = focusActive && !isFocusedOriginal ? 0.95 : 1;
      const revealScale = 1 + this.zoomReveal * 0.34;
      const s = card.userData.baseScale;
      card.scale.set(s.x * hoverScale * dimScale * revealScale, s.y * hoverScale * dimScale * revealScale, 1);
    }

    for (const orbiter of this.orbiters) {
      orbiter.spinner.rotation.y += orbiter.speed * dt * motion * 1.42;
      orbiter.orbit.position.y = orbiter.baseY + Math.sin(t * 0.34 * motion + orbiter.phase) * 0.16;
      orbiter.orbit.rotation.x = orbiter.tiltX + Math.sin(t * 0.17 + orbiter.phase) * 0.045 * motion;
      orbiter.orbit.rotation.z = orbiter.tiltZ + Math.cos(t * 0.13 + orbiter.phase) * 0.032 * motion;
      const pulse = 1 + Math.sin(t * 0.8 * motion + orbiter.phase) * 0.07;
      orbiter.core.scale.set(2.9 * pulse, 2.9 * pulse, 1);
      orbiter.ring.material.opacity = 0.06 + Math.sin(t * 0.38 + orbiter.phase) * 0.018 * motion;
    }

    this.moonGroup.rotation.y += dt * 0.032 * motion;
    this.moonGroup.rotation.x = Math.sin(t * 0.18) * 0.045 * motion;
    if (this.backgroundNebulae) {
      this.backgroundNebulae[0].material.opacity = 0.34 + Math.sin(t * 0.09) * 0.04;
      this.backgroundNebulae[1].material.opacity = 0.22 + Math.cos(t * 0.07) * 0.035;
    }
    if (this.driftingMotes) {
      this.driftingMotes.rotation.y += dt * 0.008 * motion;
      this.driftingMotes.rotation.x = Math.sin(t * 0.035) * 0.05 * motion;
    }
    if (this.nearMotes) {
      this.nearMotes.rotation.y -= dt * 0.012 * motion;
      this.nearMotes.rotation.z = Math.cos(t * 0.04) * 0.035 * motion;
    }
    if (this.megaMotes) {
      this.megaMotes.rotation.y -= dt * 0.0035 * motion;
      this.megaMotes.rotation.x = Math.sin(t * 0.02) * 0.03 * motion;
    }
    if (this.galacticBand) {
      this.galacticBand.rotation.y += dt * 0.0012 * motion;
    }

    if (this.focusState) {
      const elapsed = performance.now() - this.focusState.start;
      if (this.focusState.closing) {
        const closingElapsed = performance.now() - this.focusState.closeStart;
        const progress = clamp(1 - closingElapsed / 260, 0, 1);
        this._applyFocusMotion(progress, t, focusActive);
        if (progress <= 0) {
          this.focusState = null;
          this._clearFocusObject();
        }
      } else {
        const progress = clamp(elapsed / 620, 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        this._applyFocusMotion(eased, t, true);
      }
    }

    this.root.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();
    for (const card of this.cards) card.lookAt(this.camera.position);
    if (this.focusCard) this.focusCard.lookAt(this.camera.position);

    this.renderer.render(this.scene, this.camera);
  }

  _applyFocusMotion(progress, t, focusActive) {
    if (!this.focusCard) return;
    this.focusHolder.visible = true;
    this.focusHolder.scale.setScalar(0.9 + 0.1 * progress);
    this.focusHolder.rotation.y = this.pointer.x * 0.072 * progress;
    this.focusHolder.rotation.x = -this.pointer.y * 0.05 * progress;
    const base = this.focusBasePosition || new THREE.Vector3();
    this.focusHolder.position.set(
      base.x + this.pointer.x * 0.14 * progress,
      base.y + this.pointer.y * 0.09 * progress,
      base.z
    );
    this.focusCard.material.uniforms.uOpacity.value = progress;
    this.focusCard.material.uniforms.uFocus.value = 1;
    if (this.focusHalo) this.focusHalo.material.opacity = 0.08 + 0.06 * progress;
    const breathe = 1 + Math.sin(t * 0.8) * 0.006 * (focusActive ? 1 : 0);
    this.focusHolder.scale.multiplyScalar(breathe);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this._clearCards();
    this._clearFocusObject();
    this.renderer.dispose();
    this.glowTexture?.dispose();
    this.flareTexture?.dispose();
    for (const texture of this.textures) texture.dispose?.();
    this.textures.clear();
    this.textureCache.clear();
    this.placeholderCache.clear();
  }
}
