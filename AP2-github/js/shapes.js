// ============================================================================
// shapes.js —— 几何体生成：球体（含 UV / 法线）、圆环面（土星环）、圆（轨道线）
// ============================================================================

"use strict";

/**
 * 单位球（球心在原点，半径 1）。
 * UV 映射：u —— 经度 0→1（水平绕一圈），v —— 纬度 1（北极）→ 0（南极）。
 * 这样配合 UNPACK_FLIP_Y_WEBGL=true 的纹理，图片顶部（北极）正好落在球体北极。
 */
function createSphere(stacks = 48, slices = 96) {
  const positions = [];
  const normals = [];
  const texCoords = [];
  const indices = [];

  for (let i = 0; i <= stacks; i++) {
    const v = i / stacks;                 // 0（北极）→ 1（南极）
    const phi = v * Math.PI;              // 极角：从 +y 轴量起
    const y = Math.cos(phi);
    const r = Math.sin(phi);
    for (let j = 0; j <= slices; j++) {
      const u = j / slices;
      const theta = u * 2 * Math.PI;
      const x = r * Math.cos(theta);
      const z = r * Math.sin(theta);
      positions.push(x, y, z);
      normals.push(x, y, z);              // 单位球：法线 = 位置
      texCoords.push(u, 1 - v);           // 北极 v=1（见上方说明）
    }
  }

  for (let i = 0; i < stacks; i++) {
    const row0 = i * (slices + 1);
    const row1 = (i + 1) * (slices + 1);
    for (let j = 0; j < slices; j++) {
      // 每个小四边形拆成两个三角形
      indices.push(row0 + j, row0 + j + 1, row1 + j + 1);
      indices.push(row0 + j, row1 + j + 1, row1 + j);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    texCoords: new Float32Array(texCoords),
    indices: new Uint16Array(indices),
    count: indices.length,
  };
}

/**
 * 环形面（土星环），位于 XZ 平面，法线 +y。
 * u —— 沿半径从内(0)到外(1)，用于径向条纹纹理；v —— 绕圈方向。
 */
function createAnnulus(inner = 1.3, outer = 2.35, segments = 128) {
  const positions = [];
  const normals = [];
  const texCoords = [];
  const indices = [];

  for (let j = 0; j <= segments; j++) {
    const t = j / segments;
    const theta = t * 2 * Math.PI;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    positions.push(inner * c, 0, inner * s);
    positions.push(outer * c, 0, outer * s);
    normals.push(0, 1, 0, 0, 1, 0);
    texCoords.push(0, t, 1, t);
  }
  for (let j = 0; j < segments; j++) {
    const a = j * 2;
    indices.push(a, a + 1, a + 3);
    indices.push(a, a + 3, a + 2);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    texCoords: new Float32Array(texCoords),
    indices: new Uint16Array(indices),
    count: indices.length,
  };
}

/**
 * 单位圆（XZ 平面），用 LINE_LOOP 绘制轨道线；绘制时用模型矩阵缩放到轨道半径。
 */
function createCircle(segments = 256) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * 2 * Math.PI;
    pts.push(Math.cos(theta), 0, Math.sin(theta));
  }
  return new Float32Array(pts);
}
