/**
 * 场景碰撞检测与避让工具
 *
 * 定义场景中的障碍物（桌子、椅子、沙发等），提供碰撞检测和排斥力计算，
 * 供猫咪移动组件（WalkingCat、WanderingCat、HandoffCat）使用。
 *
 * 避障策略：势场法 + 切向绕行力
 * - 障碍物产生排斥力（远离障碍物）
 * - 排斥力叠加切向力（沿障碍物边缘绕行），避免局部极小值导致卡死
 */

import { DESK_LAYOUTS, MEETING_AREA } from './officeConfig'

/** 轴对齐包围盒（AABB）— 用于2D碰撞检测（xz平面） */
export interface ObstacleBox {
  /** 障碍物中心坐标 */
  center: [number, number, number]
  /** 半宽(x)、半高(y)、半深(z) */
  halfSize: [number, number, number]
}

/** 会议桌区域障碍物 */
const MEETING_TABLE_OBSTACLE: ObstacleBox = {
  center: [MEETING_AREA[0], 0.2, MEETING_AREA[2]],
  halfSize: [1.1, 0.25, 0.55],
}

/** 会议椅障碍物 — 与 OfficeFurniture 中 MeetingChair 位置对应 */
const MEETING_CHAIR_OBSTACLES: ObstacleBox[] = [
  // 前排3把（z正方向）
  { center: [MEETING_AREA[0] - 0.6, 0.2, MEETING_AREA[2] + 0.8], halfSize: [0.25, 0.2, 0.25] },
  { center: [MEETING_AREA[0], 0.2, MEETING_AREA[2] + 0.8], halfSize: [0.25, 0.2, 0.25] },
  { center: [MEETING_AREA[0] + 0.6, 0.2, MEETING_AREA[2] + 0.8], halfSize: [0.25, 0.2, 0.25] },
  // 后排3把（z负方向）
  { center: [MEETING_AREA[0] - 0.6, 0.2, MEETING_AREA[2] - 0.8], halfSize: [0.25, 0.2, 0.25] },
  { center: [MEETING_AREA[0], 0.2, MEETING_AREA[2] - 0.8], halfSize: [0.25, 0.2, 0.25] },
  { center: [MEETING_AREA[0] + 0.6, 0.2, MEETING_AREA[2] - 0.8], halfSize: [0.25, 0.2, 0.25] },
]

/** 办公桌障碍物 — 根据 DESK_LAYOUTS 动态生成 */
function getDeskObstacles(): ObstacleBox[] {
  return DESK_LAYOUTS.map(desk => ({
    center: [...desk.position] as [number, number, number],
    halfSize: [0.7, 0.25, 0.45],
  }))
}

/** 所有静态障碍物 */
const FIXED_OBSTACLES: ObstacleBox[] = [
  MEETING_TABLE_OBSTACLE,
  ...MEETING_CHAIR_OBSTACLES,
  // 咖啡机区域
  { center: [-3.5, 0.3, -2], halfSize: [0.7, 0.35, 0.35] },
  // 沙发
  { center: [-4.5, 0.3, 2], halfSize: [0.85, 0.35, 0.4] },
  // 烟灰缸柱
  { center: [3.5, 0.5, -2], halfSize: [0.2, 0.55, 0.2] },
]

/** 获取完整的障碍物列表（静态 + 办公桌） */
export function getAllObstacles(): ObstacleBox[] {
  return [...FIXED_OBSTACLES, ...getDeskObstacles()]
}

/** 检测点是否在障碍物内（2D，xz平面） */
export function isInsideObstacle(x: number, z: number, obs: ObstacleBox, margin = 0.1): boolean {
  return (
    x > obs.center[0] - obs.halfSize[0] - margin &&
    x < obs.center[0] + obs.halfSize[0] + margin &&
    z > obs.center[2] - obs.halfSize[2] - margin &&
    z < obs.center[2] + obs.halfSize[2] + margin
  )
}

/**
 * 将点从障碍物内部推到安全位置
 *
 * 如果起点在障碍物内部（如猫咪坐在椅子上），势场法会失效。
 * 此函数将起点沿远离障碍物中心的方向推出，确保后续寻路正常工作。
 *
 * @param x 起点x
 * @param z 起点z
 * @param goalX 目标x（用于决定推出方向 — 优先朝目标方向推出）
 * @param goalZ 目标z
 * @param obstacles 障碍物列表
 * @param margin 安全边距（推出后离障碍物的最小距离）
 * @returns [安全x, 安全z] — 如果起点不在任何障碍物内，返回原坐标
 */
export function pushOutOfObstacles(
  x: number, z: number,
  goalX: number, goalZ: number,
  obstacles: ObstacleBox[],
  margin = 0.15
): [number, number] {
  let safeX = x
  let safeZ = z
  const maxIter = 10 // 最多迭代10次，防止无限循环

  for (let iter = 0; iter < maxIter; iter++) {
    let pushed = false

    for (const obs of obstacles) {
      if (!isInsideObstacle(safeX, safeZ, obs, margin)) continue

      // 计算到目标的方向
      const toGoalX = goalX - safeX
      const toGoalZ = goalZ - safeZ
      const toGoalLen = Math.sqrt(toGoalX * toGoalX + toGoalZ * toGoalZ)

      if (toGoalLen > 0.01) {
        // 有目标方向：沿目标方向推出障碍物
        const dirX = toGoalX / toGoalLen
        const dirZ = toGoalZ / toGoalLen

        // 尝试沿目标方向推出
        const pushDist = obs.halfSize[0] + obs.halfSize[2] + margin + 0.1
        const candidateX = safeX + dirX * pushDist
        const candidateZ = safeZ + dirZ * pushDist

        // 如果推出后不在任何障碍物内，使用这个方向
        let candidateSafe = true
        for (const otherObs of obstacles) {
          if (isInsideObstacle(candidateX, candidateZ, otherObs, margin)) {
            candidateSafe = false
            break
          }
        }

        if (candidateSafe) {
          safeX = candidateX
          safeZ = candidateZ
          pushed = true
          continue
        }
      }

      // 目标方向推出失败或无目标方向：沿最短路径推出（选重叠最小的方向）
      const dx = safeX - obs.center[0]
      const dz = safeZ - obs.center[2]
      const overlapX = obs.halfSize[0] + margin - Math.abs(dx)
      const overlapZ = obs.halfSize[2] + margin - Math.abs(dz)

      if (overlapX > 0 && overlapZ > 0) {
        if (overlapX < overlapZ) {
          safeX = obs.center[0] + (dx >= 0 ? 1 : -1) * (obs.halfSize[0] + margin + 0.05)
        } else {
          safeZ = obs.center[2] + (dz >= 0 ? 1 : -1) * (obs.halfSize[2] + margin + 0.05)
        }
        pushed = true
      }
    }

    // 如果本轮没有推出任何障碍物，说明已经安全
    if (!pushed) break
  }

  return [safeX, safeZ]
}

/**
 * 计算障碍物对指定位置的排斥力 + 切向绕行力
 *
 * 使用势场法（Potential Field）+ 切向力（Tangential Force）：
 * - 障碍物产生排斥力，距离越近力越大
 * - 叠加切向力使猫咪沿障碍物边缘绕行，避免局部极小值导致卡死
 *
 * @param x 当前x坐标
 * @param z 当前z坐标
 * @param goalX 目标x坐标（用于决定绕行方向）
 * @param goalZ 目标z坐标（用于决定绕行方向）
 * @param obstacles 障碍物列表
 * @returns [合力x分量, 合力z分量]
 */
export function getObstacleRepulsion(x: number, z: number, goalX: number, goalZ: number, obstacles: ObstacleBox[]): [number, number] {
  let repX = 0
  let repZ = 0
  const repulseRange = 0.7

  for (const obs of obstacles) {
    const dx = x - obs.center[0]
    const dz = z - obs.center[2]
    const absDx = Math.abs(dx)
    const absDz = Math.abs(dz)

    // 只在障碍物附近产生排斥力
    if (
      absDx < obs.halfSize[0] + repulseRange &&
      absDz < obs.halfSize[2] + repulseRange
    ) {
      const overlapX = obs.halfSize[0] + repulseRange - absDx
      const overlapZ = obs.halfSize[2] + repulseRange - absDz

      if (overlapX > 0 && overlapZ > 0) {
        // 排斥力 — 选择重叠最小的方向推出（最短路径绕行）
        if (overlapX < overlapZ) {
          repX += (dx > 0 ? 1 : -1) * overlapX * 2
        } else {
          repZ += (dz > 0 ? 1 : -1) * overlapZ * 2
        }

        // 切向绕行力 — 避免局部极小值（卡死）
        // 根据目标方向决定绕行方向：选择更接近目标方向的切向
        const tangentX = -(dz > 0 ? 1 : -1) * overlapZ * 0.8
        const tangentZ = (dx > 0 ? 1 : -1) * overlapX * 0.8

        // 计算两种切向方向哪个更接近目标
        const toGoalX = goalX - x
        const toGoalZ = goalZ - z
        const dot1 = tangentX * toGoalX + tangentZ * toGoalZ
        const dot2 = -tangentX * toGoalX + -tangentZ * toGoalZ

        if (dot1 >= dot2) {
          repX += tangentX
          repZ += tangentZ
        } else {
          repX -= tangentX
          repZ -= tangentZ
        }
      }
    }
  }

  return [repX, repZ]
}

/**
 * 计算带碰撞避让的移动方向
 *
 * 将目标方向与排斥力 + 切向力叠加后归一化，返回最终移动方向。
 *
 * @param currentX 当前x
 * @param currentZ 当前z
 * @param targetX 目标x
 * @param targetZ 目标z
 * @param obstacles 障碍物列表
 * @param repulsionWeight 排斥力权重（默认0.6，越大绕行越明显）
 * @returns [方向x, 方向z, 距离]
 */
export function getSteeredDirection(
  currentX: number,
  currentZ: number,
  targetX: number,
  targetZ: number,
  obstacles: ObstacleBox[],
  repulsionWeight = 0.6
): [number, number, number] {
  const dx = targetX - currentX
  const dz = targetZ - currentZ
  const dist = Math.sqrt(dx * dx + dz * dz)

  if (dist < 0.01) return [0, 0, 0]

  // 目标方向
  let nx = dx / dist
  let nz = dz / dist

  // 叠加排斥力 + 切向绕行力
  const [repX, repZ] = getObstacleRepulsion(currentX, currentZ, targetX, targetZ, obstacles)
  nx += repX * repulsionWeight
  nz += repZ * repulsionWeight

  // 归一化
  const len = Math.sqrt(nx * nx + nz * nz)
  if (len > 0.01) {
    nx /= len
    nz /= len
  }

  return [nx, nz, dist]
}
