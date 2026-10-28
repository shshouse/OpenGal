/** 主窗口与桌宠共用同一角色：桌宠打开时主窗口不再显示皮套，避免两套同时渲染 */
export function shouldShowMainStage(showLive2D: boolean, petOpen: boolean): boolean {
  return showLive2D && !petOpen
}
