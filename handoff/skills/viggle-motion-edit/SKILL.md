---
name: viggle-motion-edit
description: 编辑或检查 Viggle splat-engine-three 的 441 骨骼 GLB 动作、面部轨道、朝向和落脚。
---

# Viggle 动作编辑

- [441 骨骼完整名称](references/rig-441-names.md)与[索引、父节点、静止姿态数据](references/rig-441.json)来自 npm `@viggle/splat-engine-three@0.1.1`。`0–85` 为身体，`86–440` 为面部。目标包不同时先核对名称指纹；不要按位置猜骨骼。
- 坐标为右手系、`+Y` 向上，角色局部 **`+X` 朝前**、左侧 `−Z`。世界朝向由角色及父对象旋转决定。编辑前后检查头→鼻尖向量、骨盆轨迹和左右侧。
- 441 骨骼角色能独立驱动面部；86 骨骼及映射到 Body86 的 119 骨骼角色不能。先确认人物和动作的实际骨骼数。

## 执行

1. 读[动作格式约定](references/motion-conventions.md)，保存原动作以便对照。
2. 运行 `python3 scripts/inspect_motion.py <clip.glb>`；导出新 GLB 后再运行。脚本接受 441 骨动作和仅身体的 86 骨动作（按名称匹配 canonical 骨架，身体 86 骨须齐全，面部骨骼可缺，无法匹配的关节忽略）。失败时先修名称、轨道或时间轴。
3. 只修改目标骨骼和时间段。保留身体静止骨长；归一化旋转四元数；保留需要变化的面部位移轨道。朝向改动与骨盆轨迹、root motion 一起检查。
4. 用目标 npm 包实际播放，检查正面、侧面、脸部近景、肘腕、脚底及循环接缝。先关闭 `groundLockY` 看真实落脚。交付 GLB 时说明骨架、朝向、帧率、验证结果和剩余问题。
