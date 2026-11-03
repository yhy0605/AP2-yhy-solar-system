// ============================================================================
// main.js —— AP2 三维层级场景：太阳系
//
// 核心结构：
//   世界原点 = 太阳
//   ├─ 太阳            M = R_y(自转) · S(r)
//   ├─ 各行星轨道框架   M_orbit = R_y(公转角) · T(轨道半径,0,0)
//   │   ├─ 行星本体    M = M_orbit · R_z(轴倾角) · R_y(自转角) · S(r)   ← 先倾角后自转
//   │   └─ (土星) 环   M = M_orbit · R_z(轴倾角) · S(r)
//   └─ (地球) 月球轨道框架（手工矩阵）
//         M_moonTrack = R_z(5.145°) · R_y(公转角) · T(月距,0,0)
//         月球 M = M_orbitEarth · M_moonTrack · R_y(公转角, 潮汐锁定) · S(r)
//
// 相机：V = T(0,0,-dist) · R_trackball（虚拟轨迹球，选做 E3）
//       漫游：关键帧 Catmull-Rom 插值 lookAt，空格暂停/继续，拖拽随时接管。
// 投影：O 键切换 透视 / 正交（正交视场按当前距离匹配透视取景框）。
// ============================================================================

"use strict";

// ---------------------------------------------------------------- 状态
const state = {
  simYears: 0,        // 模拟“地球年”数（受公转速度滑条控制）
  spinClock: 0,       // 自转累计时钟（秒，受自转速度滑条控制）
  orbitSpeed: 1.0,    // 公转速度倍率
  spinSpeed: 1.0,     // 自转速度倍率
  earthTiltDeg: CONFIG.planets.find((p) => p.key === "earth").tiltDeg, // 地球轴倾角（滑条）
  projMode: "persp",  // 'persp' | 'ortho'
  focusKey: null,     // 单击聚焦的天体（null = 太阳系全景，相机围绕原点）
  showOrbits: true,
  showStars: true,
  showBelt: true,
  showRing: true,
  // 相机
  viewMode: "user",   // 'user'（轨迹球） | 'blend'（接回漫游中） | 'roam'（漫游中）
  R_acc: rotate(18, 1, 0, 0),   // 轨迹球累积旋转
  dist: CONFIG.camera.initDist, // 相机到原点距离
  roamT: 0,           // 漫游参数 [0,1)
  blendK: 0,          // 漫游混合进度 [0,1]
  lastLookAt: null,   // 最近一帧 lookAt 型相机的 {eye, up}（供接管捕获）
};

// 由真实自转周期换算显示周期（压缩，见 config.TIME_SCALE）
function spinSeconds(spinDays) {
  const TS = CONFIG.TIME_SCALE;
  const s = Math.abs(spinDays) * TS.DAY_SEC;
  const clamped = Math.max(TS.SPIN_MIN_SEC, Math.min(TS.SPIN_MAX_SEC, s));
  return Math.sign(spinDays) * clamped;
}

// ============================================================================
// 手工构造矩阵（作业要求 2：至少一处运动不用封装复合函数）
// ----------------------------------------------------------------------------
// 月球轨道面倾角：月球轨道面相对地球绕日轨道面（黄道面）倾斜约 5.145°。
// 这里不用任何现成的“轨道”复合函数，而是：
//   ① 手工展开绕 Z 轴旋转 α 度的齐次变换矩阵的全部 16 个元素（列主序）；
//   ② 再用 MV.js 的基本变换 rotate() / translate() 通过 mult() 逐项组合，
//     得到 月球轨道框架 = Rz(5.145°) · Ry(公转角) · T(月距, 0, 0)。
// 数学推导见 README.md「手动矩阵的构造说明」。
function manualRotateZ(deg) {
  const a = radians(deg);
  const c = Math.cos(a);
  const s = Math.sin(a);
  // 绕 Z 轴旋转（数学形式按行书写）：
  //   [ c  -s   0  0 ]
  //   [ s   c   0  0 ]
  //   [ 0   0   1  0 ]
  //   [ 0   0   0  1 ]
  // 列主序存储：第 k 列 = 矩阵作用于基向量 e_k 的结果
  return [
    c, s, 0, 0,     // 第 0 列：R·e_x = (c, s, 0)
    -s, c, 0, 0,    // 第 1 列：R·e_y = (-s, c, 0)
    0, 0, 1, 0,     // 第 2 列：R·e_z = e_z
    0, 0, 0, 1,     // 第 3 列：齐次坐标平移分量（旋转无平移）
  ];
}

// ============================================================================
// WebGL 初始化
// ============================================================================
const canvas = document.getElementById("glcanvas");
// 课程要求 WebGL 2.0（其完全兼容本作业使用的 GLSL ES 1.00 着色器与 WebGL 1 API）；
// 极个别旧环境回退到 WebGL 1.0 仍可运行
const gl = canvas.getContext("webgl2", { antialias: true }) ||
           canvas.getContext("webgl", { antialias: true });
if (!gl) alert("当前浏览器不支持 WebGL");

function compileShader(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error("Shader 编译失败: " + gl.getShaderInfoLog(sh));
  return sh;
}

function makeProgram(vsSrc, fsSrc) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error("Program 链接失败: " + gl.getProgramInfoLog(prog));
  return prog;
}

// ---------------- 程序 1：纹理 + 简单光照（天体） ----------------
const texProg = makeProgram(
`attribute vec4 aPosition;
attribute vec3 aNormal;
attribute vec2 aTexCoord;
uniform mat4 uModel, uView, uProj;
uniform mat3 uNormalMat;
varying vec2 vTexCoord;
varying vec3 vNormal, vWorldPos;
void main() {
  vec4 wp = uModel * aPosition;
  vWorldPos = wp.xyz;
  vNormal = uNormalMat * aNormal;
  vTexCoord = aTexCoord;
  gl_Position = uProj * uView * wp;
}`,
`precision mediump float;
varying vec2 vTexCoord;
varying vec3 vNormal, vWorldPos;
uniform sampler2D uSampler;
uniform float uEmissive, uAmbient;
void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(-vWorldPos);            // 点光源位于原点（太阳）
  float diff = max(dot(N, L), 0.0);
  float light = uAmbient + (1.0 - uEmissive) * diff;
  vec4 tex = texture2D(uSampler, vTexCoord);
  gl_FragColor = vec4(tex.rgb * light, tex.a);
}`);

// ---------------- 程序 2：纯色线（轨道线） ----------------
const lineProg = makeProgram(
`attribute vec4 aPosition;
uniform mat4 uModel, uView, uProj;
void main() { gl_Position = uProj * uView * uModel * aPosition; }`,
`precision mediump float;
uniform vec4 uColor;
void main() { gl_FragColor = uColor; }`);

// ---------------- 程序 3：点（星空 / 小行星带，圆形点精灵） ----------------
const pointProg = makeProgram(
`attribute vec4 aPosition;
attribute vec3 aColor;
attribute float aSize;
uniform mat4 uModel, uView, uProj;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uProj * uView * uModel * aPosition;
  gl_PointSize = aSize;
}`,
`precision mediump float;
varying vec3 vColor;
void main() {
  if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard; // 圆形点
  gl_FragColor = vec4(vColor, 1.0);
}`);

const U = (prog, name) => gl.getUniformLocation(prog, name);
const A = (prog, name) => gl.getAttribLocation(prog, name);

const texU = {
  model: U(texProg, "uModel"), view: U(texProg, "uView"), proj: U(texProg, "uProj"),
  normal: U(texProg, "uNormalMat"), sampler: U(texProg, "uSampler"),
  emissive: U(texProg, "uEmissive"), ambient: U(texProg, "uAmbient"),
};
const texA = { pos: A(texProg, "aPosition"), normal: A(texProg, "aNormal"), uv: A(texProg, "aTexCoord") };
const lineU = { model: U(lineProg, "uModel"), view: U(lineProg, "uView"), proj: U(lineProg, "uProj"), color: U(lineProg, "uColor") };
const lineA = { pos: A(lineProg, "aPosition") };
const pointU = { model: U(pointProg, "uModel"), view: U(pointProg, "uView"), proj: U(pointProg, "uProj") };
const pointA = { pos: A(pointProg, "aPosition"), color: A(pointProg, "aColor"), size: A(pointProg, "aSize") };

// ---------------- 缓冲工具 ----------------
function makeBuffer(data, usage = gl.STATIC_DRAW) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  return buf;
}
function useAttrib(loc, buffer, size) {
  if (loc < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

// ============================================================================
// 几何体与缓冲
// ============================================================================
const sphere = createSphere(48, 96);
const sphereBufs = {
  pos: makeBuffer(sphere.positions), normal: makeBuffer(sphere.normals),
  uv: makeBuffer(sphere.texCoords), idx: (() => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW);
    return b;
  })(),
};

const ringGeo = createAnnulus(CONFIG.planets.find((p) => p.key === "saturn").ring.inner,
                              CONFIG.planets.find((p) => p.key === "saturn").ring.outer, 128);
const ringBufs = {
  pos: makeBuffer(ringGeo.positions), normal: makeBuffer(ringGeo.normals),
  uv: makeBuffer(ringGeo.texCoords), idx: (() => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ringGeo.indices, gl.STATIC_DRAW);
    return b;
  })(),
};

const circleBuf = makeBuffer(createCircle(256)); // 单位圆（轨道线）

// ---------------- 星空（静态） ----------------
const stars = (() => {
  const n = CONFIG.stars.count, R = CONFIG.stars.radius;
  const pos = new Float32Array(n * 3), color = new Float32Array(n * 3), size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // 均匀分布在球面上
    const u = Math.random() * 2 - 1;
    const th = Math.random() * 2 * Math.PI;
    const r = Math.sqrt(1 - u * u);
    pos[3 * i] = R * r * Math.cos(th);
    pos[3 * i + 1] = R * u;
    pos[3 * i + 2] = R * r * Math.sin(th);
    const b = 0.55 + Math.random() * 0.45;            // 亮度
    const t = Math.random();                          // 色温：偏蓝 ~ 偏暖
    color[3 * i] = b * (0.85 + 0.15 * t);
    color[3 * i + 1] = b * 0.92;
    color[3 * i + 2] = b * (1.0 - 0.2 * t);
    size[i] = 0.6 + Math.pow(Math.random(), 3) * 2.0; // 少数大星星
  }
  return { pos: makeBuffer(pos), color: makeBuffer(color), size: makeBuffer(size), count: n };
})();

// ---------------- 小行星带（动态位置） ----------------
const belt = CONFIG.asteroidBelt;
const beltData = [];
{
  for (let i = 0; i < belt.count; i++) {
    beltData.push({
      r: belt.innerRadius + Math.random() * (belt.outerRadius - belt.innerRadius),
      a0: Math.random() * 2 * Math.PI,
      T: belt.yearsMin + Math.random() * (belt.yearsMax - belt.yearsMin),
      y: (Math.random() - 0.5) * 2 * belt.thickness,
    });
  }
}
const beltPos = new Float32Array(belt.count * 3);
const beltPosBuf = makeBuffer(beltPos, gl.DYNAMIC_DRAW);
const beltColorBuf = makeBuffer((() => {
  const c = new Float32Array(belt.count * 3);
  for (let i = 0; i < belt.count; i++) {
    const g = 0.40 + Math.random() * 0.25;
    c[3 * i] = g * 1.05; c[3 * i + 1] = g * 0.95; c[3 * i + 2] = g * 0.85; // 灰褐色
  }
  return c;
})());
const beltSizeBuf = makeBuffer((() => {
  const s = new Float32Array(belt.count);
  for (let i = 0; i < belt.count; i++)
    s[i] = belt.sizeMin + Math.pow(Math.random(), 2) * (belt.sizeMax - belt.sizeMin);
  return s;
})());

function updateAsteroidBelt() {
  for (let i = 0; i < belt.count; i++) {
    const d = beltData[i];
    const a = d.a0 + (2 * Math.PI * state.simYears) / d.T;
    beltPos[3 * i] = d.r * Math.cos(a);
    beltPos[3 * i + 1] = d.y;
    beltPos[3 * i + 2] = d.r * Math.sin(a);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, beltPosBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, beltPos);
}

// ============================================================================
// 纹理
// ----------------------------------------------------------------------------
// ① 所有位图统一重采样到 1024×512（2 的幂），以启用 mipmap 与 REPEAT 环绕；
// ② 上传前设置 UNPACK_FLIP_Y_WEBGL = true：
//    图片/画布的第 0 行是“顶部”，而 GL 纹理坐标 v=0 约定在“底部”，
//    不翻转会导致贴图上下颠倒（地球的北极跑到南极）。详见 README。
// ============================================================================
const textures = {}; // path -> {tex, ready}

// 兜底纹理：使用各天体的标识色（config 中的 color 字段），
// 即使位图全部缺失，行星也保持彼此不同的颜色。
function createFallbackTexture(rgb) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([rgb[0], rgb[1], rgb[2], 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

function uploadPOTTexture(source) {
  const cv = document.createElement("canvas");
  cv.width = 1024; cv.height = 512;                     // 2 的幂尺寸
  cv.getContext("2d").drawImage(source, 0, 0, 1024, 512);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);         // 关键：Y 翻转
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);      // 经度方向环绕
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  return tex;
}

function loadTexture(path, fallbackColor) {
  const entry = { tex: createFallbackTexture(fallbackColor || [200, 200, 200]), ready: false };
  textures[path] = entry;
  const img = new Image();
  img.onload = () => {
    entry.tex = uploadPOTTexture(img);
    entry.ready = true;
  };
  // 优先使用 base64 内嵌纹理（textures-embedded.js）：
  // 双击 index.html（file:// 协议）时浏览器会拦截本地图片加载到 WebGL，
  // 内嵌 data URI 不受该限制，保证任何打开方式都能看到贴图。
  img.src = (typeof EMBEDDED_TEXTURES !== "undefined" && EMBEDDED_TEXTURES[path]) || path;
}

// ---------------- 土星环纹理（程序化生成的 RGBA 径向条纹） ----------------
function createRingTexture() {
  const W = 512, H = 32;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(W, H);
  // 径向条带（u: 0=内缘 → 1=外缘）：C 环 / B 环 / 卡西尼缝 / A 环 / F 环
  const bands = [
    { from: 0.00, to: 0.16, a: 0.22, c: [115, 100, 85] },
    { from: 0.16, to: 0.50, a: 0.90, c: [212, 192, 160] },
    { from: 0.50, to: 0.565, a: 0.06, c: [70, 65, 58] },
    { from: 0.565, to: 0.86, a: 0.62, c: [192, 172, 142] },
    { from: 0.86, to: 0.895, a: 0.10, c: [85, 78, 68] },
    { from: 0.895, to: 1.00, a: 0.32, c: [155, 140, 115] },
  ];
  for (let x = 0; x < W; x++) {
    const u = x / (W - 1);
    const band = bands.find((b) => u >= b.from && u < b.to) || bands[bands.length - 1];
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      const noise = 0.9 + 0.2 * Math.random();          // 颗粒感
      const stripes = 1 + 0.12 * Math.sin(u * 260);     // 细径向条纹
      img.data[i] = Math.min(255, band.c[0] * noise * stripes);
      img.data[i + 1] = Math.min(255, band.c[1] * noise * stripes);
      img.data[i + 2] = Math.min(255, band.c[2] * noise * stripes);
      img.data[i + 3] = Math.min(255, 255 * band.a * (0.85 + 0.3 * Math.random()));
    }
  }
  ctx.putImageData(img, 0, 0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  return tex;
}

// 加载全部天体纹理（传入各自标识色作为兜底）
loadTexture(CONFIG.sun.texture, CONFIG.sun.color);
for (const p of CONFIG.planets) loadTexture(p.texture, p.color);
loadTexture(CONFIG.moon.texture, CONFIG.moon.color);
const ringTexture = createRingTexture();

// ============================================================================
// 相机
// ============================================================================
const cam = CONFIG.camera;

// Catmull-Rom 关键帧插值（环绕漫游路径）
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return p1.map((_, i) =>
    0.5 * ((2 * p1[i]) +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3));
}

// ---- 天体聚焦（单击拾取）----
let pickBodies = [];          // 每帧更新：{ key, name, center, radius }（供拾取与聚焦取用）
let lastP = null, lastV = null;

function focusTarget() {
  const b = pickBodies.find((x) => x.key === state.focusKey);
  return b ? b.center : [0, 0, 0];
}

function roamEye(t) {
  if (debugEye) return debugEye.split(",").map(Number);   // 调试：固定相机
  const K = cam.roamKeyframes;
  const s = t * K.length;
  const i = Math.floor(s) % K.length;
  const f = s - Math.floor(s);
  const p0 = K[(i - 1 + K.length) % K.length];
  const p1 = K[i];
  const p2 = K[(i + 1) % K.length];
  const p3 = K[(i + 2) % K.length];
  return catmullRom(p0, p1, p2, p3, f);
}

// 用户（轨迹球）相机的眼位置 / 上方向：eye = R_acc⁻¹ · (0,0,dist) + 聚焦目标位置
function userEye() {
  const t = focusTarget();
  const e = transformPoint(inverse(state.R_acc), [0, 0, state.dist, 1]).slice(0, 3);
  return [e[0] + t[0], e[1] + t[1], e[2] + t[2]];
}
function userUp() {
  return transformPoint(inverse(state.R_acc), [0, 1, 0, 0]).slice(0, 3);
}

// 由 lookAt 型视图捕获轨迹球状态（漫游 → 手动的无缝接管）
// 推导：lookAt(eye, at=origin, up) = T(0,0,-dist) · R_l，故 R_acc = R_l
// 漫游始终绕太阳，接管的同时取消行星聚焦，保证视角连续
function captureTrackballFrom(eye, up) {
  const V = lookAt(eye, cam.roamLookAt, up);
  const R = V.slice();
  R[12] = 0; R[13] = 0; R[14] = 0; R[15] = 1;   // 去掉平移分量 → 纯旋转
  state.R_acc = R;
  state.focusKey = null;
  state.dist = Math.max(cam.minDist,
    Math.min(cam.maxDist, length(subtract(eye, cam.roamLookAt))));
}

const smoothstep = (x) => x * x * (3 - 2 * x);
const lerpVec = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// 计算当前视图矩阵（三种模式）与当前相机距离（供正交投影匹配取景）
function currentView() {
  if (state.viewMode === "roam") {
    const eye = roamEye(state.roamT);
    const V = lookAt(eye, cam.roamLookAt, [0, 1, 0]);
    state.lastLookAt = { eye, up: [0, 1, 0] };
    return { V, dist: length(subtract(eye, cam.roamLookAt)) };
  }
  if (state.viewMode === "blend") {
    const k = smoothstep(Math.min(1, state.blendK));
    const eye = lerpVec(userEye(), roamEye(state.roamT), k);
    const up = normalize(lerpVec(userUp(), [0, 1, 0], k));
    const V = lookAt(eye, cam.roamLookAt, up);
    state.lastLookAt = { eye, up };
    return { V, dist: length(subtract(eye, cam.roamLookAt)) };
  }
  // user：轨迹球（围绕聚焦目标旋转；未聚焦时目标为原点）
  const t = focusTarget();
  const V = mult(translate(0, 0, -state.dist),
    mult(state.R_acc, translate(-t[0], -t[1], -t[2])));
  state.lastLookAt = null;
  return { V, dist: state.dist };
}

// 空格：暂停 / 继续漫游
function toggleRoam() {
  if (state.viewMode === "roam") {
    // 暂停 → 轨迹球从当前视角无缝接管
    if (state.lastLookAt) captureTrackballFrom(state.lastLookAt.eye, state.lastLookAt.up);
    state.viewMode = "user";
  } else if (state.viewMode === "user") {
    state.viewMode = "blend";
    state.blendK = 0;
  }
  updateUIState();
}

// O 键：切换投影
function toggleProjection() {
  state.projMode = state.projMode === "persp" ? "ortho" : "persp";
  updateUIState();
}

// ============================================================================
// 场景更新：层级模型矩阵
// ============================================================================
const DEG = 180 / Math.PI;

// 轨道角度（度）：R_y(公转角) 中的角度
function orbitDegOf(p) {
  return (((2 * Math.PI * state.simYears) / p.orbitYears) % (2 * Math.PI)) * DEG;
}

// 轨道框架：世界原点 -> 行星质心（不含自转/倾角，供月球、轨道线复用）
function orbitFrameOf(p) {
  return mult(rotate(orbitDegOf(p), 0, 1, 0), translate(p.dist, 0, 0));
}

// 通用行星矩阵：M = R_y(公转) · T(dist) · [ R_z(倾角) · R_y(自转) ] · S(r)
function planetMatrices(p) {
  const spinSec = spinSeconds(p.spinDays);
  const spinDeg = ((2 * Math.PI * state.spinClock) / spinSec) * DEG;
  const tiltDeg = p.key === "earth" ? state.earthTiltDeg : p.tiltDeg;

  const M_orbit = orbitFrameOf(p);                                          // 轨道框架
  const M_local = mult(rotate(tiltDeg, 0, 0, 1), rotate(spinDeg, 0, 1, 0)); // 先倾角，后自转
  const M_body = mult(mult(M_orbit, M_local), scalem(p.radius, p.radius, p.radius)); // M = R_y·T · R_z·R_y · S
  const M_ring = mult(rotate(tiltDeg, 0, 0, 1), scalem(p.radius, p.radius, p.radius));
  return { M_orbit, M_body, M_ring };
}

// 月球矩阵（含手工构造的轨道面倾角矩阵）
function moonMatrix(earthOrbitFrame) {
  const m = CONFIG.moon;
  const orbitDeg = ((2 * Math.PI * state.simYears) / m.orbitYears) % (2 * Math.PI) * DEG;

  // ---- 手工构造（作业要求 2）----
  let M_track = manualRotateZ(m.inclinationDeg);                    // ① 轨道面倾角（手工矩阵）
  M_track = mult(M_track, rotate(orbitDeg, 0, 1, 0));               // ② 倾斜面内绕地球公转
  M_track = mult(M_track, translate(m.dist, 0, 0));                 // ③ 平移到轨道位置

  // 潮汐锁定：自转角 = 公转角（月球始终以同一面朝向地球）
  const M_body = mult(rotate(orbitDeg, 0, 1, 0), scalem(m.radius, m.radius, m.radius));
  return mult(mult(earthOrbitFrame, M_track), M_body);
}

// ============================================================================
// 绘制
// ============================================================================
gl.enable(gl.DEPTH_TEST);
gl.clearColor(0.012, 0.012, 0.03, 1);

function bindSphereAttribs() {
  useAttrib(texA.pos, sphereBufs.pos, 3);
  useAttrib(texA.normal, sphereBufs.normal, 3);
  useAttrib(texA.uv, sphereBufs.uv, 2);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereBufs.idx);
}
function bindRingAttribs() {
  useAttrib(texA.pos, ringBufs.pos, 3);
  useAttrib(texA.normal, ringBufs.normal, 3);
  useAttrib(texA.uv, ringBufs.uv, 2);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ringBufs.idx);
}

function drawTextured(model, tex, emissive, count, bindAttribs) {
  gl.uniformMatrix4fv(texU.model, false, flatten(model));
  gl.uniformMatrix3fv(texU.normal, false, normalMatrix(model));
  gl.uniform1f(texU.emissive, emissive);
  gl.uniform1f(texU.ambient, CONFIG.lighting.ambient);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(texU.sampler, 0);
  bindAttribs();
  gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
}

function drawOrbitLine(model, color) {
  gl.useProgram(lineProg);
  gl.uniformMatrix4fv(lineU.model, false, flatten(model));
  gl.uniform4f(lineU.color, color[0], color[1], color[2], 0.55);
  useAttrib(lineA.pos, circleBuf, 3);
  gl.drawArrays(gl.LINE_LOOP, 0, 256);
}

function render() {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const aspect = canvas.width / canvas.height;
  const { V, dist: camDist } = currentView();

  // ---- 投影矩阵：正交取景框按当前距离匹配透视（保证“同一画面”可比） ----
  let P;
  if (state.projMode === "persp") {
    P = perspective(cam.fovy, aspect, 0.1, 1500);
  } else {
    const halfH = camDist * Math.tan(radians(cam.fovy) / 2);
    const halfW = halfH * aspect;
    P = ortho(-halfW, halfW, -halfH, halfH, 0.1, 1500);
  }

  // ---- 星空（点精灵，永远最先画） ----
  if (state.showStars) {
    gl.useProgram(pointProg);
    gl.uniformMatrix4fv(pointU.view, false, flatten(V));
    gl.uniformMatrix4fv(pointU.proj, false, flatten(P));
    gl.uniformMatrix4fv(pointU.model, false, flatten(mat4()));
    useAttrib(pointA.pos, stars.pos, 3);
    useAttrib(pointA.color, stars.color, 3);
    useAttrib(pointA.size, stars.size, 1);
    gl.drawArrays(gl.POINTS, 0, stars.count);
  }

  // ---- 轨道线 ----
  gl.useProgram(lineProg);
  gl.uniformMatrix4fv(lineU.view, false, flatten(V));
  gl.uniformMatrix4fv(lineU.proj, false, flatten(P));
  if (state.showOrbits) {
    for (const p of CONFIG.planets) {
      drawOrbitLine(scalem(p.dist, 1, p.dist), p.orbitColor);
    }
    // 月球轨道线：在地球轨道框架下，再施加手工构造的倾角矩阵
    const earth = CONFIG.planets.find((p) => p.key === "earth");
    const moonLine = mult(mult(orbitFrameOf(earth), manualRotateZ(CONFIG.moon.inclinationDeg)),
      scalem(CONFIG.moon.dist, 1, CONFIG.moon.dist));
    drawOrbitLine(moonLine, CONFIG.moon.orbitColor);
  }

  // ---- 天体（纹理 + 光照） ----
  gl.useProgram(texProg);
  gl.uniformMatrix4fv(texU.view, false, flatten(V));
  gl.uniformMatrix4fv(texU.proj, false, flatten(P));

  // 太阳（自发光）
  const sunSpinDeg = ((2 * Math.PI * state.spinClock) / spinSeconds(CONFIG.sun.spinDays)) * DEG;
  const M_sun = mult(rotate(sunSpinDeg, 0, 1, 0),
    scalem(CONFIG.sun.radius, CONFIG.sun.radius, CONFIG.sun.radius));
  drawTextured(M_sun, textures[CONFIG.sun.texture].tex, 1.0, sphere.count, bindSphereAttribs);

  // 行星 + 月球（emissive 0.12：背光面也保留纹理可辨识度）
  let earthOrbitFrame = null;
  const newPick = [{ key: "sun", name: "太阳", center: [0, 0, 0], radius: CONFIG.sun.radius }];
  for (const p of CONFIG.planets) {
    const mats = planetMatrices(p);
    if (p.key === "earth") earthOrbitFrame = mats.M_orbit;
    drawTextured(mats.M_body, textures[p.texture].tex, 0.12, sphere.count, bindSphereAttribs);
    newPick.push({ key: p.key, name: p.name,
      center: [mats.M_body[12], mats.M_body[13], mats.M_body[14]], radius: p.radius });
  }
  const M_moon = moonMatrix(earthOrbitFrame);
  drawTextured(M_moon, textures[CONFIG.moon.texture].tex, 0.12, sphere.count, bindSphereAttribs);
  newPick.push({ key: "moon", name: "月球",
    center: [M_moon[12], M_moon[13], M_moon[14]], radius: CONFIG.moon.radius });
  pickBodies = newPick;   // 供单击拾取与聚焦目标取用（下一帧生效）

  // ---- 土星环（半透明，双面） ----
  if (state.showRing) {
    const saturn = CONFIG.planets.find((p) => p.key === "saturn");
    const { M_orbit, M_ring } = planetMatrices(saturn);
    const M_full = mult(M_orbit, M_ring);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    drawTextured(M_full, ringTexture, 0.35, ringGeo.count, bindRingAttribs);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  // ---- 小行星带（点精灵） ----
  if (state.showBelt) {
    gl.useProgram(pointProg);
    gl.uniformMatrix4fv(pointU.view, false, flatten(V));
    gl.uniformMatrix4fv(pointU.proj, false, flatten(P));
    gl.uniformMatrix4fv(pointU.model, false, flatten(mat4()));
    useAttrib(pointA.pos, beltPosBuf, 3);
    useAttrib(pointA.color, beltColorBuf, 3);
    useAttrib(pointA.size, beltSizeBuf, 1);
    gl.drawArrays(gl.POINTS, 0, belt.count);
  }

  lastP = P;   // 供单击拾取做投影
  lastV = V;
}

// ============================================================================
// 交互
// ============================================================================
let dragging = false, lastMouse = null;
let downPos = null, downTime = 0;   // 记录按下位置/时间，区分"单击拾取"与"拖拽"

function normalizedMouse(e) {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1); // 屏幕 y 向下 → 翻转
  return [x, y];
}

canvas.addEventListener("mousedown", (e) => {
  dragging = true;
  downPos = [e.clientX, e.clientY];
  downTime = performance.now();
  lastMouse = normalizedMouse(e);
  // 漫游/混合中拖拽 → 轨迹球随时接管
  if (state.viewMode !== "user") {
    if (state.lastLookAt) captureTrackballFrom(state.lastLookAt.eye, state.lastLookAt.up);
    state.viewMode = "user";
    updateUIState();
  }
});
window.addEventListener("mouseup", () => { dragging = false; });
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const cur = normalizedMouse(e);
  const p1 = Trackball.project(lastMouse[0], lastMouse[1]);
  const p2 = Trackball.project(cur[0], cur[1]);
  const R = Trackball.rotationBetween(p1, p2);       // 增量旋转（眼坐标系）
  state.R_acc = mult(R, state.R_acc);                // 左乘累积
  lastMouse = cur;
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (state.viewMode !== "user") {
    // 漫游中滚轮同样先接管
    if (state.lastLookAt) captureTrackballFrom(state.lastLookAt.eye, state.lastLookAt.up);
    state.viewMode = "user";
    updateUIState();
  }
  // 聚焦天体时允许推近到其表面附近；全景时保持原来的最近距离
  const fb = pickBodies.find((x) => x.key === state.focusKey);
  const minD = fb ? Math.max(fb.radius * 1.8, 0.6) : cam.minDist;
  state.dist = Math.max(minD,
    Math.min(cam.maxDist, state.dist * Math.exp(e.deltaY * 0.0012)));
}, { passive: false });

// ---- 单击拾取：把各天体中心投影到屏幕，点击落在其投影像内则聚焦 ----
// （教材 3.9 拾取思想的简化版：不做射线求交，用"投影半径 + 屏幕距离"判定）
canvas.addEventListener("click", (e) => {
  if (!downPos || !lastP || !lastV) return;
  // 位移超过 5px 或按住超过 0.5s 视为拖拽，不触发拾取
  if (Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 5 ||
      performance.now() - downTime > 500) return;

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const PV = mult(lastP, lastV);
  const eye = userEye();
  let best = null, bestScore = Infinity;
  for (const b of pickBodies) {
    const clip = transformPoint(PV, [b.center[0], b.center[1], b.center[2], 1]);
    if (clip[3] <= 0.001) continue;                       // 在相机背后
    const sx = (clip[0] / clip[3] + 1) * 0.5 * rect.width;
    const sy = (1 - clip[1] / clip[3]) * 0.5 * rect.height;
    const dc = Math.max(length(subtract(eye, b.center)), 0.01);
    const projR = (b.radius / dc) * (rect.height * 0.5) / Math.tan(radians(cam.fovy) / 2);
    const hitR = Math.max(projR, 14);                     // 小天体至少给 14px 容差
    const d = Math.hypot(mx - sx, my - sy);
    if (d > hitR) continue;
    const score = d / hitR;                               // 越靠近圆心越优先
    if (score < bestScore) { bestScore = score; best = b; }
  }
  if (best && best.key !== "sun") {
    state.focusKey = best.key;                            // 聚焦该行星
    state.viewMode = "user";
    state.dist = Math.min(cam.maxDist, Math.max(best.radius * 5.5, 2.2));
  } else {
    state.focusKey = null;                                // 点到太阳或空白 → 回到全景
    state.dist = CONFIG.camera.initDist;
  }
  updateUIState();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "o" || e.key === "O") { toggleProjection(); }
  else if (e.key === " ") { e.preventDefault(); toggleRoam(); }
  else if (e.key === "r" || e.key === "R") {
    state.viewMode = "user";
    state.focusKey = null;
    state.R_acc = rotate(18, 1, 0, 0);
    state.dist = CONFIG.camera.initDist;
    updateUIState();
  }
});

// ---------------- 参数面板 ----------------
const $ = (id) => document.getElementById(id);

function updateUIState() {
  $("btnProj").textContent = "投影：" + (state.projMode === "persp" ? "透视" : "正交") + "（O）";
  const roamLabel = state.viewMode === "roam" ? "暂停" : "继续";
  $("btnRoam").textContent = "漫游：" + roamLabel + "（空格）";
  let focusName = "太阳系全景";
  if (state.focusKey === "moon") focusName = "月球";
  else if (state.focusKey) {
    const p = CONFIG.planets.find((x) => x.key === state.focusKey);
    focusName = p ? p.name : state.focusKey;
  }
  $("focusName").textContent = focusName;
}

function bindSlider(id, valId, fmt, onChange) {
  const el = $(id);
  const apply = () => { $(valId).textContent = fmt(parseFloat(el.value)); onChange(parseFloat(el.value)); };
  el.addEventListener("input", apply);
  apply();
}

bindSlider("orbitSpeed", "orbitVal", (v) => v.toFixed(1) + "×", (v) => state.orbitSpeed = v);
bindSlider("spinSpeed", "spinVal", (v) => v.toFixed(1) + "×", (v) => state.spinSpeed = v);
bindSlider("tilt", "tiltVal", (v) => v.toFixed(1) + "°", (v) => state.earthTiltDeg = v);
$("showOrbits").addEventListener("change", (e) => state.showOrbits = e.target.checked);
$("showStars").addEventListener("change", (e) => state.showStars = e.target.checked);
$("showBelt").addEventListener("change", (e) => state.showBelt = e.target.checked);
$("showRing").addEventListener("change", (e) => state.showRing = e.target.checked);
$("btnProj").addEventListener("click", toggleProjection);
$("btnRoam").addEventListener("click", toggleRoam);
$("btnReset").addEventListener("click", () => {
  state.viewMode = "user";
  state.focusKey = null;
  state.R_acc = rotate(18, 1, 0, 0);
  state.dist = CONFIG.camera.initDist;
  updateUIState();
});
updateUIState();

// ============================================================================
// 主循环
// ============================================================================
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
  }
}

gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);

let lastTime = performance.now();

// 调试/截图辅助：URL 带 ?roamT=0.37 时，相机固定停在该漫游进度（不推进）；
// ?eye=x,y,z 直接固定相机位置；?freeze=1 冻结模拟时钟。均用于无头测试截图，正常运行无影响。
const qParams = new URLSearchParams(location.search);
const debugRoamT = qParams.get("roamT");
const debugEye = qParams.get("eye");
const freezeTime = qParams.get("freeze");
if (debugRoamT !== null || debugEye) {
  state.viewMode = "roam";
  state.roamT = parseFloat(debugRoamT) || 0;
}
if (qParams.get("proj") === "ortho") state.projMode = "ortho";   // 调试：直接以正交投影启动
if (qParams.get("focus")) state.focusKey = qParams.get("focus"); // 调试：直接聚焦某天体
const debugDist = parseFloat(qParams.get("dist"));
if (!isNaN(debugDist)) state.dist = debugDist;                   // 调试：指定相机距离
updateUIState();  // 同步按钮文字（避免 URL 参数晚于面板初始化导致标签过期）

function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  // 两个独立时钟：公转（simYears）/ 自转（spinClock），分别受滑条控制
  if (!freezeTime) {
    state.simYears += (dt * state.orbitSpeed) / CONFIG.TIME_SCALE.EARTH_YEAR_SEC;
    state.spinClock += dt * state.spinSpeed;
  }

  // 漫游推进（roamT 调试模式下冻结相机位置）
  if (state.viewMode === "roam" && debugRoamT === null) {
    state.roamT = (state.roamT + dt / cam.roamLoopSec) % 1;
  } else if (state.viewMode === "blend") {
    state.blendK += dt / cam.roamBlendSec;
    if (state.blendK >= 1) { state.viewMode = "roam"; updateUIState(); }
  }

  updateAsteroidBelt();
  resize();
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
