/**
 * 和风天气 API 封装。
 *
 * 流程（无账号/账号申请见 https://dev.qweather.com/）：
 * 1. 城市名/经纬度 → LocationID 或坐标
 * 2. 拿 LocationID 查 /v7/weather/now（实时天气）
 * 3. 拼装成自然语言描述返回给 LLM
 *
 * 和风天气 GeoAPI 支持 city lookup（"北京" -> "101010100"）。
 * 实时天气 endpoint: GET /v7/weather/now?location={id}&key={apiKey}&lang=zh
 */

import { logBus } from '../logBus'

export async function getWeather(_args: Record<string, unknown>): Promise<string> {
  logBus.warn('weather', 'get_weather 已被移除')
  return '天气查询功能已移除。'
}
