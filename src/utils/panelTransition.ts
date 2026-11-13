/**
 * 面板开合动画的方向判断（纯逻辑）。
 *
 * 岛可以贴四边，清单面板不一定在岛下方：岛贴底边时面板在岛上方，
 * 展开动画要从面板底边长出、起手的上抬也反向。
 */

/** 面板中心在岛中心上方 → 从底边长出 */
export function panelOpensUpward(islandCenterY: number, panelCenterY: number): boolean {
  return panelCenterY < islandCenterY
}

/** 面板动画的 transform-origin 纵向分量 */
export function panelOriginY(opensUpward: boolean): string {
  return opensUpward ? '100%' : '0%'
}

/** 起手位移里 top-lift 的符号：向下展开保持默认 -1，向上展开翻转 */
export function panelLiftSign(opensUpward: boolean): number {
  return opensUpward ? 1 : -1
}
