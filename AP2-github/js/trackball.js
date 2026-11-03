// ============================================================================
// trackball.js —— 虚拟轨迹球（选做 E3，教材 Virtual Trackball 思想）
//
// 把整个屏幕想象成一个镶嵌在场景中心的虚拟球：
//  · 鼠标位置归一化到 [-1,1]²，若落在单位圆内则投影到上半球面
//    z = sqrt(1 - x² - y²)；若落在圆外则钳制到赤道（z = 0）；
//  · 两次采样点 p1、p2 之间的拖拽，等价于绕轴 axis = p1 × p2
//    旋转 angle = arccos(p1·p2)；
//  · 得到的增量旋转矩阵左乘（pre-multiply）累积旋转 R：
//      V = T(0,0,-dist) · R_acc，  拖拽时 R_acc ← R_delta · R_acc
//    增量在“眼坐标系”中作用，因此无论累积到什么姿态，
//    拖拽手感始终像是直接抓住屏幕上的球在转动。
// ============================================================================

"use strict";

const Trackball = {

  // 屏幕坐标（已归一化到 [-1,1]，y 向上）-> 虚拟半球上的单位向量
  project(x, y) {
    const d2 = x * x + y * y;
    const z = d2 < 1.0 ? Math.sqrt(1.0 - d2) : 0.0; // 圆外钳制到赤道
    return normalize([x, y, z]);
  },

  // 把 p1 转到 p2 的增量旋转矩阵（MV.js mat4）；两点几乎重合时返回单位阵
  rotationBetween(p1, p2) {
    const axis = cross(p1, p2);
    const len = length(axis);
    if (len < 1e-6) return mat4();
    const c = Math.max(-1, Math.min(1, dot(p1, p2)));
    const angle = (Math.acos(c) * 180) / Math.PI;
    return rotate(angle, axis[0], axis[1], axis[2]);
  },
};
