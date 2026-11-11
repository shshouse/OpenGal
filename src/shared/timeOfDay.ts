/** 中文时段标签。问候语和主动开口共用同一套分界，避免两处说法不一致。 */
export function timeOfDayLabel(now = new Date()): string {
  const hour = now.getHours()
  if (hour < 5) return '凌晨'
  if (hour < 9) return '清晨'
  if (hour < 12) return '上午'
  if (hour < 14) return '中午'
  if (hour < 18) return '下午'
  if (hour < 23) return '晚上'
  return '深夜'
}
