// ============================================================================
// config.js —— 天体参数集中配置（作业评分点：代码质量）
// 所有天体的 半径 / 距离 / 周期 / 倾角 / 纹理 全部集中在此处，便于统一调整。
//
// 说明：
//  · 半径与距离为“场景单位”，未按真实比例（真实比例下行星几乎不可见），
//    但保持了相对大小与顺序的合理性；
//  · orbitYears 使用真实公转周期（地球年），保证开普勒式的快慢关系；
//  · spinDays 为真实自转周期（天），负值表示逆行自转（金星、天王星）；
//    显示时按 DAY_SEC 压缩，见下方 TIME_SCALE。
// ============================================================================

"use strict";

const CONFIG = {

  // ---------------- 时间压缩（显示用） ----------------
  TIME_SCALE: {
    EARTH_YEAR_SEC: 36,  // 地球公转一周 = 36 秒模拟时间
    DAY_SEC: 0.55,       // 地球自转一周的显示秒数（真实为 36/365≈0.1s，过快故放宽）
    SPIN_MIN_SEC: 0.35,  // 自转显示周期下限（避免气态巨行星快到闪烁）
    SPIN_MAX_SEC: 8.0,   // 自转显示周期上限（金星/水星实际极慢，压缩到可感知）
  },

  // ---------------- 太阳（位于世界原点，点光源） ----------------
  sun: {
    name: "太阳",
    radius: 4.6,
    spinDays: 25.4,          // 真实自转 ≈ 25.4 天
    texture: "textures/sun.jpg",
    color: [255, 200, 60],   // 兜底色（位图缺失时也可区分天体）
    emissive: 1.0,           // 自发光（不参与光照）
  },

  // ---------------- 行星（含地球；月球挂在地球轨道框架下） ----------------
  // dist：到太阳的轨道半径（场景单位）；tiltDeg：自转轴倾角（真实值）
  // color：兜底色 / 天体标识色
  planets: [
    { key: "mercury", name: "水星", radius: 0.55, dist: 8.0,  orbitYears: 0.241, spinDays: 58.6,  tiltDeg: 0.03,  texture: "textures/mercury.jpg", color: [150, 140, 130], orbitColor: [0.72, 0.66, 0.60] },
    { key: "venus",   name: "金星", radius: 1.05, dist: 11.0, orbitYears: 0.615, spinDays: -243,  tiltDeg: 177.4, texture: "textures/venus.jpg",   color: [228, 205, 155], orbitColor: [0.85, 0.75, 0.55] },
    { key: "earth",   name: "地球", radius: 1.15, dist: 14.5, orbitYears: 1.000, spinDays: 0.997, tiltDeg: 23.44, texture: "textures/earth.jpg",   color: [55, 105, 205],  orbitColor: [0.35, 0.60, 0.95] },
    { key: "mars",    name: "火星", radius: 0.75, dist: 17.5, orbitYears: 1.881, spinDays: 1.026, tiltDeg: 25.19, texture: "textures/mars.jpg",    color: [205, 95, 50],   orbitColor: [0.85, 0.45, 0.30] },
    { key: "jupiter", name: "木星", radius: 2.60, dist: 26.0, orbitYears: 11.86, spinDays: 0.414, tiltDeg: 3.13,  texture: "textures/jupiter.jpg", color: [212, 175, 125], orbitColor: [0.80, 0.65, 0.45] },
    { key: "saturn",  name: "土星", radius: 2.20, dist: 32.5, orbitYears: 29.46, spinDays: 0.444, tiltDeg: 26.73, texture: "textures/saturn.jpg",  color: [222, 202, 152], orbitColor: [0.80, 0.72, 0.50],
      ring: { inner: 1.30, outer: 2.35 } },   // 土星环（内/外半径 = 行星半径的倍数）
    { key: "uranus",  name: "天王星", radius: 1.30, dist: 38.5, orbitYears: 84.01, spinDays: -0.718, tiltDeg: 97.77, texture: "textures/uranus.jpg", color: [150, 212, 215], orbitColor: [0.50, 0.80, 0.82] },
    { key: "neptune", name: "海王星", radius: 1.25, dist: 44.0, orbitYears: 164.8, spinDays: 0.671, tiltDeg: 28.32, texture: "textures/neptune.jpg", color: [70, 100, 215], orbitColor: [0.35, 0.45, 0.85] },
  ],

  // ---------------- 月球（三级层级的第三级） ----------------
  moon: {
    name: "月球",
    radius: 0.34,
    dist: 2.10,          // 到地球的距离（场景单位）
    orbitYears: 0.0748,  // 真实周期 27.32 天 ≈ 0.0748 年
    tidalLocked: true,   // 潮汐锁定：自转角 = 公转角（同一面朝向地球）
    inclinationDeg: 5.145, // 轨道面相对地球轨道面（黄道）的倾角 —— 手工矩阵实现处
    texture: "textures/moon.jpg",
    color: [168, 168, 172],
    orbitColor: [0.60, 0.60, 0.62],
  },

  // ---------------- 小行星带（选做 E1） ----------------
  asteroidBelt: {
    count: 1600,
    innerRadius: 19.5,   // 位于火星与木星轨道之间
    outerRadius: 22.8,
    yearsMin: 3.2,       // 公转周期范围（地球年），与开普勒趋势一致
    yearsMax: 6.2,
    thickness: 0.55,     // 垂直厚度
    sizeMin: 1.2,        // 点大小（像素）
    sizeMax: 3.4,
  },

  // ---------------- 相机 ----------------
  camera: {
    fovy: 45,
    initDist: 58,
    minDist: 8,
    maxDist: 320,
    // 漫游关键帧（眼睛位置，绕场景一周；Catmull-Rom 插值）
    roamKeyframes: [
      [56, 15, 4],
      [42, 24, 42],
      [0, 30, 56],
      [-42, 22, 42],
      [-56, 13, 0],
      [-42, 8, -42],
      [0, 6, -56],
      [42, 11, -42],
    ],
    roamLoopSec: 48,     // 绕一圈的时长
    roamBlendSec: 1.2,   // 从手动视角平滑接回漫游路径的时间
    roamLookAt: [0, 0, 0],
  },

  // ---------------- 星空背景 ----------------
  stars: { count: 2600, radius: 520 },

  // ---------------- 全局光照（简单漫反射，太阳为点光源） ----------------
  // ambient 较高是为了让背光面的行星纹理也清晰可辨（教学演示优先于真实感）
  lighting: { ambient: 0.35 },
};
