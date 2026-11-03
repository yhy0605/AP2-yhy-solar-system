// ============================================================================
// MV.js —— 4×4 齐次坐标矩阵 / 向量 工具库（与教材配套 MV.js 接口兼容）
// 存储：列主序（column-major），与 WebGL uniformMatrix4fv 一致。
// 约定：顶点列向量 v' = M · v，矩阵乘法 mult(A, B) = A·B（先作用 B 再作用 A）。
// ============================================================================

"use strict";

// ---------------------------------------------------------------- 向量工具
function vec2(x = 0, y = 0) { return [x, y]; }
function vec3(x = 0, y = 0, z = 0) { return [x, y, z]; }
function vec4(x = 0, y = 0, z = 0, w = 1) { return [x, y, z, w]; }

function add(u, v) {
  const r = [];
  for (let i = 0; i < u.length; i++) r.push(u[i] + v[i]);
  return r;
}

function subtract(u, v) {
  const r = [];
  for (let i = 0; i < u.length; i++) r.push(u[i] - v[i]);
  return r;
}

function scaleVec(s, v) {
  const r = [];
  for (let i = 0; i < v.length; i++) r.push(s * v[i]);
  return r;
}

function dot(u, v) {
  let s = 0;
  for (let i = 0; i < u.length; i++) s += u[i] * v[i];
  return s;
}

function length(u) { return Math.sqrt(dot(u, u)); }

function normalize(u, w = []) {
  const d = length(u);
  if (d === 0) return u.slice();
  if (!w.length) w = u.slice();
  return w.map((_, i) => u[i] / d);
}

function cross(u, v) {
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
}

function flatten(v) {
  if (Array.isArray(v[0])) return v.flat();
  return v.slice();
}

// 角度 -> 弧度
function radians(degrees) { return (degrees * Math.PI) / 180; }

// ---------------------------------------------------------------- mat4 基本
// 单位矩阵（或按 16 元素数组构造）
function mat4(m) {
  if (m === undefined) {
    return [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
  }
  m = m.slice();
  if (m.length === 4) { // 允许对角元素构造
    return [
      m[0], 0, 0, 0,
      0, m[1], 0, 0,
      0, 0, m[2], 0,
      0, 0, 0, m[3],
    ];
  }
  return m;
}

// 矩阵乘法 mult(A, B) = A·B
function mult(a, b) {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let ro = 0; ro < 4; ro++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[ro + 4 * k] * b[k + 4 * c];
      r[ro + 4 * c] = s;
    }
  }
  return r;
}

// 平移矩阵 T(x,y,z)
function translate(x, y, z) {
  if (x instanceof Array) { z = x[2]; y = x[1]; x = x[0]; }
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

// 缩放矩阵 S(x,y,z)
function scalem(x, y, z) {
  if (x instanceof Array) { z = x[2]; y = x[1]; x = x[0]; }
  return [
    x, 0, 0, 0,
    0, y, 0, 0,
    0, 0, z, 0,
    0, 0, 0, 1,
  ];
}

// 旋转矩阵 R(angle°, axis) —— 标准 glRotate 推导（教材 Ch4）
// 绕过原点、方向 (x,y,z)（自动归一化）的轴逆时针旋转 angle 度
function rotate(angle, x, y, z) {
  if (x instanceof Array) { z = x[2]; y = x[1]; x = x[0]; }
  let d = Math.sqrt(x * x + y * y + z * z);
  if (d === 0) return mat4();
  x /= d; y /= d; z /= d;

  const a = radians(angle);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;

  // 数学形式（行主序书写，代码按列主序存储）：
  // [ c+x²t   xyt-zs  xzt+ys  0 ]
  // [ xyt+zs  c+y²t   yzt-xs  0 ]
  // [ xzt-ys  yzt+xs  c+z²t   0 ]
  // [   0       0       0     1 ]
  return [
    c + x * x * t, x * y * t + z * s, x * z * t - y * s, 0,
    x * y * t - z * s, c + y * y * t, y * z * t + x * s, 0,
    x * z * t + y * s, y * z * t - x * s, c + z * z * t, 0,
    0, 0, 0, 1,
  ];
}

// ---------------------------------------------------------------- 观察与投影
// lookAt(eye, at, up)：世界 -> 眼坐标
function lookAt(eye, at, up) {
  const n = normalize(subtract(eye, at));   // z 轴（指向相机后方）
  const u = normalize(cross(up, n));        // x 轴
  const v = cross(n, u);                    // y 轴

  return [
    u[0], v[0], n[0], 0,
    u[1], v[1], n[1], 0,
    u[2], v[2], n[2], 0,
    -dot(u, eye), -dot(v, eye), -dot(n, eye), 1,
  ];
}

// 透视投影（fovy 单位：度）
function perspective(fovy, aspect, near, far) {
  const f = 1.0 / Math.tan(radians(fovy) / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
}

// 正交投影
function ortho(left, right, bottom, top, near, far) {
  const w = right - left, h = top - bottom, d = far - near;
  return [
    2 / w, 0, 0, 0,
    0, 2 / h, 0, 0,
    0, 0, -2 / d, 0,
    -(left + right) / w, -(top + bottom) / h, -(near + far) / d, 1,
  ];
}

// ---------------------------------------------------------------- 工具函数
// mat4 · vec4
function transformPoint(m, v) {
  const r = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    r[i] = m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i] * v[3];
  }
  return r;
}

// mat4 求逆（通用伴随矩阵法；用于由视图矩阵反求相机位置等）
function inverse(m) {
  const inv = new Array(16).fill(0);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] +
    m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] -
    m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] +
    m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] -
    m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] -
    m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] +
    m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] -
    m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] +
    m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] +
    m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] -
    m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] +
    m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] -
    m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] -
    m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] +
    m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] -
    m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] +
    m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];

  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (det === 0) return mat4();
  det = 1.0 / det;
  return inv.map((x) => x * det);
}

// 法线矩阵：模型矩阵左上 3×3 的逆转置（保持法线在非等比缩放下正确）
function normalMatrix(m) {
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]; // 3×3, 列主序
  const a00 = a[0], a01 = a[1], a02 = a[2],
    a10 = a[3], a11 = a[4], a12 = a[5],
    a20 = a[6], a21 = a[7], a22 = a[8];
  // 行列式
  const det = a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20);
  if (det === 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const id = 1 / det;
  // 伴随矩阵（转置的逆 = 逆的转置）
  return [
    (a11 * a22 - a12 * a21) * id,
    (a02 * a21 - a01 * a22) * id,
    (a01 * a12 - a02 * a11) * id,
    (a12 * a20 - a10 * a22) * id,
    (a00 * a22 - a02 * a20) * id,
    (a02 * a10 - a00 * a12) * id,
    (a10 * a21 - a11 * a20) * id,
    (a01 * a20 - a00 * a21) * id,
    (a00 * a11 - a01 * a10) * id,
  ];
}

// 调试用打印
function printm(m) {
  for (let i = 0; i < 4; i++) {
    console.log(
      m[0 + i].toFixed(4), m[4 + i].toFixed(4),
      m[8 + i].toFixed(4), m[12 + i].toFixed(4)
    );
  }
}
