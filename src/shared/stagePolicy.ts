/** 主窗口与相伴窗口共用同一角色：相伴窗口打开时主窗口不再显示皮套，避免两套同时渲染 */
export function shouldShowMainStage(showLive2D: boolean, petOpen: boolean): boolean {
  return showLive2D && !petOpen
}
